import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { PKRecord } from '../src/types.js';
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

describe('paid processing crash recovery',()=>{
 async function scanned(store=new MemoryStore()) {
   const d=await mkdtemp(join(tmpdir(),'pk-scanned-'));dirs.push(d);
   const config=readConfig({PK_STORAGE:'memory',PK_LIBRARY_DIR:d});
   config.processing={provider:'openai',model:'test-model',apiKey:'not-a-real-key',pricing:{inputPerMillion:1,outputPerMillion:1,version:new Date().toISOString().slice(0,10)},maxOutputTokens:100,maxInputTokens:10000};
   const provider={estimateMaxCost:()=>0.1,process:vi.fn(async()=>({extraction:{text:'Original handwritten words'},usage:{inputTokens:100,outputTokens:20},costUsd:0.01,provider:'openai' as const,model:'test-model',pricingVersion:config.processing!.pricing.version}))};
   const a=new Application(config,{store,provider});
   const p=await a.research.createProject({address:'Test',question:'History?'});const r=await a.research.startRun(p._id);
   const png=await sharp({create:{width:20,height:20,channels:3,background:'#fff'}}).png().toBuffer();
   const s=await a.importDocument(p._id,r._id,{title:'Handwritten page',base64:png.toString('base64')});
   return {a,p,r,s,provider,config};
 }
 it('finishes a saved model result after interrupted passage storage without another charge',async()=>{
   class FailPassage extends MemoryStore { once=true;override async insert(record:PKRecord){if(record.kind==='passage'&&this.once){this.once=false;throw new Error('disk/network interruption');}return super.insert(record);}}
   const {a,p,r,s,provider}=await scanned(new FailPassage());
   await expect(a.processPage(p._id,r._id,s._id,1)).rejects.toThrow();
   expect((await a.processPage(p._id,r._id,s._id,1)).data.text).toBe('Original handwritten words');
   expect(provider.process).toHaveBeenCalledTimes(1);
 });
 it('reuses completed model results after portable restore changes project and source ids',async()=>{
   const {a,p,r,s,provider,config}=await scanned();await a.processPage(p._id,r._id,s._id,1);
   const bundle=await a.backup(p._id);const d=await mkdtemp(join(tmpdir(),'pk-restored-'));dirs.push(d);
   const b=new Application({...config,libraryDir:d},{store:new MemoryStore(),provider});
   await b.restore(bundle,'restored-scanned','restore-model');const r2=await b.research.startRun('restored-scanned');const s2=(await b.store.list('restored-scanned','source'))[0]!;
   expect((await b.processPage('restored-scanned',r2._id,s2._id,1)).data.text).toBe('Original handwritten words');expect(provider.process).toHaveBeenCalledTimes(1);
 });
});
