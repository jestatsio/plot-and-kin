import { type PKRecord, type RecordKind, type RecordStore } from './types.js';
import type { PortableBundle } from './portability.js';
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
export interface TransferRequest {
    projectId: string;
    targetProjectId: string;
    operationId: string;
    destinationId: string;
}
export interface TransferSnapshot {
    transfer: LocalTransfer;
    records: PKRecord[];
    bundle?: PortableBundle;
}
/** A process-independent SQLite store. Each mutation checks the transfer lock in the same transaction as its write. */
export declare class LocalStore implements RecordStore {
    private db?;
    private closed;
    readonly path: string;
    private readonly owner;
    constructor(path: string);
    private database;
    private transaction;
    private decoded;
    private records;
    private transfer;
    private assertWritable;
    initialize(): Promise<{
        storage: 'local';
        persistent: true;
        schemaVersion: number;
        lexical: true;
        path: string;
    }>;
    diagnose(): Promise<{
        storage: 'local';
        persistent: true;
        schemaVersion: number;
        lexical: true;
        path: string;
    }>;
    close(): void;
    projects(): Promise<PKRecord[]>;
    insert(record: PKRecord): Promise<void>;
    get(projectId: string, id: string): Promise<PKRecord | undefined>;
    list(projectId: string, kind?: RecordKind): Promise<PKRecord[]>;
    replace(record: PKRecord, expectedRevision: number): Promise<boolean>;
    search(projectId: string, query: string, limit?: number): Promise<PKRecord[]>;
    getTransfer(projectId: string): Promise<LocalTransfer | undefined>;
    listTransfers(): Promise<LocalTransfer[]>;
    /** Acquire a durable project lock and read its complete record snapshot in one SQLite transaction. */
    beginTransfer(input: TransferRequest): Promise<TransferSnapshot>;
    saveTransferBundle(projectId: string, operationId: string, bundle: PortableBundle): Promise<void>;
    private requireOwnedTransfer;
    markTransferFinalizing(projectId: string, operationId: string): Promise<void>;
    finishTransfer(projectId: string, operationId: string): Promise<LocalTransfer>;
    failTransfer(projectId: string, operationId: string): Promise<void>;
    /** Recovery is explicit because a persisted lock cannot establish whether a previous process is still working. */
    recoverTransfer(projectId: string, operationId: string, previousProcessStopped: true): Promise<void>;
    cancelTransfer(projectId: string, operationId: string, previousProcessStopped: true): Promise<void>;
}
