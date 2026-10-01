import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { PKRecord } from '../src/types.js';
import { HistoryQuestConnector, SanbornConnector } from '../src/connectors.js';
import { writeFile } from 'node:fs/promises';
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
   await expect(a.importDocument(p.projectId,r._id,{title:'Private URL',url:'https://127.0.0.1/private'})).rejects.toThrow();
   expect((await a.store.list(p._id,'log')).some(log=>log.data.outcome==='error'&&log.data.title==='Private URL')).toBe(true);
 });
 it('keeps repeated public lookups idempotent and records empty and failed searches',async()=>{
   const a=await app();const history=new HistoryQuestConnector();const lookup=vi.spyOn(history,'lookup');
   const b=new Application(a.config,{store:a.store,blobs:a.blobs,history});
   const p=await b.research.createProject({address:'Rosedale',question:'Owner?'});const r=await b.research.startRun(p._id);
   const result={records:[{attributes:{ADDRESS:'1920 ROSEDALE STREET NE',OWNER:'Example owner'}}],attribution:'DC',rights:'CC BY 4.0',url:'https://example.org/index',queryUrl:'https://example.org/index?q=street',sourceType:'compiled-dataset' as const,truncated:false,retrievedAt:'2026-10-01T00:00:00Z',normalizedAddress:'1920 ROSEDALE ST NE'};
   lookup.mockResolvedValueOnce(result).mockResolvedValueOnce({...result,retrievedAt:'2026-10-02T00:00:00Z',queryUrl:'https://example.org/index?q=st'}).mockResolvedValueOnce({...result,records:[]}).mockRejectedValueOnce(new Error('upstream unavailable'));
   const first=await b.lookup(p._id,r._id,'Street');const second=await b.lookup(p._id,r._id,'ST');expect(second.matches[0]?.sourceId).toBe(first.matches[0]?.sourceId);
   expect((await b.lookup(p._id,r._id,'missing')).matches).toEqual([]);
   await expect(b.lookup(p._id,r._id,'failure')).rejects.toThrow('upstream unavailable');
   expect(await b.store.list(p._id,'source')).toHaveLength(1);expect((await b.store.list(p._id,'log')).map(l=>l.data.outcome)).toEqual(['results','results','no_results','error']);
 });
 it('imports repeated map excerpts once and preserves image geometry for source reading',async()=>{
   const a=await app();const maps=new SanbornConnector();const excerpt=vi.spyOn(maps,'excerpt');
   const png=await sharp({create:{width:64,height:64,channels:3,background:'#fff'}}).png().toBuffer();
   const result={bytes:png,contentType:'image/png',url:'https://example.org/map?bbox=fixed',imageUrl:'https://example.org/image-1',bbox:[-77,38,-76.9,38.1] as [number,number,number,number],extent:{xmin:0,ymin:0,xmax:100,ymax:100,spatialReference:{wkid:3857}},width:64,height:64,layerIds:[],layerIdentity:'1880',attribution:'DC',rights:'Inspect source rights',retrievedAt:'2026-10-01'};
   excerpt.mockResolvedValueOnce(result).mockResolvedValueOnce({...result,imageUrl:'https://example.org/image-2',retrievedAt:'2026-10-02'}).mockRejectedValueOnce(new Error('failed'));
   const b=new Application(a.config,{store:a.store,blobs:a.blobs,maps});const p=await b.research.createProject({address:'DC',question:'Earlier footprint?'});const r=await b.research.startRun(p._id);
   const s=await b.mapExcerpt(p._id,r._id,{bbox:result.bbox});expect((await b.mapExcerpt(p._id,r._id,{bbox:result.bbox}))._id).toBe(s._id);
   const read=await b.readPage(p._id,s._id,1,{x:0,y:0,width:32,height:32});expect(read).toHaveProperty('width',32);
   await expect(b.mapExcerpt(p._id,r._id,{bbox:result.bbox})).rejects.toThrow('failed');
   await expect(b.processPage(p._id,r._id,s._id,1)).rejects.toMatchObject({code:'PROVIDER_REQUIRED'});
 });
 it('supports allowlisted local imports, safe exports, and explicit cross-project copy',async()=>{
   const a=await app();await a.initialize();expect(await a.diagnose()).toHaveProperty('processing');
   await writeFile(join(a.config.importDir,'record.txt'),'A local historical record.');
   const p=await a.research.createProject({address:'One',question:'History?'});const q=await a.research.createProject({address:'Two',question:'Related history?'});const r=await a.research.startRun(p._id);
   const s=await a.importDocument(p._id,r._id,{title:'Local record',path:'record.txt'});
   expect(await a.readPage(p._id,s._id,1)).toHaveProperty('text','A local historical record.');
   await expect(a.readPage(p._id,s._id,2)).rejects.toMatchObject({code:'INVALID_PAGE'});
   await a.processPage(p._id,r._id,s._id,1);
   expect(await a.copy(p._id,q._id,[s._id])).toHaveLength(1);
   for(const format of ['markdown','html','json','backup'] as const) expect(await a.writeExport(p._id,format)).toHaveProperty('format',format);
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
 it('requires an explicit audited retry after a known nonbillable failure',async()=>{
   const {a,p,r,s,provider}=await scanned();
   const {ProviderError}=await import('../src/providers.js');
   provider.process.mockRejectedValueOnce(new ProviderError('PROVIDER_PREFLIGHT_FAILED','No generation was sent',false));
   await expect(a.processPage(p._id,r._id,s._id,1)).rejects.toMatchObject({code:'PROVIDER_PREFLIGHT_FAILED'});
   await expect(a.processPage(p._id,r._id,s._id,1)).rejects.toMatchObject({code:'PROCESSING_PENDING'});
   const result=await a.retryPage(p._id,r._id,s._id,1,{reviewer:'Researcher',approvalText:'I fixed the configuration and approve one new attempt.'});
   expect(result.data.text).toBe('Original handwritten words');expect(provider.process).toHaveBeenCalledTimes(2);
   expect((await a.processPage(p._id,r._id,s._id,1))._id).toBe(result._id);
   expect(provider.process).toHaveBeenCalledTimes(2);
 });
 it('preserves an orphaned reservation across restore and requires reconciliation before retry',async()=>{
   class FailCheckpoint extends MemoryStore { once=true;override async insert(record:PKRecord){if(record.kind==='processing'&&this.once){this.once=false;throw new Error('checkpoint interrupted');}return super.insert(record);}}
   const {a,p,r,s,provider,config}=await scanned(new FailCheckpoint());
   await expect(a.processPage(p._id,r._id,s._id,1)).rejects.toThrow('checkpoint interrupted');
   expect(provider.process).not.toHaveBeenCalled();
   await expect(a.processPage(p._id,r._id,s._id,1)).rejects.toMatchObject({code:'PROCESSING_PENDING'});
   const d=await mkdtemp(join(tmpdir(),'pk-orphan-'));dirs.push(d);
   const b=new Application({...config,libraryDir:d},{store:new MemoryStore(),provider});
   await b.restore(await a.backup(p._id),'restored-orphan','restore-orphan');
   const restoredSource=(await b.store.list('restored-orphan','source'))[0]!;
   const restoredRun=await b.research.startRun('restored-orphan');
   await expect(b.processPage('restored-orphan',restoredRun._id,restoredSource._id,1)).rejects.toMatchObject({code:'PROCESSING_PENDING'});
   await expect(b.retryPage('restored-orphan',restoredRun._id,restoredSource._id,1,{reviewer:'Researcher',approvalText:'Retry'})).rejects.toMatchObject({code:'PROCESSING_PENDING'});
   const {project}=await b.research.getProjectContext('restored-orphan');
   const operations=(project.data.budget as {operations:{operationId:string}[]}).operations;
   await b.research.reconcileBudget('restored-orphan',{operationId:operations[0]!.operationId,actualUsd:0,reviewer:'Researcher',approvalText:'Confirmed no provider request was billed.'});
   const result=await b.retryPage('restored-orphan',restoredRun._id,restoredSource._id,1,{reviewer:'Researcher',approvalText:'I approve one new processing attempt.'});
   expect(result.data.text).toBe('Original handwritten words');expect(provider.process).toHaveBeenCalledTimes(1);
 });
 it('does not duplicate a saved passage when a failed completion checkpoint is restored',async()=>{
   class FailCompletion extends MemoryStore { once=true;override async replace(record:PKRecord,revision:number){if(record.kind==='processing'&&record.data.status==='complete'&&this.once){this.once=false;throw new Error('completion interrupted');}return super.replace(record,revision);}}
   const {a,p,r,s,provider,config}=await scanned(new FailCompletion());
   await expect(a.processPage(p._id,r._id,s._id,1)).rejects.toThrow('completion interrupted');
   expect(await a.store.list(p._id,'passage')).toHaveLength(1);
   const d=await mkdtemp(join(tmpdir(),'pk-completion-'));dirs.push(d);
   const b=new Application({...config,libraryDir:d},{store:new MemoryStore(),provider});
   await b.restore(await a.backup(p._id),'restored-completion','restore-completion');
   const restoredSource=(await b.store.list('restored-completion','source'))[0]!;
   const restoredRun=await b.research.startRun('restored-completion');
   const before=(await b.store.list('restored-completion','passage'))[0]!;
   expect((await b.processPage('restored-completion',restoredRun._id,restoredSource._id,1))._id).toBe(before._id);
   expect(await b.store.list('restored-completion','passage')).toHaveLength(1);expect(provider.process).toHaveBeenCalledTimes(1);
 });
 it('blocks subsequent processing when reported tokens exceed configured bounds even below the reserved cost',async()=>{
   const {a,p,r,s,provider}=await scanned();const {ProviderError}=await import('../src/providers.js');
   provider.process.mockRejectedValueOnce(new ProviderError('PROVIDER_BUDGET_BOUND','Token ceiling exceeded',false,0.01,{inputTokens:11000,outputTokens:1}));
   await expect(a.processPage(p._id,r._id,s._id,1)).rejects.toMatchObject({code:'PROVIDER_BUDGET_BOUND'});
   const {project}=await a.research.getProjectContext(p._id);expect(project.data.processingBlocked).toBeTruthy();
   expect(project.data.budget).toMatchObject({spentMicros:10000,reservedMicros:0});
   await expect(a.retryPage(p._id,r._id,s._id,1,{reviewer:'Researcher',approvalText:'Retry'})).rejects.toMatchObject({code:'PROCESSING_BLOCKED'});
   expect(provider.process).toHaveBeenCalledTimes(1);
 });
 it('retries the selected model when another model already completed the same page',async()=>{
   const {a,p,r,s,provider,config}=await scanned();await a.processPage(p._id,r._id,s._id,1);
   const b=new Application({...config,processing:{...config.processing!,model:'second-model'}},{store:a.store,blobs:a.blobs,provider});
   const {ProviderError}=await import('../src/providers.js');
   provider.process.mockRejectedValueOnce(new ProviderError('PROVIDER_PREFLIGHT_FAILED','No generation sent',false));
   await expect(b.processPage(p._id,r._id,s._id,1)).rejects.toMatchObject({code:'PROVIDER_PREFLIGHT_FAILED'});
   expect((await b.retryPage(p._id,r._id,s._id,1,{reviewer:'Researcher',approvalText:'Retry the selected second model.'})).kind).toBe('passage');
   expect(provider.process).toHaveBeenCalledTimes(3);
 });
 it('recovers a hard-exit snapshot only after stopping dispatch and verifying its charge',async()=>{
   const {a,p,r,s,provider}=await scanned();const {PROCESSING_VERSION}=await import('../src/application.js');
   await a.research.reserveBudget(p._id,{operationId:'hard-exit-operation',estimatedUsd:0.1,context:{sourceId:s._id,page:1,model:'openai:test-model',cacheKey:'hard-exit-key',processingVersion:PROCESSING_VERSION}});
   await expect(a.processPage(p._id,r._id,s._id,1)).rejects.toMatchObject({code:'PROCESSING_PENDING'});
   const approval={operationId:'hard-exit-operation',actualUsd:0,reviewer:'Researcher',approvalText:'Stopped the old server and verified no provider charge.'};
   await expect(a.research.reconcileBudget(p._id,approval)).rejects.toThrow();
   await a.research.reconcileBudget(p._id,{...approval,dispatchStopped:true});
   expect((await a.retryPage(p._id,r._id,s._id,1,{reviewer:'Researcher',approvalText:'Authorize one new attempt.'})).kind).toBe('passage');
   expect(provider.process).toHaveBeenCalledTimes(1);
 });
});
