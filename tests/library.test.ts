import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, symlink, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalBlobStore, readImportFile } from '../src/library.js';

describe('content library', () => {
  it('deduplicates bytes and validates hashes on read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pk-library-'));
    try {
      const library = new LocalBlobStore(dir);
      const ref = await library.put(Buffer.from('original evidence'));
      expect(await library.put(Buffer.from('original evidence'))).toEqual(ref);
      expect(Buffer.from(await library.read(ref.hash)).toString()).toBe('original evidence');
      expect(await library.verify(ref.hash)).toBe(true);
      await expect(library.read('../escape')).rejects.toMatchObject({ code: 'INVALID_HASH' });
      await writeFile(join(dir, ref.hash.slice(0, 2), ref.hash), 'tampered');
      await expect(library.read(ref.hash)).rejects.toMatchObject({ code: 'BLOB_CORRUPT' });
      expect(await library.verify(ref.hash)).toBe(false);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('imports only regular files inside an allowed real directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pk-import-'));
    try {
      const allowed = join(dir, 'allowed'); await mkdir(allowed);
      await writeFile(join(allowed, 'scan.txt'), 'page'); await writeFile(join(dir, 'secret'), 'secret');
      await symlink(join(dir, 'secret'), join(allowed, 'escape'));
      expect((await readImportFile(join(allowed, 'scan.txt'), allowed)).name).toBe('scan.txt');
      await expect(readImportFile(join(allowed, 'escape'), allowed)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
      await expect(readImportFile(join(dir, 'secret'), allowed)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
      await expect(readImportFile(join(allowed, 'scan.txt'), allowed, 2)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
