import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalStore } from '../src/local-storage.js';
import { LocalBlobStore } from '../src/library.js';
import { createBundle, restoreBundle } from '../src/portability.js';
import { ResearchService } from '../src/research.js';

const roots: string[] = [];
const stores: LocalStore[] = [];
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'pk-local-')); roots.push(dir);
  const store = new LocalStore(join(dir, 'research.sqlite')); stores.push(store);
  return { dir, store, research: new ResearchService(store) };
}
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe('durable local research', () => {
  it('initializes private SQLite with WAL, FTS, and a versioned schema', async () => {
    const { store } = await fixture();
    expect(await store.initialize()).toMatchObject({ storage: 'local', schemaVersion: 1, lexical: true });
    if (process.platform !== 'win32') expect((await stat(store.path)).mode & 0o777).toBe(0o600);
    const inspect = new DatabaseSync(store.path);
    try { expect(inspect.prepare('PRAGMA journal_mode').get()!.journal_mode).toBe('wal'); expect(inspect.prepare('PRAGMA user_version').get()!.user_version).toBe(1); }
    finally { inspect.close(); }
  });
  it('retains research and idempotency keys across process restart', async () => {
    const { store, research } = await fixture();
    const project = await research.createProject({ address: '1920 Rosedale Street NE', question: 'What is documented?', idempotencyKey: 'same-case' });
    await research.addLog(project._id, { message: 'First session', idempotencyKey: 'session-one' });
    store.close();
    const reopened = new LocalStore(store.path); stores.push(reopened);
    const next = new ResearchService(reopened);
    expect(await next.createProject({ address: '1920 Rosedale Street NE', question: 'What is documented?', idempotencyKey: 'same-case' })).toEqual(project);
    expect(await reopened.list(project._id, 'log')).toHaveLength(1);
    await expect(next.createProject({ address: 'Different', question: 'What is documented?', idempotencyKey: 'same-case' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('enforces atomic revisions and duplicate imports across two connections', async () => {
    const { store, research } = await fixture();
    const second = new LocalStore(store.path); stores.push(second);
    const project = await research.createProject({ address: '316 A Street NE', question: 'Owner or occupant?' });
    const stale = (await second.get(project._id, project._id))!;
    expect(await store.replace({ ...project, revision: 2, data: { ...project.data, note: 'first' } }, 1)).toBe(true);
    expect(await second.replace({ ...stale, revision: 2, data: { ...stale.data, note: 'lost update' } }, 1)).toBe(false);
    const sources = await Promise.all([research, new ResearchService(second)].map(service => service.addSource(project._id, { title: 'Directory', idempotencyKey: 'same-import' })));
    expect(sources[0]!._id).toBe(sources[1]!._id);
    expect(await store.list(project._id, 'source')).toHaveLength(1);
    expect(await second.get('wrong-project', project._id)).toBeUndefined();
  });
  it('searches project-scoped literal words and updates the lexical index atomically', async () => {
    const { store, research } = await fixture();
    const a = await research.createProject({ address: 'A', question: 'History?' });
    const b = await research.createProject({ address: 'B', question: 'History?' });
    for (const project of [a, b]) {
      const source = await research.addSource(project._id, { title: 'Source' });
      await research.addPassage(project._id, { sourceId: source._id, text: 'Café Rosedale directory', locator: { precision: 'page', page: 1 } });
    }
    const results = await store.search(a._id, 'cafe " OR * rosedale');
    expect(results).toHaveLength(1); expect(results[0]!.projectId).toBe(a._id);
    const passage = results[0]!;
    expect(await store.replace({ ...passage, revision: 2, data: { ...passage.data, text: 'Different transcription' } }, 1)).toBe(true);
    expect(await store.search(a._id, 'rosedale')).toHaveLength(0);
    expect(await store.search(a._id, 'transcription')).toHaveLength(1);
    expect(await store.search(a._id, '\" * ()')).toEqual([]);
  });
  it('restores local backups including citation anchors and budget reservations', async () => {
    const { store, research, dir } = await fixture();
    const project = await research.createProject({ address: 'A', question: 'History?' });
    const blobs = new LocalBlobStore(join(dir, 'originals'));
    const blob = await blobs.put(Buffer.from('Archival original'));
    const source = await research.addSource(project._id, { title: 'Record', blob });
    await research.addPassage(project._id, { sourceId: source._id, text: 'A record', locator: { precision: 'page', page: 1 } });
    await research.reserveBudget(project._id, { operationId: 'reserved', estimatedUsd: 1 });
    const bundle = await createBundle(store, blobs, project._id);
    const destination = await fixture();
    await restoreBundle(destination.store, new LocalBlobStore(join(destination.dir, 'originals')), bundle, { targetProjectId: 'restored', operationId: 'restore' });
    expect((await destination.store.get('restored', 'restored'))!.data.budget).toMatchObject({ reservedMicros: 1_000_000 });
    expect(await destination.store.search('restored', 'record')).toHaveLength(1);
  });
  it('recovers committed state while dropping an interrupted uncommitted write', async () => {
    const { store, research } = await fixture();
    const project = await research.createProject({ address: 'A', question: 'History?' });
    store.close();
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN IMMEDIATE'); db.prepare('UPDATE records SET revision = 99 WHERE id = ?').run(process.argv[2]); process.exit(9);`, store.path, project._id]);
    expect(child.status).toBe(9);
    const reopened = new LocalStore(store.path); stores.push(reopened);
    expect((await reopened.get(project._id, project._id))!.revision).toBe(1);
    expect(await reopened.diagnose()).toMatchObject({ lexical: true });
  });
  it('rejects future schemas and symlinked database files without modifying them', async () => {
    const { store, dir } = await fixture();
    const db = new DatabaseSync(store.path); db.exec('PRAGMA user_version = 99'); db.close();
    const before = await readFile(store.path);
    await expect(store.initialize()).rejects.toMatchObject({ code: 'INCOMPATIBLE_SCHEMA' });
    expect(await readFile(store.path)).toEqual(before);
    if (process.platform !== 'win32') {
      const link = join(dir, 'linked.sqlite'); await symlink(store.path, link);
      const unsafe = new LocalStore(link); stores.push(unsafe);
      await expect(unsafe.initialize()).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    }
  });
});
