import { describe, expect, it } from 'vitest';
import { ResearchService } from '../src/research.js';
import { PKError, type PKRecord, type RecordStore } from '../src/types.js';

class TestStore implements RecordStore {
  records = new Map<string, PKRecord>();
  async insert(record: PKRecord) {
    if (this.records.has(record._id)) throw new PKError('CONFLICT', 'Duplicate record');
    this.records.set(record._id, structuredClone(record));
  }
  async get(projectId: string, id: string) { const r = this.records.get(id); return r?.projectId === projectId ? structuredClone(r) : undefined; }
  async list(projectId: string, kind?: PKRecord['kind']) { return [...this.records.values()].filter(r => r.projectId === projectId && (!kind || r.kind === kind)).map(r => structuredClone(r)); }
  async replace(record: PKRecord, revision: number) { const prior = this.records.get(record._id); if (prior?.revision !== revision || prior.projectId !== record.projectId) return false; this.records.set(record._id, structuredClone(record)); return true; }
  async search(projectId: string, query: string) { return (await this.list(projectId, 'passage')).filter(r => String(r.data.text).includes(query)); }
}
async function setup() { const store = new TestStore(); const service = new ResearchService(store); const project = await service.createProject({ address: '1920 Rosedale Street NE', question: 'Who occupied this property?' }); return { store, service, projectId: project._id }; }
async function evidence(service: ResearchService, projectId: string) { const source = await service.addSource(projectId, { title: 'Directory, 1920', kind: 'document' }); const passage = await service.addPassage(projectId, { sourceId: source._id, text: 'Alice Smith, resident', locator: { page: 1 } }); return { source, passage }; }

describe('project and run invariants', () => {
  it('makes project creation retry-safe and detects reuse with different content', async () => {
    const service = new ResearchService(new TestStore());
    const input = { address: 'A', question: 'Q', idempotencyKey: 'create-one' };
    const first = await service.createProject(input);
    expect((await service.createProject(input))._id).toBe(first._id);
    await expect(service.createProject({ ...input, question: 'Changed' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('limits simultaneous reservations without overshooting', async () => {
    const { service, projectId } = await setup();
    const run = await service.startRun(projectId, { limits: { searches: 1 } });
    const results = await Promise.allSettled([service.consumeRun(projectId, run._id, { searches: 1 }), service.consumeRun(projectId, run._id, { searches: 1 })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  });
  it('rejects invalid or escalated run limits and negative consumption', async () => {
    const { service, projectId } = await setup();
    for (const limits of [{ pages: -1 }, { searches: NaN }, { minutes: 31 }, { pages: null }]) {
      await expect(service.startRun(projectId, { limits } as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    const run = await service.startRun(projectId);
    await expect(service.consumeRun(projectId, run._id, { pages: -1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('rejects further research after elapsed or any count limit', async () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const service = new ResearchService(new TestStore(), () => now);
    const p = await service.createProject({ address: 'A', question: 'Q' });
    const run = await service.startRun(p._id);
    now = new Date(now.getTime() + 30 * 60_000);
    await expect(service.consumeRun(p._id, run._id, { pages: 1 })).rejects.toMatchObject({ code: 'RUN_LIMIT' });
    const next = await service.startRun(p._id, { limits: { pages: 1 } });
    await service.consumeRun(p._id, next._id, { pages: 1 });
    await expect(service.consumeRun(p._id, next._id, { searches: 1 })).rejects.toMatchObject({ code: 'RUN_LIMIT' });
    expect((await service.checkpointRun(p._id, next._id, 'Resume later')).data.checkpoint).toBe('Resume later');
  });
});

describe('evidence and audited decisions', () => {
  it('requires citations before proposing conclusions and isolates projects', async () => {
    const { service, projectId } = await setup(); const { passage } = await evidence(service, projectId);
    const second = await service.createProject({ address: 'B', question: 'Q' });
    await expect(service.proposeClaim(second._id, { statement: 'Resident', evidence: [{ passageId: passage._id, stance: 'supporting' }] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.proposeClaim(projectId, { statement: 'Resident', evidence: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('accepts a specific reviewed revision and preserves the exact decision snapshot', async () => {
    const { service, projectId } = await setup(); const { passage } = await evidence(service, projectId);
    const claim = await service.proposeClaim(projectId, { statement: 'Alice occupied the property', category: 'occupancy', evidence: [{ passageId: passage._id, stance: 'supporting' }] });
    const input = { targetId: claim._id, expectedRevision: claim.revision, decision: 'accepted' as const, reviewer: 'Researcher', approvalText: 'I approve this conclusion.' };
    const decision = await service.recordDecision(projectId, input);
    expect(decision.data.targetRevision).toBe(claim.revision);
    expect((decision.data.snapshot as PKRecord).data.statement).toBe(claim.data.statement);
    await expect(service.recordDecision(projectId, input)).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect((await service.getProjectContext(projectId)).records.find(r => r._id === claim._id)?.data.reviewStatus).toBe('accepted');
  });
  it('requires explicit approval text and validates non-reviewable targets', async () => {
    const { service, projectId } = await setup(); const { source } = await evidence(service, projectId);
    await expect(service.recordDecision(projectId, { targetId: source._id, expectedRevision: 1, decision: 'accepted', reviewer: 'R', approvalText: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(service.recordDecision(projectId, { targetId: source._id, expectedRevision: 1, decision: 'accepted', reviewer: 'R', approvalText: 'Approved' })).rejects.toMatchObject({ code: 'INVALID_TARGET' });
  });
  it('preserves original transcription and invalidates conclusions after correction', async () => {
    const { service, store, projectId } = await setup(); const { passage } = await evidence(service, projectId);
    const claim = await service.proposeClaim(projectId, { statement: 'Alice lived here', evidence: [{ passageId: passage._id, stance: 'supporting' }] });
    await service.recordDecision(projectId, { targetId: claim._id, expectedRevision: 1, decision: 'accepted', reviewer: 'R', approvalText: 'I approve' });
    const corrected = await service.correctPassage(projectId, { passageId: passage._id, text: 'Alise Smith, resident', reason: 'Original handwriting checked', reviewer: 'R' });
    expect(corrected.data.supersedes).toBe(passage._id);
    expect((await store.get(projectId, passage._id))?.data.text).toBe('Alice Smith, resident');
    const current = (await service.getProjectContext(projectId)).records.find(r => r._id === claim._id)!;
    expect(current.data.reviewStatus).toBe('requires_review');
    await expect(service.recordDecision(projectId, { targetId: claim._id, expectedRevision: current.revision, decision: 'accepted', reviewer: 'R', approvalText: 'Approved again' })).rejects.toMatchObject({ code: 'STALE_EVIDENCE' });
  });
  it('keeps conflicting claims and same-name people distinct', async () => {
    const { service, projectId } = await setup(); const { passage } = await evidence(service, projectId);
    const a = await service.proposeEntity(projectId, { type: 'person', name: 'John Smith' });
    const b = await service.proposeEntity(projectId, { type: 'person', name: 'John Smith' });
    expect(a._id).not.toBe(b._id);
    const merge = await service.proposeMerge(projectId, { entityIds: [a._id, b._id], rationale: 'May be one person', evidence: [{ passageId: passage._id, stance: 'supporting' }] });
    expect(merge.data.reviewStatus).toBe('proposed');
    expect((await service.getProjectContext(projectId)).records.filter(r => r.kind === 'entity')).toHaveLength(2);
  });
  it('validates citation coordinate bounds and document precision', async () => {
    const { service, projectId } = await setup(); const { source } = await evidence(service, projectId);
    await expect(service.addPassage(projectId, { sourceId: source._id, text: 'Map label', locator: { page: 0 } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const passage = await service.addPassage(projectId, { sourceId: source._id, text: 'Document-level statement' });
    expect(passage.data.locator).toEqual({ precision: 'document' });
  });
});

describe('cumulative project processing budget', () => {
  it('enforces $10 atomically under concurrent requests', async () => {
    const { service, projectId } = await setup();
    const result = await Promise.allSettled([service.reserveBudget(projectId, { operationId: 'one', estimatedUsd: 6 }), service.reserveBudget(projectId, { operationId: 'two', estimatedUsd: 6 })]);
    expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter(r => r.status === 'rejected')).toHaveLength(1);
  });
  it('retains reservations on uncertain billing and prohibits automatic retry', async () => {
    const { service, projectId } = await setup();
    await service.reserveBudget(projectId, { operationId: 'one', estimatedUsd: 9 });
    const duplicate = await service.reserveBudget(projectId, { operationId: 'one', estimatedUsd: 9 });
    expect(duplicate.alreadyExists).toBe(true);
    await service.markBudgetUncertain(projectId, 'one', 'Timeout after dispatch');
    await expect(service.reserveBudget(projectId, { operationId: 'one', estimatedUsd: 9 })).rejects.toMatchObject({ code: 'BILLING_UNCERTAIN' });
    await expect(service.reserveBudget(projectId, { operationId: 'two', estimatedUsd: 2 })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });
  it('settles actual usage once and detects mismatched idempotent operations', async () => {
    const { service, projectId } = await setup();
    await service.reserveBudget(projectId, { operationId: 'one', estimatedUsd: 6 });
    await expect(service.reserveBudget(projectId, { operationId: 'one', estimatedUsd: 5 })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await service.settleBudget(projectId, { operationId: 'one', actualUsd: 2 });
    expect((await service.settleBudget(projectId, { operationId: 'one', actualUsd: 2 })).alreadyExists).toBe(true);
    await expect(service.settleBudget(projectId, { operationId: 'one', actualUsd: 1 })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await service.reserveBudget(projectId, { operationId: 'two', estimatedUsd: 8 });
    await expect(service.reserveBudget(projectId, { operationId: 'three', estimatedUsd: 0.01 })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });
  it('rejects NaN, negative and infinite money inputs', async () => {
    const { service, projectId } = await setup();
    for (const estimatedUsd of [NaN, Infinity, -1]) await expect(service.reserveBudget(projectId, { operationId: 'one', estimatedUsd })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
