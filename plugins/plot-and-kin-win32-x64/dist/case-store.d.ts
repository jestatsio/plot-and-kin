import { LocalStore } from './local-storage.js';
import { type PKRecord, type RecordKind, type RecordStore } from './types.js';
/** A completed explicit transfer is the only event that routes a local case to Astra. */
export declare class CaseStore implements RecordStore {
    readonly local: LocalStore;
    private readonly remote;
    constructor(local: LocalStore, remote: () => {
        store: RecordStore;
        destinationId: string;
    } | Promise<{
        store: RecordStore;
        destinationId: string;
    }>);
    private route;
    private destination;
    projects(): Promise<PKRecord[]>;
    get(projectId: string, id: string): Promise<PKRecord<Record<string, unknown>> | undefined>;
    list(projectId: string, kind?: RecordKind): Promise<PKRecord<Record<string, unknown>>[]>;
    search(projectId: string, query: string, limit?: number): Promise<PKRecord<Record<string, unknown>>[]>;
    insert(record: PKRecord): Promise<void>;
    replace(record: PKRecord, expectedRevision: number): Promise<boolean>;
}
