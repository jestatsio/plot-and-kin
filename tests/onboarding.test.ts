import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Application } from '../src/application.js';
import { readConfig } from '../src/config.js';
import { createBootstrapServer } from '../src/server.js';
import { caseOverview, importInbox, processBatch, sampleCase } from '../src/onboarding.js';
import { PKError, type PKRecord } from '../src/types.js';
import type { Dossier } from '../src/portability.js';

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function app(storage = 'local') {
  const dir = await mkdtemp(join(tmpdir(), 'pk-onboarding-é space-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const a = new Application(readConfig({ PK_STORAGE: storage, PK_LIBRARY_DIR: dir }));
  cleanup.push(() => a.close());
  await a.initialize();
  return a;
}

describe('first-use workflow', () => {
  it('keeps a sample, explicit approval, citations and search after restarting local storage', async () => {
    const a = await app();
    const sample = await sampleCase(a);
    expect(sample.synthetic).toBe(true);
    expect(sample.reviewQueue).toHaveLength(1);
    expect(await a.store.list(sample.projectId, 'decision')).toHaveLength(0);
    expect((await sampleCase(a)).projectId).toBe(sample.projectId);
    expect(await a.store.list(sample.projectId, 'claim')).toHaveLength(1);
    const claim = sample.reviewQueue[0]!;
    await a.research.recordDecision(sample.projectId, { targetId: claim._id, expectedRevision: claim.revision, decision: 'accepted', reviewer: 'Test researcher', approvalText: 'I approve this fictional sample statement after checking the source.' });
    a.close();
    const resumed = new Application(a.config); cleanup.push(() => resumed.close()); await resumed.initialize();
    expect((await caseOverview(resumed, sample.projectId)).approved).toHaveLength(1);
    expect(await resumed.store.search(sample.projectId, 'Ada Example')).toHaveLength(1);
    expect((await resumed.dossier(sample.projectId)).markdown).toContain('Synthetic');
    const output = await resumed.writeExport(sample.projectId, 'html');
    expect(output.filename).toMatch(/^Example-House-synthetic-sample-html-/);
  });

  it('stops a bounded batch at failure while completed text pages remain available', async () => {
    const a = await app();
    const p = await a.research.createProject({ address: 'Test house', question: 'History?' });
    const run = await a.research.startRun(p._id);
    const source = await a.importDocument(p._id, run._id, { title: 'Permitted text', base64: Buffer.from('A historical observation.').toString('base64') });
    const result = await processBatch(a, p._id, run._id, source._id, [1, 2, 3]);
    expect(result.completed).toHaveLength(1); expect(result.stoppedAtPage).toBe(2);
    expect((await a.processPage(p._id, run._id, source._id, 1))._id).toBe(result.completed[0]!._id);
    await expect(processBatch(a, p._id, run._id, source._id, [1, 1])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('keeps embedded-text research available when optional pricing is stale', async () => {
    const a = await app('memory');
    a.config.processing = { provider: 'openai', model: 'test', apiKey: 'never-dispatched', pricing: { inputPerMillion: 1, outputPerMillion: 1, version: '2000-01-01' }, maxInputTokens: 32768, maxOutputTokens: 4096 };
    expect((await a.diagnose()).processing).toMatchObject({ ready: false });
    expect((await sampleCase(a)).reviewQueue).toHaveLength(1);
  });

  it('lists import filenames without exposing symlink targets', async () => {
    const a = await app();
    await writeFile(join(a.config.importDir, 'record.txt'), 'Evidence');
    if (process.platform !== 'win32') await symlink(join(a.config.libraryDir, 'records.sqlite'), join(a.config.importDir, 'hidden-link'));
    expect((await importInbox(a)).files).toEqual(['record.txt']);
  });
});

describe.each(['Codex', 'Claude Desktop'])('%s setup protocol', name => {
  it('connects with broken settings and recovers without exposing credentials', async () => {
    const a = await app(); let ready = false;
    const server = createBootstrapServer(async () => { if (!ready) throw new PKError('CONFIG', 'Storage needs configuration'); return a; });
    const client = new Client({ name, version: 'test' });
    const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
    cleanup.push(() => server.close()); cleanup.push(() => client.close());
    expect((await client.listTools()).tools.map(t => t.name)).toContain('welcome');
    const status = await client.callTool({ name: 'setup_status', arguments: {} });
    expect(status.structuredContent).toMatchObject({ result: { ready: false, code: 'CONFIG' } });
    expect(status.isError).not.toBe(true);
    const failed = await client.callTool({ name: 'project_list', arguments: {} }); expect(failed.isError).toBe(true);
    ready = true;
    const welcome = await client.callTool({ name: 'welcome', arguments: {} });
    expect(welcome.structuredContent).toMatchObject({ result: { ready: true } });
    const sample = await client.callTool({ name: 'sample_case', arguments: {} });
    expect(sample.isError).not.toBe(true);
    expect(sample.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining('awaiting review') })]));
  });

  it('completes a cited review using only standard text content, without structuredContent', async () => {
    const a = await app();
    const server = createBootstrapServer(async () => a);
    const client = new Client({ name: `${name}-content-only`, version: 'test' });
    const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
    cleanup.push(() => server.close()); cleanup.push(() => client.close());
    const call = async <T>(tool: string, args: Record<string, unknown>): Promise<T> => {
      const response = await client.callTool({ name: tool, arguments: args });
      expect(response.isError).not.toBe(true);
      const blocks = response.content as Array<{ type: string; text?: string }>;
      const block = blocks.find(item => item.type === 'text' && item.text?.startsWith('{"result":'));
      expect(block, `${tool} must preserve machine-readable text for content-only clients`).toBeDefined();
      return (JSON.parse(block!.text!) as { result: T }).result;
    };
    const project = await call<PKRecord>('project_create', { address: 'Content-only sample house', question: 'What does the supplied record say?' });
    const run = await call<PKRecord>('run_start', { projectId: project._id });
    const source = await call<PKRecord>('source_import', { projectId: project._id, runId: run._id, title: 'Synthetic directory', base64: Buffer.from('Ada Example occupied the sample house in 1901. Synthetic test record.').toString('base64'), mimeType: 'text/plain' });
    const passage = await call<PKRecord>('page_process', { projectId: project._id, runId: run._id, sourceId: source._id, page: 1 });
    expect(passage.data.locator).toMatchObject({ precision: 'page', page: 1 });
    const claim = await call<PKRecord>('claim_propose', { projectId: project._id, statement: 'The synthetic directory lists Ada Example as an occupant in 1901.', category: 'occupancy', evidence: [{ passageId: passage._id, stance: 'supporting' }] });
    await call<PKRecord>('review_record', { projectId: project._id, targetId: claim._id, expectedRevision: claim.revision, decision: 'accepted', reviewer: 'Test researcher', approvalText: 'I checked this synthetic passage and approve this wording.' });
    const dossier = await call<Dossier>('project_dossier', { projectId: project._id });
    expect(dossier.json.claimReviews[claim._id]).toBe('accepted');
    expect(dossier.markdown).toContain('Synthetic directory');
    expect(dossier.markdown).toContain(passage._id);
  });

});
