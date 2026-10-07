import { type Db } from '@datastax/astra-db-ts';
import { type PKRecord, type RecordKind, type RecordStore } from './types.js';
export declare const RECORD_COLLECTION = "pk_records";
export declare const PASSAGE_COLLECTION = "pk_passages";
export declare const INDEX_FIELDS: string[];
export declare function validateAstraEndpoint(value: string): string;
export declare class MemoryStore implements RecordStore {
    private readonly records;
    projects(): Promise<PKRecord[]>;
    insert(record: PKRecord): Promise<void>;
    get(projectId: string, id: string): Promise<PKRecord | undefined>;
    list(projectId: string, kind?: RecordKind): Promise<PKRecord[]>;
    replace(record: PKRecord, expectedRevision: number): Promise<boolean>;
    search(projectId: string, query: string, limit?: number): Promise<PKRecord[]>;
}
/** Only the two dedicated collections can be addressed by this adapter. */
export declare class AstraStore implements RecordStore {
    private readonly db;
    constructor(endpoint: string, token: string, keyspace?: string, db?: Db);
    private collection;
    projects(): Promise<PKRecord[]>;
    private guarded;
    initialize(): Promise<{
        collections: string[];
        lexical: true;
    }>;
    diagnose(): Promise<{
        collections: string[];
        lexical: true;
    }>;
    insert(record: PKRecord): Promise<void>;
    get(projectId: string, id: string): Promise<PKRecord | undefined>;
    list(projectId: string, kind?: RecordKind): Promise<PKRecord[]>;
    replace(record: PKRecord, expectedRevision: number): Promise<boolean>;
    search(projectId: string, query: string, limit?: number): Promise<PKRecord[]>;
    private encode;
    private decode;
}
