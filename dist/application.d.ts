import { type RuntimeConfig } from './config.js';
import { ResearchService } from './research.js';
import { HistoryQuestConnector, SanbornConnector, type MapExcerptInput } from './connectors.js';
import { DocumentProcessor, type Crop } from './documents.js';
import { createProvider } from './providers.js';
import { type BlobStore, type PKRecord, type RecordStore } from './types.js';
export declare const PROCESSING_VERSION = "1";
export interface ImportInput {
    title: string;
    base64?: string;
    path?: string;
    url?: string;
    filename?: string;
    mimeType?: string;
    rights?: string;
    attribution?: string;
}
export interface ApplicationDependencies {
    store?: RecordStore;
    blobs?: BlobStore;
    history?: HistoryQuestConnector;
    maps?: SanbornConnector;
    documents?: DocumentProcessor;
    provider?: ReturnType<typeof createProvider>;
}
export declare class Application {
    readonly config: RuntimeConfig;
    readonly store: RecordStore;
    readonly blobs: BlobStore;
    readonly research: ResearchService;
    readonly documents: DocumentProcessor;
    private readonly history;
    private readonly maps;
    private provider?;
    private readonly local?;
    private astra?;
    constructor(config: RuntimeConfig, dependencies?: ApplicationDependencies);
    initialize(): Promise<{
        collections: string[];
        lexical: true;
    } | {
        storage: 'local';
        persistent: true;
        schemaVersion: number;
        lexical: true;
        path: string;
    } | {
        storage: string;
        warning: string;
    }>;
    diagnose(): Promise<{
        storage: {
            collections: string[];
            lexical: true;
        } | {
            storage: 'local';
            persistent: true;
            schemaVersion: number;
            lexical: true;
            path: string;
        } | {
            storage: string;
            persistent: boolean;
        };
        processing: Record<string, unknown>;
        version: string;
        libraryDir: string;
    }>;
    close(): void;
    private astraDestination;
    transferProject(projectId: string, input: {
        targetProjectId: string;
        operationId: string;
        expectedRevision: number;
        reviewer: string;
        approvalText: string;
        dispatchersStopped?: true;
    }): Promise<{
        projectId: string;
        targetProjectId: string;
        operationId: string;
        destinationId: string;
        snapshotHash: string;
        startedAt: string;
        updatedAt: string;
        finalizing?: true;
        status: 'complete';
        verifiedRecords: number;
        verifiedAssets: number;
        summary: string;
    }>;
    recoverTransfer(projectId: string, operationId: string, action: 'retry' | 'cancel', previousProcessStopped: true): Promise<void>;
    transferStatus(projectId: string): Promise<{
        transfer: import("./local-storage.js").LocalTransfer | null;
        summary: string;
    }>;
    private requireProvider;
    private requireSource;
    private sourceBytes;
    lookup(projectId: string, runId: string, address: string): Promise<{
        matches: {
            sourceId: string;
            passageId: string;
            attributes: Record<string, unknown>;
            geometry: Record<string, unknown> | undefined;
        }[];
        truncated: boolean;
        attribution: string;
        warning: string;
    }>;
    mapExcerpt(projectId: string, runId: string, input: MapExcerptInput): Promise<PKRecord>;
    importDocument(projectId: string, runId: string, input: ImportInput): Promise<PKRecord>;
    readPage(projectId: string, sourceId: string, page: number, crop?: Crop): Promise<{
        sourceId: string;
        page: number;
        text: string;
    } | {
        bytes: Uint8Array;
        mimeType: 'image/png';
        width: number;
        height: number;
        transform: {
            scale: number;
            offsetX: number;
            offsetY: number;
            originalWidth: number;
            originalHeight: number;
            units: 'pixels' | 'pdf-points';
            pdfViewportTransform?: number[];
        };
        text?: undefined;
        sourceId: string;
        page: number;
    }>;
    processPage(projectId: string, runId: string, sourceId: string, page: number): Promise<PKRecord>;
    retryPage(projectId: string, runId: string, sourceId: string, page: number, approval: {
        reviewer: string;
        approvalText: string;
    }): Promise<PKRecord>;
    private finishProcessing;
    dossier(projectId: string): Promise<import("./portability.js").Dossier>;
    backup(projectId: string): Promise<import("./portability.js").PortableBundle>;
    restore(bundle: unknown, targetProjectId: string, operationId: string): Promise<import("./portability.js").RestoreResult>;
    copy(sourceProjectId: string, targetProjectId: string, recordIds: string[]): Promise<PKRecord<Record<string, unknown>>[]>;
    writeExport(projectId: string, format: 'markdown' | 'html' | 'json' | 'backup'): Promise<{
        path: string;
        filename: string;
        format: "backup" | "html" | "json" | "markdown";
        bytes: number;
        openingInstructions: string;
    }>;
}
