import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalBlobStore } from '../src/library.js';
import { LocalStore } from '../src/local-storage.js';
import { transferLocalProject } from '../src/transfer.js';
import { MemoryStore } from '../src/storage.js';
import { ResearchService } from '../src/research.js';
import { buildDossier } from '../src/portability.js';
import type { PKRecord } from '../src/types.js';

const roots: string[] = []; const stores: LocalStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'pk-transfer-')); roots.push(dir);
  const store = new LocalStore(join(dir, 'records.sqlite')); stores.push(store);
  const research = new ResearchService(store); const blobs = new LocalBlobStore(join(dir, 'originals'));
  const project = await research.createProject({ address: '1920 Rosedale Street NE', question: 'What dates are documented?' });
  const blob = await blobs.put(Buffer.from('Original archival page'));
  const source = await research.addSource(project._id, { title: 'Compiled building record', blob });
  const passage = await research.addPassage(project._id, { sourceId: source._id, text: 'A permit is reported in 1890.', locator: { precision: 'page', page: 1 } });
  const claim = await research.proposeClaim(project._id, { statement: 'The compiled record reports an 1890 permit.', evidence: [{ passageId: passage._id, stance: 'supporting' }], category: 'permit' });
  await research.recordDecision(project._id, { targetId: claim._id, expectedRevision: claim.revision, decision: 'accepted', reviewer: 'Researcher', approvalText: 'Approve this exact wording.' });
  await research.addLog(project._id, { message: 'Original permit remains to be located.', outcome: 'no_results' });
  await research.reserveBudget(project._id, { operationId: 'uncertain-charge', estimatedUsd: 1 });
  await research.markBudgetUncertain(project._id, 'uncertain-charge', 'Provider timed out');
  const destination = new MemoryStore(); const destinationBlobs = new LocalBlobStore(join(dir, 'destination-originals'));
  const options = { projectId: project._id, targetProjectId: 'astra-case', operationId: 'transfer-one', destinationId: 'astra-test/default_keyspace' };
  return { dir, store, blobs, research, project, source, destination, destinationBlobs, options };
}

describe('explicit verified local case transfer', () => {
  it('preserves originals, reviewed claims, logs and uncertain budget, then makes the source read-only', async () => {
    const f = await fixture(); const before = await f.store.list(f.project._id);
    const result = await transferLocalProject(f.store, f.blobs, f.destination, f.destinationBlobs, f.options);
    expect(result).toMatchObject({ status: 'complete', verifiedAssets: 1 });
    expect(await f.store.list(f.project._id)).toEqual(before);
    expect((await f.destination.get('astra-case', 'astra-case'))!.data.budget).toMatchObject({ reservedMicros: 1_000_000, operations: [{ status: 'uncertain', estimatedMicros: 1_000_000 }] });
    const dossier = await buildDossier(f.destination, 'astra-case');
    expect(Object.values(dossier.json.claimReviews)).toEqual(['accepted']);
    expect(dossier.markdown).toContain('Original permit remains to be located');
    await expect(f.research.addLog(f.project._id, { message: 'Unrouted write' })).rejects.toMatchObject({ code: 'PROJECT_MOVED' });
    expect(await f.store.listTransfers()).toHaveLength(1);
    const retry = await transferLocalProject(f.store, f.blobs, f.destination, f.destinationBlobs, f.options);
    expect(retry.verifiedRecords).toBe(result.verifiedRecords);
  });
  it('locks writes on both connections while a consistent transfer is in progress', async () => {
    const f = await fixture(); const second = new LocalStore(f.store.path); stores.push(second);
    await f.store.beginTransfer(f.options);
    expect(await second.getTransfer(f.project._id)).toMatchObject({ status: 'transferring' });
    await expect(new ResearchService(second).addLog(f.project._id, { message: 'Concurrent write' })).rejects.toMatchObject({ code: 'TRANSFER_IN_PROGRESS' });
    await expect(second.replace({ ...f.project, revision: f.project.revision + 1 }, f.project.revision)).rejects.toMatchObject({ code: 'TRANSFER_IN_PROGRESS' });
    await expect(second.beginTransfer(f.options)).rejects.toMatchObject({ code: 'TRANSFER_IN_PROGRESS' });
    await f.store.failTransfer(f.project._id, f.options.operationId);
    await new ResearchService(second).addLog(f.project._id, { message: 'Source usable after failure' });
  });
  it('resumes the exact saved bundle after partial destination failure and restart', async () => {
    const f = await fixture(); let writes = 0;
    const originalInsert = f.destination.insert.bind(f.destination);
    f.destination.insert = async (record: PKRecord) => { if (++writes === 4) throw new Error('connection interrupted'); await originalInsert(record); };
    await expect(transferLocalProject(f.store, f.blobs, f.destination, f.destinationBlobs, f.options)).rejects.toThrow('interrupted');
    expect(await f.store.getTransfer(f.project._id)).toMatchObject({ status: 'failed' });
    expect((await f.destination.get('astra-case', 'astra-case'))!.data.restoreStatus).toBe('restoring');
    f.destination.insert = originalInsert;
    f.store.close(); const reopened = new LocalStore(f.store.path); stores.push(reopened);
    expect(await transferLocalProject(reopened, f.blobs, f.destination, f.destinationBlobs, f.options)).toMatchObject({ status: 'complete' });
  });
  it('never moves routing after destination corruption and leaves the source usable', async () => {
    const f = await fixture(); const originalInsert = f.destination.insert.bind(f.destination);
    f.destination.insert = async record => originalInsert(record.kind === 'log' ? { ...record, data: { ...record.data, message: 'tampered' } } : record);
    await expect(transferLocalProject(f.store, f.blobs, f.destination, f.destinationBlobs, f.options)).rejects.toMatchObject({ code: 'TRANSFER_VERIFICATION' });
    expect(await f.store.getTransfer(f.project._id)).toMatchObject({ status: 'failed' });
    expect((await f.destination.get('astra-case', 'astra-case'))!.data.restoreStatus).toBe('restoring');
    await f.research.addLog(f.project._id, { message: 'Still usable' });
  });
  it('requires a fresh transfer after research changed since a failed attempt', async () => {
    const f = await fixture(); const originalInsert = f.destination.insert.bind(f.destination);
    f.destination.insert = async () => { throw new Error('offline'); };
    await expect(transferLocalProject(f.store, f.blobs, f.destination, f.destinationBlobs, f.options)).rejects.toThrow('offline');
    await f.research.addLog(f.project._id, { message: 'New evidence after the interruption' });
    f.destination.insert = originalInsert;
    await expect(transferLocalProject(f.store, f.blobs, f.destination, f.destinationBlobs, f.options)).rejects.toMatchObject({ code: 'TRANSFER_SOURCE_CHANGED' });
    await f.store.cancelTransfer(f.project._id, f.options.operationId, true);
    expect(await transferLocalProject(f.store, f.blobs, f.destination, f.destinationBlobs, { ...f.options, operationId: 'fresh', targetProjectId: 'fresh-case' })).toMatchObject({ status: 'complete' });
  });
  it('retains crash locks until the researcher confirms the previous process stopped', async () => {
    const f = await fixture(); await f.store.beginTransfer(f.options); f.store.close();
    const reopened = new LocalStore(f.store.path); stores.push(reopened);
    await expect(transferLocalProject(reopened, f.blobs, f.destination, f.destinationBlobs, f.options)).rejects.toMatchObject({ code: 'TRANSFER_IN_PROGRESS' });
    await reopened.recoverTransfer(f.project._id, f.options.operationId, true);
    expect(await transferLocalProject(reopened, f.blobs, f.destination, f.destinationBlobs, f.options)).toMatchObject({ status: 'complete' });
  });
  it('requires dispatch-stop confirmation for reserved billing and preserves the reservation', async () => {
    const f = await fixture(); await f.research.reserveBudget(f.project._id, { operationId: 'still-reserved', estimatedUsd: 2 });
    await expect(transferLocalProject(f.store, f.blobs, f.destination, f.destinationBlobs, f.options)).rejects.toMatchObject({ code: 'TRANSFER_PROCESSING_ACTIVE' });
    expect(await f.destination.list('astra-case')).toEqual([]);
    await transferLocalProject(f.store, f.blobs, f.destination, f.destinationBlobs, { ...f.options, dispatchersStopped: true });
    expect((await f.destination.get('astra-case', 'astra-case'))!.data.budget).toMatchObject({ spentMicros: 0, reservedMicros: 3_000_000, operations: [{ status: 'uncertain' }, { status: 'reserved' }] });
  });
  it('rejects a stale transfer approval without destination writes and releases the source', async () => {
    const f = await fixture();
    await expect(transferLocalProject(f.store, f.blobs, f.destination, f.destinationBlobs, { ...f.options, expectedRevision: 1 })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect(await f.destination.list('astra-case')).toEqual([]);
    expect(await f.store.getTransfer(f.project._id)).toMatchObject({ status: 'failed' });
    await f.research.addLog(f.project._id, { message: 'Refresh and review the updated case' });
  });
  it('retains the lock when destination readiness committed but its response was lost', async () => {
    const f = await fixture(); const originalReplace = f.destination.replace.bind(f.destination);
    let interrupted = false;
    f.destination.replace = async (record, revision) => {
      const result = await originalReplace(record, revision);
      if (record.kind === 'project' && record.data.restoreStatus === 'ready' && !interrupted) { interrupted = true; throw new Error('response lost after commit'); }
      return result;
    };
    await expect(transferLocalProject(f.store, f.blobs, f.destination, f.destinationBlobs, f.options)).rejects.toThrow('response lost after commit');
    expect(await f.store.getTransfer(f.project._id)).toMatchObject({ status: 'transferring', finalizing: true });
    await expect(f.research.addLog(f.project._id, { message: 'Unsafe duplicate write' })).rejects.toMatchObject({ code: 'TRANSFER_IN_PROGRESS' });
    await expect(f.store.cancelTransfer(f.project._id, f.options.operationId, true)).rejects.toMatchObject({ code: 'TRANSFER_FINALIZATION_PENDING' });
    f.store.close(); const reopened = new LocalStore(f.store.path); stores.push(reopened);
    await reopened.recoverTransfer(f.project._id, f.options.operationId, true);
    // Explicit recovery relinquishes the old process owner without opening a window for source writes.
    await expect(new ResearchService(reopened).addLog(f.project._id, { message: 'Still locked during recovery' })).rejects.toMatchObject({ code: 'TRANSFER_IN_PROGRESS' });
    const originalList = f.destination.list.bind(f.destination);
    f.destination.list = async () => { throw new Error('Astra offline during finalization retry'); };
    await expect(transferLocalProject(reopened, f.blobs, f.destination, f.destinationBlobs, f.options)).rejects.toThrow('Astra offline during finalization retry');
    expect(await reopened.getTransfer(f.project._id)).toMatchObject({ status: 'transferring', finalizing: true });
    await expect(new ResearchService(reopened).addLog(f.project._id, { message: 'Never reopen a potentially committed source' })).rejects.toMatchObject({ code: 'TRANSFER_IN_PROGRESS' });
    f.destination.list = originalList;
    expect(await transferLocalProject(reopened, f.blobs, f.destination, f.destinationBlobs, f.options)).toMatchObject({ status: 'complete' });
  });

});
