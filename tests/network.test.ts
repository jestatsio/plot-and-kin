import { describe, it, expect } from 'vitest';
import { isPublicAddress, validatePublicUrl, createSafeFetcher } from '../src/network.js';

describe('public URL validation', () => {
  it.each(['127.0.0.1','10.1.2.3','169.254.169.254','172.31.1.2','192.168.1.1','0.0.0.0','100.64.1.1','224.0.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2001:db8::1','2002:7f00:1::'])('rejects non-public address %s', ip => expect(isPublicAddress(ip)).toBe(false));
  it.each(['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])('accepts public address %s', ip => expect(isPublicAddress(ip)).toBe(true));
  it.each(['file:///etc/passwd','http://127.1/a','http://0x7f000001','http://localhost','https://user:pass@example.com','https://example.com:8443','http://169.254.169.254/latest','https://foo.local/'])('rejects unsafe URL %s', url => expect(() => validatePublicUrl(url)).toThrow());
  it('rejects mixed public/private DNS answers before dispatch', async () => {
    const fetcher = createSafeFetcher({ lookup: async () => [{ address:'8.8.8.8',family:4 },{ address:'127.0.0.1',family:4 }] });
    await expect(fetcher('https://example.com')).rejects.toMatchObject({ code:'UNSAFE_URL' });
  });
});

import { Readable } from 'node:stream';
import { vi } from 'vitest';
import type { request as RequestFn } from 'undici';
const lookup=async () => [{address:'8.8.8.8',family:4}];
const reply=(statusCode=200,headers:Record<string,string>={},chunks=['evidence']) => ({statusCode,headers,body:Readable.from(chunks)});
it('fetches bounded bytes, rechecks redirects, and pins connections to checked DNS', async () => {
  const request=vi.fn().mockResolvedValueOnce(reply(302,{location:'https://second.example.org/doc'})).mockResolvedValueOnce(reply(200,{'content-type':'text/plain; charset=utf-8'},['part1','part2']));
  const resolve=vi.fn(lookup);
  const result=await createSafeFetcher({lookup:resolve,request:request as unknown as typeof RequestFn})('https://first.example.org/doc');
  expect(result).toMatchObject({status:200,contentType:'text/plain',url:'https://second.example.org/doc'});
  expect(Buffer.from(result.bytes).toString()).toBe('part1part2');
  expect(resolve.mock.calls).toHaveLength(2);
  expect(request.mock.calls[0]?.[1]).toHaveProperty('dispatcher');
});
it.each([
  [reply(403), 'FETCH_HTTP_ERROR'],
  [reply(302,{location:'http://127.0.0.1'}),'UNSAFE_URL'],
  [reply(302,{location:'http://public.example.org'}),'UNSAFE_URL'],
  [reply(302), 'FETCH_REDIRECT'],
  [reply(200,{'content-length':'100'}), 'FILE_TOO_LARGE'],
  [reply(200,{},['123456']), 'FILE_TOO_LARGE'],
  [reply(200,{'content-encoding':'gzip'}),'FETCH_ENCODING'],
])('rejects failed, unsafe or oversized HTTP response', async (response,code) => {
  const request=vi.fn().mockResolvedValue(response);
  await expect(createSafeFetcher({lookup,request:request as unknown as typeof RequestFn})('https://example.org',{maxBytes:5})).rejects.toMatchObject({code});
});
it('does not retry transport failures and enforces redirect limits', async () => {
  const request=vi.fn().mockRejectedValue(new Error('connection reset'));
  await expect(createSafeFetcher({lookup,request:request as unknown as typeof RequestFn})('https://example.org')).rejects.toMatchObject({code:'FETCH_FAILED'});
  expect(request).toHaveBeenCalledTimes(1);
  const redirect=vi.fn().mockResolvedValue(reply(302,{location:'https://example.org/again'}));
  await expect(createSafeFetcher({lookup,request:redirect as unknown as typeof RequestFn})('https://example.org',{maxRedirects:0})).rejects.toMatchObject({code:'FETCH_REDIRECT'});
});
