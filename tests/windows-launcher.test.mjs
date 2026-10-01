/** Exercise cached Windows launcher I/O without packaging the application. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

for (const withoutConsole of [false, true]) {
test(`Windows launcher preserves duplex Unicode and EOF (detached console: ${withoutConsole})`, { skip: process.platform !== 'win32', timeout: 60_000 }, async t => {
  const work = await mkdtemp(join(tmpdir(), 'pk-win-launcher-é space-'));
  const systemRoot = Object.entries(process.env).find(([key]) => /^SystemRoot$/i.test(key))[1];
  const powershell = join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  // Full distribution tests cover cold extraction. This tiny valid empty ZIP
  // and prepared cache isolate stream behavior from native-runtime compression.
  const archive = Buffer.alloc(22);
  archive.writeUInt32LE(0x06054b50);
  const hash = createHash('sha256').update(archive).digest('hex');
  const stage = join(work, `runtime-${hash}`);
  const plugin = join(stage, 'plot-and-kin-codex/plugins/plot-and-kin');
  const payload = join(work, 'runtime.zip');
  let child;
  let closed;
  let didClose = false;
  let lines;
  let stderr = '';
  let timer;
  let primaryError;
  try {
    await mkdir(join(plugin, 'bin'), { recursive: true });
    await mkdir(join(plugin, 'dist'));
    await cp(process.execPath, join(plugin, 'bin/node.exe'));
    await writeFile(join(plugin, 'dist/cli.js'), `
process.stderr.write('fixture ready\\n');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  let end;
  while ((end = input.indexOf('\\n')) >= 0) {
    const request = JSON.parse(input.slice(0, end));
    input = input.slice(end + 1);
    process.stdout.write(JSON.stringify({ id: request.id, result: request.params.text }) + '\\n');
  }
});
process.stdin.on('end', () => process.stderr.write('fixture EOF\\n'));
`);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP)$/i.test(key)));
    await writeFile(payload, archive);
    await writeFile(join(stage, '.payload-sha256'), hash);
    const source = await readFile(new URL('../distribution/codex/launch.ps1', import.meta.url), 'utf8');
    await mkdir(join(work, 'scripts'));
    const launcher = join(work, 'scripts/launch.ps1');
    await writeFile(launcher, source.replaceAll('__PK_SHA256__', hash).replaceAll('__PK_PLATFORM__', 'win32-x64'));
    // Codex uses CREATE_NO_WINDOW. Detach only this test's PowerShell process
    // to exercise the same absence of a console while preserving pipe handles.
    const detach = '$ErrorActionPreference = "Stop"; Add-Type -MemberDefinition \'[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern bool FreeConsole();\' -Name ConsoleSession -Namespace PlotKinTest; if (-not [PlotKinTest.ConsoleSession]::FreeConsole()) { throw "Unable to detach the fixture console" }; & $env:PK_TEST_LAUNCHER serve; exit $LASTEXITCODE';
    const entry = withoutConsole ? ['-Command', detach] : ['-File', launcher, 'serve'];
    child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...entry], {
      cwd: work, env: { ...env, PATH: '', PK_LAUNCHER_TRACE: '1', PK_TEST_LAUNCHER: launcher }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-16_384); });
    closed = new Promise(resolve => child.once('close', (code, signal) => { didClose = true; resolve({ code, signal }); }));
    lines = createInterface({ input: child.stdout });
    const response = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdin.once('error', reject);
      child.once('close', () => reject(new Error('Launcher closed before responding')));
      lines.once('line', line => { try { resolve(JSON.parse(line)); } catch (error) { reject(error); } });
    });
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Launcher timed out. ${stderr}`)), 20_000); });
    child.stdin.write(JSON.stringify({ id: 1, params: { text: 'Émilie / 東京' } }) + '\n');
    assert.deepEqual(await Promise.race([response, deadline]), { id: 1, result: 'Émilie / 東京' });
    child.stdin.end();
    assert.deepEqual(await Promise.race([closed, deadline]), { code: 0, signal: null });
    assert.match(stderr, /fixture EOF/);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    clearTimeout(timer);
    t.diagnostic(stderr || '(no launcher stderr)');
    if (child?.pid && !didClose) {
      try { execFileSync(join(systemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { timeout: 10_000, windowsHide: true, stdio: 'ignore' }); }
      catch (error) { t.diagnostic(`Owned process cleanup: ${error.message}`); }
      await Promise.race([closed, new Promise(resolve => { const timeout = setTimeout(resolve, 2000); timeout.unref(); })]);
    }
    lines?.close();
    child?.stdin.destroy(); child?.stdout.destroy(); child?.stderr.destroy();
    try { await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch (error) {
      if (primaryError) t.diagnostic(`Temporary directory cleanup: ${error.message}`);
      else throw error;
    }
  }
});
}
