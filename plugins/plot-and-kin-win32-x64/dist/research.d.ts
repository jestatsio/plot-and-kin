import { type PKRecord, type RecordStore } from './types.js';
export interface ProjectInput {
    address: string;
    question: string;
    knownInformation?: string;
    sourceConstraints?: string[];
    idempotencyKey?: string;
}
export interface RunLimits {
    minutes?: number;
    searches?: number;
    pages?: number;
}
export interface SourceInput extends Record<string, unknown> {
    title: string;
    idempotencyKey?: string;
}
export interface Locator extends Record<string, unknown> {
    precision?: 'passage' | 'page' | 'region' | 'document';
    page?: number;
    region?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    quote?: string;
}
export interface PassageInput extends Record<string, unknown> {
    sourceId: string;
    text: string;
    locator?: Locator;
    idempotencyKey?: string;
}
export interface EvidenceLink {
    passageId: string;
    stance: 'supporting' | 'opposing';
}
export interface EntityInput extends Record<string, unknown> {
    type: string;
    name: string;
    idempotencyKey?: string;
}
export interface ClaimInput extends Record<string, unknown> {
    statement: string;
    evidence: EvidenceLink[];
    entityIds?: string[];
    category?: string;
    eventDate?: string;
    idempotencyKey?: string;
}
export interface DecisionInput {
    targetId: string;
    expectedRevision: number;
    decision: 'accepted' | 'rejected';
    reviewer: string;
    approvalText: string;
}
export interface BudgetOperationContext {
    sourceId: string;
    page: number;
    model: string;
    cacheKey: string;
    processingVersion: string;
}
export interface BudgetOperation {
    context?: BudgetOperationContext;
    operationId: string;
    status: 'reserved' | 'settled' | 'uncertain';
    estimatedMicros: number;
    actualMicros?: number;
    reason?: string;
    reconciliation?: {
        reviewer: string;
        approvalText: string;
        actualMicros: number;
        reconciledAt: string;
        priorStatus: 'reserved' | 'uncertain';
        dispatchStopped?: true;
    };
}
export interface BudgetResult {
    operationId: string;
    status: BudgetOperation['status'];
    alreadyExists: boolean;
    estimatedUsd: number;
    actualUsd?: number;
}
/** Transport-independent evidence workflow. Review records audit client-reported human approval. */
export declare class ResearchService {
    readonly store: RecordStore;
    private readonly now;
    constructor(store: RecordStore, now?: () => Date);
    private record;
    private require;
    private project;
    private create;
    private mutate;
    createProject(input: ProjectInput): Promise<PKRecord>;
    getProjectContext(projectId: string): Promise<{
        project: PKRecord;
        records: PKRecord[];
    }>;
    startRun(projectId: string, input?: {
        idempotencyKey?: string;
        limits?: RunLimits;
    }): Promise<PKRecord>;
    consumeRun(projectId: string, runId: string, input?: {
        searches?: number;
        pages?: number;
    }): Promise<PKRecord>;
    checkpointRun(projectId: string, runId: string, note?: string): Promise<PKRecord>;
    addSource(projectId: string, input: SourceInput): Promise<PKRecord>;
    addPassage(projectId: string, input: PassageInput): Promise<PKRecord>;
    proposeEntity(projectId: string, input: EntityInput): Promise<PKRecord>;
    private validateEvidence;
    proposeClaim(projectId: string, input: ClaimInput): Promise<PKRecord>;
    proposeMerge(projectId: string, input: {
        entityIds: string[];
        rationale: string;
        evidence: EvidenceLink[];
        idempotencyKey?: string;
    }): Promise<PKRecord>;
    recordDecision(projectId: string, input: DecisionInput): Promise<PKRecord>;
    private reconcileDecisionAudit;
    updateProjectSettings(projectId: string, input: {
        expectedRevision: number;
        budgetUsd: number;
        approvalText: string;
        reviewer: string;
    }): Promise<PKRecord>;
    correctPassage(projectId: string, input: {
        passageId: string;
        text: string;
        reason: string;
        reviewer: string;
        locator?: Locator;
        idempotencyKey?: string;
    }): Promise<PKRecord>;
    addLog(projectId: string, input: Record<string, unknown> & {
        message: string;
        idempotencyKey?: string;
    }): Promise<PKRecord>;
    reserveBudget(projectId: string, input: {
        operationId: string;
        estimatedUsd: number;
        context?: BudgetOperationContext;
    }): Promise<BudgetResult>;
    settleBudget(projectId: string, input: {
        operationId: string;
        actualUsd: number;
    }): Promise<BudgetResult>;
    reconcileBudget(projectId: string, input: {
        operationId: string;
        actualUsd: number;
        reviewer: string;
        approvalText: string;
        dispatchStopped?: boolean;
    }): Promise<BudgetResult>;
    private settleReservation;
    /** Final dispatch check. Stopping all dispatchers remains required before reconciling reserved work. */
    assertBudgetDispatchable(projectId: string, operationId: string): Promise<void>;
    blockProcessing(projectId: string, input: {
        operationId: string;
        reason: string;
    }): Promise<PKRecord>;
    acknowledgeProcessingBlock(projectId: string, input: {
        expectedRevision: number;
        reviewer: string;
        approvalText: string;
        resolutionNote: string;
    }): Promise<PKRecord>;
    markBudgetUncertain(projectId: string, operationId: string, reason: string): Promise<BudgetResult>;
}
