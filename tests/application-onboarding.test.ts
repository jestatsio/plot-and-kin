import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from '../src/application.js';
import { readConfig } from '../src/config.js';
import { AstraStore, MemoryStore } from '../src/storage.js';
import { candidateMap, caseOverview, processingQueue, processBatch, sampleCase } from '../src/onboarding.js';

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) await action(); });
async function app() {
  const dir = await mkdtemp(join(tmpdir(), 'pk-case-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const a = new Application(readConfig({ PK_LIBRARY_DIR: dir })); cleanup.push(() => a.close()); await a.initialize(); return a;
}
function remoteStore() {
  const store = new MemoryStore();
  vi.spyOn(AstraStore.prototype, 'diagnose').mockResolvedValue({ collections: ['pk_records', 'pk_passages'], lexical: true });
  vi.spyOn(AstraStore.prototype, 'get').mockImplementation((...args) => store.get(...args));
  vi.spyOn(AstraStore.prototype, 'list').mockImplementation((...args) => store.list(...args));
  vi.spyOn(AstraStore.prototype, 'insert').mockImplementation((...args) => store.insert(...args));
  vi.spyOn(AstraStore.prototype, 'replace').mockImplementation((...args) => store.replace(...args));
  vi.spyOn(AstraStore.prototype, 'search').mockImplementation((...args) => store.search(...args));
  return store;
}

describe('case navigation and document progress', () => {
  it('shows completed pages, review invalidation and opposing evidence without losing originals', async () => {
    const a = await app(); const sample = await sampleCase(a); const id = sample.projectId;
    const source = (await a.store.list(id, 'source'))[0]!;
    expect((await processingQueue(a, id, source._id)).queue[0]!.pages[0]!.status).toBe('complete');
    await expect(processingQueue(a, id, 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const passage = (await a.store.list(id, 'passage'))[0]!;
    const claim = await a.research.proposeClaim(id, { statement: 'A competing interpretation.', evidence: [{ passageId: passage._id, stance: 'opposing' }] });
    expect((await caseOverview(a, id)).contradictions.map(c => c._id)).toContain(claim._id);
    const run = await a.research.startRun(id);
    expect((await processBatch(a, id, run._id, source._id, [1])).completed).toHaveLength(1);
    expect((await processingQueue(a, id)).summary).toContain('completed page');
    const sourceRead = await a.readPage(id, source._id, 1); expect(sourceRead).toHaveProperty('text', expect.stringContaining('Synthetic'));
  });
  it('requires an examined geolocated DC candidate and derives a bounded excerpt', async () => {
    const a = await app(); const p = await a.research.createProject({ address: 'A house', question: 'Earlier footprint?' }); const r = await a.research.startRun(p._id);
    const source = await a.research.addSource(p._id, { title: 'Candidate', sourceType: 'compiled-dataset', geometry: { x: -77, y: 38.9 } });
    const render = vi.spyOn(a, 'mapExcerpt').mockResolvedValue(source);
    await candidateMap(a, p._id, r._id, source._id);
    const bounds = render.mock.calls[0]![2].bbox;
    expect(bounds[0]).toBeLessThan(-77); expect(bounds[2]).toBeGreaterThan(-77); expect(bounds[1]).toBeLessThan(38.9); expect(bounds[3]).toBeGreaterThan(38.9);
    await expect(candidateMap(a, p._id, r._id, 'absent')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(candidateMap(a, p._id, r._id, source._id, 1)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(render).toHaveBeenCalledTimes(1);
  });
  it('does not unlock optional credentials for readiness or embedded text', async () => {
    const a = await app(); const resolveKey = vi.fn(async () => { throw new Error('Locked'); });
    a.config.resolveProcessingKey = resolveKey;
    a.config.resolveAstra = vi.fn(async () => { throw new Error('Locked'); });
    a.config.processing = { provider: 'openai', model: 'test', apiKey: '', pricing: { inputPerMillion: 1, outputPerMillion: 5, version: new Date().toISOString().slice(0, 10) }, maxInputTokens: 32768, maxOutputTokens: 4096 };
    expect((await a.diagnose()).processing).toMatchObject({ ready: false, configured: true, maximumRequestUsd: 0.053248 });
    await sampleCase(a);
    expect(resolveKey).not.toHaveBeenCalled(); expect(a.config.resolveAstra).not.toHaveBeenCalled();
    a.config.processingError = 'Settings need attention'; expect((await a.diagnose()).processing).toMatchObject({ ready: false, message: 'Settings need attention' });
  });
});

describe('approved transfer integration', () => {
  it('records explicit approval, resolves the optional connection only for transfer, and resumes the verified destination', async () => {
    const a = await app(); const remote = remoteStore();
    a.config.resolveAstra = vi.fn(async () => ({ endpoint: 'https://example-us-east-2.apps.astra.datastax.com', token: 'test-token', keyspace: 'default_keyspace' }));
    const sample = await sampleCase(a); const p = (await a.research.getProjectContext(sample.projectId)).project;
    expect((await a.transferStatus(p._id)).transfer).toBeNull();
    await expect(a.transferProject(p._id, { targetProjectId: 'astracase', operationId: 'transfer', expectedRevision: p.revision + 1, reviewer: 'Test', approvalText: 'Move this case.' })).rejects.toMatchObject({ code: 'CONCURRENT_UPDATE' });
    const approvalText = 'I approve this transfer after reviewing its destination. '.repeat(30);
    const input = { targetProjectId: 'astracase', operationId: 'transfer', expectedRevision: p.revision, reviewer: 'Test', approvalText };
    expect(await a.transferProject(p._id, input)).toMatchObject({ status: 'complete', targetProjectId: 'astracase' });
    expect((await a.transferStatus(p._id)).transfer?.status).toBe('complete');
    expect(await a.transferProject(p._id, input)).toMatchObject({ status: 'complete' });
    expect((await remote.list('astracase', 'log')).find(r => r.data.type === 'transfer_approval')?.data.approvalText).toBe(approvalText);
    expect((await a.store.projects!()).find(r => r.projectId === 'astracase')?.data.storageBackend).toBe('astra');
    expect((await caseOverview(a, 'astracase')).reviewQueue).toHaveLength(1);
    await expect(a.recoverTransfer(p._id, 'transfer', 'cancel', true)).rejects.toMatchObject({ code: 'TRANSFER_CONFLICT' });
  });
  it('keeps source intact if the optional connection has not been configured', async () => {
    const a = await app(); const sample = await sampleCase(a); const p = (await a.research.getProjectContext(sample.projectId)).project;
    await expect(a.transferProject(p._id, { targetProjectId: 'fresh', operationId: 'move', expectedRevision: p.revision, reviewer: 'Test', approvalText: 'Move.' })).rejects.toMatchObject({ code: 'CONFIG' });
    expect((await a.transferStatus(p._id)).transfer).toBeNull();
    expect((await caseOverview(a, p._id)).reviewQueue).toHaveLength(1);
  });
});
