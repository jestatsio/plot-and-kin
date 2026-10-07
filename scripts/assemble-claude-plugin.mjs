/** Build a small, readable Claude Code plugin with locked registry dependencies. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function assembleClaudePlugin({ output, assets }) {
  output = resolve(output);
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error('Claude plugin destination must be empty to prevent mixing releases');
  const sourcePackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const pkg = Object.fromEntries(['name', 'version', 'description', 'type', 'license', 'engines', 'dependencies'].map(key => [key, sourcePackage[key]]));
  // Claude Code refuses overrides and executes no dependency lifecycle scripts.
  // The only source override affects a development-only extension packager.
  lock.packages = Object.fromEntries(Object.entries(lock.packages).filter(([, entry]) => !entry.dev));
  lock.packages[''] = { name: pkg.name, version: pkg.version, license: pkg.license, engines: pkg.engines, dependencies: pkg.dependencies };
  for (const entry of ['dist', 'src', 'skills', 'LICENSE']) await cp(join(root, entry), join(output, entry), { recursive: true });
  await cp(join(root, 'distribution/claude-code/README.md'), join(output, 'README.md'));
  await mkdir(join(output, '.claude-plugin'));
  const json = (path, value) => writeFile(join(output, path), JSON.stringify(value, null, 2) + '\n');
  await json('package.json', pkg);
  await json('package-lock.json', lock);
  await json('.claude-plugin/plugin.json', {
    name: pkg.name, version: pkg.version, description: 'Research property history with archival evidence, reviewable findings, and saved local dossiers.',
    author: { name: 'JEStats', url: 'https://jestats.io' },
    homepage: 'https://jestatsio.github.io/plot-and-kin/',
    repository: 'https://github.com/jestatsio/plot-and-kin', license: pkg.license,
    keywords: ['property-history', 'research', 'archives'],
  });
  await json('.mcp.json', { mcpServers: { 'plot-and-kin': {
    command: 'node', args: ['--disable-warning=ExperimentalWarning', '${CLAUDE_PLUGIN_ROOT}/dist/cli.js', 'serve'],
  } } });
  await json('.claude-plugin/marketplace.json', {
    name: 'plot-and-kin', owner: { name: 'JEStats' }, description: 'Evidence-backed property history research for Claude Code.',
    plugins: [{ name: pkg.name, source: './', version: pkg.version, description: 'Evidence-backed property history research.' }],
  });
  if (assets) {
    assets = resolve(assets);
    await mkdir(assets, { recursive: true });
    const name = `plot-and-kin-${pkg.version}-claude-code.zip`;
    const artifact = join(assets, name);
    // An existing ZIP would append stale files instead of representing this build.
    try { await readFile(artifact); throw new Error('Claude plugin ZIP already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    execFileSync('zip', ['-q', '-r', artifact, '.'], { cwd: output, stdio: 'inherit' });
    const hash = createHash('sha256').update(await readFile(artifact)).digest('hex');
    await writeFile(`${artifact}.sha256`, `${hash}  ${name}\n`);
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, assets] = process.argv.slice(2);
  if (!output) throw new Error('Usage: node scripts/assemble-claude-plugin.mjs <empty-output> [release-assets]');
  await assembleClaudePlugin({ output, assets });
}
