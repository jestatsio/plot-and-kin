import type { Application } from './application.js';
import { type PKRecord } from './types.js';
export declare function caseOverview(app: Application, projectId: string): Promise<{
    projectId: string;
    address: unknown;
    question: unknown;
    approved: PKRecord<Record<string, unknown>>[];
    reviewQueue: PKRecord<Record<string, unknown>>[];
    contradictions: PKRecord<Record<string, unknown>>[];
    nextSteps: PKRecord<Record<string, unknown>>[];
    sources: number;
    remainingProcessingUsd: number;
    summary: string;
}>;
export declare function sampleCase(app: Application): Promise<{
    projectId: string;
    address: unknown;
    question: unknown;
    approved: PKRecord<Record<string, unknown>>[];
    reviewQueue: PKRecord<Record<string, unknown>>[];
    contradictions: PKRecord<Record<string, unknown>>[];
    nextSteps: PKRecord<Record<string, unknown>>[];
    sources: number;
    remainingProcessingUsd: number;
    summary: string;
    synthetic: boolean;
}>;
export declare function importInbox(app: Application): Promise<{
    directory: string;
    files: string[];
    summary: string;
}>;
export declare function processingQueue(app: Application, projectId: string, sourceId?: string): Promise<{
    queue: {
        sourceId: string;
        title: unknown;
        pageCount: unknown;
        pages: {
            page: unknown;
            status: unknown;
            passageId: unknown;
        }[];
    }[];
    summary: string;
}>;
export declare function processBatch(app: Application, projectId: string, runId: string, sourceId: string, pages: number[]): Promise<{
    completed: PKRecord<Record<string, unknown>>[];
    stoppedAtPage: number;
    error: {
        code: string;
        message: string;
    };
    summary: string;
} | {
    stoppedAtPage?: undefined;
    error?: undefined;
    completed: PKRecord<Record<string, unknown>>[];
    summary: string;
}>;
export declare function candidateMap(app: Application, projectId: string, runId: string, sourceId: string, radiusMeters?: number): Promise<PKRecord<Record<string, unknown>>>;
