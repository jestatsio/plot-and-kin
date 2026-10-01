import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { getMcpConfigForManifest } from '@anthropic-ai/mcpb';
import { CLAUDE_TARGETS, createClaudeManifest, packageClaudeExtension } from '../scripts/package-claude-extension.mjs';

for (const platform of Object.keys(CLAUDE_TARGETS)) {
  test(`Claude ${platform} manifest resolves to bundled runtime without credentials or shell commands`, async () => {
    const manifest = await createClaudeManifest({ platform, version: '1.2.3-beta.1' });
    assert.equal(manifest.manifest_version, '0.3');
    assert.equal(manifest.version, '1.2.3-beta.1');
    assert.equal(manifest.server.type, 'binary');
    assert.deepEqual(manifest.compatibility.platforms, [platform.split('-')[0]]);
    const directory = join(tmpdir(), 'Plugin cache with spaces');
    const config = await getMcpConfigForManifest({ manifest, extensionPath: directory, systemDirs: {}, userConfig: {}, pathSeparator: sep });
    const runtime = platform === 'win32-x64' ? 'bin/node.exe' : 'bin/node';
    assert.equal(config.command, `${directory}/${runtime}`);
    assert.deepEqual(config.args, [`${directory}/dist/cli.js`, 'serve']);
    assert.equal(manifest.user_config, undefined, 'Default installation must not require credentials');
    assert.equal(config.env, undefined, 'Extension must preserve existing settings and secure credentials');
    assert.equal(manifest.compatibility.runtimes, undefined, 'Bundled binary must not depend on system Node.js');
  });
}

test('Claude packaging rejects unsupported targets and mismatched release metadata', async () => {
  await assert.rejects(createClaudeManifest({ platform: 'linux-x64', version: '1.0.0' }), /Unsupported/);
  await assert.rejects(createClaudeManifest({ platform: 'darwin-arm64', version: '../escape' }), /Invalid extension version/);
  const stage = await mkdtemp(join(tmpdir(), 'pk-mcpb-metadata-'));
  try {
    await writeFile(join(stage, 'release.json'), JSON.stringify({ platform: 'darwin-arm64', version: '9.0.0' }));
    await assert.rejects(packageClaudeExtension({ stage, output: join(stage, 'out'), platform: 'win32-x64', version: '9.0.0' }), /platform does not match/);
    await assert.rejects(packageClaudeExtension({ stage, output: join(stage, 'out'), platform: 'darwin-arm64', version: '8.0.0' }), /version does not match/);
  } finally { await rm(stage, { recursive: true, force: true }); }
});
