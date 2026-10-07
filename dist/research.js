import { createHash, randomUUID } from 'node:crypto';
import { PKError, requireText } from './types.js';
const MAX_RECORD_BYTES = 256_000;
const DEFAULT_LIMITS = { minutes: 30, searches: 25, pages: 50 };
const MICROS = 1_000_000;
function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object')
        return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
    return JSON.stringify(value);
}
function hash(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function integer(value, label, min, max) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
        throw new PKError('INVALID_INPUT', `${label} must be an integer from ${min} to ${max}`);
    return value;
}
function money(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000)
        throw new PKError('INVALID_INPUT', 'USD amount must be finite, nonnegative, and at most 1000000');
    return Math.ceil(value * MICROS);
}
function clean(data) {
    let encoded;
    try {
        encoded = JSON.stringify(data);
    }
    catch {
        throw new PKError('INVALID_INPUT', 'Record data must be JSON serializable');
    }
    if (Buffer.byteLength(encoded) > MAX_RECORD_BYTES)
        throw new PKError('RECORD_TOO_LARGE', 'Record exceeds 256KB. Split material into bounded passages.');
    return JSON.parse(encoded);
}
function normalizeLocator(input = {}, source, text) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new PKError('INVALID_INPUT', 'Citation locator must be an object');
    const locator = clean(input);
    if (locator.page !== undefined)
        integer(locator.page, 'Page', 1, 1_000_000);
    if (locator.region) {
        const { x, y, width, height } = locator.region;
        if (![x, y, width, height].every(n => typeof n === 'number' && Number.isFinite(n)) || x < 0 || y < 0 || width <= 0 || height <= 0)
            throw new PKError('INVALID_INPUT', 'Region requires nonnegative pixel coordinates and positive width and height');
        if (!locator.page)
            throw new PKError('INVALID_INPUT', 'Region citations require a page');
    }
    locator.precision ??= locator.region ? 'region' : locator.page ? 'page' : locator.quote ? 'passage' : 'document';
    if (!['document', 'passage', 'page', 'region'].includes(locator.precision))
        throw new PKError('INVALID_INPUT', 'Invalid citation precision');
    if (locator.precision === 'region' && !locator.region || locator.precision === 'page' && !locator.page || locator.precision === 'passage' && !locator.quote)
        throw new PKError('INVALID_INPUT', 'Citation precision must have a matching locator');
    if (locator.quote !== undefined) {
        requireText(locator.quote, 'Citation quote', 50_000);
        if (text !== undefined && !text.includes(locator.quote))
            throw new PKError('INVALID_INPUT', 'Citation quote must occur exactly in the passage text');
    }
    if (locator.page && source?.data.pageCount !== undefined && locator.page > integer(source.data.pageCount, 'Source page count', 1, 1_000_000))
        throw new PKError('INVALID_INPUT', 'Citation page exceeds the known source page count');
    if (locator.region && source) {
        const pageDimensions = source.data.pageDimensions;
        const dimensions = pageDimensions?.[String(locator.page)] ?? source.data;
        const { x, y, width, height } = locator.region;
        if (dimensions.width !== undefined && x + width > integer(dimensions.width, 'Source width', 1, Number.MAX_SAFE_INTEGER))
            throw new PKError('INVALID_INPUT', 'Citation region exceeds the known page width');
        if (dimensions.height !== undefined && y + height > integer(dimensions.height, 'Source height', 1, Number.MAX_SAFE_INTEGER))
            throw new PKError('INVALID_INPUT', 'Citation region exceeds the known page height');
    }
    return locator;
}
function budgetResult(operation, alreadyExists) {
    return { operationId: operation.operationId, status: operation.status, alreadyExists, estimatedUsd: operation.estimatedMicros / MICROS, ...(operation.actualMicros === undefined ? {} : { actualUsd: operation.actualMicros / MICROS }) };
}
/** Transport-independent evidence workflow. Review records audit client-reported human approval. */
export class ResearchService {
    store;
    now;
    constructor(store, now = () => new Date()) {
        this.store = store;
        this.now = now;
    }
    record(kind, projectId, data, id = randomUUID()) {
        const time = this.now().toISOString();
        return { _id: id, projectId, kind, revision: 1, createdAt: time, updatedAt: time, data: clean(data) };
    }
    async require(projectId, id, kind) {
        requireText(projectId, 'Project ID', 200);
        requireText(id, 'Record ID', 200);
        const record = await this.store.get(projectId, id);
        if (!record || kind && record.kind !== kind)
            throw new PKError('NOT_FOUND', `${kind ?? 'Record'} not found in this project`);
        return record;
    }
    async project(projectId) {
        const project = await this.require(projectId, projectId, 'project');
        if (project.data.restoreStatus && !['complete', 'ready'].includes(String(project.data.restoreStatus)))
            throw new PKError('RESTORE_INCOMPLETE', 'Project restoration is not complete');
        return project;
    }
    async create(kind, projectId, data, idempotencyKey) {
        const inputHash = hash(data);
        const id = idempotencyKey === undefined ? randomUUID() : `${kind}-${hash([projectId, kind, requireText(idempotencyKey, 'Idempotency key', 200)])}`;
        const record = this.record(kind, projectId, { ...data, ...(idempotencyKey ? { _idempotencyHash: inputHash } : {}) }, id);
        if (idempotencyKey) {
            const existing = await this.store.get(projectId, id);
            if (existing) {
                if (existing.data._idempotencyHash !== inputHash)
                    throw new PKError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used for different input');
                return existing;
            }
        }
        try {
            await this.store.insert(record);
        }
        catch (error) {
            if (!idempotencyKey)
                throw error;
            const existing = await this.store.get(projectId, id);
            if (!existing)
                throw error;
            if (existing.data._idempotencyHash !== inputHash)
                throw new PKError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used for different input');
            return existing;
        }
        return record;
    }
    async mutate(projectId, id, update) {
        for (let attempt = 0; attempt < 16; attempt++) {
            const previous = await this.require(projectId, id);
            const next = { ...previous, revision: previous.revision + 1, updatedAt: this.now().toISOString(), data: clean(update(previous)) };
            if (await this.store.replace(next, previous.revision))
                return next;
        }
        throw new PKError('CONCURRENT_UPDATE', 'Record remained busy. Retry with current context.');
    }
    async createProject(input) {
        const address = requireText(input.address, 'Address', 2000);
        const question = requireText(input.question, 'Research question', 10000);
        const knownInformation = input.knownInformation === undefined ? undefined : requireText(input.knownInformation, 'Known information', 30000);
        const sourceConstraints = input.sourceConstraints;
        if (sourceConstraints !== undefined && (!Array.isArray(sourceConstraints) || sourceConstraints.length > 100))
            throw new PKError('INVALID_INPUT', 'Source constraints must be an array of at most 100 strings');
        sourceConstraints?.forEach(s => requireText(s, 'Source constraint', 2000));
        const key = input.idempotencyKey === undefined ? undefined : requireText(input.idempotencyKey, 'Idempotency key', 200);
        const projectId = key ? `project-${hash(['project', key])}` : randomUUID();
        const data = { schemaVersion: 1, address, question, knownInformation, sourceConstraints, budget: { limitMicros: 10 * MICROS, spentMicros: 0, reservedMicros: 0, operations: [] } };
        const fingerprint = hash(data);
        const prior = await this.store.get(projectId, projectId);
        if (prior) {
            if (prior.data._idempotencyHash !== fingerprint)
                throw new PKError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used for a different project');
            return prior;
        }
        const record = this.record('project', projectId, { ...data, _idempotencyHash: fingerprint }, projectId);
        try {
            await this.store.insert(record);
        }
        catch (error) {
            const existing = await this.store.get(projectId, projectId);
            if (!existing)
                throw error;
            if (existing.data._idempotencyHash !== fingerprint)
                throw new PKError('IDEMPOTENCY_CONFLICT', 'Idempotency key was used for a different project');
            return existing;
        }
        return record;
    }
    async getProjectContext(projectId) {
        const project = await this.project(projectId);
        const records = await this.store.list(projectId);
        for (const record of [...records]) {
            await this.reconcileDecisionAudit(record);
            const audit = record.data.decisionAudit;
            if (audit && !records.some(candidate => candidate._id === audit._id))
                records.push(audit);
        }
        const corrected = new Set(records.filter(r => r.kind === 'passage').map(r => r.data.supersedes).filter(Boolean));
        for (const record of records) {
            if (record.kind === 'claim' && record.data.evidence.some(e => corrected.has(e.passageId)))
                record.data.reviewStatus = 'requires_review';
        }
        return { project, records };
    }
    async startRun(projectId, input = {}) {
        await this.project(projectId);
        if (input.limits === null || input.limits !== undefined && (typeof input.limits !== 'object' || Array.isArray(input.limits)))
            throw new PKError('INVALID_INPUT', 'Limits must be an object');
        const limits = { ...DEFAULT_LIMITS, ...input.limits };
        for (const key of Object.keys(DEFAULT_LIMITS))
            integer(limits[key], `Run ${key}`, 1, DEFAULT_LIMITS[key]);
        return this.create('run', projectId, { limits, consumed: { searches: 0, pages: 0 }, status: 'active' }, input.idempotencyKey);
    }
    async consumeRun(projectId, runId, input = {}) {
        await this.project(projectId);
        await this.require(projectId, runId, 'run');
        const searches = integer(input.searches === undefined ? 0 : input.searches, 'Search consumption', 0, 25);
        const pages = integer(input.pages === undefined ? 0 : input.pages, 'Page consumption', 0, 50);
        return this.mutate(projectId, runId, run => {
            const limits = run.data.limits;
            const consumed = run.data.consumed;
            const expired = this.now().getTime() - new Date(run.createdAt).getTime() >= limits.minutes * 60_000;
            if (expired || consumed.searches >= limits.searches || consumed.pages >= limits.pages || consumed.searches + searches > limits.searches || consumed.pages + pages > limits.pages || run.data.status === 'stopped')
                throw new PKError('RUN_LIMIT', 'Research run limit reached. Progress is saved. Start a new run to continue.');
            return { ...run.data, consumed: { searches: consumed.searches + searches, pages: consumed.pages + pages } };
        });
    }
    async checkpointRun(projectId, runId, note) {
        await this.project(projectId);
        await this.require(projectId, runId, 'run');
        if (note !== undefined)
            requireText(note, 'Checkpoint note', 10000);
        const run = await this.mutate(projectId, runId, r => ({ ...r.data, checkpoint: note ?? '', checkpointAt: this.now().toISOString() }));
        await this.addLog(projectId, { type: 'checkpoint', message: note ?? 'Research progress checkpoint', runId });
        return run;
    }
    async addSource(projectId, input) {
        await this.project(projectId);
        const { idempotencyKey, ...metadata } = input;
        const title = requireText(input.title, 'Source title', 2000);
        if (input.pageCount !== undefined)
            integer(input.pageCount, 'Source page count', 1, 1_000_000);
        if (input.width !== undefined)
            integer(input.width, 'Source width', 1, Number.MAX_SAFE_INTEGER);
        if (input.height !== undefined)
            integer(input.height, 'Source height', 1, Number.MAX_SAFE_INTEGER);
        if (input.pageDimensions !== undefined) {
            if (!input.pageDimensions || typeof input.pageDimensions !== 'object' || Array.isArray(input.pageDimensions))
                throw new PKError('INVALID_INPUT', 'Page dimensions must be an object keyed by one-based page number');
            for (const [key, value] of Object.entries(input.pageDimensions)) {
                integer(Number(key), 'Dimensions page', 1, typeof input.pageCount === 'number' ? input.pageCount : 1_000_000);
                if (!value || typeof value !== 'object' || Array.isArray(value))
                    throw new PKError('INVALID_INPUT', 'Page dimensions must contain width and height');
                const dimensions = value;
                integer(dimensions.width, 'Page width', 1, Number.MAX_SAFE_INTEGER);
                integer(dimensions.height, 'Page height', 1, Number.MAX_SAFE_INTEGER);
            }
        }
        if (input.blob !== undefined) {
            const blob = input.blob;
            if (!blob || !/^[a-f0-9]{64}$/.test(blob.hash))
                throw new PKError('INVALID_INPUT', 'Blob requires a SHA-256 hash');
            integer(blob.size, 'Blob size', 0, Number.MAX_SAFE_INTEGER);
        }
        return this.create('source', projectId, { ...metadata, title }, idempotencyKey);
    }
    async addPassage(projectId, input) {
        await this.project(projectId);
        const source = await this.require(projectId, input.sourceId, 'source');
        const { idempotencyKey, ...metadata } = input;
        const text = requireText(input.text, 'Passage text', 100000);
        if (input.supersedes !== undefined) {
            const previous = await this.require(projectId, requireText(input.supersedes, 'Superseded passage ID', 200), 'passage');
            if (previous.data.sourceId !== input.sourceId)
                throw new PKError('INVALID_INPUT', 'A correction must refer to the same source');
        }
        return this.create('passage', projectId, { ...metadata, sourceId: input.sourceId, text, locator: normalizeLocator(input.locator, source, text) }, idempotencyKey);
    }
    async proposeEntity(projectId, input) {
        await this.project(projectId);
        const { idempotencyKey, ...metadata } = input;
        delete metadata.lastDecision;
        delete metadata.decisionAudit;
        return this.create('entity', projectId, { ...metadata, type: requireText(input.type, 'Entity type', 100), name: requireText(input.name, 'Entity name', 2000), reviewStatus: 'proposed' }, idempotencyKey);
    }
    async validateEvidence(projectId, evidence, entityIds = []) {
        if (!Array.isArray(evidence) || evidence.length === 0 || evidence.length > 100)
            throw new PKError('INVALID_INPUT', 'Claims require between 1 and 100 evidence links');
        if (!Array.isArray(entityIds) || entityIds.length > 100)
            throw new PKError('INVALID_INPUT', 'Entity IDs must be an array of at most 100 identifiers');
        for (const link of evidence) {
            if (!link || !['supporting', 'opposing'].includes(link.stance))
                throw new PKError('INVALID_INPUT', 'Evidence stance must be supporting or opposing');
            await this.require(projectId, link.passageId, 'passage');
        }
        for (const entityId of entityIds)
            await this.require(projectId, entityId, 'entity');
    }
    async proposeClaim(projectId, input) {
        await this.project(projectId);
        const statement = requireText(input.statement, 'Claim statement', 10000);
        await this.validateEvidence(projectId, input.evidence, input.entityIds);
        const { idempotencyKey, ...metadata } = input;
        delete metadata.lastDecision;
        delete metadata.decisionAudit;
        delete metadata.invalidatedBy;
        if (input.supersedes !== undefined)
            await this.require(projectId, requireText(input.supersedes, 'Superseded claim ID', 200), 'claim');
        return this.create('claim', projectId, { ...metadata, statement, entityIds: input.entityIds ?? [], reviewStatus: 'proposed' }, idempotencyKey);
    }
    async proposeMerge(projectId, input) {
        if (!Array.isArray(input.entityIds) || new Set(input.entityIds).size < 2 || new Set(input.entityIds).size !== input.entityIds.length)
            throw new PKError('INVALID_INPUT', 'Identity merge requires at least two distinct entity IDs');
        return this.proposeClaim(projectId, { ...input, statement: input.rationale, category: 'identity_merge' });
    }
    async recordDecision(projectId, input) {
        await this.project(projectId);
        integer(input.expectedRevision, 'Expected revision', 1, Number.MAX_SAFE_INTEGER);
        const reviewer = requireText(input.reviewer, 'Reviewer', 2000);
        const approvalText = requireText(input.approvalText, 'Explicit researcher review text', 10000);
        if (!['accepted', 'rejected'].includes(input.decision))
            throw new PKError('INVALID_INPUT', 'Decision must be accepted or rejected');
        const target = await this.require(projectId, input.targetId);
        await this.reconcileDecisionAudit(target);
        if (!['claim', 'entity'].includes(target.kind))
            throw new PKError('INVALID_TARGET', 'Only claims and entities can be reviewed');
        if (target.revision !== input.expectedRevision)
            throw new PKError('STALE_REVISION', 'Review must refer to the current proposal revision');
        if (target.kind === 'claim' && input.decision === 'accepted') {
            const links = target.data.evidence;
            const corrections = (await this.store.list(projectId, 'passage')).filter(p => p.data.supersedes);
            if (corrections.some(p => links.some(e => e.passageId === p.data.supersedes)))
                throw new PKError('STALE_EVIDENCE', 'Cited evidence was corrected. Propose a revised claim citing the corrected passages before approval.');
            if (!links.some(e => e.stance === 'supporting'))
                throw new PKError('UNSUPPORTED_CLAIM', 'An accepted conclusion requires supporting evidence');
        }
        const decisionId = `decision-${hash([projectId, target._id, target.revision])}`;
        const snapshot = structuredClone(target);
        delete snapshot.data.decisionAudit;
        const decision = this.record('decision', projectId, { targetId: target._id, targetRevision: target.revision, decision: input.decision, reviewer, approvalText, snapshot }, decisionId);
        const next = { ...target, revision: target.revision + 1, updatedAt: this.now().toISOString(), data: clean({ ...target.data, reviewStatus: input.decision, decisionAudit: decision, lastDecision: { decisionId, reviewedRevision: target.revision, decision: input.decision, reviewer, approvalText, decidedAt: decision.createdAt } }) };
        if (!await this.store.replace(next, target.revision))
            throw new PKError('STALE_REVISION', 'The proposal changed while being reviewed. Refresh and review the current revision.');
        // The atomic target update retains the entire review attestation if the append is interrupted.
        try {
            await this.store.insert(decision);
        }
        catch (error) {
            const existing = await this.store.get(projectId, decisionId);
            if (!existing)
                throw new PKError('AUDIT_APPEND_FAILED', 'Review attestation is saved on the proposal, but the immutable audit append failed. Reconcile before export.');
            if (canonical(existing.data) !== canonical(decision.data))
                throw error;
        }
        return decision;
    }
    async reconcileDecisionAudit(record) {
        if (!['claim', 'entity'].includes(record.kind) || !record.data.decisionAudit)
            return;
        const audit = record.data.decisionAudit;
        if (audit.kind !== 'decision' || audit.projectId !== record.projectId || audit.data.targetId !== record._id)
            throw new PKError('INVALID_AUDIT', 'Saved review audit is inconsistent');
        const existing = await this.store.get(record.projectId, audit._id);
        if (existing) {
            if (canonical(existing.data) !== canonical(audit.data))
                throw new PKError('INVALID_AUDIT', 'Saved review audit conflicts with its immutable record');
            return;
        }
        try {
            await this.store.insert(audit);
        }
        catch (error) {
            const concurrent = await this.store.get(record.projectId, audit._id);
            if (!concurrent || canonical(concurrent.data) !== canonical(audit.data))
                throw error;
        }
    }
    async updateProjectSettings(projectId, input) {
        const project = await this.project(projectId);
        const expectedRevision = integer(input.expectedRevision, 'Expected revision', 1, Number.MAX_SAFE_INTEGER);
        const reviewer = requireText(input.reviewer, 'Reviewer', 2000);
        const approvalText = requireText(input.approvalText, 'Explicit researcher approval', 10000);
        const limitMicros = money(input.budgetUsd);
        if (project.revision !== expectedRevision)
            throw new PKError('STALE_REVISION', 'Project changed before the budget approval was applied');
        const budget = structuredClone(project.data.budget);
        if (limitMicros < budget.spentMicros + budget.reservedMicros)
            throw new PKError('BUDGET_COMMITTED', 'Budget cannot be lower than spent costs plus pending reservations');
        const adjustment = { previousLimitMicros: budget.limitMicros, limitMicros, reviewer, approvalText, reviewedRevision: expectedRevision, changedAt: this.now().toISOString() };
        const history = [...(project.data.budgetAdjustments ?? []), adjustment];
        if (history.length > 100)
            throw new PKError('OPERATION_LIMIT', 'Project budget adjustment history is full');
        budget.limitMicros = limitMicros;
        const next = { ...project, revision: project.revision + 1, updatedAt: this.now().toISOString(), data: clean({ ...project.data, budget, budgetAdjustments: history }) };
        if (!await this.store.replace(next, expectedRevision))
            throw new PKError('STALE_REVISION', 'Project changed while recording budget approval');
        return next;
    }
    async correctPassage(projectId, input) {
        await this.project(projectId);
        const original = await this.require(projectId, input.passageId, 'passage');
        const reason = requireText(input.reason, 'Correction reason', 10000);
        const reviewer = requireText(input.reviewer, 'Correction reviewer', 2000);
        const locator = structuredClone(input.locator ?? original.data.locator);
        if (input.locator === undefined && locator.quote && !input.text.includes(locator.quote)) {
            delete locator.quote;
            locator.precision = locator.region ? 'region' : locator.page ? 'page' : 'document';
        }
        const corrected = await this.addPassage(projectId, { sourceId: original.data.sourceId, text: input.text, locator, supersedes: original._id, correction: { reason, reviewer }, idempotencyKey: input.idempotencyKey });
        const claims = (await this.store.list(projectId, 'claim')).filter(c => c.data.evidence.some(e => e.passageId === original._id));
        for (const claim of claims)
            await this.mutate(projectId, claim._id, current => ({ ...current.data, reviewStatus: 'requires_review', invalidatedBy: [...new Set([...(current.data.invalidatedBy ?? []), corrected._id])] }));
        await this.addLog(projectId, { type: 'correction', message: reason, passageId: original._id, replacementId: corrected._id, reviewer });
        return corrected;
    }
    async addLog(projectId, input) {
        await this.project(projectId);
        const { idempotencyKey, ...metadata } = input;
        return this.create('log', projectId, { ...metadata, message: requireText(input.message, 'Log message', 30000) }, idempotencyKey);
    }
    async reserveBudget(projectId, input) {
        await this.project(projectId);
        const operationId = requireText(input.operationId, 'Operation ID', 200);
        const estimatedMicros = money(input.estimatedUsd);
        let context;
        if (input.context !== undefined) {
            if (!input.context || typeof input.context !== 'object' || Array.isArray(input.context))
                throw new PKError('INVALID_INPUT', 'Processing context must be an object');
            const sourceId = requireText(input.context.sourceId, 'Processing source ID', 200);
            const source = await this.require(projectId, sourceId, 'source');
            const page = integer(input.context.page, 'Processing page', 1, 1_000_000);
            normalizeLocator({ page }, source);
            context = { sourceId, page, model: requireText(input.context.model, 'Processing model', 200), cacheKey: requireText(input.context.cacheKey, 'Processing cache key', 200), processingVersion: requireText(input.context.processingVersion, 'Processing version', 200) };
        }
        let alreadyExists = false;
        const project = await this.mutate(projectId, projectId, current => {
            if (current.data.processingBlocked)
                throw new PKError('PROCESSING_BLOCKED', 'Known processing cost exceeded its reservation. Review pricing and explicitly acknowledge the incident before additional processing.');
            const budget = structuredClone(current.data.budget);
            const existing = budget.operations.find(op => op.operationId === operationId);
            if (existing) {
                if (existing.estimatedMicros !== estimatedMicros)
                    throw new PKError('IDEMPOTENCY_CONFLICT', 'Operation was reserved for a different cost');
                if (context !== undefined && canonical(existing.context) !== canonical(context))
                    throw new PKError('IDEMPOTENCY_CONFLICT', 'Operation was reserved for different processing context');
                if (existing.status === 'uncertain')
                    throw new PKError('BILLING_UNCERTAIN', 'This operation may already have been billed. Reconcile usage before retrying.');
                alreadyExists = true;
                return current.data;
            }
            alreadyExists = false;
            if (budget.operations.length >= 1000)
                throw new PKError('OPERATION_LIMIT', 'Project processing ledger is full');
            if (budget.spentMicros + budget.reservedMicros + estimatedMicros > budget.limitMicros)
                throw new PKError('BUDGET_EXCEEDED', 'Processing reservation exceeds the project budget. Completed work is saved.');
            budget.operations.push({ operationId, status: 'reserved', estimatedMicros, ...(context ? { context } : {}) });
            budget.reservedMicros += estimatedMicros;
            return { ...current.data, budget };
        });
        return budgetResult(project.data.budget.operations.find(op => op.operationId === operationId), alreadyExists);
    }
    async settleBudget(projectId, input) {
        return this.settleReservation(projectId, input);
    }
    async reconcileBudget(projectId, input) {
        const reviewer = requireText(input.reviewer, 'Reconciliation reviewer', 2000);
        const approvalText = requireText(input.approvalText, 'Explicit billing reconciliation approval', 10000);
        if (input.dispatchStopped !== undefined && typeof input.dispatchStopped !== 'boolean')
            throw new PKError('INVALID_INPUT', 'Dispatch stopped attestation must be boolean');
        return this.settleReservation(projectId, input, { reviewer, approvalText, dispatchStopped: input.dispatchStopped });
    }
    async settleReservation(projectId, input, attestation) {
        await this.project(projectId);
        const operationId = requireText(input.operationId, 'Operation ID', 200);
        const actualMicros = money(input.actualUsd);
        let alreadyExists = false;
        const project = await this.mutate(projectId, projectId, current => {
            const budget = structuredClone(current.data.budget);
            const operation = budget.operations.find(op => op.operationId === operationId);
            if (!operation)
                throw new PKError('NOT_FOUND', 'Budget reservation not found');
            if (operation.status === 'settled') {
                if (operation.actualMicros !== actualMicros)
                    throw new PKError('IDEMPOTENCY_CONFLICT', 'Operation was already settled with a different cost');
                if (attestation && !operation.reconciliation)
                    throw new PKError('ALREADY_SETTLED', 'Operation already has known settled usage and does not require reconciliation');
                alreadyExists = true;
                return current.data;
            }
            if (operation.status === 'uncertain' && !attestation)
                throw new PKError('BILLING_UNCERTAIN', 'An uncertain bill requires explicit researcher reconciliation');
            if (attestation && operation.status === 'reserved' && attestation.dispatchStopped !== true)
                throw new PKError('DISPATCH_NOT_STOPPED', 'To reconcile a reserved operation, first stop every server or worker that could still dispatch it, verify provider billing, and explicitly attest dispatchStopped: true');
            const priorStatus = operation.status;
            alreadyExists = false;
            budget.reservedMicros -= operation.estimatedMicros;
            budget.spentMicros += actualMicros;
            operation.status = 'settled';
            operation.actualMicros = actualMicros;
            if (attestation)
                operation.reconciliation = { reviewer: attestation.reviewer, approvalText: attestation.approvalText, actualMicros, reconciledAt: this.now().toISOString(), priorStatus, ...(attestation.dispatchStopped === true ? { dispatchStopped: true } : {}) };
            if (actualMicros > operation.estimatedMicros) {
                const incident = { reason: 'actual_cost_exceeded_reservation', operationId, estimatedMicros: operation.estimatedMicros, actualMicros, detectedAt: this.now().toISOString() };
                const incidents = [...(current.data.processingIncidents ?? []), incident];
                return { ...current.data, budget, processingBlocked: incident, processingIncidents: incidents };
            }
            return { ...current.data, budget };
        });
        return budgetResult(project.data.budget.operations.find(op => op.operationId === operationId), alreadyExists);
    }
    /** Final dispatch check. Stopping all dispatchers remains required before reconciling reserved work. */
    async assertBudgetDispatchable(projectId, operationId) {
        requireText(operationId, 'Operation ID', 200);
        const project = await this.project(projectId);
        if (project.data.processingBlocked)
            throw new PKError('PROCESSING_BLOCKED', 'Processing is blocked until the researcher resolves the active incident');
        const operation = project.data.budget.operations.find(candidate => candidate.operationId === operationId);
        if (!operation)
            throw new PKError('NOT_FOUND', 'Budget reservation not found');
        if (operation.status !== 'reserved')
            throw new PKError('OPERATION_NOT_DISPATCHABLE', 'The operation is no longer reserved. Reconciled, settled, or uncertain operations must not dispatch.');
    }
    async blockProcessing(projectId, input) {
        await this.project(projectId);
        const operationId = requireText(input.operationId, 'Operation ID', 200);
        const reason = requireText(input.reason, 'Processing incident reason', 2000);
        return this.mutate(projectId, projectId, current => {
            const operation = current.data.budget.operations.find(candidate => candidate.operationId === operationId);
            if (!operation)
                throw new PKError('NOT_FOUND', 'Budget reservation not found');
            const incidents = current.data.processingIncidents ?? [];
            // A delayed duplicate notification must not reopen an already reviewed incident.
            if (incidents.some(incident => incident.operationId === operationId && incident.reason === reason))
                return current.data;
            const incident = { operationId, reason, estimatedMicros: operation.estimatedMicros, actualMicros: operation.actualMicros, detectedAt: this.now().toISOString() };
            return { ...current.data, processingBlocked: incident, processingIncidents: [...incidents, incident] };
        });
    }
    async acknowledgeProcessingBlock(projectId, input) {
        const project = await this.project(projectId);
        integer(input.expectedRevision, 'Expected revision', 1, Number.MAX_SAFE_INTEGER);
        const reviewer = requireText(input.reviewer, 'Reviewer', 2000);
        const approvalText = requireText(input.approvalText, 'Explicit approval to resume processing', 10000);
        const resolutionNote = requireText(input.resolutionNote, 'Pricing or processing-bound resolution', 10000);
        if (project.revision !== input.expectedRevision)
            throw new PKError('STALE_REVISION', 'Project changed before the processing incident was reviewed');
        if (!project.data.processingBlocked)
            throw new PKError('NOT_BLOCKED', 'Project has no processing incident to acknowledge');
        const resolution = { reviewer, approvalText, resolutionNote, incident: project.data.processingBlocked, reviewedRevision: project.revision, acknowledgedAt: this.now().toISOString() };
        const resolutions = [...(project.data.processingBlockResolutions ?? []), resolution];
        if (resolutions.length > 100)
            throw new PKError('OPERATION_LIMIT', 'Project processing-incident resolution history is full');
        const data = { ...project.data, processingBlockResolutions: resolutions };
        delete data.processingBlocked;
        const next = { ...project, revision: project.revision + 1, updatedAt: this.now().toISOString(), data: clean(data) };
        if (!await this.store.replace(next, project.revision))
            throw new PKError('STALE_REVISION', 'Project changed while recording the processing incident resolution');
        return next;
    }
    async markBudgetUncertain(projectId, operationId, reason) {
        await this.project(projectId);
        requireText(operationId, 'Operation ID', 200);
        requireText(reason, 'Billing uncertainty reason', 10000);
        let alreadyExists = false;
        const project = await this.mutate(projectId, projectId, current => {
            const budget = structuredClone(current.data.budget);
            const operation = budget.operations.find(op => op.operationId === operationId);
            if (!operation)
                throw new PKError('NOT_FOUND', 'Budget reservation not found');
            if (operation.status === 'settled')
                throw new PKError('ALREADY_SETTLED', 'Settled operations cannot become uncertain');
            alreadyExists = operation.status === 'uncertain';
            operation.status = 'uncertain';
            operation.reason = reason;
            return { ...current.data, budget };
        });
        return budgetResult(project.data.budget.operations.find(op => op.operationId === operationId), alreadyExists);
    }
}
//# sourceMappingURL=research.js.map