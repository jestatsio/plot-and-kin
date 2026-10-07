export type DocumentFormat = 'text' | 'html' | 'pdf' | 'image';
export interface DocumentInfo {
    format: DocumentFormat;
    pageCount: number;
    width?: number;
    height?: number;
}
export interface ExtractedPage {
    page: number;
    text: string;
}
export interface Crop {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface RenderOptions {
    scale?: number;
    crop?: Crop;
}
export interface RenderedPage {
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
}
export declare function htmlToText(html: string): string;
export declare class DocumentProcessor {
    inspect(bytes: Uint8Array, _mime?: string): Promise<DocumentInfo>;
    extractText(bytes: Uint8Array, _mime?: string, pages?: number[]): Promise<ExtractedPage[]>;
    renderPage(bytes: Uint8Array, page: number, options?: RenderOptions): Promise<RenderedPage>;
}
