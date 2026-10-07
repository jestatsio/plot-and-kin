import { createHash } from 'node:crypto';
import { MAX_SOURCE_BYTES } from './library.js';
import { PKError, requireText } from './types.js';
const MAX_BUNDLE_BYTES = 250 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const KINDS = new Set(['project', 'run', 'source', 'passage', 'entity', 'claim', 'decision', 'log', 'processing', 'operation']);
const ONE_REF = new Set(['sourceId', 'passageId', 'claimId', 'entityId', 'runId', 'decisionId', 'processingId', 'targetId', 'supersedes', 'replacementId', 'restoreOperationId']);
const MANY_REFS = new Set(['sourceIds', 'passageIds', 'claimIds', 'entityIds', 'evidenceIds', 'citationIds', 'invalidatedBy', 'contradicts', 'copiedRecordIds']);
const SENSITIVE = /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|astra[-_]?token|token|authorization|credentials?|password|secret|private[-_]?key|(?:original|local|absolute|file|library)[-_]?path)$/i;
const RUNTIME_KEYS = new Set(['astradbapplicationtoken', 'openaiapikey', 'anthropicapikey', 'pklibrarydir', 'pkimportdir', 'librarydir', 'importdir', 'exportdir', 'localfilepath']);
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function fail(message) { throw new PKError('INVALID_BUNDLE', message); }
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function portable(value, depth = 0) {
    if (depth > 40)
        fail('Record nesting exceeds the portable format limit');
    // Preserve documentary strings byte for byte, including apparent paths and historical labels.
    // Runtime secrets and paths are excluded by explicit metadata keys below, never by their text.
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value))
        return value.map(item => portable(item, depth + 1)).filter(item => item !== undefined);
    if (!object(value))
        return value;
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
        if (SENSITIVE.test(key) || RUNTIME_KEYS.has(key.toLowerCase().replace(/[^a-z]/g, '')))
            return [];
        const safe = portable(item, depth + 1);
        return safe === undefined ? [] : [[key, safe]];
    }));
}
function cleanRecord(record) { return portable(record); }
function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (object(value))
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
function visit(value, fn, depth = 0) {
    if (depth > 40)
        fail('Record nesting exceeds the portable format limit');
    if (Array.isArray(value)) {
        for (const item of value)
            visit(item, fn, depth + 1);
        return;
    }
    if (!object(value))
        return;
    for (const [key, item] of Object.entries(value)) {
        // Origin identifies an external project. Connector metadata is not a local record graph.
        if (key === 'origin' || key === 'metadata' || key === 'attributes')
            continue;
        fn(key, item);
        visit(item, fn, depth + 1);
    }
}
function references(record, ignoreApproval = false) {
    const ids = [];
    const data = structuredClone(record.data);
    if (ignoreApproval) {
        delete data.lastDecision;
        delete data.decisionAudit;
        delete data.processingId;
    }
    visit(data, (key, value) => {
        if (ONE_REF.has(key) && typeof value === 'string')
            ids.push(value);
        if (MANY_REFS.has(key) && Array.isArray(value))
            for (const item of value)
                if (typeof item === 'string')
                    ids.push(item);
    });
    return [...new Set(ids)];
}
function assetReferences(records) {
    const assets = new Map();
    const inspect = (value, depth = 0) => {
        if (depth > 40)
            fail('Record nesting exceeds the portable format limit');
        if (Array.isArray(value)) {
            for (const item of value)
                inspect(item, depth + 1);
            return;
        }
        if (!object(value))
            return;
        if (typeof value.hash === 'string' && 'size' in value) {
            if (!HASH.test(value.hash) || !Number.isSafeInteger(value.size) || Number(value.size) < 0)
                fail('Invalid content-addressed asset reference');
            if (Number(value.size) > MAX_SOURCE_BYTES)
                fail('Referenced asset size exceeds the local library limit of 25 MiB');
            if (assets.has(value.hash) && assets.get(value.hash) !== value.size)
                fail('Conflicting asset sizes');
            assets.set(value.hash, value.size);
        }
        for (const item of Object.values(value))
            inspect(item, depth + 1);
    };
    for (const record of records)
        inspect(record.data);
    return assets;
}
function validText(value, label, max = 100000) {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        fail(`Invalid ${label}`);
}
function natural(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
        fail(`Invalid ${label}`);
}
function linked(value, kind, byId, label) {
    if (typeof value !== 'string' || byId.get(value)?.kind !== kind)
        fail(`Invalid ${label}: expected a ${kind} reference`);
    return byId.get(value);
}
function validateBudget(value, byId) {
    if (!object(value) || !Array.isArray(value.operations) || value.operations.length > 1000)
        fail('Invalid project budget operations');
    natural(value.limitMicros, 'project budget limit');
    natural(value.spentMicros, 'project budget spent');
    natural(value.reservedMicros, 'project budget reserved');
    let spent = 0;
    let reserved = 0;
    const ids = new Set();
    for (const operation of value.operations) {
        if (!object(operation))
            fail('Invalid budget operation');
        validText(operation.operationId, 'budget operation ID', 200);
        natural(operation.estimatedMicros, 'budget reservation');
        if (ids.has(operation.operationId))
            fail('Duplicate budget operation ID');
        ids.add(operation.operationId);
        if (!['reserved', 'settled', 'uncertain'].includes(String(operation.status)))
            fail('Invalid budget operation status');
        if (operation.context !== undefined) {
            if (!object(operation.context))
                fail('Invalid processing budget context');
            linked(operation.context.sourceId, 'source', byId, 'budget processing source');
            natural(operation.context.page, 'budget processing page', 1);
            validText(operation.context.model, 'budget processing model', 500);
            validText(operation.context.cacheKey, 'budget processing cache key', 500);
            validText(operation.context.processingVersion, 'budget processing version', 200);
        }
        if (operation.status === 'settled') {
            natural(operation.actualMicros, 'settled budget cost');
            spent += operation.actualMicros;
        }
        else
            reserved += operation.estimatedMicros;
    }
    if (!Number.isSafeInteger(spent) || !Number.isSafeInteger(reserved) || spent !== value.spentMicros || reserved !== value.reservedMicros)
        fail('Project budget totals do not match operation ledger');
}
function validateLocator(value) {
    if (!object(value) || !['document', 'page', 'region', 'passage'].includes(String(value.precision)))
        fail('Invalid passage locator');
    if (value.page !== undefined)
        natural(value.page, 'locator page', 1, 1000000);
    if (value.quote !== undefined)
        validText(value.quote, 'locator quote', 50000);
    if (value.region !== undefined) {
        const region = value.region;
        if (!object(region) || ![region.x, region.y, region.width, region.height].every(item => typeof item === 'number' && Number.isFinite(item)) || Number(region.x) < 0 || Number(region.y) < 0 || Number(region.width) <= 0 || Number(region.height) <= 0 || value.page === undefined)
            fail('Invalid citation region');
    }
    if (value.precision === 'page' && value.page === undefined || value.precision === 'region' && value.region === undefined || value.precision === 'passage' && value.quote === undefined)
        fail('Citation precision requires its matching locator');
}
function claimSubstance(data) {
    const copy = structuredClone(data);
    for (const key of ['reviewStatus', 'decisionAudit', 'lastDecision', 'invalidatedBy'])
        delete copy[key];
    return canonical(copy);
}
function validateReview(record, byId) {
    const { reviewStatus, lastDecision, decisionAudit } = record.data;
    if (!['proposed', 'accepted', 'rejected', 'requires_review'].includes(String(reviewStatus)))
        fail('Invalid review status');
    if (decisionAudit !== undefined) {
        if (!object(decisionAudit) || typeof decisionAudit._id !== 'string' || canonical(byId.get(decisionAudit._id)) !== canonical(decisionAudit))
            fail('Embedded review audit is missing or inconsistent');
    }
    if (reviewStatus !== 'accepted' && reviewStatus !== 'rejected')
        return;
    if (!object(lastDecision))
        fail('Reviewed claim or entity requires decision provenance');
    const decision = linked(lastDecision.decisionId, 'decision', byId, 'review decision');
    const snapshot = decision.data.snapshot;
    if (decision.data.targetId !== record._id || decision.data.decision !== reviewStatus || lastDecision.decision !== reviewStatus || lastDecision.reviewedRevision !== decision.data.targetRevision || record.revision !== Number(decision.data.targetRevision) + 1 || !snapshot || claimSubstance(record.data) !== claimSubstance(snapshot.data))
        fail('Review decision does not approve the current record revision and content');
    if (lastDecision.reviewer !== decision.data.reviewer || lastDecision.approvalText !== decision.data.approvalText)
        fail('Review attestation does not match its audit');
    if (record.kind === 'claim' && reviewStatus === 'accepted' && !record.data.evidence.some(link => link.stance === 'supporting'))
        fail('Accepted claim requires supporting evidence');
}
function validateKind(record, byId, historical = false) {
    const data = record.data;
    switch (record.kind) {
        case 'project':
            if (data.schemaVersion !== 1)
                fail('Unsupported project schema version');
            validText(data.address, 'project address', 2000);
            validText(data.question, 'research question', 10000);
            validateBudget(data.budget, byId);
            if (data.sourceConstraints !== undefined && (!Array.isArray(data.sourceConstraints) || data.sourceConstraints.length > 100 || data.sourceConstraints.some(value => typeof value !== 'string' || !value.trim() || value.length > 2000)))
                fail('Invalid source constraints');
            break;
        case 'source':
            validText(data.title, 'source title', 2000);
            break;
        case 'passage': {
            linked(data.sourceId, 'source', byId, 'passage source');
            validText(data.text, 'passage text');
            validateLocator(data.locator);
            if (data.supersedes !== undefined && linked(data.supersedes, 'passage', byId, 'superseded passage').data.sourceId !== data.sourceId)
                fail('Correction must cite the same source');
            if (data.processingId !== undefined && linked(data.processingId, 'processing', byId, 'passage processing').data.sourceId !== data.sourceId)
                fail('Passage processing belongs to a different source');
            break;
        }
        case 'claim':
            validText(data.statement, 'claim statement', 10000);
            if (data.eventDate !== undefined && (typeof data.eventDate !== 'string' || data.eventDate.length > 200))
                fail('Invalid claim event date');
            if (data.category !== undefined && (typeof data.category !== 'string' || data.category.length > 100))
                fail('Invalid claim category');
            if (!Array.isArray(data.evidence) || data.evidence.length < 1 || data.evidence.length > 100)
                fail('Claim requires an evidence array');
            for (const evidence of data.evidence) {
                if (!object(evidence) || !['supporting', 'opposing'].includes(String(evidence.stance)))
                    fail('Invalid evidence stance');
                linked(evidence.passageId, 'passage', byId, 'claim evidence');
            }
            if (!Array.isArray(data.entityIds) || data.entityIds.length > 100)
                fail('Claim entityIds must be an array');
            for (const id of data.entityIds)
                linked(id, 'entity', byId, 'claim entity');
            if (data.category === 'identity_merge' && (data.entityIds.length < 2 || new Set(data.entityIds).size !== data.entityIds.length))
                fail('Identity merge requires distinct entity references');
            if (data.supersedes !== undefined)
                linked(data.supersedes, 'claim', byId, 'superseded claim');
            if (!historical)
                validateReview(record, byId);
            break;
        case 'entity':
            validText(data.name, 'entity name', 2000);
            validText(data.type, 'entity type', 100);
            if (!historical)
                validateReview(record, byId);
            break;
        case 'decision': {
            validText(data.reviewer, 'decision reviewer', 2000);
            validText(data.approvalText, 'decision approval text', 10000);
            natural(data.targetRevision, 'reviewed revision', 1);
            if (!['accepted', 'rejected'].includes(String(data.decision)))
                fail('Invalid decision');
            const target = typeof data.targetId === 'string' ? byId.get(data.targetId) : undefined;
            const snapshot = data.snapshot;
            if (!target || !['claim', 'entity'].includes(target.kind) || !object(snapshot) || snapshot._id !== target._id || snapshot.kind !== target.kind || snapshot.projectId !== record.projectId || snapshot.revision !== data.targetRevision || !object(snapshot.data))
                fail('Invalid decision target or snapshot');
            validateKind(snapshot, byId, true);
            break;
        }
        case 'log':
            validText(data.message, 'research log message', 30000);
            break;
        case 'run': {
            if (!object(data.limits) || !object(data.consumed) || !['active', 'stopped'].includes(String(data.status)))
                fail('Invalid research run');
            natural(data.limits.minutes, 'run minutes', 1, 30);
            natural(data.limits.searches, 'run searches', 1, 25);
            natural(data.limits.pages, 'run pages', 1, 50);
            natural(data.consumed.searches, 'consumed searches', 0, data.limits.searches);
            natural(data.consumed.pages, 'consumed pages', 0, data.limits.pages);
            break;
        }
        case 'processing':
            linked(data.sourceId, 'source', byId, 'processing source');
            natural(data.page, 'processing page', 1);
            validText(data.model, 'processing model', 500);
            validText(data.processingVersion, 'processing version', 200);
            if (!['in_progress', 'result_saved', 'complete', 'uncertain'].includes(String(data.status)))
                fail('Invalid processing status');
            if (data.status === 'complete' || data.passageId !== undefined) {
                const passage = linked(data.passageId, 'passage', byId, 'processing passage');
                if (passage.data.sourceId !== data.sourceId)
                    fail('Processing passage belongs to a different source');
            }
            if (data.status === 'result_saved' && (typeof data.text !== 'string' || !object(data.extractionMetadata)))
                fail('Saved processing result is incomplete');
            if (data.supersededBy !== undefined) {
                validText(data.supersededBy, 'processing retry reference', 200);
                if (!object(data.retryApproval))
                    fail('Processing retry requires an approval record');
                validText(data.retryApproval.reviewer, 'retry reviewer', 500);
                validText(data.retryApproval.approvalText, 'retry approval', 10000);
                if (typeof data.retryApproval.at !== 'string' || !Number.isFinite(Date.parse(data.retryApproval.at)))
                    fail('Invalid retry approval timestamp');
                let nextId = data.supersededBy;
                const seen = new Set([record._id]);
                for (let depth = 0; nextId; depth++) {
                    if (seen.has(nextId) || depth >= 100)
                        fail('Invalid cyclic processing retry chain');
                    seen.add(nextId);
                    const next = byId.get(nextId);
                    // Approval can precede a budget-limit failure, leaving the next attempt undispatched.
                    if (!next)
                        break;
                    if (next.kind !== 'processing' || next.data.sourceId !== data.sourceId || next.data.page !== data.page)
                        fail('Processing retry refers to a different source or page');
                    nextId = typeof next.data.supersededBy === 'string' ? next.data.supersededBy : '';
                }
            }
            break;
        case 'operation':
            if (!['running', 'complete'].includes(String(data.status)))
                fail('Invalid operation status');
            validText(data.operationId, 'operation ID', 500);
            validText(data.sourceProjectId, 'operation source project', 500);
            if (data.type === 'restore') {
                if (typeof data.bundleHash !== 'string' || !HASH.test(data.bundleHash))
                    fail('Invalid restore operation');
            }
            else if (data.type === 'copy') {
                if (typeof data.inputHash !== 'string' || !HASH.test(data.inputHash) || !Array.isArray(data.copiedRecordIds) || new Set(data.copiedRecordIds).size !== data.copiedRecordIds.length)
                    fail('Invalid copy operation');
                natural(data.totalRecords, 'copy record count', 1, 2000);
                for (const id of data.copiedRecordIds)
                    if (typeof id !== 'string' || !['source', 'passage', 'entity', 'claim'].includes(byId.get(id)?.kind ?? ''))
                        fail('Invalid copied record reference');
                if (data.copiedRecordIds.length > data.totalRecords || data.status === 'complete' && data.copiedRecordIds.length !== data.totalRecords)
                    fail('Copy progress does not match completion state');
            }
            else
                fail('Invalid operation type');
            break;
    }
}
function validateRecords(records, projectId) {
    const ids = new Set();
    for (const record of records) {
        if (!object(record) || typeof record._id !== 'string' || !record._id || record._id.length > 500 || record.projectId !== projectId || !KINDS.has(record.kind) || !object(record.data))
            fail('Invalid project record');
        if (ids.has(record._id))
            fail(`Duplicate record ID: ${record._id}`);
        if (!Number.isSafeInteger(record.revision) || record.revision < 1 || !Number.isFinite(Date.parse(record.createdAt)) || !Number.isFinite(Date.parse(record.updatedAt)))
            fail('Invalid record revision or timestamp');
        if (Buffer.byteLength(JSON.stringify(record.data)) > 256000)
            fail('Record data exceeds 256KB');
        ids.add(record._id);
    }
    const projects = records.filter(record => record.kind === 'project');
    if (projects.length !== 1 || projects[0]._id !== projectId)
        fail('Bundle requires exactly one matching project record');
    if (projects[0].data.restoreStatus === 'restoring')
        fail('Cannot export or restore an incomplete project');
    for (const record of records)
        for (const id of references(record))
            if (!ids.has(id))
                fail(`Dangling record reference ${id} from ${record._id}`);
    const byId = new Map(records.map(record => [record._id, record]));
    for (const record of records)
        validateKind(record, byId);
}
function validateBundle(input, maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
        fail('Invalid bundle size limit');
    let serialized;
    try {
        serialized = JSON.stringify(input);
    }
    catch {
        fail('Bundle must be JSON serializable');
    }
    if (serialized === undefined || Buffer.byteLength(serialized) > maxBytes)
        fail('Bundle exceeds the size limit');
    if (!object(input) || input.format !== 'plot-and-kin' || input.schemaVersion !== 1)
        fail('Unsupported portable bundle format or version');
    if (typeof input.projectId !== 'string' || !input.projectId || !Array.isArray(input.records) || !Array.isArray(input.assets) || input.records.length > 50000 || input.assets.length > 10000)
        fail('Invalid bundle contents');
    if (typeof input.exportedAt !== 'string' || !Number.isFinite(Date.parse(input.exportedAt)))
        fail('Invalid export timestamp');
    const bundle = input;
    validateRecords(bundle.records, bundle.projectId);
    for (const record of bundle.records)
        if (canonical(cleanRecord(record)) !== canonical(record))
            fail('Bundle contains sensitive values or absolute local paths');
    const required = assetReferences(bundle.records);
    const bytes = new Map();
    for (const asset of bundle.assets) {
        if (!object(asset) || typeof asset.hash !== 'string' || !HASH.test(asset.hash) || !Number.isSafeInteger(asset.size) || asset.size < 0 || asset.encoding !== 'base64' || typeof asset.data !== 'string')
            fail('Invalid asset encoding or hash');
        if (asset.size > MAX_SOURCE_BYTES)
            fail('Asset size exceeds the local library limit of 25 MiB');
        if (!required.has(asset.hash))
            fail(`Unreferenced asset ${asset.hash}`);
        if (required.get(asset.hash) !== asset.size)
            fail('Asset size does not match its reference');
        if (bytes.has(asset.hash))
            fail('Duplicate asset hash');
        const decoded = Buffer.from(asset.data, 'base64');
        if (decoded.toString('base64') !== asset.data || decoded.byteLength !== asset.size || digest(decoded) !== asset.hash)
            fail('Asset hash or size mismatch');
        bytes.set(asset.hash, decoded);
    }
    for (const [hash, size] of required)
        if (!bytes.has(hash) || bytes.get(hash).byteLength !== size)
            fail(`Missing or invalid required asset ${hash}`);
    return { bundle, bytes, bundleHash: digest(canonical(bundle)) };
}
async function projectRecords(store, projectId) {
    requireText(projectId, 'projectId', 500);
    const records = (await store.list(projectId)).map(cleanRecord);
    const byId = new Map(records.map(record => [record._id, record]));
    // A target update may succeed immediately before its separate immutable audit append fails.
    for (const record of records) {
        const audit = record.data.decisionAudit;
        if (!object(audit))
            continue;
        if (audit.kind !== 'decision' || audit.projectId !== projectId || typeof audit._id !== 'string')
            fail('Invalid embedded decision audit');
        const existing = byId.get(audit._id);
        if (existing && canonical(existing) !== canonical(audit))
            fail('Embedded decision audit conflicts with stored decision');
        if (!existing) {
            byId.set(audit._id, audit);
            records.push(audit);
        }
    }
    records.sort((a, b) => a._id.localeCompare(b._id));
    validateRecords(records, projectId);
    return records;
}
/** A JSON bundle is self-contained: it never contains filesystem destinations or credentials. */
export async function createBundle(store, blobs, projectId, options = {}) {
    const records = await projectRecords(store, projectId);
    const assets = [];
    for (const [hash, size] of assetReferences(records)) {
        const bytes = await blobs.read(hash);
        if (bytes.byteLength !== size || digest(bytes) !== hash)
            fail(`Local asset hash or size mismatch: ${hash}`);
        assets.push({ hash, size, encoding: 'base64', data: Buffer.from(bytes).toString('base64') });
    }
    const bundle = { format: 'plot-and-kin', schemaVersion: 1, exportedAt: new Date().toISOString(), projectId, records, assets: assets.sort((a, b) => a.hash.localeCompare(b.hash)) };
    validateBundle(bundle, options.maxBundleBytes ?? MAX_BUNDLE_BYTES);
    return bundle;
}
function rewritten(value, ids, sourceProjectId, targetProjectId, key = '') {
    if (key === 'origin' || key === 'metadata' || key === 'attributes')
        return structuredClone(value);
    if (key === 'projectId' && value === sourceProjectId)
        return targetProjectId;
    if ((ONE_REF.has(key) || key === '_id' || key === 'operationId' || key === 'supersededBy') && typeof value === 'string')
        return ids.get(value) ?? value;
    if (MANY_REFS.has(key) && Array.isArray(value))
        return value.map(id => typeof id === 'string' ? ids.get(id) ?? id : id);
    if (Array.isArray(value))
        return value.map(item => rewritten(item, ids, sourceProjectId, targetProjectId));
    if (!object(value))
        return value;
    return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, rewritten(item, ids, sourceProjectId, targetProjectId, childKey)]));
}
function restoreId(projectId, id) { return `pk_${digest(`${projectId}\0${id}`)}`; }
async function replaceOrConflict(store, next, current) {
    if (!await store.replace(next, current.revision))
        throw new PKError('RESTORE_CONFLICT', 'Concurrent project change. Retry the same restore operation.');
}
/** Restore validates every record/reference/hash before the first write. Retry with the exact same options and bundle. */
export async function restoreBundle(store, blobs, input, options) {
    const target = requireText(options.targetProjectId, 'targetProjectId', 500);
    const operationId = requireText(options.operationId, 'operationId', 500);
    const { bundle, bytes, bundleHash } = validateBundle(input, options.maxBundleBytes ?? MAX_BUNDLE_BYTES);
    const opId = restoreId(target, `restore-operation:${operationId}`);
    const result = { projectId: target, operationId, status: 'complete', restoredRecords: bundle.records.length };
    const existing = await store.list(target);
    let operation = existing.find(record => record._id === opId);
    if (existing.length && (!operation || operation.kind !== 'operation' || operation.data.bundleHash !== bundleHash || operation.data.type !== 'restore'))
        throw new PKError('RESTORE_CONFLICT', 'Destination project already exists or belongs to a different restore operation');
    if (operation?.data.status === 'complete') {
        const project = await store.get(target, target);
        if (project?.data.restoreStatus === 'ready')
            return result;
        if (project?.data.restoreStatus !== 'restoring')
            throw new PKError('RESTORE_CONFLICT', 'Completed restore has inconsistent project readiness');
    }
    const ids = new Map(bundle.records.map(record => [record._id, record.kind === 'project' ? target : restoreId(target, record._id)]));
    for (const record of bundle.records) {
        if (record.kind === 'processing' && typeof record.data.supersededBy === 'string' && !ids.has(record.data.supersededBy))
            ids.set(record.data.supersededBy, restoreId(target, record.data.supersededBy));
        if (record.kind === 'project') {
            const budget = record.data.budget;
            for (const operation of budget.operations)
                if (!ids.has(operation.operationId))
                    ids.set(operation.operationId, restoreId(target, operation.operationId));
        }
    }
    const mapped = bundle.records.map(record => rewritten(record, ids, bundle.projectId, target));
    const expected = new Map(mapped.map(record => [record._id, record]));
    for (const current of existing) {
        if (current._id === opId || current._id === target)
            continue;
        if (!expected.has(current._id) || canonical(current) !== canonical(expected.get(current._id)))
            throw new PKError('RESTORE_CONFLICT', 'Destination contains different or modified records');
    }
    const now = new Date().toISOString();
    if (!operation) {
        operation = { _id: opId, projectId: target, kind: 'operation', revision: 1, createdAt: now, updatedAt: now, data: { type: 'restore', status: 'running', operationId, bundleHash, sourceProjectId: bundle.projectId } };
        await store.insert(operation);
    }
    let staged = await store.get(target, target);
    const originalProject = mapped.find(record => record.kind === 'project');
    if (!staged) {
        staged = { ...originalProject, data: { ...originalProject.data, restoreStatus: 'restoring', restoreOperationId: opId } };
        await store.insert(staged);
    }
    else if (staged.data.restoreOperationId !== opId || !['restoring', 'ready'].includes(String(staged.data.restoreStatus))) {
        throw new PKError('RESTORE_CONFLICT', 'Destination project is not owned by this restore');
    }
    for (const [hash, value] of bytes) {
        if (!await blobs.verify(hash)) {
            const written = await blobs.put(value);
            if (written.hash !== hash || written.size !== value.byteLength)
                throw new PKError('RESTORE_CONFLICT', 'Blob store returned an inconsistent asset hash');
        }
    }
    for (const record of mapped) {
        if (record.kind === 'project')
            continue;
        if (!await store.get(target, record._id))
            await store.insert(record);
    }
    // Complete the operation first. A crash here keeps the project blocked until this exact restore resumes.
    if (operation.data.status !== 'complete') {
        const completed = { ...operation, revision: operation.revision + 1, updatedAt: now, data: { ...operation.data, status: 'complete', restoredRecords: mapped.length } };
        await replaceOrConflict(store, completed, operation);
    }
    // Project readiness is committed only after every asset, record and operation has been materialized.
    if (staged.data.restoreStatus !== 'ready') {
        const ready = { ...staged, revision: staged.revision + 1, updatedAt: now, data: { ...staged.data, restoreStatus: 'ready' } };
        await replaceOrConflict(store, ready, staged);
    }
    return result;
}
function escapeHtml(value) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function escapeMarkdown(value) { return value.replace(/([\\`*_\[\]()|<>])/g, '\\$1').replace(/\r?\n/g, ' '); }
function text(value) { return typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value); }
function timelineDate(raw) {
    if (!raw?.trim())
        return { dateInterpretation: 'undated' };
    const date = raw.trim();
    const simple = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date);
    if (simple) {
        const year = Number(simple[1]), month = Number(simple[2] ?? 1), day = Number(simple[3] ?? 1);
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1])
            return { dateInterpretation: simple[3] ? 'day' : simple[2] ? 'month' : 'year', sortDate: `${simple[1]}-${simple[2] ?? '01'}-${simple[3] ?? '01'}` };
    }
    const approximate = /^(?:c\.?|ca\.?|circa|about)\s+(\d{4})$/i.exec(date);
    if (approximate && Number(approximate[1]) > 0)
        return { dateInterpretation: 'approximate', sortDate: `${approximate[1]}-01-01` };
    const range = /^(\d{4})\s*(?:-|–|—|to)\s*(\d{4})$/i.exec(date);
    if (range && Number(range[1]) > 0 && Number(range[1]) <= Number(range[2]))
        return { dateInterpretation: 'range', sortDate: `${range[1]}-01-01` };
    return { dateInterpretation: 'unplaced' };
}
/** Export an inspectable dossier. Accepted claims with superseded evidence are never presented as approved. */
export async function buildDossier(store, projectId) {
    const records = await projectRecords(store, projectId);
    const byId = new Map(records.map(record => [record._id, record]));
    const project = byId.get(projectId);
    const superseded = new Set(records.filter(record => record.kind === 'passage').map(record => record.data.supersedes).filter((value) => typeof value === 'string'));
    const reviews = {};
    const sections = ['Approved conclusions', 'Proposed claims', 'Requires review', 'Rejected claims', 'Contradictions and alternative interpretations', 'Sources and citation locators', 'Research log and gaps', 'Review decisions'].map(title => ({ title, items: [] }));
    for (const record of records.filter(item => item.kind === 'claim')) {
        const evidence = Array.isArray(record.data.evidence) ? record.data.evidence.filter(object) : [];
        const stale = evidence.some(item => typeof item.passageId === 'string' && superseded.has(item.passageId));
        const status = stale ? 'requires_review' : text(record.data.reviewStatus || 'proposed');
        reviews[record._id] = status;
        const index = status === 'accepted' ? 0 : status === 'rejected' ? 3 : status === 'requires_review' ? 2 : 1;
        const details = evidence.map(item => {
            const passage = byId.get(text(item.passageId));
            const source = passage ? byId.get(text(passage.data.sourceId)) : undefined;
            return `${text(item.stance)} evidence: passage ${text(item.passageId)}, source ${source?._id ?? 'unavailable'} (${text(source?.data.title)}), locator ${text(passage?.data.locator)}. Transcription: ${text(passage?.data.text)}`;
        });
        if (stale)
            details.push('Evidence was corrected. Renewed human review is required.');
        const item = { text: `${record._id}: ${text(record.data.statement)}`, details };
        sections[index].items.push(item);
        if (evidence.some(entry => entry.stance === 'opposing'))
            sections[4].items.push(item);
    }
    for (const source of records.filter(item => item.kind === 'source')) {
        const rights = text(source.data.rights).trim(), attribution = text(source.data.attribution).trim();
        sections[5].items.push({ text: `${source._id}: ${text(source.data.title)}`, details: [text(source.data.url), rights ? `Rights: ${rights}` : '', attribution ? `Attribution: ${attribution}` : '', ...records.filter(record => record.kind === 'passage' && record.data.sourceId === source._id).map(passage => `Passage ${passage._id}: ${text(passage.data.locator)} — ${text(passage.data.text)}`)].filter(Boolean) });
    }
    for (const record of records.filter(item => item.kind === 'log' || item.kind === 'run'))
        sections[6].items.push({ text: `${record._id} (${record.kind})`, details: [text(record.data)] });
    for (const record of records.filter(item => item.kind === 'decision'))
        sections[7].items.push({ text: `${record._id}: ${text(record.data.decision)} by ${text(record.data.reviewer)}`, details: [`Target ${text(record.data.targetId)}, revision ${text(record.data.targetRevision)}`, text(record.data.approvalText)] });
    const timeline = records.filter(record => record.kind === 'claim').map(record => {
        const eventDate = typeof record.data.eventDate === 'string' ? record.data.eventDate : undefined;
        return { claimId: record._id, statement: text(record.data.statement), ...(eventDate === undefined ? {} : { eventDate }), ...(typeof record.data.category === 'string' ? { category: record.data.category } : {}), reviewStatus: reviews[record._id], ...timelineDate(eventDate) };
    }).sort((a, b) => (a.sortDate ?? '~~~~').localeCompare(b.sortDate ?? '~~~~') || a.claimId.localeCompare(b.claimId));
    sections.unshift({ title: 'Timeline', items: timeline.map(entry => ({
            text: `${entry.dateInterpretation === 'unplaced' ? 'Unplaced date: ' : entry.dateInterpretation === 'undated' ? 'Undated' : ''}${entry.eventDate ?? ''} — ${entry.statement}`,
            details: [`Claim ${entry.claimId}. Review: ${entry.reviewStatus}. Category: ${entry.category ?? 'unspecified'}. Date precision: ${entry.dateInterpretation}.`, ...(entry.dateInterpretation === 'approximate' || entry.dateInterpretation === 'range' || entry.dateInterpretation === 'year' || entry.dateInterpretation === 'month' ? ['Chronological placement uses the earliest supplied date component for ordering only. It does not establish an exact event date.'] : [])],
        })) });
    const title = `Plot & Kin: ${text(project.data.address || project.data.title || projectId)}`;
    const question = text(project.data.question).trim();
    const intro = `Research question: ${question}${/[.!?…]$/.test(question) ? '' : '.'} Human approval is recorded from the client conversation, not independently authenticated by the MCP server.`;
    const markdown = [`# ${escapeMarkdown(title)}`, '', escapeMarkdown(intro), '', ...sections.flatMap(section => [`## ${section.title}`, '', ...(section.items.length ? section.items.flatMap(item => [`- ${escapeMarkdown(item.text)}`, ...item.details.map(detail => `  - ${escapeMarkdown(detail)}`)]) : ['No entries.']), ''])].join('\n');
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light;--paper:#f7f4ec;--ink:#192b2a;--muted:#566763;--copper:#9c5639;--line:#d5dbd1;--white:#fffef9}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:2rem}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}a{color:inherit;text-underline-offset:4px}a:focus-visible{outline:3px solid var(--copper);outline-offset:5px}.page{max-width:1120px;margin:auto;padding:0 56px}.masthead{display:flex;justify-content:space-between;align-items:center;padding:27px 0;border-bottom:1px solid var(--line);gap:1rem}.brand{font:600 25px/1.2 Georgia,"Times New Roman",serif;letter-spacing:-1px}.brand em{font-weight:400;color:var(--copper)}.eyebrow{margin:0;color:var(--copper);font-size:10px;line-height:1.5;letter-spacing:.16em;text-transform:uppercase;font-weight:700}.hero{padding:58px 0 40px}.hero h1{font:400 clamp(36px,5vw,58px)/1.08 Georgia,"Times New Roman",serif;letter-spacing:-1.8px;max-width:850px;margin:18px 0 24px;overflow-wrap:anywhere}.intro{font-size:16px;max-width:730px;color:var(--muted);margin:0}.summary{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-top:35px;padding:22px 0;gap:20px}.summary div{display:flex;align-items:baseline;gap:12px}.summary strong{font:400 36px/1 Georgia,"Times New Roman",serif}.summary span{font-size:12px;color:var(--muted)}.contents{display:flex;flex-wrap:wrap;gap:9px 22px;padding:22px 0 30px;border-bottom:1px solid var(--line);font-size:11px;line-height:1.6}.contents a{text-decoration:none}.contents a:hover{text-decoration:underline;color:var(--copper)}main{padding:4px 0 56px}section{padding-top:38px;scroll-margin-top:20px}section h2{font:400 28px/1.2 Georgia,"Times New Roman",serif;letter-spacing:-.4px;margin:0 0 22px;display:flex;align-items:baseline;gap:16px}.section-number{color:var(--copper);font:600 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.08em}.entries{list-style:none;padding:0;margin:0;display:grid;gap:16px}.entry{padding:24px 27px;background:var(--white);border:1px solid var(--line);border-radius:3px;overflow-wrap:anywhere}.entry-title{font-size:17px;font-weight:500;line-height:1.6;display:block}.record-id{display:block;color:var(--muted);font:10px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;margin-bottom:10px}.details{padding:0;margin:16px 0 0;list-style:none;border-top:1px solid var(--line)}.details li{font-size:12px;line-height:1.85;color:var(--muted);padding-top:12px;overflow-wrap:anywhere}.identifier{font:10px/1.75 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--muted)}.empty{margin:0;color:var(--muted);padding:15px 20px;border-left:2px solid var(--line);font-size:13px}.timeline .entry{display:grid;grid-template-columns:105px 1fr;column-gap:23px;border-left:3px solid var(--copper)}.timeline .date{font:400 23px/1.3 Georgia,"Times New Roman",serif;color:var(--copper)}.timeline .details{grid-column:2}.timeline .entry-title{font-size:16px}.footer{display:flex;justify-content:space-between;gap:16px;border-top:1px solid var(--line);padding:24px 0 40px;font-size:11px;color:var(--muted)}
@media(max-width:650px){.page{padding:0 22px}.masthead{padding:20px 0}.masthead .eyebrow{font-size:9px}.brand{font-size:23px}.hero{padding:36px 0 24px}.hero h1{letter-spacing:-1px;margin-top:16px}.intro{font-size:14px}.summary{gap:12px;padding:20px 0;margin-top:28px}.summary div{display:block}.summary strong{display:block;font-size:30px;margin-bottom:6px}.summary span{font-size:11px}.contents{gap:10px 18px}section h2{font-size:25px}.entry{padding:20px}.timeline .entry{grid-template-columns:1fr}.timeline .date{margin-bottom:12px;font-size:21px}.timeline .details{grid-column:1}.footer{flex-direction:column}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
@media print{body{background:#fff;font-size:11pt}.page{max-width:none;padding:0}.masthead{padding:0 0 14pt}.hero{padding:24pt 0 14pt}.hero h1{font-size:30pt}.intro{font-size:10pt}.summary{padding:14pt 0;margin-top:18pt}.summary strong{font-size:24pt}.contents{display:none}main{padding-bottom:20pt}section{padding-top:24pt}section h2{font-size:20pt;break-after:avoid}.entry{background:#fff;padding:14pt;border-radius:0;break-inside:avoid}.details li{font-size:9pt}.empty{font-size:10pt}.footer{padding:16pt 0}a{text-decoration:none}}
</style>
</head>
<body>
<div class="page">
<header>
<div class="masthead"><div class="brand">Plot <em>&amp;</em> Kin</div><p class="eyebrow">Evidence dossier</p></div>
<div class="hero"><p class="eyebrow">Property history · Research record</p><h1>${escapeHtml(text(project.data.address || project.data.title || projectId))}</h1><p class="intro">${escapeHtml(intro)}</p>
<div class="summary" aria-label="Dossier overview"><div><strong>${sections.find(section => section.title === 'Sources and citation locators').items.length}</strong><span>preserved sources</span></div><div><strong>${sections.find(section => section.title === 'Proposed claims').items.length}</strong><span>proposed claims</span></div><div><strong>${sections.find(section => section.title === 'Approved conclusions').items.length}</strong><span>approved conclusions</span></div></div>
</div>
<nav class="contents" aria-label="Dossier sections">${sections.map((section, index) => `<a href="#section-${index + 1}">${escapeHtml(section.title)}</a>`).join('')}</nav>
</header>
<main>${sections.map((section, index) => `<section id="section-${index + 1}"${section.title === 'Timeline' ? ' class="timeline"' : ''}><h2><span class="section-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>${escapeHtml(section.title)}</h2>${section.items.length ? `<ul class="entries">${section.items.map(item => {
        const identified = /^((?:claim|source|decision)-[^\s:]+):\s*(.*)$/s.exec(item.text);
        const dateSeparator = section.title === 'Timeline' ? item.text.indexOf(' — ') : -1;
        const heading = dateSeparator >= 0 ? `<span class="date">${escapeHtml(item.text.slice(0, dateSeparator))}</span><span class="entry-title">${escapeHtml(item.text.slice(dateSeparator + 3))}</span>` : identified ? `<span class="record-id">${escapeHtml(identified[1])}</span><span class="entry-title">${escapeHtml(identified[2])}</span>` : `<span class="entry-title">${escapeHtml(item.text)}</span>`;
        return `<li class="entry">${heading}${item.details.length ? `<ul class="details">${item.details.map(detail => `<li>${escapeHtml(detail).replace(/((?:passage|source|claim|decision|run|log)-[a-z0-9-]{20,})/gi, '<span class="identifier">$1</span>')}</li>`).join('')}</ul>` : ''}</li>`;
    }).join('')}</ul>` : '<p class="empty">No entries.</p>'}</section>`).join('')}</main>
<footer class="footer"><span>Plot &amp; Kin · Evidence-backed property research</span><span>Sources, interpretations, and review history preserved together.</span></footer>
</div>
</body>
</html>`;
    return { markdown, html, json: { schemaVersion: 1, projectId, exportedAt: new Date().toISOString(), records, claimReviews: reviews, timeline } };
}
/** Explicit in-library reuse copies only the selected research records and their evidence dependencies. */
export async function copyRecords(store, sourceProjectId, targetProjectId, recordIds, operationId) {
    if (sourceProjectId === targetProjectId)
        throw new PKError('INVALID_INPUT', 'Cross-project reuse requires a different destination');
    if (!Array.isArray(recordIds) || !recordIds.length)
        throw new PKError('INVALID_INPUT', 'Select at least one record to reuse');
    const source = await projectRecords(store, sourceProjectId);
    const target = await store.get(targetProjectId, targetProjectId);
    if (!target || target.kind !== 'project' || target.data.restoreStatus === 'restoring')
        throw new PKError('INVALID_INPUT', 'Destination project must exist and be ready');
    const byId = new Map(source.map(record => [record._id, record]));
    const selected = new Map();
    const ordered = [];
    const visiting = new Set();
    const add = (id) => {
        if (visiting.has(id))
            throw new PKError('INVALID_INPUT', 'Cannot copy a cyclic research dependency');
        if (selected.has(id))
            return;
        const record = byId.get(id);
        if (!record || !['source', 'passage', 'entity', 'claim'].includes(record.kind))
            throw new PKError('INVALID_INPUT', 'Only sources, passages, entities, and claims may be explicitly reused');
        selected.set(id, record);
        visiting.add(id);
        if (selected.size > 2000)
            throw new PKError('INVALID_INPUT', 'A copy operation supports at most 2000 records including dependencies');
        for (const dependency of references(record, true))
            add(dependency);
        visiting.delete(id);
        ordered.push(record);
    };
    for (const id of [...new Set(recordIds)].sort())
        add(id);
    const inputHash = digest(canonical({ sourceProjectId, targetProjectId, selection: [...new Set(recordIds)].sort(), snapshots: [...selected.values()].sort((a, b) => a._id.localeCompare(b._id)) }));
    const key = operationId === undefined ? `copy-${inputHash}` : requireText(operationId, 'copy operation ID', 200);
    const opId = restoreId(targetProjectId, `copy-operation:${key}`);
    let operation = await store.get(targetProjectId, opId);
    if (operation && (operation.kind !== 'operation' || operation.data.type !== 'copy' || operation.data.inputHash !== inputHash))
        throw new PKError('COPY_CONFLICT', 'Copy operation was already used for different source snapshots or selections');
    const now = operation?.createdAt ?? new Date().toISOString();
    const ids = new Map([...selected.keys()].map(id => [id, restoreId(targetProjectId, `copy:${key}:${id}`)]));
    const copies = ordered.map(record => {
        const copy = rewritten(record, ids, sourceProjectId, targetProjectId);
        const origin = { projectId: sourceProjectId, recordId: record._id, revision: record.revision, copiedAt: now, previousOrigin: record.data.origin ?? null, previousReviewStatus: record.data.reviewStatus ?? null, ...(record.data.processingId === undefined ? {} : { processingId: record.data.processingId }) };
        delete copy.data.lastDecision;
        delete copy.data.decisionAudit;
        delete copy.data.processingId;
        if (copy.kind === 'claim' || copy.kind === 'entity')
            copy.data.reviewStatus = 'proposed';
        return { ...copy, revision: 1, createdAt: now, updatedAt: now, data: { ...copy.data, origin } };
    });
    for (const copy of copies) {
        const existing = await store.get(targetProjectId, copy._id);
        if (existing && canonical(existing) !== canonical(copy))
            throw new PKError('COPY_CONFLICT', 'Previously copied record was modified or conflicts with this operation');
        if (!existing && operation?.data.status === 'complete')
            throw new PKError('COPY_CONFLICT', 'Completed copy has a missing output record');
    }
    if (operation?.data.status === 'complete')
        return copies;
    if (!operation) {
        operation = { _id: opId, projectId: targetProjectId, kind: 'operation', revision: 1, createdAt: now, updatedAt: now, data: { type: 'copy', status: 'running', operationId: key, inputHash, sourceProjectId, totalRecords: copies.length, copiedRecordIds: [] } };
        await store.insert(operation);
    }
    const checkpoint = async (recordId) => {
        for (let attempt = 0; attempt < 8; attempt++) {
            const current = await store.get(targetProjectId, opId);
            if (!current || current.data.inputHash !== inputHash)
                throw new PKError('COPY_CONFLICT', 'Copy operation changed during import');
            const completed = new Set(current.data.copiedRecordIds);
            if (recordId)
                completed.add(recordId);
            if (!recordId && completed.size !== copies.length)
                throw new PKError('COPY_CONFLICT', 'Cannot finish copy before all records are preserved');
            if (recordId && current.data.copiedRecordIds.includes(recordId) || !recordId && current.data.status === 'complete')
                return;
            const next = { ...current, revision: current.revision + 1, updatedAt: new Date().toISOString(), data: { ...current.data, copiedRecordIds: [...completed], status: recordId ? 'running' : 'complete' } };
            if (await store.replace(next, current.revision))
                return;
        }
        throw new PKError('COPY_CONFLICT', 'Concurrent copy progress changed repeatedly. Retry the same operation.');
    };
    // Dependency order means a partial copy never installs a claim before its cited evidence.
    for (const copy of copies) {
        const existing = await store.get(targetProjectId, copy._id);
        if (existing && canonical(existing) !== canonical(copy))
            throw new PKError('COPY_CONFLICT', 'Copied record changed during import');
        if (!existing)
            await store.insert(copy);
        await checkpoint(copy._id);
    }
    for (const copy of copies)
        for (const reference of references(copy))
            if (!await store.get(targetProjectId, reference))
                throw new PKError('COPY_CONFLICT', 'Copied research has an unresolved reference');
    await checkpoint();
    return copies;
}
//# sourceMappingURL=portability.js.map