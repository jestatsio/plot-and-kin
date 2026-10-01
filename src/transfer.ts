import { createHash } from 'node:crypto';
import { LocalStore, type LocalTransfer, type TransferRequest } from './local-storage.js';
import { createBundle, restoreBundle, type PortableBundle } from './portability.js';
import { MemoryStore } from './storage.js';
import { PKError, type BlobStore, type PKRecord, type RecordStore } from './types.js';

export interface TransferOptions extends TransferRequest { dispatchersStopped?: true; expectedRevision?: number }
export interface TransferResult extends LocalTransfer { status: 'complete'; verifiedRecords: number; verifiedAssets: number }
const active = new WeakMap<LocalStore, Set<string>>();

/** Stage the project's final readiness so other clients cannot use an unverified restore. */
class VerifiedDestination implements RecordStore {
  private ready?: PKRecord;
  constructor(private readonly store: RecordStore, private readonly projectId: string) {}
  insert(record: PKRecord): Promise<void> { return this.store.insert(record); }
  async get(projectId: string, id: string): Promise<PKRecord | undefined> {
    return projectId === this.projectId && id === projectId && this.ready ? structuredClone(this.ready) : this.store.get(projectId, id);
  }
  async list(projectId: string, kind?: PKRecord['kind']): Promise<PKRecord[]> {
    return (await this.store.list(projectId, kind)).map(record => record._id === this.projectId && this.ready ? structuredClone(this.ready) : record);
  }
  async replace(record: PKRecord, expectedRevision: number): Promise<boolean> {
    if (record._id !== this.projectId || record.kind !== 'project' || record.data.restoreStatus !== 'ready') return this.store.replace(record, expectedRevision);
    const current = await this.store.get(record.projectId, record._id);
    if (!current || current.revision !== expectedRevision || record.revision !== expectedRevision + 1) return false;
    this.ready = structuredClone(record);
    return true;
  }
  search(projectId: string, query: string, limit?: number): Promise<PKRecord[]> { return this.store.search(projectId, query, limit); }
  async commit(): Promise<void> {
    if (this.ready && !await this.store.replace(this.ready, this.ready.revision - 1)) throw new PKError('TRANSFER_FINALIZATION_PENDING', 'Destination readiness changed. Resume this exact transfer to verify its state.');
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Compare against an independently restored expected graph, including reviews, revisions, and budget reservations. */
async function verifyDestination(destination: RecordStore, blobs: BlobStore, bundle: PortableBundle, options: TransferOptions): Promise<number> {
  const expected = new MemoryStore();
  const sourceAssets = new Map(bundle.assets.map(asset => [asset.hash, Buffer.from(asset.data, 'base64')]));
  const referenceBlobs: BlobStore = {
    async put(bytes) { const hash = createHash('sha256').update(bytes).digest('hex'); sourceAssets.set(hash, Buffer.from(bytes)); return { hash, size: bytes.byteLength }; },
    async read(hash) { const bytes = sourceAssets.get(hash); if (!bytes) throw new PKError('TRANSFER_VERIFICATION', 'Expected asset is missing'); return bytes; },
    async verify(hash) { return sourceAssets.has(hash); },
  };
  await restoreBundle(expected, referenceBlobs, bundle, options);
  const expectedRecords = await expected.list(options.targetProjectId);
  const actualRecords = await destination.list(options.targetProjectId);
  const restoreAuditId = `pk_${createHash('sha256').update(`${options.targetProjectId}\0restore-operation:${options.operationId}`).digest('hex')}`;
  // createBundle revalidates citations, decision snapshots, budget totals, and every referenced original/derived byte.
  const actualBundle = await createBundle(destination, blobs, options.targetProjectId);
  if (actualRecords.length !== expectedRecords.length || actualBundle.records.length !== expectedRecords.length) throw new PKError('TRANSFER_VERIFICATION', 'Destination record count does not match the transfer snapshot');
  const actual = new Map(actualRecords.map(record => [record._id, record]));
  for (const record of expectedRecords) {
    const received = actual.get(record._id);
    if (!received) throw new PKError('TRANSFER_VERIFICATION', 'A destination record is missing');
    const wanted = structuredClone(record);
    const found = structuredClone(received);
    if (record.kind === 'project') {
      // restoreBundle updates only the project timestamp when marking restoration ready.
      wanted.updatedAt = found.updatedAt;
    } else if (record._id === restoreAuditId && record.kind === 'operation') {
      // The new restore audit gets the destination's wall-clock timestamps. All other audit fields must match.
      wanted.createdAt = found.createdAt; wanted.updatedAt = found.updatedAt;
    }
    if (canonical(wanted) !== canonical(found)) throw new PKError('TRANSFER_VERIFICATION', 'Destination research differs from the saved transfer snapshot. The local source remains available.');
  }
  if (canonical(actualBundle.assets) !== canonical(bundle.assets)) throw new PKError('TRANSFER_VERIFICATION', 'Destination assets differ from the saved transfer snapshot');
  return expectedRecords.length;
}

/** Explicit move with a locked local snapshot, idempotent restore, full verification, and retained local recovery copy. */
export async function transferLocalProject(source: LocalStore, sourceBlobs: BlobStore, destination: RecordStore, destinationBlobs: BlobStore, options: TransferOptions): Promise<TransferResult> {
  if (source === destination || destination instanceof LocalStore && source.path === destination.path) throw new PKError('TRANSFER_CONFLICT', 'The destination must be a different research database');
  const running = active.get(source) ?? new Set<string>();
  active.set(source, running);
  if (running.has(options.projectId)) throw new PKError('TRANSFER_IN_PROGRESS', 'This case already has a transfer running in this connection');
  running.add(options.projectId);
  let acquired = false;
  try {
    const { dispatchersStopped: _dispatchersStopped, expectedRevision, ...request } = options;
    const snapshot = await source.beginTransfer(request);
    acquired = true;
    if (expectedRevision !== undefined && snapshot.records.find(record => record.kind === 'project')!.revision !== expectedRevision) throw new PKError('STALE_REVISION', 'The case changed after transfer review. Refresh its current version before approving the transfer.');
    if (snapshot.transfer.status === 'complete') {
      const transfer = await source.finishTransfer(options.projectId, options.operationId);
      return { ...transfer, status: 'complete', verifiedRecords: (snapshot.bundle?.records.length ?? snapshot.records.length) + 1, verifiedAssets: snapshot.bundle?.assets.length ?? 0 };
    }
    const budget = snapshot.records.find(record => record.kind === 'project')!.data.budget as { operations?: Array<{ status: string }> };
    const pendingDispatch = budget.operations?.some(operation => operation.status === 'reserved') || snapshot.records.some(record => record.kind === 'processing' && record.data.status === 'in_progress');
    if (pendingDispatch && options.dispatchersStopped !== true) throw new PKError('TRANSFER_PROCESSING_ACTIVE', 'Stop page processing in both clients before transferring this case, then confirm dispatchersStopped. Reserved and uncertain charges will remain reserved or uncertain.');
    let bundle = snapshot.bundle;
    if (!bundle) {
      const snapshotStore = new MemoryStore();
      for (const record of snapshot.records) await snapshotStore.insert(record);
      bundle = await createBundle(snapshotStore, sourceBlobs, options.projectId);
      await source.saveTransferBundle(options.projectId, options.operationId, bundle);
    }
    const staged = new VerifiedDestination(destination, options.targetProjectId);
    await restoreBundle(staged, destinationBlobs, bundle, options);
    const verifiedRecords = await verifyDestination(staged, destinationBlobs, bundle, options);
    // Persist the finalization phase before the cross-database readiness commit. Any uncertain result keeps the source locked.
    await source.markTransferFinalizing(options.projectId, options.operationId);
    await staged.commit();
    const transfer = await source.finishTransfer(options.projectId, options.operationId);
    return { ...transfer, status: 'complete', verifiedRecords, verifiedAssets: bundle.assets.length };
  } catch (error) {
    // No routing is changed until verification. Known failures release the source for research.
    // An interrupted process never reaches here, so its durable lock requires explicit recovery.
    if (acquired && (await source.getTransfer(options.projectId))?.status !== 'complete') await source.failTransfer(options.projectId, options.operationId);
    throw error;
  } finally { running.delete(options.projectId); }
}
