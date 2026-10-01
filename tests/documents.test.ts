import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { DocumentProcessor, htmlToText } from '../src/documents.js';

describe('document processing', () => {
  it('extracts text without evaluating hostile HTML', async () => {
    const bytes=Buffer.from('<html><script>steal()</script><style>.x{}</style><p>Evidence &amp; history</p><img src=x onerror="steal()"></html>');
    expect((await new DocumentProcessor().extractText(bytes))[0]?.text).toBe('Evidence & history');
    expect(htmlToText('<p>&lt;script&gt;</p>')).toBe('<script>');
  });
  it('handles large malformed HTML without repeated tag scans', () => {
    // This input has no closing angle bracket after the first paragraph.
    // Regex-based stripping takes quadratic work over these repeated prefixes.
    const malformed = '<html><p>Preserved evidence</p>' + '<script '.repeat(150_000);
    expect(htmlToText(malformed)).toBe('Preserved evidence');
  });
  it('omits nested excluded content while preserving text and block boundaries', () => {
    expect(htmlToText('<p>First&nbsp;line<br>Second &#x26; third</p><!-- comment -->' +
      '<template><p>Hidden</p><template>Also hidden</template></template>' +
      '<noscript>Hidden</noscript><iframe>Hidden</iframe><div>Final</div>')).toBe('First line\nSecond & third\nFinal');
    expect(htmlToText('<p>Visible</p><script>Unclosed content')).toBe('Visible');
  });
  it('rejects binary inputs and corrupt PDF/images', async () => {
    const processor=new DocumentProcessor();
    await expect(processor.inspect(Buffer.from([0,1,2,3]))).rejects.toThrow();
    await expect(processor.inspect(Buffer.from('%PDF-corrupt'))).rejects.toMatchObject({code:'INVALID_DOCUMENT'});
    await expect(processor.inspect(Buffer.from([137,80,78,71,13,10,26,10]))).rejects.toMatchObject({code:'INVALID_DOCUMENT'});
  }, 20_000); // The first PDF load initializes the native worker on Windows CI.
  it('renders photos and crops with traceable original coordinates', async () => {
    const bytes=await sharp({create:{width:80,height:40,channels:3,background:'white'}}).png().toBuffer();
    const processor=new DocumentProcessor();
    expect(await processor.inspect(bytes)).toMatchObject({format:'image',pageCount:1});
    const page=await processor.renderPage(bytes,1,{scale:2,crop:{x:10,y:4,width:20,height:10}});
    expect(page).toMatchObject({width:40,height:20,mimeType:'image/png',transform:{scale:2,offsetX:10,offsetY:4}});
    await expect(processor.renderPage(bytes,2)).rejects.toThrow();
    await expect(processor.renderPage(bytes,1,{crop:{x:79,y:0,width:2,height:1}})).rejects.toThrow();
  });
});

function textPdf(): Uint8Array {
  const stream='BT /F1 18 Tf 20 90 Td (Historical evidence) Tj ET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf='%PDF-1.4\n'; const offsets=[0];
  for (let i=0;i<objects.length;i++) { offsets.push(Buffer.byteLength(pdf)); pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
it('reads a real text-bearing PDF and renders a bounded crop', async () => {
  const processor=new DocumentProcessor(); const pdf=textPdf();
  expect(await processor.inspect(pdf)).toEqual({format:'pdf',pageCount:1});
  expect((await processor.extractText(pdf))[0]?.text).toBe('Historical evidence');
  const rendered=await processor.renderPage(pdf,1,{scale:2,crop:{x:10,y:10,width:100,height:80}});
  expect(rendered).toMatchObject({width:200,height:160,transform:{units:'pdf-points',offsetX:10,offsetY:10,scale:2}});
  expect((await sharp(rendered.bytes).metadata()).format).toBe('png');
  await expect(processor.extractText(pdf,undefined,[2])).rejects.toMatchObject({code:'INVALID_PAGE'});
  await expect(processor.renderPage(pdf,2)).rejects.toMatchObject({code:'INVALID_PAGE'});
});

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
it('preserves an independently identified archival manuscript original and crop coordinates', async () => {
  const bytes=await readFile(new URL('./fixtures/national-archives-declaration-630.jpg',import.meta.url));
  const provenance=JSON.parse(await readFile(new URL('./fixtures/manuscript-provenance.json',import.meta.url),'utf8'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
  expect(provenance.relationshipToDcProperties).toContain('None');
  const processor=new DocumentProcessor();
  const info=await processor.inspect(bytes);
  expect(info).toMatchObject({format:'image',pageCount:1});
  const crop=await processor.renderPage(bytes,1,{scale:1,crop:{x:0,y:0,width:100,height:100}});
  expect(crop.transform).toMatchObject({offsetX:0,offsetY:0,originalWidth:info.width,originalHeight:info.height});
  expect((await processor.extractText(bytes))[0]?.text).toBe('');
});
