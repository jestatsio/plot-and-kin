import { LocalStore, type LocalTransfer } from './local-storage.js';
import { PKError, type PKRecord, type RecordKind, type RecordStore } from './types.js';

/** A completed explicit transfer is the only event that routes a local case to Astra. */
export class CaseStore implements RecordStore {
  constructor(readonly local: LocalStore, private readonly remote: () => { store: RecordStore; destinationId: string } | Promise<{ store: RecordStore; destinationId: string }>) {}
  private async route(projectId: string): Promise<RecordStore> {
    const transfers = await this.local.listTransfers();
    const moved = transfers.find(t => t.projectId === projectId && t.status === 'complete');
    if (moved) throw new PKError('CASE_MOVED', `This case moved to Astra. Open case ${moved.targetProjectId} from your saved case list. Its local original is retained read-only.`);
    const target = transfers.find(t => t.targetProjectId === projectId);
    if (!target) return this.local;
    if (target.status !== 'complete') throw new PKError('TRANSFER_INCOMPLETE', 'This destination is not ready. Resume or recover the original case transfer first.');
    return this.destination(target);
  }
  private async destination(transfer: LocalTransfer): Promise<RecordStore> {
    const remote = await this.remote();
    if (remote.destinationId !== transfer.destinationId) throw new PKError('ASTRA_CONNECTION_MISMATCH', 'This case belongs to another Astra connection. Restore the original connection through setup. The case will not be silently recreated.');
    return remote.store;
  }
  async projects(): Promise<PKRecord[]> {
    const transfers = await this.local.listTransfers();
    const projects = await this.local.projects();
    return Promise.all(projects.map(async project => {
      const moved = transfers.find(t => t.projectId === project.projectId && t.status === 'complete');
      if (!moved) return { ...project, data: { ...project.data, storageBackend: 'local' } };
      try {
        const remote = await (await this.destination(moved)).get(moved.targetProjectId, moved.targetProjectId);
        if (!remote) throw new PKError('NOT_FOUND', 'Transferred case is missing from Astra');
        return { ...remote, data: { ...remote.data, storageBackend: 'astra' } };
      } catch {
        // Keep the known case visible when its destination is offline. Never use the stale original as current evidence.
        return { ...project, _id: moved.targetProjectId, projectId: moved.targetProjectId, data: { address: project.data.address, question: project.data.question, storageBackend: 'astra', availability: 'unavailable', restoreStatus: 'unavailable' } };
      }
    }));
  }
  async get(projectId: string, id: string) { return (await this.route(projectId)).get(projectId, id); }
  async list(projectId: string, kind?: RecordKind) { return (await this.route(projectId)).list(projectId, kind); }
  async search(projectId: string, query: string, limit?: number) { return (await this.route(projectId)).search(projectId, query, limit); }
  async insert(record: PKRecord) { return (await this.route(record.projectId)).insert(record); }
  async replace(record: PKRecord, expectedRevision: number) { return (await this.route(record.projectId)).replace(record, expectedRevision); }
}
