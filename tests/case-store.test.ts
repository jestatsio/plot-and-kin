import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CaseStore } from '../src/case-store.js';
import { LocalStore } from '../src/local-storage.js';
import { LocalBlobStore } from '../src/library.js';
import { MemoryStore } from '../src/storage.js';
import { transferLocalProject } from '../src/transfer.js';
import { ResearchService } from '../src/research.js';
import { createBundle, restoreBundle } from '../src/portability.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'pk-case-routing-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const local = new LocalStore(join(dir, 'records.sqlite')); cleanup.push(() => local.close());
  const remote = new MemoryStore();
  const blobs = new LocalBlobStore(join(dir, 'blobs'));
  const cases = new CaseStore(local, () => ({ store: remote, destinationId: 'astra-test' }));
  const research = new ResearchService(local);
  const first = await research.createProject({ address: 'First house', question: 'History?' });
  const second = await research.createProject({ address: 'Second house', question: 'History?' });
  return { local, remote, blobs, cases, research, first, second };
}

describe('explicit case storage routing', () => {
  it('reserves a failed transfer destination until cancelled, then routes the successful transfer', async () => {
    const f = await fixture();
    const first = { projectId: f.first._id, targetProjectId: 'astra-case', operationId: 'first-transfer', destinationId: 'astra-test' };
    await f.local.beginTransfer(first); await f.local.failTransfer(first.projectId, first.operationId);
    const second = { ...first, projectId: f.second._id, operationId: 'second-transfer' };
    await expect(transferLocalProject(f.local, f.blobs, f.remote, f.blobs, second)).rejects.toMatchObject({ code: 'TRANSFER_CONFLICT' });
    expect(await f.remote.list('astra-case')).toEqual([]);
    await f.research.addLog(f.second._id, { message: 'A rejected destination leaves this case usable.' });
    await f.local.cancelTransfer(first.projectId, first.operationId, true);
    await transferLocalProject(f.local, f.blobs, f.remote, f.blobs, second);
    expect((await f.cases.get('astra-case', 'astra-case'))!.data.address).toBe('Second house');
    await expect(f.cases.get(f.second._id, f.second._id)).rejects.toMatchObject({ code: 'CASE_MOVED' });
    expect((await f.cases.get(f.first._id, f.first._id))!.data.address).toBe('First house');
  });

  it('never allows transfer metadata to reserve an existing local case identifier', async () => {
    const f = await fixture();
    await expect(f.local.beginTransfer({ projectId: f.first._id, targetProjectId: f.second._id, operationId: 'collision', destinationId: 'astra-test' })).rejects.toMatchObject({ code: 'TRANSFER_CONFLICT' });
    expect((await f.cases.get(f.second._id, f.second._id))!.data.address).toBe('Second house');
  });

  it('rejects a local insert when another connection reserves its destination after routing', async () => {
    const f = await fixture();
    const transferring = new LocalStore(f.local.path); cleanup.push(() => transferring.close());
    const target = { ...f.second, _id: 'racing-destination', projectId: 'racing-destination' };
    const request = { projectId: f.first._id, targetProjectId: target.projectId, operationId: 'racing-transfer', destinationId: 'astra-test' };
    const listTransfers = f.local.listTransfers.bind(f.local);
    f.local.listTransfers = async () => {
      const beforeReservation = await listTransfers();
      // This connection routed locally before the other client reserved the ID.
      await transferring.beginTransfer(request);
      return beforeReservation;
    };
    try {
      await expect(f.cases.insert(target)).rejects.toMatchObject({ code: 'TRANSFER_CONFLICT' });
    } finally { f.local.listTransfers = listTransfers; }
    expect(await f.local.get(target.projectId, target._id)).toBeUndefined();
    expect(await transferring.getTransfer(f.first._id)).toMatchObject({ status: 'transferring' });
    // Failed transfers still reserve their destination until explicitly cancelled.
    await transferring.failTransfer(request.projectId, request.operationId);
    await expect(f.local.insert(target)).rejects.toMatchObject({ code: 'TRANSFER_CONFLICT' });
    await transferring.cancelTransfer(request.projectId, request.operationId, true);
    await f.cases.insert(target);
    expect((await f.cases.get(target.projectId, target._id))!.data.address).toBe('Second house');
  });

  it('preserves a partial local restore when another connection attempts to reserve its destination', async () => {
    const f = await fixture();
    const restoring = new LocalStore(f.local.path); cleanup.push(() => restoring.close());
    const bundle = await createBundle(f.local, f.blobs, f.second._id);
    const destination = { targetProjectId: 'partial-restore', operationId: 'restore-one' };
    const insert = restoring.insert.bind(restoring);
    restoring.insert = async record => {
      if (record.kind === 'project') throw new Error('Interrupted before writing the project');
      await insert(record);
    };
    await expect(restoreBundle(restoring, f.blobs, bundle, destination)).rejects.toThrow('Interrupted');
    restoring.insert = insert;
    expect(await restoring.get(destination.targetProjectId, destination.targetProjectId)).toBeUndefined();
    expect(await restoring.list(destination.targetProjectId, 'operation')).toHaveLength(1);
    await expect(f.local.beginTransfer({ projectId: f.first._id, targetProjectId: destination.targetProjectId, operationId: 'collision', destinationId: 'astra-test' })).rejects.toMatchObject({ code: 'TRANSFER_CONFLICT' });
    expect(await f.local.getTransfer(f.first._id)).toBeUndefined();
    await restoreBundle(restoring, f.blobs, bundle, destination);
    expect((await f.cases.get(destination.targetProjectId, destination.targetProjectId))!.data.address).toBe('Second house');
  });

  it('keeps a transferred case visible when Astra is unavailable, without falling back to its local source', async () => {
    const f = await fixture();
    await transferLocalProject(f.local, f.blobs, f.remote, f.blobs, { projectId: f.first._id, targetProjectId: 'astra-case', operationId: 'move', destinationId: 'astra-test' });
    const offline = new CaseStore(f.local, () => { throw new Error('Astra unavailable'); });
    const listed = await offline.projects();
    expect(listed.find(project => project.projectId === 'astra-case')!.data).toMatchObject({ address: 'First house', storageBackend: 'astra', availability: 'unavailable' });
    await expect(offline.get('astra-case', 'astra-case')).rejects.toThrow('Astra unavailable');
    await expect(offline.get(f.first._id, f.first._id)).rejects.toMatchObject({ code: 'CASE_MOVED' });
    const changedConnection = new CaseStore(f.local, () => ({ store: new MemoryStore(), destinationId: 'another-database' }));
    await expect(changedConnection.get('astra-case', 'astra-case')).rejects.toMatchObject({ code: 'ASTRA_CONNECTION_MISMATCH' });
  });
});
