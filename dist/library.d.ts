import type { BlobRef, BlobStore } from './types.js';
export declare const MAX_SOURCE_BYTES: number;
/** Content-addressed storage. Reads verify the digest rather than trusting filenames. */
export declare class LocalBlobStore implements BlobStore {
    readonly rootDir: string;
    constructor(rootDir: string);
    private path;
    put(bytes: Uint8Array): Promise<BlobRef>;
    read(hash: string): Promise<Uint8Array>;
    verify(hash: string): Promise<boolean>;
}
export declare function readImportFile(path: string, allowedImportDir: string, maxBytes?: number): Promise<{
    bytes: Uint8Array;
    name: string;
}>;
