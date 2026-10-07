import { request } from 'undici';
export interface FetchResult {
    bytes: Uint8Array;
    contentType: string;
    url: string;
    status: number;
}
export interface SafeFetchOptions {
    maxBytes?: number;
    timeoutMs?: number;
    maxRedirects?: number;
}
export type SafeFetch = (url: string, options?: SafeFetchOptions) => Promise<FetchResult>;
export interface ResolvedAddress {
    address: string;
    family: number;
}
/** Deliberately conservative: special-purpose and transition ranges are not public imports. */
export declare function isPublicAddress(ip: string): boolean;
export declare function validatePublicUrl(value: string): URL;
export declare function createSafeFetcher(dependencies?: {
    lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
    request?: typeof request;
}): SafeFetch;
export declare const safeFetch: SafeFetch;
