import { Parser } from 'htmlparser2';
import { PKError } from './types.js';
import { MAX_SOURCE_BYTES } from './library.js';

export type DocumentFormat = 'text' | 'html' | 'pdf' | 'image';
export interface DocumentInfo { format: DocumentFormat; pageCount: number; width?: number; height?: number }
export interface ExtractedPage { page: number; text: string }
export interface Crop { x: number; y: number; width: number; height: number }
export interface RenderOptions { scale?: number; crop?: Crop }
export interface RenderedPage {
  bytes: Uint8Array; mimeType: 'image/png'; width: number; height: number;
  transform: { scale: number; offsetX: number; offsetY: number; originalWidth: number; originalHeight: number; units: 'pixels' | 'pdf-points'; pdfViewportTransform?: number[] };
}
const MAX_PIXELS = 20_000_000;
const MAX_PAGES = 500;
const MAX_TEXT = 100_000;

export function htmlToText(html: string): string {
  const excluded = new Set(['script','style','noscript','template','iframe']);
  const blocks = new Set(['p','div','li','h1','h2','h3','h4','h5','h6']);
  const parts: string[] = [];
  let hiddenDepth = 0;
  // Tokenize once. Regex tag stripping repeatedly rescans unmatched '<script '
  // prefixes and can block the server on a small malicious document.
  const parser = new Parser({
    onopentagname(name) {
      if (excluded.has(name)) hiddenDepth++;
      if (!hiddenDepth && name === 'br') parts.push('\n');
    },
    onclosetag(name) {
      if (excluded.has(name)) hiddenDepth = Math.max(0, hiddenDepth - 1);
      else if (!hiddenDepth && blocks.has(name)) parts.push('\n');
    },
    ontext(text) { if (!hiddenDepth) parts.push(text); },
  }, { decodeEntities: true });
  parser.end(html);
  return parts.join('').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function sniff(bytes: Uint8Array): DocumentFormat {
  if (!bytes.byteLength || bytes.byteLength > MAX_SOURCE_BYTES) throw new PKError('INVALID_DOCUMENT','Document must contain 1 byte to 25 MiB');
  const b = Buffer.from(bytes);
  if (b.subarray(0,5).toString() === '%PDF-') return 'pdf';
  if (b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || b[0] === 0xff && b[1] === 0xd8 || ['GIF87a','GIF89a'].includes(b.subarray(0,6).toString()) || b.subarray(0,4).toString() === 'RIFF' && b.subarray(8,12).toString() === 'WEBP' || b.subarray(0,4).equals(Buffer.from([73,73,42,0])) || b.subarray(0,4).equals(Buffer.from([77,77,0,42]))) return 'image';
  let text: string;
  try { text = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { throw new PKError('INVALID_DOCUMENT','Unsupported document encoding or binary format'); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new PKError('INVALID_DOCUMENT','Unsupported binary document');
  return /^\s*(?:<!doctype\s+html|<html\b|<(?:head|body|p|div|article|table)\b)/i.test(text) ? 'html' : 'text';
}
async function loadPdf(bytes: Uint8Array) {
  try {
    // Import the Node-compatible build only when necessary. No document-supplied code or URLs run.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = pdfjs.getDocument({data:Uint8Array.from(bytes),disableAutoFetch:true,disableStream:true,useSystemFonts:false,enableXfa:false,maxImageSize:MAX_PIXELS,verbosity:0});
    const document = Object.assign(await loading.promise.catch(async error => { await loading.destroy(); throw error; }), { destroy: () => loading.destroy() });
    if (document.numPages > MAX_PAGES) { await document.destroy(); throw new Error('too many pages'); }
    return document;
  } catch { throw new PKError('INVALID_DOCUMENT','PDF is corrupt, encrypted, unsupported, or exceeds 500 pages'); }
}
function boundedText(text: string): string {
  if (text.length > MAX_TEXT) throw new PKError('DOCUMENT_LIMIT','A page contains more than 100,000 text characters. Split the document before importing');
  return text;
}
function cropFor(width: number,height: number,crop?: Crop): Crop {
  const c = crop ?? {x:0,y:0,width,height};
  if (![c.x,c.y,c.width,c.height].every(Number.isFinite) || c.x < 0 || c.y < 0 || c.width <= 0 || c.height <= 0 || c.x+c.width > width || c.y+c.height > height) throw new PKError('INVALID_CROP','Crop must fit inside the original page');
  return c;
}
export class DocumentProcessor {
  async inspect(bytes: Uint8Array, _mime?: string): Promise<DocumentInfo> {
    const format = sniff(bytes);
    if (format === 'pdf') { const doc = await loadPdf(bytes); try { return {format,pageCount:doc.numPages}; } finally { await doc.destroy(); } }
    if (format === 'image') {
      try {
        const { default: sharp } = await import('sharp');
        const m = await sharp(bytes,{limitInputPixels:MAX_PIXELS,failOn:'warning'}).metadata();
        if (!m.width || !m.height || m.pages && m.pages > 1) throw new Error('multipage image');
        return {format,pageCount:1,width:m.width,height:m.height};
      } catch { throw new PKError('INVALID_DOCUMENT','Image is corrupt, exceeds 20 megapixels, or has multiple frames. Import individual pages'); }
    }
    boundedText(format === 'html' ? htmlToText(Buffer.from(bytes).toString('utf8')) : Buffer.from(bytes).toString('utf8'));
    return {format,pageCount:1};
  }
  async extractText(bytes: Uint8Array, _mime?: string, pages?: number[]): Promise<ExtractedPage[]> {
    const format = sniff(bytes);
    if (format === 'image') { await this.inspect(bytes); return [{page:1,text:''}]; }
    if (format !== 'pdf') return [{page:1,text:boundedText(format === 'html' ? htmlToText(Buffer.from(bytes).toString('utf8')) : Buffer.from(bytes).toString('utf8'))}];
    const doc = await loadPdf(bytes);
    try {
      const selected = pages ?? Array.from({length:doc.numPages},(_,i) => i+1);
      if (selected.length > MAX_PAGES || selected.some(page => !Number.isInteger(page) || page < 1 || page > doc.numPages)) throw new PKError('INVALID_PAGE','Requested PDF page is out of range');
      const result: ExtractedPage[] = [];
      for (const page of selected) {
        const pdfPage = await doc.getPage(page);
        const content = await pdfPage.getTextContent();
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
        result.push({page,text:boundedText(text)}); pdfPage.cleanup();
      }
      return result;
    } finally { await doc.destroy(); }
  }
  async renderPage(bytes: Uint8Array, page: number, options: RenderOptions = {}): Promise<RenderedPage> {
    const format = sniff(bytes);
    const scale = options.scale ?? 1.5;
    if (!Number.isFinite(scale) || scale < 0.25 || scale > 4 || !Number.isSafeInteger(page) || page < 1) throw new PKError('INVALID_INPUT','Page and render scale are invalid');
    if (format === 'image') {
      const info = await this.inspect(bytes);
      if (page !== 1) throw new PKError('INVALID_PAGE','Images contain only page 1');
      const c = cropFor(info.width!,info.height!,options.crop);
      const width = Math.round(c.width*scale),height = Math.round(c.height*scale);
      if (width < 1 || height < 1 || width*height > MAX_PIXELS) throw new PKError('DOCUMENT_LIMIT','Rendered image exceeds pixel limits');
      if (![c.x,c.y,c.width,c.height].every(Number.isInteger)) throw new PKError('INVALID_CROP','Image crops use integer pixel coordinates');
      try {
        const { default: sharp } = await import('sharp');
        const rendered = await sharp(bytes,{limitInputPixels:MAX_PIXELS,failOn:'warning'}).extract({left:c.x,top:c.y,width:c.width,height:c.height}).resize(width,height).png().toBuffer();
        return {bytes:rendered,mimeType:'image/png',width,height,transform:{scale,offsetX:c.x,offsetY:c.y,originalWidth:info.width!,originalHeight:info.height!,units:'pixels'}};
      } catch { throw new PKError('INVALID_DOCUMENT','Image could not be decoded'); }
    }
    if (format !== 'pdf') throw new PKError('INVALID_DOCUMENT','Only PDF and image pages can be rendered');
    const doc = await loadPdf(bytes);
    try {
      if (page > doc.numPages) throw new PKError('INVALID_PAGE','PDF page is out of range');
      const pdfPage = await doc.getPage(page);
      const viewport = pdfPage.getViewport({scale:1});
      const c = cropFor(viewport.width,viewport.height,options.crop);
      const width = Math.ceil(c.width*scale),height = Math.ceil(c.height*scale);
      if (width*height > MAX_PIXELS) throw new PKError('DOCUMENT_LIMIT','Rendered PDF exceeds pixel limits');
      const { createCanvas } = await import('@napi-rs/canvas');
      const canvas = createCanvas(width,height);
      const scaled = pdfPage.getViewport({scale});
      await pdfPage.render({canvas:canvas as unknown as HTMLCanvasElement,canvasContext:canvas.getContext('2d') as unknown as CanvasRenderingContext2D,viewport:scaled,transform:[1,0,0,1,-c.x*scale,-c.y*scale],background:'#ffffff'}).promise;
      return {bytes:await canvas.encode('png'),mimeType:'image/png',width,height,transform:{scale,offsetX:c.x,offsetY:c.y,originalWidth:viewport.width,originalHeight:viewport.height,units:'pdf-points',pdfViewportTransform:viewport.transform}};
    } finally { await doc.destroy(); }
  }
}
