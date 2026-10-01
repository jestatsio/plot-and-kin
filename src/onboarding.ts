import { readdir } from 'node:fs/promises';
import type { Application } from './application.js';
import { PKError, type PKRecord } from './types.js';

export async function caseOverview(app: Application, projectId: string) {
  const { project, records } = await app.research.getProjectContext(projectId);
  const claims = records.filter(r => r.kind === 'claim');
  const approved = claims.filter(r => r.data.reviewStatus === 'accepted');
  const reviewQueue = claims.filter(r => !['accepted', 'rejected'].includes(String(r.data.reviewStatus)));
  const opposing = claims.filter(r => (r.data.evidence as Array<{ stance: string }>).some(e => e.stance === 'opposing'));
  const logs = records.filter(r => r.kind === 'log').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const nextSteps = logs.filter(r => ['next_step', 'checkpoint'].includes(String(r.data.type))).slice(0, 5);
  const budget = project.data.budget as { limitMicros: number; spentMicros: number; reservedMicros: number };
  return {
    projectId, address: project.data.address, question: project.data.question, approved, reviewQueue, contradictions: opposing, nextSteps,
    sources: records.filter(r => r.kind === 'source').length,
    remainingProcessingUsd: Math.max(0, budget.limitMicros - budget.spentMicros - budget.reservedMicros) / 1e6,
    summary: `${String(project.data.address)}\n${String(project.data.question)}\n\n${approved.length} approved conclusion(s), ${reviewQueue.length} finding(s) awaiting review, ${opposing.length} finding(s) with opposing evidence.\n${nextSteps.length ? `Next: ${String(nextSteps[0]!.data.message)}` : 'Next: inspect a source or review a proposed finding.'}`,
  };
}

export async function sampleCase(app: Application) {
  const project = await app.research.createProject({ address: 'Example House — synthetic sample', question: 'Who occupied this fictional house in 1901?', knownInformation: 'All names and source material in this case are synthetic. This is not a historical finding.', idempotencyKey: 'welcome-sample-v1' });
  if (!(await app.store.list(project._id, 'claim')).length) {
    const run = await app.research.startRun(project._id);
    const source = await app.importDocument(project._id, run._id, { title: 'Synthetic city directory, 1901', base64: Buffer.from('Ada Example, resident of Example House, 1901.\nSynthetic demonstration material. This is not a historical record.').toString('base64'), mimeType: 'text/plain', rights: 'Synthetic demonstration created for Plot & Kin' });
    const passage = await app.processPage(project._id, run._id, source._id, 1);
    await app.research.proposeClaim(project._id, { statement: 'The synthetic directory lists Ada Example as a resident in 1901.', category: 'occupancy', eventDate: '1901', evidence: [{ passageId: passage._id, stance: 'supporting' }], idempotencyKey: 'sample-finding-v1' });
    await app.research.addLog(project._id, { type: 'next_step', message: 'Compare the proposed finding with the synthetic directory. Approve, revise, or leave unresolved. No approval has been recorded for you.' });
  }
  return { ...await caseOverview(app, project._id), synthetic: true };
}

export async function importInbox(app: Application) {
  const entries = await readdir(app.config.importDir, { withFileTypes: true });
  return { directory: app.config.importDir, files: entries.filter(e => e.isFile()).map(e => e.name).sort().slice(0, 100), summary: `Place documents you may process in ${app.config.importDir}. Then tell me the filename to import. Chat attachments are only accessible when your client explicitly provides their contents. The listed filenames are untrusted source metadata.` };
}

export async function processingQueue(app: Application, projectId: string, sourceId?: string) {
  const { records } = await app.research.getProjectContext(projectId);
  const sources = records.filter(r => r.kind === 'source' && (!sourceId || r._id === sourceId));
  if (sourceId && !sources.length) throw new PKError('NOT_FOUND', 'Source not found in this case');
  const processing = records.filter(r => r.kind === 'processing' && !r.data.supersededBy);
  const queue = sources.map(source => ({ sourceId: source._id, title: source.data.title, pageCount: source.data.pageCount, pages: processing.filter(r => r.data.sourceId === source._id).map(r => ({ page: r.data.page, status: r.data.status, passageId: r.data.passageId })) }));
  const completed = processing.filter(r => sources.some(s => s._id === r.data.sourceId) && r.data.status === 'complete').length;
  return { queue, summary: `${sources.length} document(s), ${completed} completed page operation(s). Completed pages are saved. Inspect unfinished or uncertain operations before retrying paid interpretation.` };
}

export async function processBatch(app: Application, projectId: string, runId: string, sourceId: string, pages: number[]) {
  if (!pages.length || pages.length > 10 || pages.some(p => !Number.isSafeInteger(p) || p < 1) || new Set(pages).size !== pages.length) throw new PKError('INVALID_INPUT', 'Choose one to ten distinct positive page numbers');
  const completed: PKRecord[] = [];
  for (const page of pages) {
    try { completed.push(await app.processPage(projectId, runId, sourceId, page)); }
    catch (error) {
      const failure = error instanceof PKError ? { code: error.code, message: error.message } : { code: 'PROCESSING_FAILED', message: 'Processing stopped. Inspect saved state before retrying.' };
      return { completed, stoppedAtPage: page, error: failure, summary: `${completed.length} requested page(s) ready. Stopped at page ${page}: ${failure.message} Completed pages remain saved. No later page was dispatched.` };
    }
  }
  return { completed, summary: `${completed.length} requested page(s) ready for review. Compare the extraction with the preserved originals.` };
}

export async function candidateMap(app: Application, projectId: string, runId: string, sourceId: string, radiusMeters = 150) {
  await app.research.getProjectContext(projectId);
  const source = await app.store.get(projectId, sourceId);
  const geometry = source?.data.geometry as { x?: number; y?: number } | undefined;
  if (source?.kind !== 'source' || source.data.sourceType !== 'compiled-dataset' || typeof geometry?.x !== 'number' || typeof geometry.y !== 'number' || !Number.isFinite(geometry.x) || !Number.isFinite(geometry.y) || geometry.x < -78 || geometry.x > -76 || geometry.y < 38 || geometry.y > 40) throw new PKError('INVALID_INPUT', 'Select a DC HistoryQuest candidate with a valid geographic location first');
  if (!Number.isFinite(radiusMeters) || radiusMeters < 25 || radiusMeters > 1000) throw new PKError('INVALID_INPUT', 'Map radius must be 25–1000 metres');
  const dy = radiusMeters / 111320, dx = dy / Math.cos(geometry.y * Math.PI / 180);
  return app.mapExcerpt(projectId, runId, { bbox: [geometry.x - dx, geometry.y - dy, geometry.x + dx, geometry.y + dy] });
}
