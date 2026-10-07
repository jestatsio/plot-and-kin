import { PKError, requireText } from './types.js';
import { safeFetch, type SafeFetch } from './network.js';

export const HISTORYQUEST_URL = 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Historic/MapServer/10';
export const SANBORN_URL = 'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_HISTORICAL/Sanborn_WebMercator/MapServer';
export interface HistoryQuestFeature { attributes: Record<string, unknown>; geometry?: Record<string, unknown> }
export interface HistoryQuestResult {
  records: HistoryQuestFeature[]; attribution: string; rights: string; url: string; queryUrl: string;
  sourceType: 'compiled-dataset'; truncated: boolean; retrievedAt: string; normalizedAddress: string;
}
function decodeJson(bytes: Uint8Array): Record<string, unknown> {
  try { const value: unknown = JSON.parse(Buffer.from(bytes).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch { throw new PKError('CONNECTOR_ERROR', 'Source returned invalid JSON'); }
}
function checkArcError(data: Record<string, unknown>): void {
  if (data.error) throw new PKError('CONNECTOR_ERROR', 'ArcGIS reported an error. No absence conclusion can be drawn');
}
export function normalizeDcAddress(address: string): string {
  return requireText(address, 'address', 250).split(',')[0]!.toUpperCase().replace(/\./g,'').replace(/\bSTREET\b/g,'ST').replace(/\bAVENUE\b/g,'AVE').replace(/\bROAD\b/g,'RD').replace(/\bPLACE\b/g,'PL').replace(/\bTERRACE\b/g,'TER').replace(/\s+/g,' ').trim();
}
export class HistoryQuestConnector {
  constructor(private readonly fetcher: SafeFetch = safeFetch) {}
  async lookup(address: string, options: {limit?: number} = {}): Promise<HistoryQuestResult> {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new PKError('INVALID_INPUT','HistoryQuest result limit must be 1–500');
    const normalizedAddress = normalizeDcAddress(address);
    const originalAddress = requireText(address, 'address', 250).split(',')[0]!.toUpperCase().replace(/\./g,'').replace(/\s+/g,' ').trim();
    const expandedAddress = normalizedAddress.replace(/\bST\b/g,'STREET').replace(/\bAVE\b/g,'AVENUE').replace(/\bRD\b/g,'ROAD').replace(/\bPL\b/g,'PLACE').replace(/\bTER\b/g,'TERRACE');
    const variants = [...new Set([originalAddress,normalizedAddress,expandedAddress])];
    const where = variants.map(value => `UPPER(ADDRESS) = '${value.replace(/'/g,"''")}'`).join(' OR ');
    const url = new URL(`${HISTORYQUEST_URL}/query`);
    // Exact normalized match deliberately avoids SQL wildcard semantics and identity assumptions.
    url.search = new URLSearchParams({ f:'json', where,outFields:'*',returnGeometry:'true',outSR:'4326',orderByFields:'OBJECTID',resultOffset:'0',resultRecordCount:String(limit) }).toString();
    const data = decodeJson((await this.fetcher(url.href, {maxBytes:5*1024*1024})).bytes); checkArcError(data);
    if (!Array.isArray(data.features) || data.features.some(f => !f || typeof f !== 'object' || !f.attributes || typeof f.attributes !== 'object')) throw new PKError('CONNECTOR_ERROR','HistoryQuest response has no valid feature array');
    return {
      records:(data.features as HistoryQuestFeature[]).slice(0,limit),url:HISTORYQUEST_URL,queryUrl:url.href,
      attribution:'Historical Data on DC Buildings, Brian Kraft with JMT Inc. for the DC Historic Preservation Office / Office of Planning. Compiled dataset, not original archival evidence.',
      rights:'CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/ (dataset catalog: https://catalog.data.gov/dataset/historic-data-on-dc-buildings). Original underlying materials may have different rights.',
      sourceType:'compiled-dataset',truncated:data.exceededTransferLimit === true || data.features.length > limit,retrievedAt:new Date().toISOString(),normalizedAddress,
    };
  }
}
export interface MapExcerptInput { bbox: [number,number,number,number]; width?: number; height?: number }
export interface MapExtent { xmin: number; ymin: number; xmax: number; ymax: number; spatialReference: Record<string, unknown> }
export interface MapExcerpt {
  bytes: Uint8Array; contentType: string; url: string; imageUrl: string; bbox: [number,number,number,number];
  extent: MapExtent; width: number; height: number; layerIds: number[]; layerIdentity: string;
  attribution: string; rights: string; retrievedAt: string;
}
export class SanbornConnector {
  constructor(private readonly fetcher: SafeFetch = safeFetch) {}
  async excerpt(input: MapExcerptInput): Promise<MapExcerpt> {
    const [west,south,east,north] = input.bbox;
    const width = input.width ?? 1024, height = input.height ?? 1024;
    if (input.bbox.length !== 4 || !input.bbox.every(Number.isFinite) || west >= east || south >= north || west < -180 || east > 180 || south < -85 || north > 85 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 64 || height < 64 || width > 2048 || height > 2048) throw new PKError('INVALID_INPUT','Map requires ordered WGS84 bounds and dimensions of 64–2048 pixels');
    const url = new URL(`${SANBORN_URL}/export`);
    // The raster is in the fused map cache. Layer 0 is only a boundary overlay.
    url.search = new URLSearchParams({f:'json',bbox:input.bbox.join(','),bboxSR:'4326',imageSR:'3857',size:`${width},${height}`,format:'png32',transparent:'false'}).toString();
    const metadata = decodeJson((await this.fetcher(url.href, {maxBytes:1024*1024})).bytes); checkArcError(metadata);
    const extent = metadata.extent as MapExtent | undefined;
    if (typeof metadata.href !== 'string' || !extent || ![extent.xmin,extent.ymin,extent.xmax,extent.ymax].every(Number.isFinite) || !extent.spatialReference || metadata.width !== width || metadata.height !== height) throw new PKError('CONNECTOR_ERROR','Map export returned incomplete extent or image metadata');
    const imageUrl = new URL(metadata.href);
    if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== new URL(SANBORN_URL).hostname || !imageUrl.pathname.startsWith('/dcgis/rest/directories/arcgisoutput/')) throw new PKError('CONNECTOR_ERROR','Unexpected map export image location');
    // Render directly instead of dereferencing the temporary href. Load-balanced
    // ArcGIS nodes do not always share their temporary output directory.
    const directImage = new URL(url); directImage.searchParams.set('f','image');
    const image = await this.fetcher(directImage.href);
    if (!image.contentType.startsWith('image/png') || !Buffer.from(image.bytes).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new PKError('CONNECTOR_ERROR','Map export did not return a PNG image');
    return {bytes:image.bytes,contentType:image.contentType,url:url.href,imageUrl:image.url,bbox:input.bbox,extent,width,height,layerIds:[],layerIdentity:'1880 Sanborn service fused map cache (layer 0 is a separate DC Boundary overlay)',attribution:'1880 Sanborn map, DC GIS and Library of Congress',rights:'Service credits DC GIS and Library of Congress. A blanket reuse license is not established by this service. Review rights for the underlying map before redistribution.',retrievedAt:new Date().toISOString()};
  }
}
