import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildDossier, copyRecords, createBundle, restoreBundle } from '../src/portability.js';
import { MAX_SOURCE_BYTES } from '../src/library.js';
import type { BlobStore, PKRecord, RecordKind, RecordStore } from '../src/types.js';

class TestStore implements RecordStore {
  records = new Map<string, PKRecord>();
  failInsertAfter: number | undefined;
  writes = 0;
  async insert(record: PKRecord) {
    if (this.failInsertAfter !== undefined && this.writes >= this.failInsertAfter) throw new Error('interrupted');
    const key = `${record.projectId}/${record._id}`;
    if (this.records.has(key)) throw new Error('already exists');
    this.records.set(key, structuredClone(record)); this.writes++;
  }
  async get(projectId: string, id: string) { return structuredClone(this.records.get(`${projectId}/${id}`)); }
  async list(projectId: string, kind?: RecordKind) {
    return structuredClone([...this.records.values()].filter(r => r.projectId === projectId && (!kind || kind === r.kind)));
  }
  async replace(record: PKRecord, expectedRevision: number) {
    const current = await this.get(record.projectId, record._id);
    if (!current || current.revision !== expectedRevision) return false;
    this.records.set(`${record.projectId}/${record._id}`, structuredClone(record)); this.writes++; return true;
  }
  async search(projectId: string, query: string) {
    return (await this.list(projectId)).filter(r => JSON.stringify(r).includes(query));
  }
}
class TestBlobs implements BlobStore {
  values = new Map<string, Uint8Array>();
  writes = 0;
  async put(bytes: Uint8Array) {
    const hash = createHash('sha256').update(bytes).digest('hex');
    this.values.set(hash, bytes); this.writes++; return { hash, size: bytes.byteLength };
  }
  async read(hash: string) { const value = this.values.get(hash); if (!value) throw new Error('missing blob'); return value; }
  async verify(hash: string) { const value = this.values.get(hash); return !!value && createHash('sha256').update(value).digest('hex') === hash; }
}
const stamp = '2026-10-01T12:00:00.000Z';
function rec(id: string, kind: RecordKind, data: Record<string, unknown>, projectId = 'case-1'): PKRecord {
  return { _id: id, projectId, kind, revision: 1, createdAt: stamp, updatedAt: stamp, data };
}
function approve(claim: PKRecord, id = 'approved-1'): PKRecord {
  const snapshot = structuredClone(claim); delete snapshot.data.decisionAudit;
  const decision = rec(id, 'decision', { targetId: claim._id, targetRevision: claim.revision, decision: 'accepted', reviewer: 'Researcher', approvalText: 'Approved in chat', snapshot });
  claim.revision++;
  claim.data.reviewStatus = 'accepted'; claim.data.decisionAudit = decision;
  claim.data.lastDecision = { decisionId: id, reviewedRevision: snapshot.revision, decision: 'accepted', reviewer: 'Researcher', approvalText: 'Approved in chat' };
  return decision;
}
async function fixture() {
  const store = new TestStore(); const blobs = new TestBlobs();
  const original = await blobs.put(new TextEncoder().encode('An example archival page.'));
  const records = [
    rec('case-1', 'project', { address: 'A house <history>', question: 'Who occupied it?', schemaVersion: 1, budget: { limitMicros: 10000000, spentMicros: 0, reservedMicros: 0, operations: [] } }),
    rec('s1', 'source', { title: 'Directory <script>alert(1)</script>', blob: original, rights: 'Research permitted', url: 'https://example.org/item/1' }),
    rec('p1', 'passage', { sourceId: 's1', text: 'Smith occupied the house.', locator: { precision: 'page', page: 2 } }),
    rec('c1', 'claim', { statement: 'Smith occupied the house.', reviewStatus: 'proposed', entityIds: [], evidence: [{ passageId: 'p1', stance: 'supporting' }] }),
    rec('c2', 'claim', { statement: 'Construction was in 1890.', reviewStatus: 'proposed', entityIds: [], evidence: [{ passageId: 'p1', stance: 'opposing' }] }),
    rec('l1', 'log', { message: 'Search for earlier owner', action: 'search', query: 'earlier owner', outcome: 'no_results', gap: 'Earlier owners remain unknown.' }),
  ];
  records.push(approve(records.find(r => r._id === 'c1')!));
  for (const record of records) await store.insert(record);
  return { store, blobs, records };
}

describe('portable research dossiers', () => {
  it('keeps approved conclusions, proposed claims, contradictions and gaps visibly distinct and escapes HTML', async () => {
    const { store } = await fixture();
    const dossier = await buildDossier(store, 'case-1');
    expect(dossier.markdown).toContain('Approved');
    expect(dossier.markdown).toContain('Proposed');
    expect(dossier.markdown).toContain('Earlier owners remain unknown.');
    expect(dossier.markdown).toContain('p1');
    expect(dossier.html).not.toContain('<script>');
    expect(dossier.html).toContain('&lt;script&gt;');
    expect(dossier.json).toHaveProperty('projectId', 'case-1');
  });
  it('round trips evidence, originals and logs into a fresh project without changing the source', async () => {
    const { store, blobs } = await fixture();
    const bundle = await createBundle(store, blobs, 'case-1');
    const destination = new TestStore(); const files = new TestBlobs();
    const result = await restoreBundle(destination, files, bundle, { targetProjectId: 'restored', operationId: 'restore-1' });
    expect(result.status).toBe('complete');
    expect(result.restoredRecords).toBe(7);
    expect((await destination.get('restored', 'restored'))?.data.restoreStatus).toBe('ready');
    const restoredClaims = await destination.list('restored', 'claim');
    expect(restoredClaims).toHaveLength(2);
    expect(files.values.size).toBe(1);
    expect((await store.list('case-1')).length).toBe(7);
  });
  it('excludes credentials and machine paths from exports', async () => {
    const { store, blobs } = await fixture();
    await store.insert(rec('private', 'log', { apiKey: 'secret-value', nested: { authorization: 'Bearer x', localPath: '/Users/private/original.pdf', ASTRA_DB_APPLICATION_TOKEN: 'secret-astra', ANTHROPIC_API_KEY: 'secret-anthropic', PK_LIBRARY_DIR: '/Users/private/library' }, message: 'safe note' }));
    const bundle = await createBundle(store, blobs, 'case-1');
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('/Users/private');
    expect(serialized).not.toContain('Bearer x');
    expect(serialized).not.toContain('secret-astra');
    expect(serialized).not.toContain('secret-anthropic');
    expect(serialized).toContain('safe note');
  });
  it('rejects corrupt blobs and dangling evidence references before writing anything', async () => {
    const { store, blobs } = await fixture();
    const bundle = await createBundle(store, blobs, 'case-1');
    bundle.assets[0]!.data = Buffer.from('tampered').toString('base64');
    const destination = new TestStore(); const files = new TestBlobs();
    await expect(restoreBundle(destination, files, bundle, { targetProjectId: 'new', operationId: 'bad' })).rejects.toThrow(/hash|size/i);
    expect(destination.writes).toBe(0); expect(files.writes).toBe(0);
    const dangling = await createBundle(store, blobs, 'case-1');
    dangling.records = dangling.records.filter(r => r._id !== 'p1');
    await expect(restoreBundle(destination, files, dangling, { targetProjectId: 'new', operationId: 'bad2' })).rejects.toThrow(/reference/i);
    expect(destination.writes).toBe(0);
  });
  it('refuses to overwrite an existing project', async () => {
    const { store, blobs } = await fixture();
    const bundle = await createBundle(store, blobs, 'case-1');
    await expect(restoreBundle(store, blobs, bundle, { targetProjectId: 'case-1', operationId: 'overwriting' })).rejects.toThrow(/exist|fresh/i);
    expect((await store.list('case-1')).length).toBe(7);
  });
  it('resumes an interrupted restore and makes completed retries idempotent', async () => {
    const { store, blobs } = await fixture(); const bundle = await createBundle(store, blobs, 'case-1');
    const destination = new TestStore(); const files = new TestBlobs();
    destination.failInsertAfter = 3;
    await expect(restoreBundle(destination, files, bundle, { targetProjectId: 'new', operationId: 'resume' })).rejects.toThrow('interrupted');
    expect((await destination.get('new', 'new'))?.data.restoreStatus).toBe('restoring');
    destination.failInsertAfter = undefined;
    const result = await restoreBundle(destination, files, bundle, { targetProjectId: 'new', operationId: 'resume' });
    expect(result.status).toBe('complete');
    const count = destination.writes;
    await restoreBundle(destination, files, bundle, { targetProjectId: 'new', operationId: 'resume' });
    expect(destination.writes).toBe(count);
    const altered = structuredClone(bundle); altered.records.find(r => r._id === 'c2')!.data.statement = 'Changed';
    await expect(restoreBundle(destination, files, altered, { targetProjectId: 'new', operationId: 'resume' })).rejects.toThrow(/different|match|conflict/i);
  });
  it('rejects duplicate record IDs, future versions and unsafe external paths before mutation', async () => {
    const { store, blobs } = await fixture(); const bundle = await createBundle(store, blobs, 'case-1');
    const destination = new TestStore(); const files = new TestBlobs();
    const duplicate = structuredClone(bundle); duplicate.records.push(duplicate.records[0]!);
    await expect(restoreBundle(destination, files, duplicate, { targetProjectId: 'new', operationId: 'duplicate' })).rejects.toThrow(/duplicate/i);
    const future = { ...bundle, schemaVersion: 99 };
    await expect(restoreBundle(destination, files, future, { targetProjectId: 'new', operationId: 'future' })).rejects.toThrow(/version/i);
    const unsafe = structuredClone(bundle); unsafe.records.find(r => r._id === 's1')!.data.localPath = '/tmp/overwrite';
    await expect(restoreBundle(destination, files, unsafe, { targetProjectId: 'new', operationId: 'unsafe' })).rejects.toThrow(/path|sensitive/i);
    expect(destination.writes).toBe(0); expect(files.writes).toBe(0);
  });
  it('copies an evidence dependency closure only by explicit request and preserves origin provenance', async () => {
    const { store } = await fixture();
    await store.insert(rec('other', 'project', { title: 'Other', status: 'ready' }, 'other'));
    const copied = await copyRecords(store, 'case-1', 'other', ['c1']);
    expect(copied.map(r => r.kind).sort()).toEqual(['claim', 'passage', 'source']);
    expect(copied.every(r => r.projectId === 'other')).toBe(true);
    const claim = copied.find(r => r.kind === 'claim')!;
    expect(claim.data.origin).toMatchObject({ projectId: 'case-1', recordId: 'c1' });
    expect(claim.data.reviewStatus).toBe('proposed');
    expect(claim.data.evidence).not.toEqual([{ passageId: 'p1', stance: 'supporting' }]);
    expect((await store.get('case-1', 'c1'))?.data.reviewStatus).toBe('accepted');
  });
  it('downgrades accepted conclusions whose evidence was superseded even if persisted review status is stale', async () => {
    const { store } = await fixture();
    await store.insert(rec('p2', 'passage', { sourceId: 's1', text: 'A different Smith occupied the house.', locator: { precision: 'page', page: 2 }, supersedes: 'p1' }));
    const dossier = await buildDossier(store, 'case-1');
    expect(dossier.json.claimReviews.c1).toBe('requires_review');
    expect(dossier.markdown).toContain('Renewed human review is required');
  });
  it('recovers a missing append-only decision from its atomic embedded audit during export', async () => {
    const { store, blobs } = await fixture();
    const claim = (await store.get('case-1', 'c1'))!;
    const previousRevision = claim.revision;
    const decision = approve(claim, 'd1');
    await store.replace(claim, previousRevision);
    const bundle = await createBundle(store, blobs, 'case-1');
    expect(bundle.records.find(r => r._id === 'd1')).toEqual(decision);
    expect(await store.get('case-1', 'd1')).toBeUndefined();
    const destination = new TestStore();
    await restoreBundle(destination, new TestBlobs(), bundle, { targetProjectId: 'new', operationId: 'audit' });
    const restored = (await destination.list('new', 'decision'))[0]!;
    expect(restored.projectId).toBe('new');
    expect((restored.data.snapshot as PKRecord).projectId).toBe('new');
  });
  it('refuses a bundle whose referenced original asset is omitted', async () => {
    const { store, blobs } = await fixture(); const bundle = await createBundle(store, blobs, 'case-1');
    bundle.assets = [];
    const destination = new TestStore(); const files = new TestBlobs();
    await expect(restoreBundle(destination, files, bundle, { targetProjectId: 'new', operationId: 'missing' })).rejects.toThrow(/asset/i);
    expect(destination.writes).toBe(0); expect(files.writes).toBe(0);
  });
  it('rejects an individually oversized valid asset before any destination writes', async () => {
    const { store, blobs } = await fixture(); const bundle = await createBundle(store, blobs, 'case-1');
    const oversized = Buffer.alloc(MAX_SOURCE_BYTES + 1, 42);
    const hash = createHash('sha256').update(oversized).digest('hex');
    bundle.records.find(record => record._id === 's1')!.data.blob = { hash, size: oversized.byteLength };
    bundle.assets = [{ hash, size: oversized.byteLength, encoding: 'base64', data: oversized.toString('base64') }];
    const destination = new TestStore(); const files = new TestBlobs();
    await expect(restoreBundle(destination, files, bundle, { targetProjectId: 'new', operationId: 'oversized' })).rejects.toThrow(/asset.*size|size.*limit/i);
    expect(destination.writes).toBe(0); expect(files.writes).toBe(0);
  });
  it('rejects unreferenced assets before any destination writes', async () => {
    const { store, blobs } = await fixture(); const bundle = await createBundle(store, blobs, 'case-1');
    const bytes = Buffer.from('unreferenced original');
    bundle.assets.push({ hash: createHash('sha256').update(bytes).digest('hex'), size: bytes.byteLength, encoding: 'base64', data: bytes.toString('base64') });
    const destination = new TestStore(); const files = new TestBlobs();
    await expect(restoreBundle(destination, files, bundle, { targetProjectId: 'new', operationId: 'orphan' })).rejects.toThrow(/unreferenced/i);
    expect(destination.writes).toBe(0); expect(files.writes).toBe(0);
  });
  it('does not carry a source-project review approval into explicitly reused claims', async () => {
    const { store } = await fixture();
    const claim = (await store.get('case-1', 'c1'))!;
    const previousRevision = claim.revision;
    const decision = approve(claim, 'd1');
    await store.replace(claim, previousRevision); await store.insert(decision);
    await store.insert(rec('other', 'project', { question: 'A new question' }, 'other'));
    const copies = await copyRecords(store, 'case-1', 'other', ['c1']);
    expect(copies.find(record => record.kind === 'claim')!.data).not.toHaveProperty('decisionAudit');
    expect(copies.find(record => record.kind === 'claim')!.data).not.toHaveProperty('lastDecision');
  });
  it('preserves evidence text that resembles a path or credential exactly, including review snapshots', async () => {
    const { store, blobs } = await fixture();
    const passage = (await store.get('case-1', 'p1'))!;
    passage.data.text = '/ [illegible] Smith, resident';
    passage.data.locator = { precision: 'passage', quote: 'C:\\ historical ledger label' };
    await store.replace(passage, passage.revision);
    const claim = (await store.get('case-1', 'c1'))!;
    claim.data.statement = 'Bearer of this note was Smith';
    const previousRevision = claim.revision;
    const audit = approve(claim, 'd1');
    audit.data.approvalText = '/ agreed passage wording';
    (claim.data.lastDecision as Record<string, unknown>).approvalText = '/ agreed passage wording';
    await store.replace(claim, previousRevision);
    const bundle = await createBundle(store, blobs, 'case-1');
    expect(bundle.records.find(r => r._id === 'p1')!.data).toEqual(passage.data);
    expect(bundle.records.find(r => r._id === 'd1')!.data.approvalText).toBe('/ agreed passage wording');
    const destination = new TestStore();
    await restoreBundle(destination, new TestBlobs(), bundle, { targetProjectId: 'new', operationId: 'exact-text' });
    expect((await destination.list('new', 'passage'))[0]!.data.text).toBe(passage.data.text);
  });
  it('remaps budget operation IDs with their restored processing records and preserves uncertain outcomes', async () => {
    const { store, blobs } = await fixture();
    const project = (await store.get('case-1', 'case-1'))!;
    project.data.budget = { limitMicros: 10000000, reservedMicros: 2000, spentMicros: 0, operations: [{ operationId: 'processing-1', status: 'uncertain', estimatedMicros: 2000 }] };
    await store.replace(project, project.revision);
    await store.insert(rec('processing-1', 'processing', { sourceId: 's1', passageId: 'p1', page: 2, status: 'uncertain', model: 'test-model', processingVersion: 'v1' }));
    const bundle = await createBundle(store, blobs, 'case-1');
    const destination = new TestStore();
    await restoreBundle(destination, new TestBlobs(), bundle, { targetProjectId: 'new', operationId: 'processing' });
    const processing = (await destination.list('new', 'processing'))[0]!;
    const restored = (await destination.get('new', 'new'))!;
    const budget = restored.data.budget as { operations: Array<{ operationId: string; status: string }> };
    expect(budget.operations[0]!.operationId).toBe(processing._id);
    expect(budget.operations[0]!.status).toBe('uncertain');
    expect(processing.data.status).toBe('uncertain');
    expect(processing.data.sourceId).toBe((await destination.list('new', 'source'))[0]!._id);
  });
  it('builds a chronological timeline while retaining date qualifiers, category and review status', async () => {
    const { store } = await fixture();
    for (const [id, eventDate, category] of [['dated', '1901-02-03', 'occupancy'], ['year', '1890', 'construction'], ['circa', 'circa 1880', 'construction'], ['ambiguous', '01/02/1900', 'ownership']]) {
      await store.insert(rec(id!, 'claim', { statement: `Statement ${id}`, eventDate, category, reviewStatus: 'proposed', entityIds: [], evidence: [{ passageId: 'p1', stance: 'supporting' }] }));
    }
    const dossier = await buildDossier(store, 'case-1');
    expect(dossier.json.timeline.filter(entry => entry.sortDate).map(entry => entry.claimId)).toEqual(['circa', 'year', 'dated']);
    expect(dossier.json.timeline.find(entry => entry.claimId === 'circa')).toMatchObject({ eventDate: 'circa 1880', dateInterpretation: 'approximate', category: 'construction', reviewStatus: 'proposed' });
    expect(dossier.json.timeline.find(entry => entry.claimId === 'ambiguous')).toMatchObject({ eventDate: '01/02/1900', dateInterpretation: 'unplaced' });
    expect(dossier.json.timeline.find(entry => entry.claimId === 'c1')).toMatchObject({ dateInterpretation: 'undated', reviewStatus: 'accepted' });
    expect(dossier.markdown).toContain('## Timeline');
    expect(dossier.html).toContain('circa 1880');
    expect(dossier.html).toContain('Unplaced date');
  });
  it('remaps processing provenance on restore but omits processing jobs from evidence-only reuse', async () => {
    const { store, blobs } = await fixture();
    const passage = (await store.get('case-1', 'p1'))!;
    passage.data.processingId = 'processing-1'; await store.replace(passage, passage.revision);
    await store.insert(rec('processing-1', 'processing', { sourceId: 's1', passageId: 'p1', page: 2, status: 'complete', model: 'test-model', processingVersion: '1' }));
    const bundle = await createBundle(store, blobs, 'case-1'); const destination = new TestStore();
    await restoreBundle(destination, new TestBlobs(), bundle, { targetProjectId: 'new', operationId: 'processing-links' });
    const restoredPassage = (await destination.list('new', 'passage'))[0]!;
    expect(restoredPassage.data.processingId).toBe((await destination.list('new', 'processing'))[0]!._id);
    await store.insert(rec('other', 'project', { question: 'Other case' }, 'other'));
    const copied = await copyRecords(store, 'case-1', 'other', ['p1']);
    expect(copied.map(record => record.kind).sort()).toEqual(['passage', 'source']);
    expect(copied.find(record => record.kind === 'passage')!.data).not.toHaveProperty('processingId');
    expect(copied.find(record => record.kind === 'passage')!.data.origin).toMatchObject({ processingId: 'processing-1' });
  });
  it('resumes an interrupted explicit copy without duplicates and records completed progress', async () => {
    const { store } = await fixture();
    await store.insert(rec('other', 'project', { question: 'Other case' }, 'other'));
    store.failInsertAfter = store.writes + 2;
    await expect(copyRecords(store, 'case-1', 'other', ['c1'], 'copy-once')).rejects.toThrow('interrupted');
    const pending = (await store.list('other', 'operation'))[0]!;
    expect(pending.data.status).toBe('running');
    store.failInsertAfter = undefined;
    const copied = await copyRecords(store, 'case-1', 'other', ['c1'], 'copy-once');
    expect(copied).toHaveLength(3);
    expect((await store.list('other', 'operation'))[0]!.data).toMatchObject({ type: 'copy', status: 'complete', copiedRecordIds: expect.arrayContaining(copied.map(record => record._id)) });
    const writes = store.writes;
    const repeated = await copyRecords(store, 'case-1', 'other', ['c1'], 'copy-once');
    expect(repeated.map(record => record._id)).toEqual(copied.map(record => record._id));
    expect(store.writes).toBe(writes);
    await expect(copyRecords(store, 'case-1', 'other', ['c2'], 'copy-once')).rejects.toThrow(/conflict|different/i);
  });
  it('uses a deterministic default copy operation for unchanged source snapshots', async () => {
    const { store } = await fixture();
    await store.insert(rec('other', 'project', { question: 'Other case' }, 'other'));
    const first = await copyRecords(store, 'case-1', 'other', ['c1']);
    const writes = store.writes;
    const second = await copyRecords(store, 'case-1', 'other', ['c1']);
    expect(second.map(record => record._id)).toEqual(first.map(record => record._id));
    expect(store.writes).toBe(writes);
  });
  it('round trips completed copy progress and remaps its destination record references', async () => {
    const { store, blobs } = await fixture();
    const projectData = structuredClone((await store.get('case-1', 'case-1'))!.data);
    await store.insert(rec('other', 'project', { ...projectData, address: 'Other property' }, 'other'));
    await copyRecords(store, 'case-1', 'other', ['c1'], 'portable-copy');
    const bundle = await createBundle(store, blobs, 'other'); const destination = new TestStore();
    await restoreBundle(destination, new TestBlobs(), bundle, { targetProjectId: 'third', operationId: 'restore-copy' });
    const operation = (await destination.list('third', 'operation')).find(record => record.data.type === 'copy')!;
    expect(operation.data.status).toBe('complete');
    for (const id of operation.data.copiedRecordIds as string[]) expect(await destination.get('third', id)).toBeDefined();
    expect((await destination.list('third', 'claim'))[0]!.data.reviewStatus).toBe('proposed');
  });
  it.each([false, true])('round trips an approved processing retry chain with target dispatched=%s', async dispatched => {
    const { store, blobs } = await fixture();
    await store.insert(rec('process-old', 'processing', { sourceId: 's1', page: 2, status: 'uncertain', model: 'test-model', processingVersion: '1', supersededBy: 'process-next', retryApproval: { reviewer: 'Researcher', approvalText: 'Retry after settling billing', at: stamp } }));
    if (dispatched) await store.insert(rec('process-next', 'processing', { sourceId: 's1', page: 2, status: 'result_saved', text: 'Saved reading', extractionMetadata: { method: 'model' }, model: 'test-model', processingVersion: '1' }));
    const bundle = await createBundle(store, blobs, 'case-1'); const destination = new TestStore();
    await restoreBundle(destination, new TestBlobs(), bundle, { targetProjectId: 'new', operationId: 'retry-chain' });
    const prior = (await destination.list('new', 'processing')).find(record => record.data.supersededBy)!;
    expect(prior.data.supersededBy).not.toBe('process-next');
    expect(prior.data.retryApproval).toEqual({ reviewer: 'Researcher', approvalText: 'Retry after settling billing', at: stamp });
    const next = await destination.get('new', String(prior.data.supersededBy));
    if (dispatched) expect(next?.data).toMatchObject({ status: 'result_saved', sourceId: prior.data.sourceId, page: 2 });
    else expect(next).toBeUndefined();
  });
  it('remaps orphan billing reservations and their source context without inventing processing records', async () => {
    const { store, blobs } = await fixture();
    const project = (await store.get('case-1', 'case-1'))!;
    project.data.budget = { limitMicros: 10000000, reservedMicros: 3000, spentMicros: 0, operations: [{ operationId: 'undispatched-operation', estimatedMicros: 3000, status: 'uncertain', context: { sourceId: 's1', page: 2, model: 'test-model', cacheKey: 'test-cache-key', processingVersion: '1' } }] };
    await store.replace(project, project.revision);
    const bundle = await createBundle(store, blobs, 'case-1'); const destination = new TestStore();
    await restoreBundle(destination, new TestBlobs(), bundle, { targetProjectId: 'new', operationId: 'orphan-reservation' });
    const budget = (await destination.get('new', 'new'))!.data.budget as { operations: Array<{ operationId: string; context: { sourceId: string } }> };
    expect(budget.operations[0]!.operationId).not.toBe('undispatched-operation');
    expect(budget.operations[0]!.context.sourceId).toBe((await destination.list('new', 'source'))[0]!._id);
    expect(await destination.get('new', budget.operations[0]!.operationId)).toBeUndefined();
  });
  it.each([
    ['missing claim evidence', (records: PKRecord[]) => { delete records.find(r => r._id === 'c2')!.data.evidence; }],
    ['wrong evidence record kind', (records: PKRecord[]) => { records.find(r => r._id === 'c2')!.data.evidence = [{ passageId: 's1', stance: 'supporting' }]; }],
    ['wrong source record kind', (records: PKRecord[]) => { records.find(r => r._id === 'p1')!.data.sourceId = 'c2'; }],
    ['wrong entity references', (records: PKRecord[]) => { records.find(r => r._id === 'c2')!.data.entityIds = ['p1']; }],
    ['missing project budget', (records: PKRecord[]) => { delete records.find(r => r.kind === 'project')!.data.budget; }],
    ['negative budget', (records: PKRecord[]) => { (records.find(r => r.kind === 'project')!.data.budget as Record<string, unknown>).limitMicros = -1; }],
    ['missing locator value', (records: PKRecord[]) => { records.find(r => r._id === 'p1')!.data.locator = { precision: 'page' }; }],
    ['forged accepted claim', (records: PKRecord[]) => { records.find(r => r._id === 'c2')!.data.reviewStatus = 'accepted'; }],
    ['altered approved statement', (records: PKRecord[]) => { records.find(r => r._id === 'c1')!.data.statement = 'An unsupported changed claim'; }],
    ['missing source title', (records: PKRecord[]) => { delete records.find(r => r._id === 's1')!.data.title; }],
    ['missing log message', (records: PKRecord[]) => { delete records.find(r => r._id === 'l1')!.data.message; }],
    ['invalid run state', (records: PKRecord[]) => { records.push(rec('bad-run', 'run', { limits: {}, consumed: {}, status: 'active' })); }],
    ['invalid processing source', (records: PKRecord[]) => { records.push(rec('bad-process', 'processing', { sourceId: 'c1', page: 1, model: 'test', processingVersion: '1', status: 'uncertain' })); }],
  ])('rejects %s before any restore writes', async (_label, mutate) => {
    const { store, blobs } = await fixture(); const bundle = await createBundle(store, blobs, 'case-1');
    mutate(bundle.records);
    const destination = new TestStore(); const files = new TestBlobs();
    await expect(restoreBundle(destination, files, bundle, { targetProjectId: 'new', operationId: 'malformed' })).rejects.toThrow();
    expect(destination.writes).toBe(0); expect(files.writes).toBe(0);
  });
});
