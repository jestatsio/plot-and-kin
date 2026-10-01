import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { constants } from 'node:fs';
import { type RuntimeConfig } from './config.js';
import { AstraStore, MemoryStore } from './storage.js';
import { ResearchService, type BudgetOperation } from './research.js';
import { LocalBlobStore, MAX_SOURCE_BYTES, readImportFile } from './library.js';
import { safeFetch } from './network.js';
import { HistoryQuestConnector, SanbornConnector, type MapExcerptInput } from './connectors.js';
import { DocumentProcessor, type Crop } from './documents.js';
import { createProvider } from './providers.js';
import { buildDossier, copyRecords, createBundle, restoreBundle } from './portability.js';
import { PKError, requireText, type BlobRef, type BlobStore, type PKRecord, type RecordStore } from './types.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export const PROCESSING_VERSION = '1';
export interface ImportInput { title: string; base64?: string; path?: string; url?: string; filename?: string; mimeType?: string; rights?: string; attribution?: string }
export interface ApplicationDependencies {
  store?: RecordStore; blobs?: BlobStore; history?: HistoryQuestConnector; maps?: SanbornConnector;
  documents?: DocumentProcessor; provider?: ReturnType<typeof createProvider>;
}
export class Application {
  readonly store: RecordStore;
  readonly blobs: BlobStore;
  readonly research: ResearchService;
  readonly documents: DocumentProcessor;
  private readonly history: HistoryQuestConnector;
  private readonly maps: SanbornConnector;
  private readonly provider?: ReturnType<typeof createProvider>;
  constructor(readonly config: RuntimeConfig, dependencies: ApplicationDependencies = {}) {
    this.store = dependencies.store ?? (config.storage === 'memory' ? new MemoryStore() : new AstraStore(config.endpoint!, config.token!, config.keyspace));
    this.blobs = dependencies.blobs ?? new LocalBlobStore(join(config.libraryDir, 'blobs'));
    this.research = new ResearchService(this.store);
    this.documents = dependencies.documents ?? new DocumentProcessor();
    this.history = dependencies.history ?? new HistoryQuestConnector();
    this.maps = dependencies.maps ?? new SanbornConnector();
    this.provider = dependencies.provider ?? (config.processing ? createProvider(config.processing) : undefined);
  }
  async initialize() {
    await mkdir(this.config.importDir, { recursive: true, mode: 0o700 });
    await mkdir(this.config.exportDir, { recursive: true, mode: 0o700 });
    return this.store instanceof AstraStore ? this.store.initialize() : { storage: 'memory', warning: 'Demonstration records are lost when the process exits' };
  }
  async diagnose() {
    const storage = this.store instanceof AstraStore ? await this.store.diagnose() : { storage: 'memory', persistent: false };
    return { storage, processing: this.config.processing ? { provider: this.config.processing.provider, model: this.config.processing.model, pricingDate: this.config.processing.pricing.version } : 'not configured; text extraction remains available', version: '0.1.0', libraryDir: this.config.libraryDir };
  }
  private async requireSource(projectId: string, sourceId: string): Promise<PKRecord> {
    await this.research.getProjectContext(projectId);
    const source = await this.store.get(projectId, sourceId);
    if (source?.kind !== 'source') throw new PKError('NOT_FOUND', 'Source does not exist in this project');
    return source;
  }
  private async sourceBytes(source: PKRecord): Promise<Uint8Array> {
    const blob = source.data.blob as BlobRef | undefined;
    if (!blob) throw new PKError('NO_ORIGINAL', 'Source has no locally preserved original');
    return this.blobs.read(blob.hash);
  }
  async lookup(projectId: string, runId: string, address: string) {
    await this.research.consumeRun(projectId, runId, { searches: 1 });
    try {
      const result = await this.history.lookup(address);
      const matches = [];
      for (const feature of result.records) {
        const text = Object.entries(feature.attributes).map(([key, value]) => `${key}: ${value === null ? '(not recorded)' : String(value)}`).join('\n');
        const blob = await this.blobs.put(Buffer.from(text));
        const source = await this.research.addSource(projectId, { title: `HistoryQuest: ${feature.attributes.ADDRESS ?? address}`, sourceType: 'compiled-dataset', url: result.url, attribution: result.attribution, rights: result.rights, blob, mimeType: 'text/plain', pageCount: 1, attributes: feature.attributes, geometry: feature.geometry, idempotencyKey: `hq:${blob.hash}` });
        const passage = await this.research.addPassage(projectId, { sourceId: source._id, text, locator: { precision: 'document' }, extraction: 'structured public dataset', idempotencyKey: `hq:${blob.hash}` });
        matches.push({ sourceId: source._id, passageId: passage._id, attributes: feature.attributes, geometry: feature.geometry });
      }
      await this.research.addLog(projectId, { type: 'search', message: `HistoryQuest returned ${matches.length} candidate records`, runId, query: address, queryUrl: result.queryUrl, retrievedAt: result.retrievedAt, source: result.url, outcome: matches.length ? 'results' : 'no_results', count: matches.length, truncated: result.truncated, gap: matches.length ? undefined : 'No matching indexed address. This does not establish that a building or event did not exist.' });
      return { matches, truncated: result.truncated, attribution: result.attribution, warning: 'Address matches and compiled fields are evidence candidates, not approved historical conclusions.' };
    } catch (error) {
      await this.research.addLog(projectId, { type: 'search', message: 'Historical-building lookup failed', runId, query: address, outcome: 'error', gap: 'Historical-building lookup failed. Coverage remains unknown.' });
      throw error;
    }
  }
  async mapExcerpt(projectId: string, runId: string, input: MapExcerptInput): Promise<PKRecord> {
    await this.research.consumeRun(projectId, runId, { searches: 1 });
    try {
      const result = await this.maps.excerpt(input);
      const { bytes, retrievedAt, imageUrl: _temporaryImageUrl, ...metadata } = result;
      const blob = await this.blobs.put(bytes);
      const source = await this.research.addSource(projectId, { title: '1880 Sanborn map excerpt', ...metadata, blob, mimeType: 'image/png', pageCount: 1, sourceType: 'historical-map', idempotencyKey: `sanborn:${blob.hash}:${sha(JSON.stringify(result.extent))}` });
      await this.research.addLog(projectId, { type: 'map_search', message: '1880 Sanborn excerpt imported', runId, sourceId: source._id, outcome: 'results', bbox: input.bbox, retrievedAt });
      return source;
    } catch (error) {
      await this.research.addLog(projectId, { type: 'map_search', message: 'Sanborn excerpt request failed', runId, outcome: 'error', bbox: input.bbox }); throw error;
    }
  }
  async importDocument(projectId: string, runId: string, input: ImportInput): Promise<PKRecord> {
    requireText(input.title, 'Title', 2000);
    if ([input.base64, input.path, input.url].filter(v => v !== undefined).length !== 1) throw new PKError('INVALID_INPUT', 'Provide exactly one of base64, path, or url');
    await this.research.consumeRun(projectId, runId, { searches: input.url ? 1 : 0 });
    try {
    let bytes: Uint8Array; let filename = input.filename; let url: string | undefined;
    if (input.base64 !== undefined) {
      if (input.base64.length > Math.ceil(MAX_SOURCE_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) throw new PKError('INVALID_INPUT', 'Invalid or oversized base64 content');
      bytes = Buffer.from(input.base64, 'base64');
    } else if (input.path !== undefined) {
      const imported = await readImportFile(input.path, this.config.importDir); bytes = imported.bytes; filename = imported.name;
    } else {
      const response = await safeFetch(input.url!, { maxBytes: MAX_SOURCE_BYTES }); bytes = response.bytes; url = response.url;
    }
    const info = await this.documents.inspect(bytes, input.mimeType);
    const blob = await this.blobs.put(bytes);
    const source = await this.research.addSource(projectId, { title: input.title, blob, filename: filename ? basename(filename) : undefined, mimeType: input.mimeType ?? ({ text: 'text/plain', html: 'text/html', pdf: 'application/pdf', image: 'image/unknown' }[info.format]), ...info, url, rights: input.rights ?? 'User-provided material. Reuse permissions not evaluated.', attribution: input.attribution ?? 'Researcher-supplied source', sourceType: 'import', idempotencyKey: `import:${blob.hash}:${sha(JSON.stringify([input.title,input.rights,input.attribution,url]))}` });
    await this.research.addLog(projectId, { type: 'import', message: 'Source original preserved', runId, sourceId: source._id, outcome: 'success' });
    return source;
    } catch (error) {
      await this.research.addLog(projectId, {type:'import',message:'Source import failed',runId,title:input.title,outcome:'error',errorCode:error instanceof PKError ? error.code : 'IMPORT_FAILED'});
      throw error;
    }
  }
  async readPage(projectId: string, sourceId: string, page: number, crop?: Crop) {
    const source = await this.requireSource(projectId, sourceId);
    const bytes = await this.sourceBytes(source);
    const info = await this.documents.inspect(bytes);
    if (!Number.isSafeInteger(page) || page < 1 || page > info.pageCount) throw new PKError('INVALID_PAGE', 'Page is outside this document');
    if (info.format === 'text' || info.format === 'html') return { sourceId, page, text: (await this.documents.extractText(bytes))[0]!.text };
    const rendered = await this.documents.renderPage(bytes, page, { crop, scale: 1 });
    return { sourceId, page, ...rendered };
  }
  async processPage(projectId: string, runId: string, sourceId: string, page: number): Promise<PKRecord> {
    const source = await this.requireSource(projectId, sourceId);
    const bytes = await this.sourceBytes(source);
    const info = await this.documents.inspect(bytes);
    if (!Number.isSafeInteger(page) || page < 1 || page > info.pageCount) throw new PKError('INVALID_PAGE', 'Page is outside this document');
    const embedded = (await this.documents.extractText(bytes, undefined, [page])).find(p => p.page === page)?.text ?? '';
    const model = embedded.trim() ? 'embedded-text' : `${this.config.processing?.provider}:${this.config.processing?.model}`;
    const cacheKey = sha(JSON.stringify([projectId,sourceId,(source.data.blob as BlobRef).hash,page,model,PROCESSING_VERSION]));
    const processingRecords = await this.store.list(projectId, 'processing');
    let cached = processingRecords.find(record=>record._id===`processing-${cacheKey}`) ?? processingRecords.find(record => record.data.sourceId === sourceId && record.data.page === page && record.data.model === model && record.data.processingVersion === PROCESSING_VERSION);
    let processingId = cached?._id ?? `processing-${cacheKey}`;
    for (let depth = 0; cached?.data.supersededBy; depth++) {
      if (depth >= 100 || typeof cached.data.supersededBy !== 'string') throw new PKError('PROCESSING_INCONSISTENT', 'Invalid processing retry chain');
      processingId = cached.data.supersededBy;
      cached = await this.store.get(projectId, processingId);
      if (cached && (cached.kind !== 'processing' || cached.data.sourceId !== sourceId || cached.data.page !== page)) throw new PKError('PROCESSING_INCONSISTENT', 'Retry checkpoint refers to another source or page');
    }
    if (cached?.data.status === 'complete') {
      const passage = await this.store.get(projectId, String(cached.data.passageId));
      if (passage?.kind === 'passage') return passage;
      throw new PKError('PROCESSING_INCONSISTENT', 'Cached passage is missing. Restore or inspect the project before retrying.');
    }
    if (cached && typeof cached.data.text === 'string') return this.finishProcessing(cached, cached.data.text, cached.data.extractionMetadata as Record<string,unknown>);
    if (cached && embedded.trim() && cached.data.model === 'embedded-text') return this.finishProcessing(cached, embedded, { method: 'embedded-text' });
    if (cached) throw new PKError('PROCESSING_PENDING', 'This page has an unfinished or uncertain operation. Inspect its saved state before another billable attempt.');
    if (!embedded.trim()) {
      const {project}=await this.research.getProjectContext(projectId);
      const operations=(project.data.budget as {operations:BudgetOperation[]}).operations;
      const missing=operations.filter(op=>!processingRecords.some(record=>record._id===op.operationId));
      if (missing.some(op=>!op.context && op.status!=='settled')) throw new PKError('BILLING_UNCERTAIN','An unresolved reservation has no processing checkpoint. Verify provider billing before further model processing.');
      if (missing.some(op=>op.context?.sourceId===sourceId && op.context.page===page && op.context.model===model)) throw new PKError('PROCESSING_PENDING','This page reserved processing but its checkpoint is missing. Reconcile billing and explicitly authorize page_retry.');
    }
    if (!embedded.trim() && !this.provider) throw new PKError('PROVIDER_REQUIRED', 'Configure a processing provider to interpret this scanned page or image');
    await this.research.consumeRun(projectId, runId, { pages: 1 });
    let rendered: Awaited<ReturnType<DocumentProcessor['renderPage']>> | undefined;
    let derivedBlob: BlobRef | undefined;
    if (!embedded.trim()) {
      rendered = await this.documents.renderPage(bytes, page, { scale: 1 });
      derivedBlob = await this.blobs.put(rendered.bytes);
      const reserved = await this.research.reserveBudget(projectId, { operationId: processingId, estimatedUsd: this.provider!.estimateMaxCost({ image: rendered.bytes, mimeType: rendered.mimeType }), context: {sourceId,page,model,cacheKey:sha(cacheKey+processingId),processingVersion:PROCESSING_VERSION} });
      if (reserved.alreadyExists) throw new PKError('PROCESSING_PENDING', 'This page already reserved model processing. Reconcile the existing operation without redispatch.');
    }
    const stamp = new Date().toISOString();
    let processing: PKRecord = { _id: processingId, projectId, kind: 'processing', revision: 1, createdAt: stamp, updatedAt: stamp, data: { sourceId, page, cacheKey: sha(cacheKey+processingId), processingVersion: PROCESSING_VERSION, model, status: 'in_progress', ...(derivedBlob ? { blob: derivedBlob, transform: rendered!.transform } : {}) } };
    try { await this.store.insert(processing); } catch (error) {
      if (derivedBlob) await this.research.markBudgetUncertain(projectId, processingId, 'Could not persist dispatch checkpoint. No automatic retry.');
      throw error;
    }
    let text = embedded;
    let extractionMetadata: Record<string, unknown> = { method: 'embedded-text' };
    try {
      if (rendered) {
        await this.research.assertBudgetDispatchable(projectId, processingId);
        const result = await this.provider!.process({ image: rendered.bytes, mimeType: rendered.mimeType, purpose: source.data.sourceType === 'historical-map' ? 'interpretation' : 'transcription' });
        text = result.extraction.text;
        extractionMetadata = { method: 'model', provider: result.provider, model: result.model, usage: result.usage, costUsd: result.costUsd, pricingVersion: result.pricingVersion, extraction: result.extraction, transform: rendered.transform };
        const saved = { ...processing, revision: processing.revision + 1, data: { ...processing.data, status: 'result_saved', extractionMetadata, text } };
        if (!await this.store.replace(saved, processing.revision)) throw new PKError('CONCURRENT_UPDATE', 'Processing result checkpoint conflict');
        processing = saved;
      }
      return await this.finishProcessing(processing, text, extractionMetadata);
    } catch (error) {
      if (rendered) {
        const knownCost = error && typeof error === 'object' && 'actualCostUsd' in error && typeof error.actualCostUsd === 'number' ? error.actualCostUsd : undefined;
        const definiteFailure = error && typeof error === 'object' && 'uncertainBilling' in error && error.uncertainBilling === false;
        if (knownCost !== undefined) {
          await this.research.settleBudget(projectId, { operationId: processingId, actualUsd: knownCost });
          if (error instanceof PKError && error.code === 'PROVIDER_BUDGET_BOUND') await this.research.blockProcessing(projectId, { operationId: processingId, reason: 'Provider exceeded its configured token ceiling. Correct pricing/token bounds before explicitly unblocking processing.' });
        }
        else if (definiteFailure) await this.research.settleBudget(projectId, { operationId: processingId, actualUsd: 0 });
        else if (typeof processing.data.text !== 'string') await this.research.markBudgetUncertain(projectId, processingId, 'Model dispatch or persistence outcome is uncertain. Check provider usage and saved processing records.').catch(() => undefined);
      }
      const failed = { ...processing, revision: processing.revision + 1, data: { ...processing.data, status: 'uncertain', errorCode: error instanceof PKError ? error.code : 'PROCESSING_FAILED' } };
      await this.store.replace(failed, processing.revision).catch(() => false);
      throw error;
    }
  }
  async retryPage(projectId: string, runId: string, sourceId: string, page: number, approval: {reviewer:string;approvalText:string}): Promise<PKRecord> {
    requireText(approval.reviewer,'Reviewer',500); requireText(approval.approvalText,'Explicit retry approval',10000);
    await this.requireSource(projectId,sourceId);
    await this.research.consumeRun(projectId,runId,{});
    const {project}=await this.research.getProjectContext(projectId);
    const budget=project.data.budget as {operations:BudgetOperation[]};
    const records=await this.store.list(projectId,'processing');
    const model=`${this.config.processing?.provider}:${this.config.processing?.model}`;
    const candidates = records.filter(record=>record.data.sourceId===sourceId && record.data.page===page && record.data.model===model && record.data.processingVersion===PROCESSING_VERSION && !record.data.supersededBy);
    if (!candidates.length) {
      const orphaned=budget.operations.filter(op=>op.context?.sourceId===sourceId && op.context.page===page && op.context.model===model && op.context.processingVersion===PROCESSING_VERSION && !records.some(record=>record._id===op.operationId));
      if (orphaned.length===1 && orphaned[0]!.status==='settled') {
        const orphan=orphaned[0]!;const at=new Date().toISOString();
        const recovered:PKRecord={_id:orphan.operationId,projectId,kind:'processing',revision:1,createdAt:at,updatedAt:at,data:{...orphan.context,status:'uncertain',recoveredMissingCheckpoint:true}};
        await this.store.insert(recovered);candidates.push(recovered);
      }
    }
    if (candidates.length !== 1) throw new PKError('PROCESSING_PENDING','Select the existing failed page operation. No unique retryable operation was found.');
    const prior=candidates[0]!;
    if (prior.data.status==='complete' || typeof prior.data.text==='string') throw new PKError('PROCESSING_PENDING','A saved result already exists. Resume with page_process without another model request.');
    const operation=budget.operations.find(op=>op.operationId===prior._id);
    if (!operation || operation.status!=='settled') throw new PKError('BILLING_UNCERTAIN','Verify and reconcile the prior provider charge before authorizing another attempt.');
    if (project.data.processingBlocked) throw new PKError('PROCESSING_BLOCKED','Resolve the project processing block before retrying.');
    const supersededBy=`processing-${randomUUID()}`;
    const authorized={...prior,revision:prior.revision+1,updatedAt:new Date().toISOString(),data:{...prior.data,supersededBy,retryApproval:{...approval,at:new Date().toISOString()}}};
    if (!await this.store.replace(authorized,prior.revision)) throw new PKError('CONCURRENT_UPDATE','Processing state changed. Review the current operation before retrying.');
    return this.processPage(projectId,runId,sourceId,page);
  }
  private async finishProcessing(processing: PKRecord, text: string, extractionMetadata: Record<string,unknown>): Promise<PKRecord> {
    const projectId = processing.projectId;
    if (typeof extractionMetadata.costUsd === 'number') await this.research.settleBudget(projectId, { operationId: processing._id, actualUsd: extractionMetadata.costUsd });
    const passage = (await this.store.list(projectId, 'passage')).find(p => p.data.processingId === processing._id) ?? await this.research.addPassage(projectId, { sourceId: String(processing.data.sourceId), text: text.trim() || '[No legible text extracted. Inspect the original image.]', locator: { page: Number(processing.data.page), precision: 'page' }, extractionMetadata, processingId: processing._id, idempotencyKey: String(processing.data.cacheKey) });
    const completed = { ...processing, revision: processing.revision + 1, updatedAt: new Date().toISOString(), data: { ...processing.data, status: 'complete', passageId: passage._id } };
    if (!await this.store.replace(completed, processing.revision)) {
      const current = await this.store.get(projectId, processing._id);
      if (current?.data.status !== 'complete' || current.data.passageId !== passage._id) throw new PKError('CONCURRENT_UPDATE', 'Processing completion conflict');
    }
    return passage;
  }
  async dossier(projectId: string) { await this.research.getProjectContext(projectId); return buildDossier(this.store, projectId); }
  async backup(projectId: string) { await this.research.getProjectContext(projectId); return createBundle(this.store, this.blobs, projectId); }
  async restore(bundle: unknown, targetProjectId: string, operationId: string) { return restoreBundle(this.store, this.blobs, bundle, { targetProjectId, operationId }); }
  async copy(sourceProjectId: string, targetProjectId: string, recordIds: string[]) {
    await this.research.getProjectContext(sourceProjectId); await this.research.getProjectContext(targetProjectId);
    return copyRecords(this.store, sourceProjectId, targetProjectId, recordIds);
  }
  async writeExport(projectId: string, format: 'markdown' | 'html' | 'json' | 'backup') {
    const dossier = format === 'backup' ? undefined : await this.dossier(projectId);
    const body = format === 'backup' ? JSON.stringify(await this.backup(projectId),null,2) : format === 'json' ? JSON.stringify(dossier!.json,null,2) : dossier![format];
    await mkdir(this.config.exportDir, { recursive: true, mode: 0o700 });
    const root = await realpath(this.config.exportDir);
    const path = join(root, `${format}-${randomUUID()}.${format === 'markdown' ? 'md' : format === 'html' ? 'html' : 'json'}`);
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(body); } finally { await handle.close(); }
    return { path, format, bytes: Buffer.byteLength(body) };
  }
}
