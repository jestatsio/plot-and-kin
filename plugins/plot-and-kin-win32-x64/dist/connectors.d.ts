import { type SafeFetch } from './network.js';
export declare const HISTORYQUEST_URL = "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Historic/MapServer/10";
export declare const SANBORN_URL = "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_HISTORICAL/Sanborn_WebMercator/MapServer";
export interface HistoryQuestFeature {
    attributes: Record<string, unknown>;
    geometry?: Record<string, unknown>;
}
export interface HistoryQuestResult {
    records: HistoryQuestFeature[];
    attribution: string;
    rights: string;
    url: string;
    queryUrl: string;
    sourceType: 'compiled-dataset';
    truncated: boolean;
    retrievedAt: string;
    normalizedAddress: string;
}
export declare function normalizeDcAddress(address: string): string;
export declare class HistoryQuestConnector {
    private readonly fetcher;
    constructor(fetcher?: SafeFetch);
    lookup(address: string, options?: {
        limit?: number;
    }): Promise<HistoryQuestResult>;
}
export interface MapExcerptInput {
    bbox: [number, number, number, number];
    width?: number;
    height?: number;
}
export interface MapExtent {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
    spatialReference: Record<string, unknown>;
}
export interface MapExcerpt {
    bytes: Uint8Array;
    contentType: string;
    url: string;
    imageUrl: string;
    bbox: [number, number, number, number];
    extent: MapExtent;
    width: number;
    height: number;
    layerIds: number[];
    layerIdentity: string;
    attribution: string;
    rights: string;
    retrievedAt: string;
}
export declare class SanbornConnector {
    private readonly fetcher;
    constructor(fetcher?: SafeFetch);
    excerpt(input: MapExcerptInput): Promise<MapExcerpt>;
}
