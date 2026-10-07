import { type BlobStore, type PKRecord, type RecordStore } from './types.js';
export interface PortableAsset {
    hash: string;
    size: number;
    encoding: 'base64';
    data: string;
}
export interface PortableBundle {
    format: 'plot-and-kin';
    schemaVersion: 1;
    exportedAt: string;
    projectId: string;
    records: PKRecord[];
    assets: PortableAsset[];
}
export interface Dossier {
    markdown: string;
    html: string;
    json: {
        schemaVersion: 1;
        projectId: string;
        exportedAt: string;
        records: PKRecord[];
        claimReviews: Record<string, string>;
        timeline: TimelineEntry[];
    };
}
export interface TimelineEntry {
    claimId: string;
    statement: string;
    eventDate?: string;
    category?: string;
    reviewStatus: string;
    dateInterpretation: 'day' | 'month' | 'year' | 'approximate' | 'range' | 'unplaced' | 'undated';
    sortDate?: string;
}
export interface RestoreOptions {
    targetProjectId: string;
    operationId: string;
    maxBundleBytes?: number;
}
export interface RestoreResult {
    projectId: string;
    operationId: string;
    status: 'complete';
    restoredRecords: number;
}
/** A JSON bundle is self-contained: it never contains filesystem destinations or credentials. */
export declare function createBundle(store: RecordStore, blobs: BlobStore, projectId: string, options?: {
    maxBundleBytes?: number;
}): Promise<PortableBundle>;
/** Restore validates every record/reference/hash before the first write. Retry with the exact same options and bundle. */
export declare function restoreBundle(store: RecordStore, blobs: BlobStore, input: unknown, options: RestoreOptions): Promise<RestoreResult>;
/** Export an inspectable dossier. Accepted claims with superseded evidence are never presented as approved. */
export declare function buildDossier(store: RecordStore, projectId: string): Promise<Dossier>;
/** Explicit in-library reuse copies only the selected research records and their evidence dependencies. */
export declare function copyRecords(store: RecordStore, sourceProjectId: string, targetProjectId: string, recordIds: string[], operationId?: string): Promise<PKRecord[]>;
