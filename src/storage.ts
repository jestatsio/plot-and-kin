import { DataAPIClient, type Db, type Collection } from '@datastax/astra-db-ts';
import { PKError, type PKRecord, type RecordKind, type RecordStore } from './types.js';

export const RECORD_COLLECTION = 'pk_records';
export const PASSAGE_COLLECTION = 'pk_passages';
export const INDEX_FIELDS = ['projectId', 'kind', 'revision', 'createdAt', 'updatedAt'];
const MAX_RECORD_BYTES = 500_000;
type DBRecord = PKRecord & { $lexical?: string };

export function validateAstraEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new PKError('CONFIG', 'ASTRA_DB_API_ENDPOINT must be an HTTPS Astra database endpoint'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.apps\.astra\.datastax\.com$/.test(url.hostname) || url.port || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) throw new PKError('CONFIG', 'ASTRA_DB_API_ENDPOINT must be an HTTPS Astra database endpoint without credentials or paths');
  return url.origin;
}

function validateRecord(record: PKRecord): void {
  if (!record._id || !record.projectId || !Number.isInteger(record.revision) || record.revision < 1 || Buffer.byteLength(JSON.stringify(record)) > MAX_RECORD_BYTES) throw new PKError('INVALID_RECORD', 'Record identity, revision or size is invalid');
}

export class MemoryStore implements RecordStore {
  private readonly records = new Map<string, PKRecord>();
  async insert(record: PKRecord): Promise<void> {
    validateRecord(record);
    if (this.records.has(record._id)) throw new PKError('CONFLICT', 'Record already exists');
    this.records.set(record._id, structuredClone(record));
  }
  async get(projectId: string, id: string): Promise<PKRecord | undefined> {
    const record = this.records.get(id);
    return record?.projectId === projectId ? structuredClone(record) : undefined;
  }
  async list(projectId: string, kind?: RecordKind): Promise<PKRecord[]> {
    return [...this.records.values()].filter(r => r.projectId === projectId && (!kind || r.kind === kind)).map(r => structuredClone(r));
  }
  async replace(record: PKRecord, expectedRevision: number): Promise<boolean> {
    validateRecord(record);
    const existing = this.records.get(record._id);
    if (!existing || existing.projectId !== record.projectId || existing.kind !== record.kind || existing.revision !== expectedRevision || record.revision !== expectedRevision + 1) return false;
    this.records.set(record._id, structuredClone(record));
    return true;
  }
  async search(projectId: string, query: string, limit = 20): Promise<PKRecord[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (await this.list(projectId, 'passage')).map(r => ({ r, score: terms.filter(t => String(r.data.text).toLowerCase().includes(t)).length })).filter(r => r.score > 0).sort((a,b) => b.score - a.score).slice(0, Math.min(100, Math.max(1, limit))).map(({ r }) => r);
  }
}

/** Only the two dedicated collections can be addressed by this adapter. */
export class AstraStore implements RecordStore {
  private readonly db: Db;
  constructor(endpoint: string, token: string, keyspace = 'default_keyspace', db?: Db) {
    const origin = validateAstraEndpoint(endpoint);
    if (!token) throw new PKError('CONFIG', 'ASTRA_DB_APPLICATION_TOKEN is required');
    if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(keyspace)) throw new PKError('CONFIG', 'Invalid Astra keyspace');
    this.db = db ?? new DataAPIClient(token).db(origin, { keyspace });
  }
  private collection(kind: RecordKind): Collection<DBRecord> {
    return this.db.collection<DBRecord>(kind === 'passage' ? PASSAGE_COLLECTION : RECORD_COLLECTION);
  }
  private async guarded<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); } catch (error) {
      if (error instanceof PKError) throw error;
      if (error instanceof Error && /DOCUMENT_ALREADY_EXISTS|already exists|duplicate/i.test(error.message)) throw new PKError('CONFLICT', 'Record already exists');
      throw new PKError('STORAGE_ERROR', 'Astra operation failed. Check connectivity, credentials, and initialized collection configuration. The operation may need reconciliation before retry.');
    }
  }
  async initialize(): Promise<{ collections: string[]; lexical: true }> {
    return this.guarded(async () => {
      const names = await this.db.listCollections({ nameOnly: true });
      for (const name of [RECORD_COLLECTION, PASSAGE_COLLECTION]) {
        if (!names.includes(name)) await this.db.createCollection(name, { indexing: { allow: INDEX_FIELDS }, ...(name === PASSAGE_COLLECTION ? { lexical: { enabled: true } } : {}) });
      }
      return this.diagnose();
    });
  }
  async diagnose(): Promise<{ collections: string[]; lexical: true }> {
    return this.guarded(async () => {
      const descriptions = await this.db.listCollections();
      for (const name of [RECORD_COLLECTION, PASSAGE_COLLECTION]) {
        const descriptor = descriptions.find(d => d.name === name);
        if (!descriptor) throw new PKError('NOT_INITIALIZED', 'Run plot-and-kin init to create the dedicated collections');
        const options = descriptor.definition;
        const allowed = options?.indexing?.allow as readonly string[] | undefined;
        if (!allowed || INDEX_FIELDS.some(f => !allowed.includes(f))) throw new PKError('INCOMPATIBLE_SCHEMA', `${name} needs the expected selective index configuration. Existing collections are never changed automatically.`);
        if (name === PASSAGE_COLLECTION && !options.lexical?.enabled) throw new PKError('LEXICAL_UNAVAILABLE', 'pk_passages must have lexical search enabled');
      }
      await this.collection('passage').find({ projectId: '__pk_capability_probe__' }, { sort: { $lexical: 'capability probe' }, limit: 1 }).toArray();
      return { collections: [RECORD_COLLECTION, PASSAGE_COLLECTION], lexical: true };
    });
  }
  async insert(record: PKRecord): Promise<void> {
    validateRecord(record);
    await this.guarded(async () => { await this.collection(record.kind).insertOne(this.encode(record)); });
  }
  async get(projectId: string, id: string): Promise<PKRecord | undefined> {
    return this.guarded(async () => {
      const record = await this.collection('project').findOne({ _id: id, projectId }) ?? await this.collection('passage').findOne({ _id: id, projectId });
      return record ? this.decode(record) : undefined;
    });
  }
  async list(projectId: string, kind?: RecordKind): Promise<PKRecord[]> {
    return this.guarded(async () => {
      const filter = { projectId, ...(kind ? { kind } : {}) };
      const records = await this.collection(kind ?? 'project').find(filter).toArray();
      if (!kind) records.push(...await this.collection('passage').find({ projectId }).toArray());
      return records.map(r => this.decode(r));
    });
  }
  async replace(record: PKRecord, expectedRevision: number): Promise<boolean> {
    validateRecord(record);
    if (record.revision !== expectedRevision + 1) return false;
    return this.guarded(async () => {
      const { _id, ...replacement } = this.encode(record);
      const result = await this.collection(record.kind).replaceOne({ _id, projectId: record.projectId, kind: record.kind, revision: expectedRevision }, replacement);
      return result.matchedCount === 1;
    });
  }
  async search(projectId: string, query: string, limit = 20): Promise<PKRecord[]> {
    return this.guarded(async () => (await this.collection('passage').find({ projectId }, { sort: { $lexical: query }, limit: Math.min(100, Math.max(1, limit)) }).toArray()).map(r => this.decode(r)));
  }
  private encode(record: PKRecord): DBRecord { return { ...record, ...(record.kind === 'passage' ? { $lexical: String(record.data.text ?? '') } : {}) }; }
  private decode(record: DBRecord): PKRecord { const { $lexical: _lexical, ...rest } = record; return rest; }
}
