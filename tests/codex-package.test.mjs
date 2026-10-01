import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { codexManifests } from '../scripts/package-codex-plugin.mjs';
import { assembleCodexMarketplace } from '../scripts/assemble-codex-marketplace.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const platform = `${process.platform}-${process.arch}`;
const supported = ['darwin-arm64', 'darwin-x64', 'win32-x64'];
const testPackaged = process.env.PK_TEST_PACKAGED_DISTRIBUTION === '1' && supported.includes(platform);
const clientProcesses = new WeakMap();

test('native manifests are portable, stable, and do not require a system runtime', () => {
  for (const target of supported) {
    const first = codexManifests({ version: '1.0.0', platform: target });
    const next = codexManifests({ version: '1.0.1', platform: target });
    assert.equal(first.marketplace.name, next.marketplace.name);
    assert.equal(first.plugin.name, next.plugin.name);
    assert.equal(first.plugin.version, '1.0.0');
    assert.equal(next.plugin.version, '1.0.1');
    assert.equal(first.marketplace.plugins[0].source.path, './plugins/plot-and-kin');
    assert.equal(first.mcp.mcpServers['plot-and-kin'].command, `./bin/${target === 'win32-x64' ? 'node.exe' : 'node'}`);
    assert.ok(!first.mcp.mcpServers['plot-and-kin'].command.includes('${'), 'Portable executable commands never expand placeholders');
    assert.equal(first.mcp.mcpServers['plot-and-kin'].env, undefined, 'Never embed secrets or the build machine data directory');
  }
  assert.throws(() => codexManifests({ version: '1.0.0', platform: 'linux-x64' }), /Unsupported/);
  assert.throws(() => codexManifests({ version: '../escape', platform: 'darwin-arm64' }), /Invalid/);
});

async function unpack(archive, destination) {
  if (process.platform === 'win32') {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:PK_CODEX_ARCHIVE, $env:PK_CODEX_UNPACK)"], {
      env: { ...env, PK_CODEX_ARCHIVE: archive, PK_CODEX_UNPACK: destination }, stdio: 'pipe', timeout: 120_000,
    });
  } else execFileSync('/usr/bin/unzip', ['-q', archive, '-d', destination], { timeout: 120_000 });
}

async function launchParameters(plugin, data) {
  const config = JSON.parse(await readFile(join(plugin, 'mcp.json'), 'utf8')).mcpServers['plot-and-kin'];
  const expand = value => value.replaceAll('${PLUGIN_ROOT}', plugin);
  // No development Node/npm/Python on PATH, no inherited provider credentials,
  // and no access to the researcher's saved settings or library.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP|TMPDIR)$/i.test(key)));
  const windowsShell = config.command === 'powershell.exe';
  const systemRoot = Object.entries(env).find(([key]) => /^SystemRoot$/i.test(key))?.[1];
  const systemPath = windowsShell ? join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0') : '';
  return {
    command: resolveCommand(config.command, plugin), args: config.args.map(expand),
    cwd: data, env: { ...env, PATH: systemPath, ...(windowsShell ? { PSModulePath: 'C:\\missing-powershell-7-modules' } : {}), PK_STORAGE: 'local', PK_LIBRARY_DIR: data, PK_SETTINGS_DIR: join(data, 'settings') },
    stderr: 'pipe',
  };
}

async function connect(plugin, data) {
  const params = await launchParameters(plugin, data);
  const windowsShell = params.command === 'powershell.exe';
  const transport = new StdioClientTransport(params);
  const client = new Client({ name: 'codex-package-acceptance', version: '1.0.0' });
  const owned = { transport, windowsShell, stderr: '' };
  clientProcesses.set(client, owned);
  transport.stderr?.on('data', bytes => { owned.stderr = (owned.stderr + bytes.toString('utf8')).slice(-16_384); });
  try { await client.connect(transport); }
  catch (error) {
    const failure = new Error(`MCP connection failed: ${error.message}\nLauncher stderr: ${owned.stderr || '(empty)'}`, { cause: error });
    try { await closeClient(client); }
    catch (cleanupError) { failure.message += `\nProcess cleanup: ${cleanupError.message}`; }
    throw failure;
  }
  return client;
}

async function verifyWindowsLauncherEof(plugin, data) {
  const params = await launchParameters(plugin, data);
  const child = spawn(params.command, params.args, { cwd: params.cwd, env: params.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-16_384); });
  const lines = createInterface({ input: child.stdout });
  let exitResult;
  let primaryError;
  const exited = new Promise(resolveExit => child.once('close', (code, signal) => { exitResult = { code, signal }; resolveExit(exitResult); }));
  const timers = [];
  const deadline = (promise, label) => Promise.race([promise, new Promise((_, reject) => {
    timers.push(setTimeout(() => reject(new Error(`${label}: ${stderr || '(no launcher stderr)'}`)), 15_000));
  })]);
  try {
    const initialized = new Promise((resolveInitialized, reject) => {
      child.once('error', reject);
      child.stdin.once('error', reject);
      child.once('close', () => reject(new Error(`Launcher closed before MCP initialize: ${stderr}`)));
      lines.on('line', line => {
        try {
          const message = JSON.parse(line);
          if (message.id === 1) resolveInitialized(message);
        } catch (error) { reject(error); }
      });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'eof-regression', version: '1.0.0' } } }) + '\n');
    assert.ok((await deadline(initialized, 'MCP initialize timed out')).result?.serverInfo);
    child.stdin.end();
    // No SDK timeout or force-kill here. Exit zero proves that EOF reached Node
    // and the launcher waited for it instead of leaving its child behind.
    assert.deepEqual(await deadline(exited, 'Launcher did not exit after client EOF'), { code: 0, signal: null });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    for (const timer of timers) clearTimeout(timer);
    lines.close();
    let cleanupError;
    if (!exitResult && child.pid) {
      const result = spawnSync(join(process.env.SystemRoot ?? process.env.SYSTEMROOT, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
      if (result.error || (result.status !== 0 && result.status !== 128)) cleanupError = new Error(`Owned EOF-test process cleanup failed (${result.status}): ${result.error?.message ?? result.stderr}`);
    }
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    if (cleanupError && primaryError) primaryError.stack += `\n${cleanupError.stack}`;
    else if (cleanupError) throw cleanupError;
  }
}

async function closeClient(client) {
  if (!client) return;
  const owned = clientProcesses.get(client);
  const failures = [];
  // SDK close() terminates only its immediate child. Windows has no exec(), so
  // the Git launcher has a Node descendant that must be included in test-owned
  // process teardown. Never target unrelated processes by executable name.
  try {
    if (owned?.windowsShell && owned.transport.pid) {
      const taskkill = join(process.env.SystemRoot ?? process.env.SYSTEMROOT, 'System32', 'taskkill.exe');
      const result = spawnSync(taskkill, ['/PID', String(owned.transport.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
      if (result.error) throw new Error(`Owned launcher process cleanup failed: ${result.error.message}`);
      // taskkill returns 128 when the process completed before the request.
      if (result.status !== 0 && result.status !== 128) throw new Error(`Owned launcher process cleanup failed (${result.status}): ${result.stderr}`);
    }
  } catch (error) { failures.push(error); }
  finally {
    try { await client.close(); }
    catch (error) { failures.push(error); }
    clientProcesses.delete(client);
  }
  if (failures.length) throw new AggregateError(failures, 'Owned MCP process cleanup failed');
}

function resolveCommand(command, plugin) {
  // Follow Agent Plugins' command rules. The host resolves ./ against the
  // plugin, while placeholder expansion belongs only to args/env/cwd.
  assert.match(command, /^(?:\.\/[^\\]+|[A-Za-z0-9_.-]+)$/);
  assert.ok(!command.includes('${'));
  if (!command.startsWith('./')) return command;
  assert.ok(!command.split('/').includes('..'));
  return resolve(plugin, command);
}

async function call(client, name, args = {}) {
  let result;
  try { result = await client.callTool({ name, arguments: args }); }
  catch (error) { throw new Error(`${name} failed: ${error.message}\nLauncher stderr: ${clientProcesses.get(client)?.stderr || '(empty)'}`, { cause: error }); }
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return result.structuredContent.result;
}

test('extracted and relocated Codex package starts without Node on PATH and preserves evidence across cache replacement', { skip: !testPackaged, timeout: process.platform === 'win32' ? 900_000 : 300_000 }, async () => {
  // Run after release:package. Missing distribution artifacts must fail CI.
  const archive = join(root, 'artifacts/release', `plot-and-kin-${version}-${platform}-codex.zip`);
  const expected = (await readFile(`${archive}.sha256`, 'utf8')).split(/\s+/)[0];
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), expected);
  const work = await mkdtemp(join(tmpdir(), 'pk-codex-é space-'));
  let client;
  try {
    const extraction = join(work, 'download');
    await unpack(archive, extraction);
    const marketplace = join(extraction, 'plot-and-kin-codex');
    const catalog = JSON.parse(await readFile(join(marketplace, '.agents/plugins/marketplace.json'), 'utf8'));
    const source = resolve(marketplace, catalog.plugins[0].source.path);
    const original = JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8'));
    assert.equal(original.version, version);
    // Match the client's copy-into-cache behavior. Launching from the build
    // directory alone would not catch broken absolute paths and missing files.
    const firstCache = join(work, 'client cache', version, 'plot-and-kin');
    await cp(source, firstCache, { recursive: true });
    await rm(extraction, { recursive: true, force: true });
    const data = join(work, 'researcher library');
    await mkdir(data);
    client = await connect(firstCache, data);
    const tools = await client.listTools();
    assert.ok(tools.tools.some(tool => tool.name === 'project_create'));
    assert.ok(tools.tools.some(tool => tool.name === 'project_list'));
    const project = await call(client, 'project_create', { address: 'Synthetic marketplace fixture', question: 'Will evidence survive a plugin update?' });
    const projectId = project.projectId ?? project._id;
    const run = await call(client, 'run_start', { projectId });
    const sourceRecord = await call(client, 'source_import', {
      projectId, runId: run._id, title: 'Synthetic directory', mimeType: 'text/plain',
      base64: Buffer.from('Ada Example occupied Example House in 1901. Synthetic fixture.').toString('base64'),
    });
    await call(client, 'page_process', { projectId, runId: run._id, sourceId: sourceRecord._id, page: 1 });
    await closeClient(client); client = undefined;
    const secondCache = join(work, 'replacement cache', 'plot-and-kin');
    await cp(firstCache, secondCache, { recursive: true });
    await rm(firstCache, { recursive: true, force: true });
    client = await connect(secondCache, data);
    const projects = await call(client, 'project_list');
    assert.ok(projects.some(item => item.projectId === projectId));
    const evidence = await call(client, 'evidence_search', { projectId, query: 'Ada' });
    assert.match(JSON.stringify(evidence), /Ada Example/);
    const dossier = await call(client, 'project_dossier', { projectId });
    assert.match(JSON.stringify(dossier), /Synthetic directory/);
    const exported = await call(client, 'project_export', { projectId, format: 'html' });
    assert.match(JSON.stringify(exported), /html/);
    await closeClient(client); client = undefined;
    await rm(secondCache, { recursive: true, force: true });
    // Simulated uninstall removes the plugin only. Case data remains readable.
    assert.equal((await readFile(join(data, 'records.sqlite'))).subarray(0, 15).toString(), 'SQLite format 3');
  } finally {
    await closeClient(client);
    await rm(work, { recursive: true, force: true });
  }
});

test('Git catalog embeds verified offline payloads with explicit platform choices', async () => {
  const work = await mkdtemp(join(tmpdir(), 'pk-codex-catalog-'));
  try {
    const assets = join(work, 'assets');
    await mkdir(assets);
    for (const target of supported) {
      const name = `plot-and-kin-${version}-${target}-codex.zip`;
      const bytes = Buffer.from(`Synthetic packaging fixture for ${target}`);
      await writeFile(join(assets, name), bytes);
      const hash = createHash('sha256').update(bytes).digest('hex');
      await writeFile(join(assets, `${name}.sha256`), `${hash}  ${name}\n`);
    }
    const output = join(work, 'catalog');
    const catalog = await assembleCodexMarketplace({ assets, output, version });
    assert.equal(catalog.plugins.length, 3);
    for (const [index, entry] of catalog.plugins.entries()) {
      const target = supported[index];
      const plugin = resolve(output, entry.source.path);
      const manifest = JSON.parse(await readFile(join(plugin, 'plugin.json'), 'utf8'));
      assert.equal(entry.name, manifest.name);
      assert.equal(manifest.version, version);
      const config = JSON.parse(await readFile(join(plugin, 'mcp.json'), 'utf8')).mcpServers['plot-and-kin'];
      assert.equal(config.command, target === 'win32-x64' ? 'powershell.exe' : './scripts/launch.sh');
      const launcher = await readFile(join(plugin, 'scripts', target === 'win32-x64' ? 'launch.ps1' : 'launch.sh'), 'utf8');
      const payload = await readFile(join(plugin, 'runtime.zip'));
      assert.ok(launcher.includes(createHash('sha256').update(payload).digest('hex')));
      assert.ok(!launcher.includes('__PK_'));
    }
    await assert.rejects(assembleCodexMarketplace({ assets, output, version }), /must be empty/);
    const damaged = join(assets, `plot-and-kin-${version}-darwin-arm64-codex.zip`);
    await writeFile(damaged, 'Modified');
    await assert.rejects(assembleCodexMarketplace({ assets, output: join(work, 'unpublished'), version }), /checksum mismatch/);
  } finally { await rm(work, { recursive: true, force: true }); }
});

test('offline Git marketplace extracts once under concurrent launch and rejects a modified payload', { skip: !testPackaged, timeout: process.platform === 'win32' ? 900_000 : 300_000 }, async t => {
  const work = await mkdtemp(join(tmpdir(), 'pk-codex-offline-é space-'));
  const clients = [];
  let phase = 'assemble offline catalog';
  let primaryError;
  try {
    const output = join(work, 'marketplace');
    const catalog = await assembleCodexMarketplace({ assets: join(root, 'artifacts/release'), output, version, targets: [platform] });
    const plugin = resolve(output, catalog.plugins[0].source.path);
    const firstData = join(work, 'case-one');
    const secondData = join(work, 'case-two');
    await Promise.all([mkdir(firstData), mkdir(secondData)]);
    // Both clients cold-start the same plugin. Extraction must publish exactly
    // one complete runtime and leave the MCP stdout stream unpolluted.
    phase = 'concurrent cold MCP connections';
    const connected = await Promise.allSettled([connect(plugin, firstData), connect(plugin, secondData)]);
    for (const result of connected) if (result.status === 'fulfilled') clients.push(result.value);
    for (const result of connected) if (result.status === 'rejected') throw result.reason;
    phase = 'create Unicode case';
    const project = await call(clients[0], 'project_create', { address: 'Offline Git fixture · Émilie / 東京', question: 'Does the plugin start offline?' });
    assert.ok(project.projectId ?? project._id);
    phase = 'Unicode case roundtrip';
    assert.match(JSON.stringify(await call(clients[0], 'project_list')), /Émilie \/ 東京/);
    assert.ok((await clients[1].listTools()).tools.length > 0);
    phase = 'owned process-tree shutdown';
    await Promise.all(clients.map(client => closeClient(client)));
    clients.length = 0;
    if (process.platform === 'win32') {
      phase = 'normal Windows launcher EOF shutdown';
      await verifyWindowsLauncherEof(plugin, firstData);
    }
    // Every launch checks the shipped bytes even after a runtime was cached.
    phase = 'tampered archive rejection';
    await writeFile(join(plugin, 'runtime.zip'), 'Modified archive');
    const config = JSON.parse(await readFile(join(plugin, 'mcp.json'), 'utf8')).mcpServers['plot-and-kin'];
    let failed;
    try {
      execFileSync(resolveCommand(config.command, plugin), config.args.map(value => value.replaceAll('${PLUGIN_ROOT}', plugin)), { encoding: 'utf8', timeout: 10_000, env: process.env });
    } catch (error) { failed = error; }
    assert.ok(failed);
    assert.match(String(failed.stderr), /checksum failed/);
  } catch (error) {
    primaryError = error;
    t.diagnostic(`Offline launcher failed during ${phase}: ${error.stack ?? error}`);
    for (const client of clients) t.diagnostic(`Launcher stderr: ${clientProcesses.get(client)?.stderr || '(empty)'}`);
    throw error;
  } finally {
    const cleanup = await Promise.allSettled(clients.map(client => closeClient(client)));
    try { await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { cleanup.push({ status: 'rejected', reason: error }); }
    const failures = cleanup.filter(result => result.status === 'rejected');
    for (const result of failures) t.diagnostic(`Cleanup failure: ${result.reason.stack ?? result.reason}`);
    if (!primaryError && failures.length) throw new AggregateError(failures.map(result => result.reason), 'Offline launcher cleanup failed');
  }
});
