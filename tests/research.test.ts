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

describe('recovery and explicit budget changes', () => {
  it('repairs a failed immutable decision append from the atomic attestation', async () => {
    const { service, store, projectId } = await setup(); const { passage } = await evidence(service, projectId);
    const claim = await service.proposeClaim(projectId, { statement: 'Alice lived here', evidence: [{ passageId: passage._id, stance: 'supporting' }] });
    const originalInsert = store.insert.bind(store);
    let failOnce = true;
    store.insert = async r => { if (r.kind === 'decision' && failOnce) { failOnce = false; throw new Error('Network interrupted'); } return originalInsert(r); };
    await expect(service.recordDecision(projectId, { targetId: claim._id, expectedRevision: 1, decision: 'accepted', reviewer: 'R', approvalText: 'I approve' })).rejects.toMatchObject({ code: 'AUDIT_APPEND_FAILED' });
    const context = await service.getProjectContext(projectId);
    const decision = context.records.find(r => r.kind === 'decision');
    expect(decision?.data.approvalText).toBe('I approve');
    expect((await store.list(projectId, 'decision'))).toHaveLength(1);
  });
  it('requires an exact project revision and preserves budget approvals', async () => {
    const { service, projectId } = await setup();
    const project = (await service.getProjectContext(projectId)).project;
    await service.reserveBudget(projectId, { operationId: 'pending', estimatedUsd: 9 });
    await expect(service.updateProjectSettings(projectId, { expectedRevision: project.revision, budgetUsd: 20, reviewer: 'R', approvalText: 'Raise to $20' })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    const current = (await service.getProjectContext(projectId)).project;
    await expect(service.updateProjectSettings(projectId, { expectedRevision: current.revision, budgetUsd: 8, reviewer: 'R', approvalText: 'Lower to $8' })).rejects.toMatchObject({ code: 'BUDGET_COMMITTED' });
    const updated = await service.updateProjectSettings(projectId, { expectedRevision: current.revision, budgetUsd: 20, reviewer: 'R', approvalText: 'Raise to $20' });
    expect(updated.data.budgetAdjustments).toMatchObject([{ reviewer: 'R', approvalText: 'Raise to $20', previousLimitMicros: 10_000_000, limitMicros: 20_000_000 }]);
    await service.reserveBudget(projectId, { operationId: 'second', estimatedUsd: 11 });
  });
  it('prevents both cross-project correction links and work during partial restore', async () => {
    const { service, store, projectId } = await setup(); const { passage } = await evidence(service, projectId);
    const other = await service.createProject({ address: 'Other', question: 'Q' });
    const source = await service.addSource(other._id, { title: 'Unrelated source' });
    await expect(service.addPassage(other._id, { sourceId: source._id, text: 'Forged correction', supersedes: passage._id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const original = await store.get(projectId, projectId);
    await store.replace({ ...original!, revision: original!.revision + 1, data: { ...original!.data, restoreStatus: 'restoring' } }, original!.revision);
    await expect(service.startRun(projectId)).rejects.toMatchObject({ code: 'RESTORE_INCOMPLETE' });
  });
  it('keeps opposing-only claims as proposals unless revised with support', async () => {
    const { service, projectId } = await setup(); const { passage } = await evidence(service, projectId);
    const claim = await service.proposeClaim(projectId, { statement: 'Alice owned the property', evidence: [{ passageId: passage._id, stance: 'opposing' }] });
    await expect(service.recordDecision(projectId, { targetId: claim._id, expectedRevision: 1, decision: 'accepted', reviewer: 'R', approvalText: 'I approve' })).rejects.toMatchObject({ code: 'UNSUPPORTED_CLAIM' });
  });
});

describe('citation bounds and billing incident recovery', () => {
  it('rejects pages outside the known source and image regions outside known dimensions', async () => {
    const { service, projectId } = await setup();
    const source = await service.addSource(projectId, { title: 'One-page image', pageCount: 1, width: 100, height: 80 });
    await expect(service.addPassage(projectId, { sourceId: source._id, text: 'Name', locator: { page: 999 } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    for (const region of [{ x: 95, y: 0, width: 6, height: 1 }, { x: 0, y: 79, width: 1, height: 2 }]) {
      await expect(service.addPassage(projectId, { sourceId: source._id, text: 'Name', locator: { page: 1, region } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect((await service.addPassage(projectId, { sourceId: source._id, text: 'Name', locator: { page: 1, region: { x: 90, y: 70, width: 10, height: 10 } } })).data.locator).toMatchObject({ precision: 'region' });
  });
  it('uses page-specific dimensions when known and accepts locators when source bounds are unavailable', async () => {
    const { service, projectId } = await setup();
    const source = await service.addSource(projectId, { title: 'Scanned book', pageCount: 2, pageDimensions: { '1': { width: 100, height: 200 }, '2': { width: 300, height: 400 } } });
    await expect(service.addPassage(projectId, { sourceId: source._id, text: 'Name', locator: { page: 1, region: { x: 100, y: 0, width: 1, height: 1 } } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await service.addPassage(projectId, { sourceId: source._id, text: 'Name', locator: { page: 2, region: { x: 100, y: 0, width: 1, height: 1 } } });
    const unknown = await service.addSource(projectId, { title: 'Unmeasured scan' });
    await service.addPassage(projectId, { sourceId: unknown._id, text: 'Name', locator: { page: 2, region: { x: 100, y: 0, width: 1, height: 1 } } });
  });
  it('requires quoted locators to occur in passage text and removes stale quote precision during correction', async () => {
    const { service, projectId } = await setup(); const { source } = await evidence(service, projectId);
    await expect(service.addPassage(projectId, { sourceId: source._id, text: 'Alice Smith', locator: { quote: 'Bob Jones' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const passage = await service.addPassage(projectId, { sourceId: source._id, text: 'Alice Smith', locator: { quote: 'Alice Smith' } });
    const corrected = await service.correctPassage(projectId, { passageId: passage._id, text: 'Alise Smith', reason: 'Checked handwriting', reviewer: 'R' });
    expect(corrected.data.locator).toEqual({ precision: 'document' });
  });
  it('records exact known costs beyond the reservation and cap, then blocks all further processing', async () => {
    const { service, projectId } = await setup();
    await service.reserveBudget(projectId, { operationId: 'underestimated', estimatedUsd: 1 });
    await service.settleBudget(projectId, { operationId: 'underestimated', actualUsd: 12 });
    const project = (await service.getProjectContext(projectId)).project;
    expect(project.data.budget).toMatchObject({ spentMicros: 12_000_000, reservedMicros: 0 });
    expect(project.data.processingBlocked).toMatchObject({ operationId: 'underestimated', actualMicros: 12_000_000, estimatedMicros: 1_000_000 });
    await expect(service.reserveBudget(projectId, { operationId: 'new', estimatedUsd: 0 })).rejects.toMatchObject({ code: 'PROCESSING_BLOCKED' });
    expect((await service.settleBudget(projectId, { operationId: 'underestimated', actualUsd: 12 })).alreadyExists).toBe(true);
  });
  it('requires a current researcher attestation to clear pricing incidents and preserves the original operation guard', async () => {
    const { service, projectId } = await setup();
    const oldProject = (await service.getProjectContext(projectId)).project;
    await service.reserveBudget(projectId, { operationId: 'underestimated', estimatedUsd: 1 });
    await service.settleBudget(projectId, { operationId: 'underestimated', actualUsd: 2 });
    await expect(service.acknowledgeProcessingBlock(projectId, { expectedRevision: oldProject.revision, reviewer: 'R', approvalText: 'I approve resuming', resolutionNote: 'Updated model price bounds' })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    const project = (await service.getProjectContext(projectId)).project;
    await expect(service.acknowledgeProcessingBlock(projectId, { expectedRevision: project.revision, reviewer: 'R', approvalText: '', resolutionNote: 'Updated model price bounds' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const resolved = await service.acknowledgeProcessingBlock(projectId, { expectedRevision: project.revision, reviewer: 'R', approvalText: 'I approve resuming', resolutionNote: 'Updated model price bounds' });
    expect(resolved.data.processingBlocked).toBeUndefined();
    expect(resolved.data.processingBlockResolutions).toMatchObject([{ reviewer: 'R', resolutionNote: 'Updated model price bounds' }]);
    expect((await service.reserveBudget(projectId, { operationId: 'underestimated', estimatedUsd: 1 })).alreadyExists).toBe(true);
    await service.reserveBudget(projectId, { operationId: 'new', estimatedUsd: 1 });
  });
  it('audits exact uncertain-billing reconciliation, retains idempotency, and rejects unapproved settlement', async () => {
    const { service, projectId } = await setup();
    await service.reserveBudget(projectId, { operationId: 'uncertain', estimatedUsd: 5 });
    await service.markBudgetUncertain(projectId, 'uncertain', 'Response lost');
    await expect(service.settleBudget(projectId, { operationId: 'uncertain', actualUsd: 2 })).rejects.toMatchObject({ code: 'BILLING_UNCERTAIN' });
    const result = await service.reconcileBudget(projectId, { operationId: 'uncertain', actualUsd: 2, reviewer: 'R', approvalText: 'Provider confirms the $2 charge' });
    expect(result).toMatchObject({ status: 'settled', actualUsd: 2, alreadyExists: false });
    const budget = (await service.getProjectContext(projectId)).project.data.budget as { spentMicros: number; operations: { operationId: string; reconciliation?: unknown }[] };
    expect(budget.spentMicros).toBe(2_000_000);
    expect(budget.operations[0]?.reconciliation).toMatchObject({ reviewer: 'R', approvalText: 'Provider confirms the $2 charge', actualMicros: 2_000_000 });
    expect((await service.reconcileBudget(projectId, { operationId: 'uncertain', actualUsd: 2, reviewer: 'R', approvalText: 'Provider confirms the $2 charge' })).alreadyExists).toBe(true);
    await expect(service.reconcileBudget(projectId, { operationId: 'uncertain', actualUsd: 3, reviewer: 'R', approvalText: 'Different charge' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect((await service.reserveBudget(projectId, { operationId: 'uncertain', estimatedUsd: 5 })).alreadyExists).toBe(true);
  });
  it('retains multiple cost overruns that settle concurrently', async () => {
    const { service, projectId } = await setup();
    await service.reserveBudget(projectId, { operationId: 'one', estimatedUsd: 1 });
    await service.reserveBudget(projectId, { operationId: 'two', estimatedUsd: 1 });
    await Promise.all([service.settleBudget(projectId, { operationId: 'one', actualUsd: 2 }), service.settleBudget(projectId, { operationId: 'two', actualUsd: 3 })]);
    const project = (await service.getProjectContext(projectId)).project;
    expect(project.data.budget).toMatchObject({ spentMicros: 5_000_000, reservedMicros: 0 });
    expect(project.data.processingIncidents).toHaveLength(2);
  });
});

describe('provider-bound circuit breaker', () => {
  it('blocks processing when a token bound fails even if the exact bill fits the reservation', async () => {
    const { service, projectId } = await setup();
    await service.reserveBudget(projectId, { operationId: 'input-overflow', estimatedUsd: 5 });
    await service.settleBudget(projectId, { operationId: 'input-overflow', actualUsd: 2 });
    const blocked = await service.blockProcessing(projectId, { operationId: 'input-overflow', reason: 'Provider input tokens exceeded the configured conservative bound' });
    expect(blocked.data.budget).toMatchObject({ spentMicros: 2_000_000, reservedMicros: 0 });
    expect(blocked.data.processingBlocked).toMatchObject({ operationId: 'input-overflow', reason: 'Provider input tokens exceeded the configured conservative bound', estimatedMicros: 5_000_000, actualMicros: 2_000_000 });
    await expect(service.reserveBudget(projectId, { operationId: 'next', estimatedUsd: 1 })).rejects.toMatchObject({ code: 'PROCESSING_BLOCKED' });
    const again = await service.blockProcessing(projectId, { operationId: 'input-overflow', reason: 'Provider input tokens exceeded the configured conservative bound' });
    expect(again.data.processingIncidents).toHaveLength(1);
  });
  it('cannot clear a newer incident with a stale acknowledgment and does not replay acknowledged incidents', async () => {
    const { service, projectId } = await setup();
    await service.reserveBudget(projectId, { operationId: 'first', estimatedUsd: 1 });
    await service.reserveBudget(projectId, { operationId: 'second', estimatedUsd: 1 });
    const first = await service.blockProcessing(projectId, { operationId: 'first', reason: 'Input bound exceeded' });
    const second = await service.blockProcessing(projectId, { operationId: 'second', reason: 'Input bound exceeded' });
    await expect(service.acknowledgeProcessingBlock(projectId, { expectedRevision: first.revision, reviewer: 'R', approvalText: 'Resume', resolutionNote: 'Updated bound' })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    await service.acknowledgeProcessingBlock(projectId, { expectedRevision: second.revision, reviewer: 'R', approvalText: 'Resume', resolutionNote: 'Updated bound' });
    const replay = await service.blockProcessing(projectId, { operationId: 'first', reason: 'Input bound exceeded' });
    expect(replay.data.processingBlocked).toBeUndefined();
    expect(replay.data.processingIncidents).toHaveLength(2);
  });
  it('rejects missing operations and unbounded reasons without changing project state', async () => {
    const { service, projectId } = await setup();
    await expect(service.blockProcessing(projectId, { operationId: 'missing', reason: 'Input bound exceeded' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await service.reserveBudget(projectId, { operationId: 'valid', estimatedUsd: 1 });
    await expect(service.blockProcessing(projectId, { operationId: 'valid', reason: 'x'.repeat(2001) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await service.getProjectContext(projectId)).project.data.processingBlocked).toBeUndefined();
  });
});

describe('recoverable reservation context', () => {
  it('persists processing identity atomically with the reservation and rejects conflicting retries', async () => {
    const { service, projectId } = await setup();
    const source = await service.addSource(projectId, { title: 'Three-page directory', pageCount: 3 });
    const context = { sourceId: source._id, page: 1, model: 'configured-model', cacheKey: 'stable-processing-cache-key', processingVersion: 'v1' };
    await service.reserveBudget(projectId, { operationId: 'processing', estimatedUsd: 1, context });
    const budget = (await service.getProjectContext(projectId)).project.data.budget as { reservedMicros: number; operations: { context?: unknown }[] };
    expect(budget).toMatchObject({ reservedMicros: 1_000_000, operations: [{ context }] });
    expect((await service.reserveBudget(projectId, { operationId: 'processing', estimatedUsd: 1, context })).alreadyExists).toBe(true);
    await expect(service.reserveBudget(projectId, { operationId: 'processing', estimatedUsd: 1, context: { ...context, page: 2 } })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const retained = (await service.getProjectContext(projectId)).project.data.budget as { operations: { context?: unknown }[] };
    expect(retained.operations[0]?.context).toEqual(context);
  });
  it('rejects foreign sources, nonexistent pages, and invalid context before reserving funds', async () => {
    const { service, projectId } = await setup(); const { source } = await evidence(service, projectId);
    const other = await service.createProject({ address: 'Other', question: 'Q' });
    const context = { sourceId: source._id, page: 1, model: 'configured-model', cacheKey: 'cache', processingVersion: 'v1' };
    await expect(service.reserveBudget(other._id, { operationId: 'foreign', estimatedUsd: 1, context })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const boundedSource = await service.addSource(projectId, { title: 'Single page', pageCount: 1 });
    await expect(service.reserveBudget(projectId, { operationId: 'bad-page', estimatedUsd: 1, context: { ...context, sourceId: boundedSource._id, page: 2 } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(service.reserveBudget(projectId, { operationId: 'invalid', estimatedUsd: 1, context: { ...context, cacheKey: '' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await service.getProjectContext(projectId)).project.data.budget).toMatchObject({ reservedMicros: 0, operations: [] });
  });
});

describe('hard-crash reservation recovery and dispatch fencing', () => {
  it('requires stopped-dispatch attestation to reconcile an operation still marked reserved', async () => {
    const { service, projectId } = await setup();
    await service.reserveBudget(projectId, { operationId: 'crashed', estimatedUsd: 3 });
    for (const dispatchStopped of [undefined, false]) {
      await expect(service.reconcileBudget(projectId, { operationId: 'crashed', actualUsd: 1, reviewer: 'R', approvalText: 'I verified the provider charge', dispatchStopped })).rejects.toMatchObject({ code: 'DISPATCH_NOT_STOPPED' });
    }
    expect((await service.getProjectContext(projectId)).project.data.budget).toMatchObject({ spentMicros: 0, reservedMicros: 3_000_000, operations: [{ status: 'reserved' }] });
  });
  it('recovers a persisted hard-crash snapshot with audited exact billing and fences the old reservation', async () => {
    const { service, store, projectId } = await setup();
    await service.reserveBudget(projectId, { operationId: 'crashed', estimatedUsd: 3 });
    const recoveredStore = new TestStore();
    for (const record of JSON.parse(JSON.stringify([...store.records.values()])) as PKRecord[]) await recoveredStore.insert(record);
    const recovered = new ResearchService(recoveredStore);
    await recovered.assertBudgetDispatchable(projectId, 'crashed');
    const result = await recovered.reconcileBudget(projectId, { operationId: 'crashed', actualUsd: 1, reviewer: 'R', approvalText: 'All workers are stopped and I verified a $1 bill', dispatchStopped: true });
    expect(result).toMatchObject({ status: 'settled', actualUsd: 1 });
    expect((await recovered.getProjectContext(projectId)).project.data.budget).toMatchObject({ spentMicros: 1_000_000, reservedMicros: 0, operations: [{ reconciliation: { priorStatus: 'reserved', dispatchStopped: true, reviewer: 'R', actualMicros: 1_000_000 } }] });
    const pausedWorker = new ResearchService(recoveredStore);
    await expect(pausedWorker.assertBudgetDispatchable(projectId, 'crashed')).rejects.toMatchObject({ code: 'OPERATION_NOT_DISPATCHABLE' });
    expect((await recovered.reserveBudget(projectId, { operationId: 'crashed', estimatedUsd: 3 })).alreadyExists).toBe(true);
  });
  it('allows only one concurrent conflicting reconciliation and retains the winning audit', async () => {
    const { service, projectId } = await setup();
    await service.reserveBudget(projectId, { operationId: 'crashed', estimatedUsd: 3 });
    const results = await Promise.allSettled([0, 1].map(actualUsd => service.reconcileBudget(projectId, { operationId: 'crashed', actualUsd, reviewer: `Reviewer ${actualUsd}`, approvalText: 'Dispatch stopped and billing checked', dispatchStopped: true })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const budget = (await service.getProjectContext(projectId)).project.data.budget as { spentMicros: number; reservedMicros: number; operations: { actualMicros: number; reconciliation: { actualMicros: number; priorStatus: string } }[] };
    expect(budget.reservedMicros).toBe(0);
    expect(budget.spentMicros).toBe(budget.operations[0]?.actualMicros);
    expect(budget.operations[0]?.reconciliation).toMatchObject({ actualMicros: budget.spentMicros, priorStatus: 'reserved' });
  });
  it('does not dispatch uncertain or blocked reservations', async () => {
    const { service, projectId } = await setup();
    await service.reserveBudget(projectId, { operationId: 'uncertain', estimatedUsd: 1 });
    await service.markBudgetUncertain(projectId, 'uncertain', 'Provider response lost');
    await expect(service.assertBudgetDispatchable(projectId, 'uncertain')).rejects.toMatchObject({ code: 'OPERATION_NOT_DISPATCHABLE' });
    await service.reserveBudget(projectId, { operationId: 'ready', estimatedUsd: 1 });
    await service.blockProcessing(projectId, { operationId: 'uncertain', reason: 'Provider bounds require review' });
    await expect(service.assertBudgetDispatchable(projectId, 'ready')).rejects.toMatchObject({ code: 'PROCESSING_BLOCKED' });
  });
});
