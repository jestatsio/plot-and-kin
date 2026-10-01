/** Package the tested native runtime as an offline, relocatable Codex marketplace. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const supportedPlatforms = ['darwin-arm64', 'darwin-x64', 'win32-x64'];
const marketplaceName = 'plot-and-kin';
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));

export function codexManifests({ version, platform }) {
  if (!supportedPlatforms.includes(platform)) throw new Error(`Unsupported Codex plugin platform: ${platform}`);
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid Codex plugin version');
  const platformLabel = { 'darwin-arm64': 'Mac · Apple Silicon', 'darwin-x64': 'Mac · Intel', 'win32-x64': 'Windows · x64' }[platform];
  const identity = {
    name: 'plot-and-kin', version,
    description: 'Evidence-backed property research with archival sources, reviewable claims, and portable dossiers.',
  };
  const presentation = {
    displayName: 'Plot & Kin',
    shortDescription: 'Discover the stories behind an address.',
    longDescription: `Research property history, preserve your evidence, and build a reviewable dossier. ${platformLabel}. Local storage works immediately without an account or API key.`,
    developerName: 'JEStats', category: 'Productivity',
    websiteURL: 'https://jestatsio.github.io/plot-and-kin/',
    privacyPolicyURL: 'https://jestatsio.github.io/plot-and-kin/privacy.html',
    composerIcon: './assets/icon.png', logo: './assets/icon.png',
    defaultPrompt: ['Help me research the history of a property.', 'Show my saved research cases.'],
    brandColor: '#173F35',
  };
  return {
    plugin: {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...identity,
      author: { name: 'JEStats', url: 'https://jestats.io' },
      homepage: 'https://jestatsio.github.io/plot-and-kin/',
      repository: 'https://github.com/jestatsio/plot-and-kin', license: 'Apache-2.0',
      keywords: ['property-history', 'research', 'archives'],
      extensions: { 'com.openai': { interface: presentation } },
    },
    compatibility: { ...identity, skills: './skills/', mcpServers: './mcp.json', interface: presentation },
    mcp: {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        'plot-and-kin': {
          type: 'stdio',
          // Portable commands are bare executable names or contained ./ paths.
          // PLUGIN_ROOT expansion is only supported in args, env values, cwd.
          command: `./bin/${platform === 'win32-x64' ? 'node.exe' : 'node'}`,
          args: ['--disable-warning=ExperimentalWarning', '${PLUGIN_ROOT}/dist/cli.js', 'serve'],
        },
      },
    },
    marketplace: {
      name: marketplaceName,
      interface: { displayName: `Plot & Kin · ${platformLabel}` },
      plugins: [{
        name: 'plot-and-kin',
        source: { source: 'local', path: './plugins/plot-and-kin' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
      }],
    },
  };
}

// No build-machine symlinks may escape into the installed plugin. npm's .bin
// entries are build conveniences only and are not needed by the stdio server.
async function rejectSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Codex package contains a symlink: ${path}`);
    if (entry.isDirectory()) await rejectSymlinks(path);
  }
}

export async function packageCodexPlugin({ stage, output, platform, version }) {
  const manifests = codexManifests({ version, platform });
  stage = resolve(stage);
  output = resolve(output);
  const release = JSON.parse(await readFile(join(stage, 'release.json'), 'utf8'));
  if (release.version !== version || release.platform !== platform) throw new Error('Codex package must use the matching native release stage');
  for (const path of ['dist/cli.js', platform === 'win32-x64' ? 'bin/node.exe' : 'bin/node', 'skills/research-property/SKILL.md']) {
    if (!(await lstat(join(stage, path))).isFile()) throw new Error(`Codex package requires a regular file: ${path}`);
  }
  await mkdir(output, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'pk-codex-package-'));
  try {
    const marketplaceRoot = join(work, 'plot-and-kin-codex');
    const pluginRoot = join(marketplaceRoot, 'plugins/plot-and-kin');
    await mkdir(join(marketplaceRoot, '.agents/plugins'), { recursive: true });
    await cp(stage, pluginRoot, {
      recursive: true,
      filter: source => source !== join(stage, 'node_modules/.bin'),
    });
    await rejectSymlinks(pluginRoot);
    await mkdir(join(pluginRoot, '.codex-plugin'), { recursive: true });
    await mkdir(join(pluginRoot, 'assets'), { recursive: true });
    await cp(join(sourceRoot, 'extension/icon.png'), join(pluginRoot, 'assets/icon.png'));
    const saveJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
    await saveJson(join(pluginRoot, 'plugin.json'), manifests.plugin);
    await saveJson(join(pluginRoot, '.codex-plugin/plugin.json'), manifests.compatibility);
    await saveJson(join(pluginRoot, 'mcp.json'), manifests.mcp);
    await saveJson(join(marketplaceRoot, '.agents/plugins/marketplace.json'), manifests.marketplace);
    await writeFile(join(marketplaceRoot, 'INSTALL.txt'), `Plot & Kin ${version} for ${platform}\n\nThis folder is a self-contained Codex marketplace. No Node.js installation,\npackage manager, or additional runtime download is needed.\n\n1. Extract the complete ZIP into a permanent folder. Keep the hidden .agents\n   directory and the plugins directory together.\n2. Add this extracted folder as a local marketplace source in a Codex client\n   that supports local marketplaces, then select Plot & Kin and Install.\n   If using the Codex CLI, the equivalent source registration is:\n   codex plugin marketplace add "/absolute/path/to/plot-and-kin-codex"\n3. Start a new chat and ask: "Help me research the history of a property."\n\nAvailability of local-source controls varies by client version. The source\nregistration step is separate from clicking Install. This is a custom\nmarketplace, not an official OpenAI directory listing.\n\nYour cases, original documents, and settings live in your home directory's\n.plot-and-kin folder by default, outside this plugin. Installing a new plugin\nversion or removing the plugin cache does not remove those files.\n\nTo update, extract the new release to a permanent folder and update the local\nmarketplace source to that folder. Refresh the marketplace, then reopen the\nclient. Keep a portable case backup before upgrading. The marketplace and\nplugin identifiers remain the same across releases.\n\nOptional Astra and scan processing use the existing guided setup and OS\ncredential vault. Never enter credentials into a chat.\n`);
    const artifactName = `plot-and-kin-${version}-${platform}-codex.zip`;
    const artifact = join(output, artifactName);
    await rm(artifact, { force: true });
    if (process.platform === 'win32') {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:PK_CODEX_STAGE, $env:PK_CODEX_ARTIFACT, [IO.Compression.CompressionLevel]::Optimal, $true)"], {
        env: { ...env, PK_CODEX_STAGE: marketplaceRoot, PK_CODEX_ARTIFACT: artifact }, stdio: 'inherit',
      });
    } else {
      execFileSync('/usr/bin/zip', ['-q', '-r', artifact, 'plot-and-kin-codex'], { cwd: work, stdio: 'inherit' });
    }
    const hash = createHash('sha256').update(await readFile(artifact)).digest('hex');
    await writeFile(`${artifact}.sha256`, `${hash}  ${artifactName}\n`);
    process.stdout.write(`Built self-contained Codex marketplace ${artifactName}\n`);
    return artifact;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [stage, output] = process.argv.slice(2);
  if (!stage || !output) throw new Error('Usage: node scripts/package-codex-plugin.mjs <native-stage> <output>');
  const { platform, version } = JSON.parse(await readFile(join(resolve(stage), 'release.json'), 'utf8'));
  await packageCodexPlugin({ stage, output, platform, version });
}
