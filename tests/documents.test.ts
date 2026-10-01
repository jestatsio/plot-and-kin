import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { DocumentProcessor, htmlToText } from '../src/documents.js';

describe('document processing', () => {
  it('extracts text without evaluating hostile HTML', async () => {
    const bytes=Buffer.from('<html><script>steal()</script><style>.x{}</style><p>Evidence &amp; history</p><img src=x onerror="steal()"></html>');
    expect((await new DocumentProcessor().extractText(bytes))[0]?.text).toBe('Evidence & history');
    expect(htmlToText('<p>&lt;script&gt;</p>')).toBe('<script>');
  });
  it('rejects binary inputs and corrupt PDF/images', async () => {
    const processor=new DocumentProcessor();
    await expect(processor.inspect(Buffer.from([0,1,2,3]))).rejects.toThrow();
    await expect(processor.inspect(Buffer.from('%PDF-corrupt'))).rejects.toMatchObject({code:'INVALID_DOCUMENT'});
    await expect(processor.inspect(Buffer.from([137,80,78,71,13,10,26,10]))).rejects.toMatchObject({code:'INVALID_DOCUMENT'});
  });
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
