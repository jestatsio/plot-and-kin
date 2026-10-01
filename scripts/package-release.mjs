/** Build only on the target platform so native PDF/image dependencies are real. */
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeVersion = '22.23.2';
// Pinned from https://nodejs.org/dist/v22.23.2/SHASUMS256.txt.
const runtimes = {
  'darwin-arm64': ['node-v22.23.2-darwin-arm64.tar.gz', '61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6'],
  'darwin-x64': ['node-v22.23.2-darwin-x64.tar.gz', '58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026'],
  'win32-x64': ['node-v22.23.2-win-x64.zip', '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97'],
};
const platform = `${process.platform}-${process.arch}`;
if (!runtimes[platform]) throw new Error(`No researcher release target for ${platform}`);
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version)) throw new Error('Invalid package version');
const output = resolve(process.argv[2] ?? join(root, 'artifacts/release'));
await mkdir(output, { recursive: true });
const work = await mkdtemp(join(tmpdir(), 'pk-release-'));
const stage = join(work, 'plot-and-kin');
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });
try {
  await mkdir(join(stage, 'bin'), { recursive: true });
  for (const entry of ['dist', 'skills', 'LICENSE', 'README.md', 'package.json', 'package-lock.json']) {
    await cp(join(root, entry), join(stage, entry), { recursive: true });
  }
  await mkdir(join(stage, 'scripts'));
  await cp(join(root, 'scripts/smoke-release.mjs'), join(stage, 'scripts/smoke-release.mjs'));
  // Use npm's JS entry point instead of a Windows .cmd shell. Production install
  // occurs on each target architecture, including its optional native packages.
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run with npm run release:package so npm is available to the build');
  run(process.execPath, [npmCli, 'ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stage });
  const [runtimeFile, runtimeHash] = runtimes[platform];
  const response = await fetch(`https://nodejs.org/dist/v${runtimeVersion}/${runtimeFile}`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Node runtime download failed (${response.status})`);
  const runtime = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(runtime).digest('hex') !== runtimeHash) throw new Error('Node runtime checksum mismatch');
  const runtimeArchive = join(work, runtimeFile);
  await writeFile(runtimeArchive, runtime);
  const runtimeDirectory = runtimeFile.replace(/\.(?:tar\.gz|zip)$/, '');
  if (process.platform === 'win32') {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:PK_ARCHIVE -DestinationPath $env:PK_UNPACK'], { env: { ...process.env, PK_ARCHIVE: runtimeArchive, PK_UNPACK: work } });
    await cp(join(work, runtimeDirectory, 'node.exe'), join(stage, 'bin/node.exe'));
  } else {
    run('tar', ['-xzf', runtimeArchive, '-C', work]);
    await cp(join(work, runtimeDirectory, 'bin/node'), join(stage, 'bin/node'));
    await chmod(join(stage, 'bin/node'), 0o755);
  }
  await cp(join(work, runtimeDirectory, 'LICENSE'), join(stage, 'bin/NODE-LICENSE'));
  await writeFile(join(stage, 'release.json'), JSON.stringify({ schemaVersion: 1, version: pkg.version, platform, runtimeVersion, runtimeSha256: runtimeHash }, null, 2) + '\n');
  const bundledNode = join(stage, process.platform === 'win32' ? 'bin/node.exe' : 'bin/node');
  run(bundledNode, [join(stage, 'scripts/smoke-release.mjs')], { cwd: work });
  const artifactName = `plot-and-kin-${pkg.version}-${platform}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`;
  const artifact = join(output, artifactName);
  if (process.platform === 'win32') {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -LiteralPath $env:PK_STAGE -DestinationPath $env:PK_ARTIFACT -Force'], { env: { ...process.env, PK_STAGE: stage, PK_ARTIFACT: artifact } });
  } else {
    run('tar', ['-czf', artifact, '-C', work, 'plot-and-kin']);
  }
  const hash = createHash('sha256').update(await readFile(artifact)).digest('hex');
  await writeFile(`${artifact}.sha256`, `${hash}  ${artifactName}\n`);
  await writeFile(join(output, 'version.txt'), pkg.version + '\n');
  process.stdout.write(`Built and smoke-tested ${artifactName}\n`);
} finally {
  await rm(work, { recursive: true, force: true });
}
