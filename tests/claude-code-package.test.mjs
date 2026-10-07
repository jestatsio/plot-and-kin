import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleClaudePlugin } from '../scripts/assemble-claude-plugin.mjs';

test('Claude Code package contains executable source and a frozen production dependency graph', async () => {
  const work = await mkdtemp(join(tmpdir(), 'pk-claude-code-test-'));
  const output = join(work, 'plugin');
  try {
    await assembleClaudePlugin({ output });
    const pkg = JSON.parse(await readFile(join(output, 'package.json')));
    const lock = JSON.parse(await readFile(join(output, 'package-lock.json')));
    const manifest = JSON.parse(await readFile(join(output, '.claude-plugin/plugin.json')));
    const mcp = JSON.parse(await readFile(join(output, '.mcp.json')));
    assert.equal(pkg.version, manifest.version);
    assert.deepEqual(pkg.dependencies, lock.packages[''].dependencies);
    assert.equal(pkg.devDependencies, undefined);
    assert.equal(pkg.overrides, undefined, 'Claude skips automatic installs with overrides');
    assert.equal(pkg.scripts, undefined, 'No lifecycle scripts run during installation');
    assert.ok(Object.values(lock.packages).every(entry => !entry.dev));
    assert.ok(Object.keys(lock.packages).every(path => !path.includes('@openai/codex')));
    assert.equal(mcp.mcpServers['plot-and-kin'].command, 'node');
    assert.deepEqual(mcp.mcpServers['plot-and-kin'].args, ['--disable-warning=ExperimentalWarning', '${CLAUDE_PLUGIN_ROOT}/dist/cli.js', 'serve']);
    assert.match(await readFile(join(output, 'dist/cli.js'), 'utf8'), /createBootstrapServer/);
    assert.match(await readFile(join(output, 'src/cli.ts'), 'utf8'), /createBootstrapServer/);
    assert.match(await readFile(join(output, 'skills/research-property/SKILL.md'), 'utf8'), /name: research-property/);
    assert.ok(!(await readdir(output)).includes('node_modules'));
    await writeFile(join(output, 'unexpected.txt'), 'must not mix releases');
    await assert.rejects(assembleClaudePlugin({ output }), /empty/);
  } finally { await rm(work, { recursive: true, force: true }); }
});

test('fresh Claude dependency install runs native PDF/image processing and saved case restart without lifecycle scripts', { skip: process.env.PK_TEST_PACKAGED_DISTRIBUTION !== '1', timeout: 120_000 }, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const work = await mkdtemp(join(tmpdir(), 'pk-claude-native-test-'));
  const output = join(work, 'plugin');
  try {
    await assembleClaudePlugin({ output });
    // Match the frozen, no-scripts installation Claude Code performs in its cache.
    execFileSync(process.execPath, [process.env.npm_execpath, 'ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--cache', join(work, 'npm-cache')], { cwd: output, stdio: 'pipe', timeout: 60_000 });
    const { version } = JSON.parse(await readFile(join(output, 'package.json')));
    await mkdir(join(output, 'scripts'));
    await cp(join(root, 'scripts/smoke-release.mjs'), join(output, 'scripts/smoke-release.mjs'));
    await writeFile(join(output, 'release.json'), JSON.stringify({ version, platform: `${process.platform}-${process.arch}`, runtimeVersion: process.versions.node }));
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(output, 'scripts/smoke-release.mjs')], { cwd: work, stdio: 'pipe', timeout: 30_000 });
  } finally { await rm(work, { recursive: true, force: true }); }
});
