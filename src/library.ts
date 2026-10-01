import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { BlobRef, BlobStore } from './types.js';
import { PKError } from './types.js';

export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel);
}

/** Content-addressed storage. Reads verify the digest rather than trusting filenames. */
export class LocalBlobStore implements BlobStore {
  constructor(readonly rootDir: string) {}
  private async path(hash: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new PKError('INVALID_HASH', 'Expected a lowercase SHA-256 digest');
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const root = await realpath(this.rootDir);
    const prefix = join(root, hash.slice(0, 2));
    await mkdir(prefix, { recursive: true, mode: 0o700 });
    if (!inside(root, await realpath(prefix))) throw new PKError('UNSAFE_PATH', 'Library shard escaped its root');
    return join(prefix, hash);
  }
  async put(bytes: Uint8Array): Promise<BlobRef> {
    if (bytes.byteLength > MAX_SOURCE_BYTES) throw new PKError('FILE_TOO_LARGE', 'Library object exceeds 25 MiB');
    const hash = digest(bytes);
    const destination = await this.path(hash);
    const temporary = join(dirname(destination), `.${randomUUID()}.tmp`);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temporary, destination); } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    return { hash, size: bytes.byteLength };
  }
  async read(hash: string): Promise<Uint8Array> {
    const path = await this.path(hash);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) throw new PKError('BLOB_CORRUPT', 'Library object is not a bounded regular file');
      const bytes = await handle.readFile();
      if (digest(bytes) !== hash) throw new PKError('BLOB_CORRUPT', 'Library object checksum does not match its reference');
      return bytes;
    } finally { await handle.close(); }
  }
  async verify(hash: string): Promise<boolean> { try { await this.read(hash); return true; } catch { return false; } }
}

export async function readImportFile(path: string, allowedImportDir: string, maxBytes = MAX_SOURCE_BYTES): Promise<{bytes: Uint8Array; name: string}> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_SOURCE_BYTES) throw new PKError('INVALID_INPUT', 'Invalid import byte limit');
  const root = await realpath(allowedImportDir);
  const resolved = await realpath(resolve(root, path));
  if (!inside(root, resolved)) throw new PKError('UNSAFE_PATH', 'Import must resolve inside the configured import directory');
  const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new PKError('UNSAFE_PATH', 'Only regular files can be imported');
    if (stat.size > maxBytes) throw new PKError('FILE_TOO_LARGE', 'Import exceeds its byte limit');
    const bytes = await handle.readFile();
    if (bytes.byteLength > maxBytes) throw new PKError('FILE_TOO_LARGE', 'Import grew beyond its byte limit');
    return { bytes, name: basename(resolved) };
  } finally { await handle.close(); }
}
