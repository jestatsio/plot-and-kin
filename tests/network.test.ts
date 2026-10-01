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
