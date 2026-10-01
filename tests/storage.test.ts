import { describe, it, expect } from 'vitest';
import { MemoryStore, validateAstraEndpoint, RECORD_COLLECTION, PASSAGE_COLLECTION } from '../src/storage.js';
import type { PKRecord } from '../src/types.js';
const item = (projectId = 'p1'): PKRecord => ({_id:'one',projectId,kind:'source',revision:1,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',data:{title:'sample'}});
describe('isolated revision-checked storage',()=>{
 it('isolates project reads and forbids collisions',async()=>{const s=new MemoryStore();await s.insert(item());expect(await s.get('p2','one')).toBeUndefined();await expect(s.insert(item())).rejects.toMatchObject({code:'CONFLICT'});});
 it('uses compare-and-swap and does not leak mutable objects',async()=>{const s=new MemoryStore();await s.insert(item());const a=(await s.get('p1','one'))!;a.data.title='changed';expect((await s.get('p1','one'))!.data.title).toBe('sample');expect(await s.replace({...a,revision:2},1)).toBe(true);expect(await s.replace({...a,revision:2},1)).toBe(false);});
 it('searches passages only within their project',async()=>{const s=new MemoryStore();await s.insert({...item(),kind:'passage',data:{text:'House on Rosedale Street'}});expect(await s.search('p1','rosedale')).toHaveLength(1);expect(await s.search('p2','rosedale')).toEqual([]);});
 it('restricts database connections and collection names',()=>{expect(RECORD_COLLECTION).toBe('pk_records');expect(PASSAGE_COLLECTION).toBe('pk_passages');expect(validateAstraEndpoint('https://a6d79310-51bf-4363-b49e-8dc815614f1e-us-east-2.apps.astra.datastax.com')).toContain('astra.datastax.com');for(const v of ['http://localhost','https://example.com','https://secret@x.apps.astra.datastax.com','https://x.apps.astra.datastax.com/path'])expect(()=>validateAstraEndpoint(v)).toThrow();});
});
