import { describe, it, expect } from 'vitest';
import { readConfig } from '../src/config.js';
describe('explicit runtime configuration',()=>{
 it('requires real storage credentials without silently falling back',()=>{expect(()=>readConfig({})).toThrow(/ASTRA/);});
 it('allows explicit demonstration storage',()=>{const c=readConfig({PK_STORAGE:'memory',PK_LIBRARY_DIR:'/tmp/pk-test'});expect(c.storage).toBe('memory');expect(c.libraryDir).toBe('/tmp/pk-test');});
 it('requires complete selected-provider settings',()=>{expect(()=>readConfig({PK_STORAGE:'memory',PK_PROVIDER:'openai'})).toThrow(/model|MODEL/);});
 it('rejects invalid storage modes',()=>{expect(()=>readConfig({PK_STORAGE:'file'})).toThrow(/storage|STORAGE/);});
});
