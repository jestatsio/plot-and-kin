import { PKError } from './types.js';
export interface ProviderPricing {
    inputPerMillion: number;
    outputPerMillion: number;
    version: string;
}
export interface ProviderConfig {
    provider: 'openai' | 'anthropic';
    model: string;
    apiKey: string;
    pricing: ProviderPricing;
    /** Explicit conservative bound for this model, including image and prompt tokens. */
    maxInputTokens: number;
    maxOutputTokens?: number;
    timeoutMs?: number;
}
export interface PageInput {
    image: Uint8Array;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    text?: string;
    purpose?: 'transcription' | 'interpretation';
}
export interface PageExtraction {
    text: string;
    observations?: string[];
    uncertainties?: string[];
}
export interface ProviderUsage {
    inputTokens: number;
    outputTokens: number;
}
export interface ProcessingResult {
    extraction: PageExtraction;
    usage: ProviderUsage;
    costUsd: number;
    provider: 'openai' | 'anthropic';
    model: string;
    pricingVersion: string;
}
export interface PageProvider {
    estimateMaxCost(input: PageInput): number;
    process(input: PageInput): Promise<ProcessingResult>;
}
export declare class ProviderError extends PKError {
    readonly uncertainBilling: boolean;
    readonly actualCostUsd?: number | undefined;
    readonly usage?: ProviderUsage | undefined;
    constructor(code: string, message: string, uncertainBilling: boolean, actualCostUsd?: number | undefined, usage?: ProviderUsage | undefined);
}
export type ProviderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export declare function createProvider(config: ProviderConfig, fetcher?: ProviderFetch): PageProvider;
