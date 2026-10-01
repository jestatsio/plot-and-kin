import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from '../src/application.js';
import { readConfig } from '../src/config.js';
import { MemoryStore } from '../src/storage.js';
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
async function app(){const d=await mkdtemp(join(tmpdir(),'pk-app-'));dirs.push(d);return new Application(readConfig({PK_STORAGE:'memory',PK_LIBRARY_DIR:d}),{store:new MemoryStore()});}
describe('complete research workflow',()=>{
 it('imports text, retrieves inspectable evidence and produces restorable output',async()=>{
   const a=await app();const p=await a.research.createProject({address:'1920 Rosedale Street NE',question:'Who owned the property?'});const r=await a.research.startRun(p.projectId,{});
   const s=await a.importDocument(p.projectId,r._id,{title:'Example directory',base64:Buffer.from('Ada Example occupied this property in 1901.').toString('base64'),mimeType:'text/plain',filename:'directory.txt',rights:'Synthetic fixture'});
   expect(s.kind).toBe('source');
   const result=await a.processPage(p.projectId,r._id,s._id,1);expect(result.kind).toBe('passage');
   expect(await a.store.search(p.projectId,'Ada')).toHaveLength(1);
   const c=await a.research.proposeClaim(p.projectId,{statement:'Ada Example occupied the property in 1901.',evidence:[{passageId:result._id,stance:'supporting'}]});
   await a.research.recordDecision(p.projectId,{targetId:c._id,expectedRevision:c.revision,decision:'accepted',reviewer:'Test researcher',approvalText:'I reviewed the directory and approve this conclusion.'});
   const dossier=await a.dossier(p.projectId);expect(dossier.markdown).toContain('Ada Example');
   const bundle=await a.backup(p.projectId);const b=await app();const restored=await b.restore(bundle,'restored-case','restore-1');expect(restored.status).toBe('complete');
   expect((await b.dossier('restored-case')).markdown).toContain('Ada Example');
 });
 it('deduplicates processing and rejects cross-project sources',async()=>{
   const a=await app();const p=await a.research.createProject({address:'One',question:'History?'});const q=await a.research.createProject({address:'Two',question:'History?'});const r=await a.research.startRun(p.projectId,{});
   const s=await a.importDocument(p.projectId,r._id,{title:'Text',base64:Buffer.from('A surviving record').toString('base64'),mimeType:'text/plain'});
   expect((await a.processPage(p.projectId,r._id,s._id,1))._id).toBe((await a.processPage(p.projectId,r._id,s._id,1))._id);
   await expect(a.processPage(q.projectId,r._id,s._id,1)).rejects.toThrow();
 });
 it('does not silently call models for unsupported or malformed imports',async()=>{
   const a=await app();const p=await a.research.createProject({address:'One',question:'History?'});const r=await a.research.startRun(p.projectId,{});
   await expect(a.importDocument(p.projectId,r._id,{title:'Invalid',base64:'not-base64!'})).rejects.toThrow();
   await expect(a.importDocument(p.projectId,r._id,{title:'Ambiguous',base64:'YQ==',url:'https://example.com'})).rejects.toThrow();
 });
});
