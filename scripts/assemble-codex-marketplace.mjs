/** Assemble a Git-publishable offline catalog from the three tested native ZIPs. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexManifests } from './package-codex-plugin.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const platforms = ['darwin-arm64', 'darwin-x64', 'win32-x64'];
const fileLimit = 100 * 1024 * 1024;

// Release ZIPs are ZIP32 archives produced by our native packager. Inspect both
// central and local names before an extraction utility can write any entries.
function validateWindowsZip(bytes) {
  const normalized = Buffer.from(bytes);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('Unsupported Windows release ZIP');
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  let offset = bytes.readUInt32LE(end + 16);
  if (!count || count === 65_535 || count !== bytes.readUInt16LE(end + 8) || offset + centralSize !== end) throw new Error('Invalid Windows release ZIP directory');
  const names = new Set();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid Windows release ZIP entry');
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const next = offset + 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    if (next > end || flags & 1 || ![0, 8].includes(method) || size >= fileLimit) throw new Error('Unsupported or oversized Windows release ZIP entry');
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = decoder.decode(nameBytes).replaceAll('\\', '/');
    const parts = name.replace(/\/$/, '').split('/');
    if (parts[0] !== 'plot-and-kin-codex' || parts.some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f<>"|?*]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Unsafe Windows release ZIP path');
    const key = parts.join('/').toLowerCase();
    if (names.has(key)) throw new Error('Duplicate Windows release ZIP path');
    names.add(key);
    const attributes = bytes.readUInt32LE(offset + 38);
    const fileType = (attributes >>> 16) & 0xf000;
    if (![0, 0x4000, 0x8000].includes(fileType) || attributes & 0x400) throw new Error('Windows release ZIP contains a link or special file');
    const local = bytes.readUInt32LE(offset + 42);
    if (local + 30 > offset || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('Invalid Windows release ZIP local entry');
    const localNameLength = bytes.readUInt16LE(local + 26);
    if (localNameLength !== nameLength || !bytes.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)) throw new Error('Windows release ZIP entry names disagree');
    // Older .NET ZIP writers use backslashes. Normalize only entry names in a
    // temporary copy so Unix extraction has the same separator interpretation.
    for (let index = 0; index < nameLength; index++) if (nameBytes[index] === 92) {
      normalized[offset + 46 + index] = 47;
      normalized[local + 30 + index] = 47;
    }
    offset = next;
  }
  if (offset !== end) throw new Error('Invalid Windows release ZIP directory length');
  return normalized;
}

async function validateWindowsTree(directory, version) {
  async function walk(path) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('Windows marketplace cannot contain links or special files');
    if (stat.isFile() && stat.size >= fileLimit) throw new Error('Windows marketplace file exceeds GitHub\'s per-file limit');
    if (stat.isDirectory()) for (const name of await readdir(path)) await walk(join(path, name));
  }
  await walk(directory);
  const release = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'));
  if (release.schemaVersion !== 1 || release.platform !== 'win32-x64' || release.version !== version) throw new Error('Windows marketplace release metadata mismatch');
  for (const path of ['bin/node.exe', 'dist/cli.js', 'skills/research-property/SKILL.md', 'plugin.json', 'mcp.json', '.codex-plugin/plugin.json', 'assets/icon.png', 'LICENSE', 'package.json', 'package-lock.json']) {
    if (!(await lstat(join(directory, path))).isFile()) throw new Error(`Windows marketplace requires a regular file: ${path}`);
  }
  if (!(await lstat(join(directory, 'node_modules'))).isDirectory()) throw new Error('Windows marketplace requires bundled dependencies');
}

function unpackWindowsZip(archive, destination) {
  if (process.platform === 'win32') {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:PK_CODEX_ARCHIVE, $env:PK_CODEX_UNPACK)"], { env: { ...env, PK_CODEX_ARCHIVE: archive, PK_CODEX_UNPACK: destination }, stdio: 'pipe', timeout: 120_000 });
  } else execFileSync('/usr/bin/unzip', ['-q', archive, '-d', destination], { timeout: 120_000 });
}

export async function assembleCodexMarketplace({ assets, output, version, targets = platforms }) {
  if (!targets.length || targets.some(platform => !platforms.includes(platform)) || new Set(targets).size !== targets.length) throw new Error('Invalid marketplace targets');
  const catalog = { name: 'plot-and-kin', interface: { displayName: 'Plot & Kin' }, plugins: [] };
  const verified = [];
  const work = await mkdtemp(join(tmpdir(), 'pk-marketplace-'));
  try {
    // Verify all inputs before writing any publishable catalog files.
    for (const platform of targets) {
      const manifests = codexManifests({ version, platform });
      const name = `plot-and-kin-${version}-${platform}-codex.zip`;
      const archive = join(resolve(assets), name);
      const bytes = await readFile(archive);
      if (bytes.length >= fileLimit) throw new Error(`${name} exceeds GitHub's per-file limit`);
      const checksum = (await readFile(`${archive}.sha256`, 'utf8')).trim();
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (checksum !== `${hash}  ${name}`) throw new Error(`Native Codex ZIP checksum mismatch: ${name}`);
      let nativePlugin;
      if (platform === 'win32-x64') {
        const normalized = validateWindowsZip(bytes);
        // Extract the verified bytes, not a source file that could change between
        // checksum validation and extraction.
        const snapshot = join(work, name);
        await writeFile(snapshot, normalized);
        const extracted = join(work, 'windows');
        unpackWindowsZip(snapshot, extracted);
        nativePlugin = join(extracted, 'plot-and-kin-codex/plugins/plot-and-kin');
        await validateWindowsTree(nativePlugin, version);
      }
      verified.push({ platform, manifests, archive, hash, nativePlugin });
    }
    output = resolve(output);
    await mkdir(output, { recursive: true });
    if ((await readdir(output)).length) throw new Error('Marketplace destination must be empty to prevent mixing releases');
    for (const { platform, manifests, archive, hash, nativePlugin } of verified) {
      const name = `plot-and-kin-${platform}`;
      const pluginRoot = join(output, 'plugins', name);
      if (nativePlugin) {
        await cp(nativePlugin, pluginRoot, { recursive: true });
      } else {
        await mkdir(join(pluginRoot, 'scripts'), { recursive: true });
        await mkdir(join(pluginRoot, '.codex-plugin'));
        await mkdir(join(pluginRoot, 'assets'));
        await cp(join(root, 'extension/icon.png'), join(pluginRoot, 'assets/icon.png'));
        await cp(archive, join(pluginRoot, 'runtime.zip'));
        await cp(join(root, 'skills'), join(pluginRoot, 'skills'), { recursive: true });
        await cp(join(root, 'LICENSE'), join(pluginRoot, 'LICENSE'));
        const launcher = (await readFile(join(root, 'distribution/codex/launch.sh'), 'utf8')).replaceAll('__PK_PLATFORM__', platform).replaceAll('__PK_SHA256__', hash);
        await writeFile(join(pluginRoot, 'scripts/launch.sh'), launcher, { mode: 0o755 });
        const server = manifests.mcp.mcpServers['plot-and-kin'];
        server.command = './scripts/launch.sh';
        server.args = ['serve'];
      }
      const label = manifests.marketplace.interface.displayName.replace('Plot & Kin · ', '');
      manifests.plugin.name = name;
      manifests.plugin.extensions['com.openai'].interface.displayName = `Plot & Kin · ${label}`;
      manifests.compatibility.name = name;
      for (const [path, value] of [['plugin.json', manifests.plugin], ['.codex-plugin/plugin.json', manifests.compatibility], ['mcp.json', manifests.mcp]]) {
        await writeFile(join(pluginRoot, path), JSON.stringify(value, null, 2) + '\n');
      }
      catalog.plugins.push({ ...manifests.marketplace.plugins[0], name, source: { source: 'local', path: `./plugins/${name}` } });
    }
    await mkdir(join(output, '.agents/plugins'), { recursive: true });
    await writeFile(join(output, '.agents/plugins/marketplace.json'), JSON.stringify(catalog, null, 2) + '\n');
    await writeFile(join(output, 'README.md'), `# Plot & Kin marketplace\n\nInstall only the entry matching your computer: Mac Apple Silicon, Mac Intel, or Windows x64. Every package bundles its runtime and is verified during publication. Windows starts the bundled Node executable directly. Mac extracts its verified local runtime on first launch. No Node.js installation or runtime download is needed. Cases and settings remain in your home directory's .plot-and-kin folder, outside the plugin cache.\n\nThis is a custom Codex marketplace, not an official OpenAI directory listing. Add this repository or extracted folder as a marketplace source, then choose the matching entry and Install.\n\nVersion: ${version}\n\n[Documentation](https://jestatsio.github.io/plot-and-kin/) · [Source and support](https://github.com/jestatsio/plot-and-kin)\n`);
    return catalog;
  } finally { await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [assets, output] = process.argv.slice(2);
  if (!assets || !output) throw new Error('Usage: node scripts/assemble-codex-marketplace.mjs <release-assets> <empty-output>');
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  await assembleCodexMarketplace({ assets, output, version });
}
