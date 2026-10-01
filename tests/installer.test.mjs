import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const platform = `${process.platform}-${process.arch}`;
const supported = ['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(platform);
const asset = `plot-and-kin-${version}-${platform}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`;
const release = join(root, 'artifacts/release');

test('verified native installer preserves settings, supports rerun, and rejects damaged downloads', { skip: !supported, timeout: 300_000 }, async () => {
  // Run after release:package. An absent archive is a failure, never an implicit pass.
  const work = await mkdtemp(join(tmpdir(), 'pk-installer-test-'));
  const fixture = join(work, 'downloads');
  const home = join(work, 'researcher');
  const settings = join(home, '.plot-and-kin');
  const installRoot = join(work, 'runtime');
  const mockBin = join(work, 'mock-bin');
  try {
    await Promise.all([fixture, home, settings, mockBin].map(path => mkdir(path, { recursive: true })));
    await cp(join(release, asset), join(fixture, asset));
    await cp(join(release, `${asset}.sha256`), join(fixture, 'SHA256SUMS.txt'));
    await writeFile(join(fixture, 'version.txt'), version + '\n');
    await writeFile(join(settings, 'existing-research.txt'), 'Keep my research');
    const codexDirectory = join(home, '.codex');
    const claudeDirectory = process.platform === 'win32' ? join(home, 'AppData', 'Roaming', 'Claude') : join(home, 'Library', 'Application Support', 'Claude');
    await Promise.all([mkdir(codexDirectory, { recursive: true }), mkdir(claudeDirectory, { recursive: true })]);
    await writeFile(join(codexDirectory, 'config.toml'), 'model = "researcher-model"\n[mcp_servers.other]\ncommand = "other-server"\nargs = ["unchanged"]\n');
    await writeFile(join(claudeDirectory, 'claude_desktop_config.json'), JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'other-server', args: ['unchanged'] } } }));
    const args = ['--non-interactive', '--client', 'both', '--storage', 'local', '--home', home, '--settings-dir', settings];
    const env = { ...process.env, PLOT_AND_KIN_VERSION: '', PLOT_AND_KIN_INSTALL_ROOT: installRoot, PK_INSTALL_FIXTURE: fixture, PK_INSTALL_SCRIPT: join(root, 'scripts/install.ps1'), PK_INSTALL_ARGS: JSON.stringify(args) };
    let command;
    let commandArgs;
    if (process.platform === 'win32') {
      command = 'powershell.exe';
      commandArgs = ['-NoProfile', '-NonInteractive', '-Command', `function Invoke-WebRequest { param($UseBasicParsing, $Uri, $OutFile, $TimeoutSec) Copy-Item -LiteralPath (Join-Path $env:PK_INSTALL_FIXTURE ([Uri]$Uri).Segments[-1]) -Destination $OutFile }; $setupArgs = @(ConvertFrom-Json $env:PK_INSTALL_ARGS); & $env:PK_INSTALL_SCRIPT -SetupArguments $setupArgs`];
      // Use a real switch parameter in the network stub, as the bootstrap does.
      commandArgs[3] = commandArgs[3].replace('param($UseBasicParsing,', 'param([switch]$UseBasicParsing,');
    } else {
      await writeFile(join(mockBin, 'curl'), '#!/bin/sh\nset -eu\npk_url=\npk_output=\nwhile [ "$#" -gt 0 ]; do\n case "$1" in\n  --output) shift; pk_output=$1 ;;\n  https:*) pk_url=$1 ;;\n esac\n shift\ndone\ncp "$PK_INSTALL_FIXTURE/${pk_url##*/}" "$pk_output"\n', { mode: 0o755 });
      env.PATH = `${mockBin}:${process.env.PATH}`;
      command = '/bin/sh';
      commandArgs = [join(root, 'scripts/install.sh'), ...args];
    }
    const run = () => spawnSync(command, commandArgs, { env, encoding: 'utf8', timeout: 120_000 });
    const first = run();
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const target = join(installRoot, 'versions', `${version}-${platform}`);
    assert.match(await readFile(join(target, '.archive-sha256'), 'utf8'), /^[a-f0-9]{64}\s*$/);
    assert.equal(await readFile(join(settings, 'existing-research.txt'), 'utf8'), 'Keep my research');
    const codex = parse(await readFile(join(codexDirectory, 'config.toml'), 'utf8'));
    const claude = JSON.parse(await readFile(join(claudeDirectory, 'claude_desktop_config.json'), 'utf8'));
    assert.equal(codex.model, 'researcher-model');
    assert.equal(codex.mcp_servers.other.command, 'other-server');
    assert.equal(claude.theme, 'dark');
    assert.equal(claude.mcpServers.other.command, 'other-server');
    assert.equal(await realpath(codex.mcp_servers['plot-and-kin'].command), await realpath(join(target, process.platform === 'win32' ? 'bin/node.exe' : 'bin/node')));
    assert.equal(claude.mcpServers['plot-and-kin'].command, codex.mcp_servers['plot-and-kin'].command);
    const installed = await readFile(join(target, 'release.json'), 'utf8');
    const rerun = run();
    assert.equal(rerun.status, 0, rerun.stdout + rerun.stderr);
    assert.equal(await readFile(join(target, 'release.json'), 'utf8'), installed);
    assert.equal((await readdir(join(installRoot, 'versions'))).length, 1);
    await writeFile(join(fixture, asset), 'damaged download');
    const failed = run();
    assert.notEqual(failed.status, 0);
    assert.match(failed.stdout + failed.stderr, /checksum did not match/i);
    assert.equal(await readFile(join(target, 'release.json'), 'utf8'), installed);
    assert.equal(await readFile(join(settings, 'existing-research.txt'), 'utf8'), 'Keep my research');
    assert.ok(!(await readdir(installRoot)).includes('install.lock'));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
