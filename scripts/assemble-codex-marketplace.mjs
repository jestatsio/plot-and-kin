/** Assemble a Git-publishable offline catalog from the three tested native ZIPs. */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexManifests } from './package-codex-plugin.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const platforms = ['darwin-arm64', 'darwin-x64', 'win32-x64'];

export async function assembleCodexMarketplace({ assets, output, version, targets = platforms }) {
  if (!targets.length || targets.some(platform => !platforms.includes(platform)) || new Set(targets).size !== targets.length) throw new Error('Invalid marketplace targets');
  const catalog = { name: 'plot-and-kin', interface: { displayName: 'Plot & Kin' }, plugins: [] };
  const verified = [];
  // Verify all inputs before writing any publishable catalog files.
  for (const platform of targets) {
    const manifests = codexManifests({ version, platform });
    const name = `plot-and-kin-${version}-${platform}-codex.zip`;
    const archive = join(resolve(assets), name);
    const bytes = await readFile(archive);
    if (bytes.length >= 100 * 1024 * 1024) throw new Error(`${name} exceeds GitHub's per-file limit`);
    const checksum = (await readFile(`${archive}.sha256`, 'utf8')).trim();
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (checksum !== `${hash}  ${name}`) throw new Error(`Native Codex ZIP checksum mismatch: ${name}`);
    verified.push({ platform, manifests, archive, hash });
  }
  output = resolve(output);
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error('Marketplace destination must be empty to prevent mixing releases');
  for (const { platform, manifests, archive, hash } of verified) {
    const name = `plot-and-kin-${platform}`;
    const pluginRoot = join(output, 'plugins', name);
    await mkdir(join(pluginRoot, 'scripts'), { recursive: true });
    await mkdir(join(pluginRoot, '.codex-plugin'));
    await mkdir(join(pluginRoot, 'assets'));
    await cp(join(root, 'extension/icon.png'), join(pluginRoot, 'assets/icon.png'));
    await cp(archive, join(pluginRoot, 'runtime.zip'));
    await cp(join(root, 'skills'), join(pluginRoot, 'skills'), { recursive: true });
    await cp(join(root, 'LICENSE'), join(pluginRoot, 'LICENSE'));
    const windows = platform === 'win32-x64';
    const script = windows ? 'launch.ps1' : 'launch.sh';
    const launcher = (await readFile(join(root, 'distribution/codex', script), 'utf8')).replaceAll('__PK_PLATFORM__', platform).replaceAll('__PK_SHA256__', hash);
    await writeFile(join(pluginRoot, 'scripts', script), launcher, { mode: 0o755 });
    const label = manifests.marketplace.interface.displayName.replace('Plot & Kin · ', '');
    manifests.plugin.name = name;
    manifests.plugin.extensions['com.openai'].interface.displayName = `Plot & Kin · ${label}`;
    manifests.compatibility.name = name;
    const server = manifests.mcp.mcpServers['plot-and-kin'];
    server.command = windows ? 'powershell.exe' : './scripts/launch.sh';
    server.args = windows
      ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', '${PLUGIN_ROOT}/scripts/launch.ps1', 'serve']
      : ['serve'];
    for (const [path, value] of [['plugin.json', manifests.plugin], ['.codex-plugin/plugin.json', manifests.compatibility], ['mcp.json', manifests.mcp]]) {
      await writeFile(join(pluginRoot, path), JSON.stringify(value, null, 2) + '\n');
    }
    catalog.plugins.push({ ...manifests.marketplace.plugins[0], name, source: { source: 'local', path: `./plugins/${name}` } });
  }
  await mkdir(join(output, '.agents/plugins'), { recursive: true });
  await writeFile(join(output, '.agents/plugins/marketplace.json'), JSON.stringify(catalog, null, 2) + '\n');
  await writeFile(join(output, 'README.md'), `# Plot & Kin marketplace\n\nInstall only the entry matching your computer: Mac Apple Silicon, Mac Intel, or Windows x64. The runtime is bundled and verified before first launch. No Node.js installation or runtime download is needed. Cases and settings remain in your home directory's .plot-and-kin folder, outside the plugin cache.\n\nThis is a custom Codex marketplace, not an official OpenAI directory listing. Add this repository or extracted folder as a marketplace source, then choose the matching entry and Install.\n\nVersion: ${version}\n\n[Documentation](https://jestatsio.github.io/plot-and-kin/) · [Source and support](https://github.com/jestatsio/plot-and-kin)\n`);
  return catalog;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [assets, output] = process.argv.slice(2);
  if (!assets || !output) throw new Error('Usage: node scripts/assemble-codex-marketplace.mjs <release-assets> <empty-output>');
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  await assembleCodexMarketplace({ assets, output, version });
}
