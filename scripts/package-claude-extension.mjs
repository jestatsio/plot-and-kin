/** Package a validated native release tree as a self-contained Claude Desktop extension. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packExtension, unpackExtension, getMcpConfigForManifest, MANIFEST_SCHEMAS } from '@anthropic-ai/mcpb';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export const CLAUDE_TARGETS = Object.freeze({
  'darwin-arm64': 'macOS · Apple Silicon',
  'darwin-x64': 'macOS · Intel',
  'win32-x64': 'Windows · x64',
});
const releaseEntries = ['bin', 'dist', 'node_modules', 'skills', 'LICENSE', 'README.md', 'package.json', 'package-lock.json', 'release.json'];

export async function createClaudeManifest({ platform, version }) {
  if (!Object.hasOwn(CLAUDE_TARGETS, platform)) throw new Error(`Unsupported Claude extension target: ${platform}`);
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid extension version');
  const manifest = JSON.parse(await readFile(join(root, 'extension/manifest.json'), 'utf8'));
  manifest.version = version;
  // MCPB has platform constraints but no CPU constraint. Name the CPU in the
  // installation dialog and release filename so people can choose the right file.
  manifest.display_name = `Plot & Kin (${CLAUDE_TARGETS[platform]})`;
  manifest.compatibility.platforms = [platform.split('-')[0]];
  manifest.server.entry_point = platform === 'win32-x64' ? 'bin/node.exe' : 'bin/node';
  manifest.server.mcp_config.command = '${__dirname}/' + manifest.server.entry_point;
  return MANIFEST_SCHEMAS['0.3'].parse(manifest);
}

/** Exercise the exact config Claude will resolve, using only isolated test data. */
export async function smokeClaudeExtension({ artifact, platform, version }) {
  assert.equal(platform, `${process.platform}-${process.arch}`, 'Extension smoke must run on its native target');
  const work = await mkdtemp(join(tmpdir(), 'pk-mcpb-smoke-'));
  const firstInstall = join(work, 'First installation with spaces');
  const updatedInstall = join(work, 'Updated installation with spaces');
  const profile = join(work, 'researcher-home');
  const defaultLibrary = join(profile, '.plot-and-kin');
  const library = join(work, 'research-library');
  const settings = join(defaultLibrary, 'settings');
  const savedSettings = JSON.stringify({ version: 1, storage: 'local', libraryDir: library });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^(?:PK_|ASTRA_DB_|OPENAI_|ANTHROPIC_|NODE_OPTIONS$)/.test(key)));
  // No PK configuration and no Node on PATH: first launch must discover its own
  // durable home directory and use the binary packaged inside the extension.
  Object.assign(env, { HOME: profile, USERPROFILE: profile, PATH: join(work, 'empty-path') });
  let projectId;
  async function launch(directory, create) {
    assert.equal(await unpackExtension({ mcpbPath: artifact, outputDir: directory, silent: true }), true, 'MCPB extraction failed');
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, version);
    const release = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'));
    assert.equal(release.platform, platform);
    const config = await getMcpConfigForManifest({ manifest, extensionPath: directory, systemDirs: {}, userConfig: {}, pathSeparator: sep });
    assert.equal(config.command, `${directory}/${manifest.server.entry_point}`);
    const client = new Client({ name: 'plot-and-kin-extension-smoke', version: '1.0.0' });
    const transport = new StdioClientTransport({ ...config, env: { ...env, ...config.env }, cwd: work, stderr: 'pipe' });
    transport.stderr?.resume();
    try {
      await client.connect(transport);
      assert.ok((await client.listTools()).tools.some(tool => tool.name === 'welcome'));
      assert.ok((await client.listPrompts()).prompts.some(prompt => prompt.name === 'getting_started'));
      const welcome = await client.callTool({ name: 'welcome', arguments: {} });
      assert.equal(welcome.isError, undefined);
      assert.equal(welcome.structuredContent.result.ready, true);
      if (create) {
        const created = await client.callTool({ name: 'project_create', arguments: { address: 'Extension installation fixture (synthetic)', question: 'Does this local case survive an extension update?' } });
        assert.equal(created.isError, undefined);
        projectId = created.structuredContent.result.projectId;
        assert.ok(projectId);
      } else {
        const projects = await client.callTool({ name: 'project_list', arguments: {} });
        assert.equal(projects.isError, undefined);
        assert.ok(projects.structuredContent.result.some(project => project.projectId === projectId), 'Case did not survive the extension replacement');
      }
    } finally { await client.close(); }
  }
  try {
    await launch(firstInstall, true);
    // Reuse an explicitly configured library after replacement. Moving this
    // isolated fixture also proves the second launch reads the saved setting,
    // instead of accidentally finding the original default database.
    await rename(defaultLibrary, library);
    await mkdir(settings, { recursive: true });
    await writeFile(join(settings, 'settings.json'), savedSettings);
    await rm(firstInstall, { recursive: true, force: true });
    await launch(updatedInstall, false);
    assert.equal(await readFile(join(settings, 'settings.json'), 'utf8'), savedSettings, 'Extension changed saved setup');
    process.stdout.write(`Claude extension smoke passed: ${platform}, first local case, MCP prompts, replacement install, saved settings.\n`);
  } finally { await rm(work, { recursive: true, force: true }); }
}

export async function packageClaudeExtension({ stage, output, platform, version }) {
  const manifest = await createClaudeManifest({ platform, version });
  const release = JSON.parse(await readFile(join(stage, 'release.json'), 'utf8'));
  assert.equal(release.platform, platform, 'Release platform does not match extension target');
  assert.equal(release.version, version, 'Release version does not match extension target');
  assert.equal(platform, `${process.platform}-${process.arch}`, 'Build and test extensions on their native target');
  for (const entry of [manifest.server.entry_point, 'dist/cli.js', 'bin/NODE-LICENSE']) {
    assert.ok((await stat(join(stage, entry))).isFile(), `Release is missing ${entry}`);
  }
  const work = await mkdtemp(join(tmpdir(), 'pk-mcpb-build-'));
  try {
    const extensionPath = join(work, 'extension');
    await mkdir(extensionPath);
    // Copy only distribution files. User settings, local research, environment
    // files, and build-workspace metadata can never enter from the stage root.
    for (const entry of releaseEntries) await cp(join(stage, entry), join(extensionPath, entry), { recursive: true });
    if (manifest.icon) {
      assert.match(manifest.icon, /^[a-z\d][a-z\d_.-]*\.png$/i, 'Extension icon must be a local PNG filename');
      await cp(join(root, 'extension', manifest.icon), join(extensionPath, manifest.icon));
    }
    await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const artifactName = `plot-and-kin-${version}-${platform}.mcpb`;
    const temporaryArtifact = join(work, artifactName);
    assert.equal(await packExtension({ extensionPath, outputPath: temporaryArtifact, silent: true }), true, 'Official MCPB validation or packaging failed');
    await smokeClaudeExtension({ artifact: temporaryArtifact, platform, version });
    await mkdir(output, { recursive: true });
    const artifact = join(output, artifactName);
    // Output may be on a different filesystem than the temporary directory.
    const stagedOutput = join(output, `${artifactName}.${process.pid}.tmp`);
    try {
      await cp(temporaryArtifact, stagedOutput);
      await rename(stagedOutput, artifact);
    } finally { await rm(stagedOutput, { force: true }); }
    const sha256 = createHash('sha256').update(await readFile(artifact)).digest('hex');
    await writeFile(`${artifact}.sha256`, `${sha256}  ${artifactName}\n`);
    process.stdout.write(`Built and smoke-tested ${artifactName}\n`);
    return { artifact, sha256 };
  } finally { await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--stage' || args[2] !== '--output') throw new Error('Usage: node scripts/package-claude-extension.mjs --stage <native-release-directory> --output <artifact-directory>');
  const stage = resolve(args[1]);
  const { platform, version } = JSON.parse(await readFile(join(stage, 'release.json'), 'utf8'));
  await packageClaudeExtension({ stage, output: resolve(args[3]), platform, version });
}
