export type RecordKind = 'project' | 'run' | 'source' | 'passage' | 'entity' | 'claim' | 'decision' | 'log' | 'processing' | 'operation';
export interface PKRecord<T extends Record<string, unknown> = Record<string, unknown>> {
    _id: string;
    projectId: string;
    kind: RecordKind;
    revision: number;
    createdAt: string;
    updatedAt: string;
    data: T;
}
export interface RecordStore {
    projects?(): Promise<PKRecord[]>;
    insert(record: PKRecord): Promise<void>;
    get(projectId: string, id: string): Promise<PKRecord | undefined>;
    list(projectId: string, kind?: RecordKind): Promise<PKRecord[]>;
    replace(record: PKRecord, expectedRevision: number): Promise<boolean>;
    search(projectId: string, query: string, limit?: number): Promise<PKRecord[]>;
}
export interface BlobRef {
    hash: string;
    size: number;
}
export interface BlobStore {
    put(bytes: Uint8Array): Promise<BlobRef>;
    read(hash: string): Promise<Uint8Array>;
    verify(hash: string): Promise<boolean>;
}
export declare class PKError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function requireText(value: unknown, label: string, max?: number): string;
