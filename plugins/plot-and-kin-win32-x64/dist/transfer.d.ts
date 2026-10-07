import { LocalStore, type LocalTransfer, type TransferRequest } from './local-storage.js';
import { type BlobStore, type RecordStore } from './types.js';
export interface TransferOptions extends TransferRequest {
    dispatchersStopped?: true;
    expectedRevision?: number;
}
export interface TransferResult extends LocalTransfer {
    status: 'complete';
    verifiedRecords: number;
    verifiedAssets: number;
}
/** Explicit move with a locked local snapshot, idempotent restore, full verification, and retained local recovery copy. */
export declare function transferLocalProject(source: LocalStore, sourceBlobs: BlobStore, destination: RecordStore, destinationBlobs: BlobStore, options: TransferOptions): Promise<TransferResult>;
