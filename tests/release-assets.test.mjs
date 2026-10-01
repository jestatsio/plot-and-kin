import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseAssetNames, verifyReleaseAssets } from '../scripts/release-assets.mjs';

test('publication refuses missing client packages, mismatched versions, and corrupt native assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pk-publish-test-'));
  const version = '0.1.0';
  const files = releaseAssetNames(version);
  try {
    assert.equal(files.length, 9);
    assert.throws(() => releaseAssetNames('../unsafe'));
    for (const file of files) {
      const bytes = Buffer.from(`Fixture for ${file}`);
      await writeFile(join(dir, file), bytes);
      await writeFile(join(dir, `${file}.sha256`), `${createHash('sha256').update(bytes).digest('hex')}  ${file}\n`);
    }
    await writeFile(join(dir, 'version.txt'), version);
    assert.deepEqual((await verifyReleaseAssets(dir, version)).files, files);
    const extension = files.find(file => file.endsWith('.mcpb'));
    const original = await readFile(join(dir, extension));
    await rm(join(dir, extension));
    await assert.rejects(verifyReleaseAssets(dir, version), /ENOENT/);
    await writeFile(join(dir, extension), 'damaged extension');
    await assert.rejects(verifyReleaseAssets(dir, version), /checksum mismatch/);
    await writeFile(join(dir, extension), original);
    await writeFile(join(dir, 'version.txt'), '9.9.9');
    await assert.rejects(verifyReleaseAssets(dir, version), /version mismatch/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
