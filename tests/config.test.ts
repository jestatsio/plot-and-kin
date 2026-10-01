import { describe, it, expect } from 'vitest';
import { readConfig } from '../src/config.js';
import { resolve } from 'node:path';
describe('explicit runtime configuration',()=>{
 it('defaults to durable local research without credentials',()=>{expect(readConfig({}).storage).toBe('local');});
 it('never falls back from explicitly selected Astra',()=>{expect(()=>readConfig({PK_STORAGE:'astra'})).toThrow(/ASTRA/);});
 it('allows explicit demonstration storage',()=>{const c=readConfig({PK_STORAGE:'memory',PK_LIBRARY_DIR:'/tmp/pk-test'});expect(c.storage).toBe('memory');expect(c.libraryDir).toBe(resolve('/tmp/pk-test'));});
 it('requires complete selected-provider settings',()=>{expect(()=>readConfig({PK_STORAGE:'memory',PK_PROVIDER:'openai'})).toThrow(/model|MODEL/);});
 it('rejects invalid storage modes',()=>{expect(()=>readConfig({PK_STORAGE:'file'})).toThrow(/storage|STORAGE/);});
});
