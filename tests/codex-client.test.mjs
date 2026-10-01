/** Verify the real pinned Codex loader, not a simulated manifest expander. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assembleCodexMarketplace } from '../scripts/assemble-codex-marketplace.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'node_modules/@openai/codex/bin/codex.js');
const platform = `${process.platform}-${process.arch}`;
const supported = ['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(platform);
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

async function appServer(env, cwd, signal) {
  const child = spawn(process.execPath, [cli, 'app-server'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
  let nextId = 0;
  let diagnostic = '';
  let closed = false;
  let treeClosed = false;
  const pending = new Map();
  child.stderr.on('data', bytes => { diagnostic = (diagnostic + bytes.toString()).slice(-8000); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
  });
  function rejectPending(error) {
    closed = true;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  }
  const exit = new Promise(resolve => child.once('close', code => { treeClosed = true; rejectPending(new Error(`Codex exited (${code}): ${diagnostic}`)); resolve(); }));
  child.on('error', rejectPending);
  child.stdin.on('error', rejectPending);
  const rpc = (method, params) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('Codex app server is closed'));
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timed out: ${diagnostic}`)); }, 60_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  function terminateTree() {
    if (!child.pid || treeClosed) return;
    try {
      if (process.platform === 'win32') {
        const systemRoot = Object.entries(env).find(([key]) => /^SystemRoot$/i.test(key))?.[1];
        execFileSync(join(systemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 10_000, windowsHide: true });
      } else process.kill(-child.pid, 'SIGKILL');
    } catch { /* The owned process group may already have exited. */ }
  }
  signal.addEventListener('abort', terminateTree, { once: true });
  async function close() {
    child.stdin.end();
    const force = setTimeout(terminateTree, 5000);
    let deadline;
    try {
      await Promise.race([exit, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Codex process tree did not close within 20 seconds')), 20_000); })]);
    } finally {
      clearTimeout(force); clearTimeout(deadline);
      terminateTree();
      signal.removeEventListener('abort', terminateTree);
      rejectPending(new Error('Codex test client closed'));
      lines.close(); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    }
  }
  try {
    await rpc('initialize', { clientInfo: { name: 'plot-and-kin-acceptance', version }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    return { rpc, close };
  } catch (error) { await close(); throw error; }
}

test('real Codex installs both catalog formats and discovers usable tools and skills after restart', { skip: !supported, timeout: 300_000 }, async t => {
  const work = await mkdtemp(join(tmpdir(), 'pk-real-codex-'));
  try {
    const catalog = join(work, 'git-catalog');
    const assets = join(root, 'artifacts/release');
    await assembleCodexMarketplace({ assets, output: catalog, version, targets: [platform] });
    const unpacked = join(work, 'offline-catalog');
    const archive = join(assets, `plot-and-kin-${version}-${platform}-codex.zip`);
    if (process.platform === 'win32') {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:PK_ARCHIVE, $env:PK_UNPACK)"], { env: { ...env, PK_ARCHIVE: archive, PK_UNPACK: unpacked }, timeout: 120_000 });
    } else execFileSync('/usr/bin/unzip', ['-q', archive, '-d', unpacked], { timeout: 120_000 });

    for (const [name, source] of [[`plot-and-kin-${platform}`, catalog], ['plot-and-kin', join(unpacked, 'plot-and-kin-codex')]]) {
      const profile = join(work, name, 'codex');
      const home = join(work, name, 'home');
      const library = join(home, '.plot-and-kin');
      await mkdir(profile, { recursive: true });
      await mkdir(home, { recursive: true });
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP|TMPDIR)$/i.test(key)));
      const windowsRoot = Object.entries(env).find(([key]) => /^SystemRoot$/i.test(key))?.[1];
      // These overrides apply only to test child processes, never the operator's profile.
      Object.assign(env, { CODEX_HOME: profile, HOME: home, USERPROFILE: home, PK_LIBRARY_DIR: library, PK_SETTINGS_DIR: join(library, 'settings'), PATH: process.platform === 'win32' ? join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0') : '/usr/bin:/bin' });
      const run = args => execFileSync(process.execPath, [cli, ...args], { env, cwd: work, encoding: 'utf8', timeout: 90_000 });
      run(['plugin', 'marketplace', 'add', source]);
      const installed = JSON.parse(run(['plugin', 'add', `${name}@plot-and-kin`, '--json']));
      assert.equal(installed.version, version);
      let projectId;
      for (const restart of [false, true]) {
        const app = await appServer(env, work, t.signal);
        try {
          const details = await app.rpc('plugin/read', { marketplacePath: join(source, '.agents/plugins/marketplace.json'), pluginName: name });
          assert.equal(details.plugin.mcpServers.length, 1, 'Codex rejected the MCP manifest');
          assert.ok(details.plugin.skills.some(skill => skill.name.endsWith(':research-property')));
          const { thread } = await app.rpc('thread/start', { cwd: work, ephemeral: true });
          const status = await app.rpc('mcpServerStatus/list', { threadId: thread.id });
          const server = status.data.find(item => item.pluginId === `${name}@plot-and-kin`);
          assert.ok(server, 'Plugin server was not discovered by Codex');
          assert.equal(server.toolsError, null);
          assert.ok(Object.values(server.tools).some(tool => tool.name === 'welcome'), 'Codex must discover real tools, not only an installed plugin');
          const call = async (tool, args = {}) => {
            const result = await app.rpc('mcpServer/tool/call', { threadId: thread.id, server: server.name, tool, arguments: args });
            assert.notEqual(result.isError, true, JSON.stringify(result));
            return result.structuredContent.result;
          };
          assert.equal((await call('welcome')).ready, true);
          if (!restart) projectId = (await call('project_create', { address: 'Client installation fixture (synthetic)', question: 'Does the installed client preserve this case?' })).projectId;
          else assert.ok((await call('project_list')).some(project => project.projectId === projectId), 'Case missing after Codex restart');
        } finally { await app.close(); }
      }
    }
  } finally { await rm(work, { recursive: true, force: true }); }
});
