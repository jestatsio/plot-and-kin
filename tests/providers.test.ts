import { describe, it, expect, vi } from 'vitest';
import { createProvider } from '../src/providers.js';
const config={provider:'openai' as const,model:'explicit-model',apiKey:'test-secret',pricing:{inputPerMillion:10,outputPerMillion:30,version:'2026-10-01'},maxInputTokens:10000,maxOutputTokens:100};
const page={image:Buffer.from('image'),mimeType:'image/png' as const};
describe('page processing adapters', () => {
  it('reserves a configured worst-case input bound and verifies usage', async () => {
    const fetcher=vi.fn(async () => new Response(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'{"text":"Original words","uncertainties":["illegible name"]}'}]}],usage:{input_tokens:500,output_tokens:30}})));
    const provider=createProvider(config,fetcher);
    expect(provider.estimateMaxCost(page)).toBeCloseTo(0.103);
    const result=await provider.process(page);
    expect(result.extraction.text).toBe('Original words'); expect(result.costUsd).toBeCloseTo(.0059);
    const body=JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe('explicit-model'); expect(body.store).toBe(false);
  });
  it('implements Anthropic with explicit model and no provider fallback', async () => {
    const fetcher=vi.fn(async () => new Response(JSON.stringify({content:[{type:'text',text:'{"text":"handwriting"}'}],usage:{input_tokens:25,output_tokens:10}})));
    const result=await createProvider({...config,provider:'anthropic'},fetcher).process(page);
    expect(result.provider).toBe('anthropic'); expect(result.usage.inputTokens).toBe(25);
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  it('does not retry uncertain timeouts or invalid responses', async () => {
    const fetcher=vi.fn(async () => { throw new Error('timeout'); });
    await expect(createProvider(config,fetcher).process(page)).rejects.toMatchObject({uncertainBilling:true});
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(createProvider(config,async () => new Response('{}')).process(page)).rejects.toMatchObject({uncertainBilling:true});
  });
  it('rejects explicit failures, unknown pricing dates, and missing credentials', async () => {
    await expect(createProvider(config,async () => new Response('{}',{status:429})).process(page)).rejects.toMatchObject({code:'PROVIDER_HTTP_ERROR',uncertainBilling:false});
    expect(() => createProvider({...config,apiKey:''})).toThrow();
    expect(() => createProvider({...config,pricing:{...config.pricing,version:'unknown'}})).toThrow();
  });
});
