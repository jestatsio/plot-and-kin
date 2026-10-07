import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { PKError, requireText, type PKRecord, type RecordKind, type RecordStore } from './types.js';
import type { PortableBundle } from './portability.js';

const SCHEMA_VERSION = 1;
const MAX_RECORD_BYTES = 500_000;
const KINDS = new Set<RecordKind>(['project', 'run', 'source', 'passage', 'entity', 'claim', 'decision', 'log', 'processing', 'operation']);
export interface LocalTransfer {
  projectId: string;
  targetProjectId: string;
  operationId: string;
  destinationId: string;
  status: 'transferring' | 'failed' | 'complete';
  snapshotHash: string;
  startedAt: string;
  updatedAt: string;
  finalizing?: true;
}
export interface TransferRequest { projectId: string; targetProjectId: string; operationId: string; destinationId: string }
export interface TransferSnapshot { transfer: LocalTransfer; records: PKRecord[]; bundle?: PortableBundle }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function snapshotHash(records: PKRecord[]): string { return createHash('sha256').update(canonical(records)).digest('hex'); }
function validateRecord(record: PKRecord): string {
  let encoded: string;
  try { encoded = JSON.stringify(record); } catch { throw new PKError('INVALID_RECORD', 'Record must be JSON serializable'); }
  if (!record._id || !record.projectId || !KINDS.has(record.kind) || !Number.isSafeInteger(record.revision) || record.revision < 1 || !record.data || typeof record.data !== 'object' || Array.isArray(record.data) || Buffer.byteLength(encoded) > MAX_RECORD_BYTES) throw new PKError('INVALID_RECORD', 'Record identity, revision, data or size is invalid');
  return encoded;
}
function exists(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** A process-independent SQLite store. Each mutation checks the transfer lock in the same transaction as its write. */
export class LocalStore implements RecordStore {
  private db?: DatabaseSync;
  private closed = false;
  readonly path: string;
  private readonly owner = randomUUID();
  constructor(path: string) { this.path = resolve(requireText(path, 'Local database path', 10000)); }

  private database(): DatabaseSync {
    if (this.closed) throw new PKError('STORAGE_CLOSED', 'The local research database is closed');
    if (this.db) return this.db;
    const parent = dirname(this.path);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const actualParent = realpathSync(parent);
    if (process.platform !== 'win32' && (lstatSync(actualParent).mode & 0o022)) throw new PKError('UNSAFE_PATH', 'Choose a private local database folder that other users cannot modify');
    const actualPath = join(actualParent, basename(this.path));
    for (const file of [actualPath, `${actualPath}-wal`, `${actualPath}-shm`]) {
      const stat = exists(file);
      if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) throw new PKError('UNSAFE_PATH', 'Local database and journal paths must be regular, unlinked files');
    }
    try { closeSync(openSync(actualPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (process.platform !== 'win32') chmodSync(actualPath, 0o600);
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(actualPath, { enableDoubleQuotedStringLiterals: false });
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
      if (version < 0 || version > SCHEMA_VERSION) throw new PKError('INCOMPATIBLE_SCHEMA', 'This research database was created by a newer Plot & Kin. Update the installation before opening it.');
      db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON');
      if (version === 0) {
        db.exec('BEGIN IMMEDIATE');
        try {
          // A second client may have initialized the database while this connection waited.
          if (Number(db.prepare('PRAGMA user_version').get()!.user_version) === 0) db.exec(`
            CREATE TABLE records (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1), document TEXT NOT NULL CHECK(json_valid(document)));
            CREATE INDEX records_project_kind ON records(project_id, kind);
            CREATE VIRTUAL TABLE passages_fts USING fts5(record_id UNINDEXED, project_id UNINDEXED, text, tokenize='unicode61');
            CREATE TRIGGER passages_insert AFTER INSERT ON records WHEN new.kind = 'passage' BEGIN
              INSERT INTO passages_fts(rowid, record_id, project_id, text) VALUES(new.rowid, new.id, new.project_id, json_extract(new.document, '$.data.text'));
            END;
            CREATE TRIGGER passages_update AFTER UPDATE ON records WHEN old.kind = 'passage' BEGIN
              DELETE FROM passages_fts WHERE rowid = old.rowid;
              INSERT INTO passages_fts(rowid, record_id, project_id, text) VALUES(new.rowid, new.id, new.project_id, json_extract(new.document, '$.data.text'));
            END;
            CREATE TABLE transfers (project_id TEXT PRIMARY KEY, metadata TEXT NOT NULL CHECK(json_valid(metadata)), bundle TEXT, owner TEXT);
            PRAGMA user_version = 1;
          `);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      this.db = db;
      return db;
    } catch (error) { db.close(); throw error; }
  }

  private transaction<T>(action: (db: DatabaseSync) => T): T {
    const db = this.database();
    try {
      db.exec('BEGIN IMMEDIATE');
      try { const result = action(db); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (error) {
      if (error instanceof PKError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      const message = error instanceof Error ? error.message : '';
      if (code === 'SQLITE_BUSY' || /database is locked/i.test(message)) throw new PKError('STORAGE_BUSY', 'Another client is saving research. Retry this operation.');
      if (/UNIQUE constraint failed: records.id/.test(message)) throw new PKError('CONFLICT', 'Record already exists');
      throw error;
    }
  }
  private decoded(row: Record<string, unknown> | undefined): PKRecord | undefined { return row ? JSON.parse(String(row.document)) as PKRecord : undefined; }
  private records(db: DatabaseSync, projectId: string): PKRecord[] { return db.prepare('SELECT document FROM records WHERE project_id = ? ORDER BY id').all(projectId).map(row => this.decoded(row)!); }
  private transfer(db: DatabaseSync, projectId: string): LocalTransfer | undefined {
    const row = db.prepare('SELECT metadata FROM transfers WHERE project_id = ?').get(projectId);
    return row ? JSON.parse(String(row.metadata)) as LocalTransfer : undefined;
  }
  private assertWritable(db: DatabaseSync, projectId: string): void {
    // Routing happens before this transaction. Another client may have reserved
    // the ID since then, including while starting a local backup restoration.
    if (db.prepare('SELECT 1 FROM transfers WHERE json_extract(metadata, \'$.targetProjectId\') = ?').get(projectId)) throw new PKError('TRANSFER_CONFLICT', 'This identifier is reserved for an Astra case transfer. Choose a fresh local destination, or explicitly cancel the incomplete transfer first.');
    const transfer = this.transfer(db, projectId);
    if (transfer?.status === 'complete') throw new PKError('PROJECT_MOVED', 'This case was moved to Astra. Open its Astra location to continue. The local copy is retained for recovery.');
    if (transfer?.status === 'transferring') throw new PKError('TRANSFER_IN_PROGRESS', 'This case is being transferred. Resume or cancel that transfer before making changes.');
  }
  async initialize(): Promise<{ storage: 'local'; persistent: true; schemaVersion: number; lexical: true; path: string }> {
    this.database();
    return this.diagnose();
  }
  async diagnose(): Promise<{ storage: 'local'; persistent: true; schemaVersion: number; lexical: true; path: string }> {
    const db = this.database();
    if (db.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') throw new PKError('STORAGE_CORRUPT', 'The local database failed its integrity check. Restore a verified backup before continuing.');
    db.prepare('SELECT rowid FROM passages_fts WHERE passages_fts MATCH ? LIMIT 1').all('"capability"');
    return { storage: 'local', persistent: true, schemaVersion: SCHEMA_VERSION, lexical: true, path: this.path };
  }
  close(): void { this.db?.close(); this.db = undefined; this.closed = true; }
  async projects(): Promise<PKRecord[]> { return this.database().prepare("SELECT document FROM records WHERE kind = 'project' ORDER BY id").all().map(row => this.decoded(row)!); }
  async insert(record: PKRecord): Promise<void> {
    const encoded = validateRecord(record);
    this.transaction(db => { this.assertWritable(db, record.projectId); db.prepare('INSERT INTO records(id, project_id, kind, revision, document) VALUES (?, ?, ?, ?, ?)').run(record._id, record.projectId, record.kind, record.revision, encoded); });
  }
  async get(projectId: string, id: string): Promise<PKRecord | undefined> { return this.decoded(this.database().prepare('SELECT document FROM records WHERE id = ? AND project_id = ?').get(id, projectId)); }
  async list(projectId: string, kind?: RecordKind): Promise<PKRecord[]> {
    if (!kind) return this.records(this.database(), projectId);
    return this.database().prepare('SELECT document FROM records WHERE project_id = ? AND kind = ? ORDER BY id').all(projectId, kind).map(row => this.decoded(row)!);
  }
  async replace(record: PKRecord, expectedRevision: number): Promise<boolean> {
    const encoded = validateRecord(record);
    if (record.revision !== expectedRevision + 1) return false;
    return this.transaction(db => {
      this.assertWritable(db, record.projectId);
      return Number(db.prepare('UPDATE records SET revision = ?, document = ? WHERE id = ? AND project_id = ? AND kind = ? AND revision = ?').run(record.revision, encoded, record._id, record.projectId, record.kind, expectedRevision).changes) === 1;
    });
  }
  async search(projectId: string, query: string, limit = 20): Promise<PKRecord[]> {
    if (typeof query !== 'string' || query.length > 10000) throw new PKError('INVALID_INPUT', 'Search text must be at most 10000 characters');
    // Interpret researcher text as words, never FTS query syntax or SQL.
    const terms = [...new Set(query.match(/[\p{L}\p{N}_]+/gu) ?? [])].slice(0, 64);
    if (!terms.length) return [];
    const match = terms.map(term => `"${term}"`).join(' OR ');
    const count = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 20;
    return this.database().prepare('SELECT r.document FROM passages_fts f JOIN records r ON r.rowid = f.rowid WHERE passages_fts MATCH ? AND f.project_id = ? ORDER BY bm25(passages_fts), r.id LIMIT ?').all(match, projectId, count).map(row => this.decoded(row)!);
  }

  async getTransfer(projectId: string): Promise<LocalTransfer | undefined> { return this.transfer(this.database(), projectId); }
  async listTransfers(): Promise<LocalTransfer[]> { return this.database().prepare('SELECT metadata FROM transfers ORDER BY project_id').all().map(row => JSON.parse(String(row.metadata)) as LocalTransfer); }

  /** Acquire a durable project lock and read its complete record snapshot in one SQLite transaction. */
  async beginTransfer(input: TransferRequest): Promise<TransferSnapshot> {
    for (const [key, value] of Object.entries(input)) requireText(value, key, 1000);
    return this.transaction(db => {
      if (db.prepare('SELECT 1 FROM transfers WHERE project_id <> ? AND json_extract(metadata, \'$.targetProjectId\') = ?').get(input.projectId, input.targetProjectId)) throw new PKError('TRANSFER_CONFLICT', 'This destination identifier is reserved by another case transfer. Choose a fresh destination.');
      if (db.prepare('SELECT 1 FROM records WHERE project_id = ?').get(input.targetProjectId)) throw new PKError('TRANSFER_CONFLICT', 'The destination identifier belongs to a local case or an incomplete restore. Choose a fresh destination.');
      const records = this.records(db, input.projectId);
      if (!records.some(record => record.kind === 'project' && record._id === input.projectId)) throw new PKError('NOT_FOUND', 'Local case was not found');
      const current = this.transfer(db, input.projectId);
      const row = db.prepare('SELECT bundle, owner FROM transfers WHERE project_id = ?').get(input.projectId);
      if (current) {
        if (current.operationId !== input.operationId || current.targetProjectId !== input.targetProjectId || current.destinationId !== input.destinationId) throw new PKError('TRANSFER_CONFLICT', 'This case has a different transfer. Resume or cancel it before starting another transfer.');
        if (current.snapshotHash !== snapshotHash(records)) throw new PKError('TRANSFER_SOURCE_CHANGED', 'This case changed after a failed transfer. Start a new transfer into a fresh destination.');
        if (current.status === 'transferring' && row?.owner && row.owner !== this.owner) throw new PKError('TRANSFER_IN_PROGRESS', 'Another connection owns this transfer. Close that connection, then explicitly recover the transfer.');
      }
      const now = new Date().toISOString();
      const transfer: LocalTransfer = current?.status === 'complete' ? current : { ...input, ...(current?.finalizing ? { finalizing: true as const } : {}), status: 'transferring', snapshotHash: current?.snapshotHash ?? snapshotHash(records), startedAt: current?.startedAt ?? now, updatedAt: now };
      db.prepare('INSERT INTO transfers(project_id, metadata, owner) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET metadata = excluded.metadata, owner = excluded.owner').run(input.projectId, JSON.stringify(transfer), this.owner);
      return { transfer, records, ...(row?.bundle ? { bundle: JSON.parse(String(row.bundle)) as PortableBundle } : {}) };
    });
  }
  async saveTransferBundle(projectId: string, operationId: string, bundle: PortableBundle): Promise<void> {
    this.transaction(db => {
      this.requireOwnedTransfer(db, projectId, operationId);
      db.prepare('UPDATE transfers SET bundle = ? WHERE project_id = ?').run(JSON.stringify(bundle), projectId);
    });
  }
  private requireOwnedTransfer(db: DatabaseSync, projectId: string, operationId: string): LocalTransfer {
    const transfer = this.transfer(db, projectId);
    const row = db.prepare('SELECT owner FROM transfers WHERE project_id = ?').get(projectId);
    if (!transfer || transfer.operationId !== operationId || row?.owner !== this.owner) throw new PKError('TRANSFER_CONFLICT', 'Transfer ownership changed. Refresh its status before continuing.');
    return transfer;
  }
  async markTransferFinalizing(projectId: string, operationId: string): Promise<void> {
    this.transaction(db => {
      const current = this.requireOwnedTransfer(db, projectId, operationId);
      db.prepare('UPDATE transfers SET metadata = ? WHERE project_id = ?').run(JSON.stringify({ ...current, finalizing: true, updatedAt: new Date().toISOString() }), projectId);
    });
  }
  async finishTransfer(projectId: string, operationId: string): Promise<LocalTransfer> {
    return this.transaction(db => {
      const current = this.requireOwnedTransfer(db, projectId, operationId);
      if (current.snapshotHash !== snapshotHash(this.records(db, projectId))) throw new PKError('TRANSFER_SOURCE_CHANGED', 'Source records changed during the transfer');
      const next: LocalTransfer = { ...current, status: 'complete', updatedAt: new Date().toISOString() };
      db.prepare('UPDATE transfers SET metadata = ?, owner = NULL WHERE project_id = ?').run(JSON.stringify(next), projectId);
      return next;
    });
  }
  async failTransfer(projectId: string, operationId: string): Promise<void> {
    this.transaction(db => {
      const current = this.requireOwnedTransfer(db, projectId, operationId);
      if (current.status === 'complete' || current.finalizing) return;
      db.prepare('UPDATE transfers SET metadata = ?, owner = NULL WHERE project_id = ?').run(JSON.stringify({ ...current, status: 'failed', updatedAt: new Date().toISOString() }), projectId);
    });
  }
  /** Recovery is explicit because a persisted lock cannot establish whether a previous process is still working. */
  async recoverTransfer(projectId: string, operationId: string, previousProcessStopped: true): Promise<void> {
    if (previousProcessStopped !== true) throw new PKError('TRANSFER_CONFIRMATION', 'Confirm the previous transfer process has stopped before recovering it');
    this.transaction(db => {
      const current = this.transfer(db, projectId);
      if (!current || current.operationId !== operationId || current.status === 'complete') throw new PKError('TRANSFER_CONFLICT', 'No incomplete matching transfer exists');
      db.prepare('UPDATE transfers SET metadata = ?, owner = NULL WHERE project_id = ?').run(JSON.stringify({ ...current, status: 'transferring', updatedAt: new Date().toISOString() }), projectId);
    });
  }
  async cancelTransfer(projectId: string, operationId: string, previousProcessStopped: true): Promise<void> {
    if (previousProcessStopped !== true) throw new PKError('TRANSFER_CONFIRMATION', 'Confirm the previous transfer process has stopped before cancelling it');
    this.transaction(db => {
      const current = this.transfer(db, projectId);
      if (!current || current.operationId !== operationId || current.status === 'complete') throw new PKError('TRANSFER_CONFLICT', 'No incomplete matching transfer exists');
      if (current.finalizing) throw new PKError('TRANSFER_FINALIZATION_PENDING', 'The destination may be ready. Resume this exact transfer to verify its location before cancelling or editing the source.');
      db.prepare('DELETE FROM transfers WHERE project_id = ?').run(projectId);
    });
  }
}
