import { Inject, Injectable } from '@nestjs/common';
import {
  ApprovalArtifactSchema,
  ArtifactReferenceSchema,
  BudgetLimitSchema,
  CampaignSchema,
  DomainEventSchema,
  EvidenceRecordSchema,
  ExperimentPlanSchema,
  ExperimentResultSchema,
  HypothesisSchema,
  ProposedActionSchema,
  ReproducibilityBundleManifestSchema,
  TargetVersionSchema,
  TransitionPredicateSchema,
  VerificationReportSchema,
  type Actor,
  type ApprovalArtifact,
  type Campaign,
  type DomainEvent,
  type EvidenceRecord,
  type ReproducibilityBundleManifest,
  type TargetVersion,
  type VerificationReport,
} from '@alphalab/contracts';
import { DomainError, emptyBudgetUsage, transitionCampaign } from '@alphalab/domain';
import { classifyAction, digestAction } from '@alphalab/policy';
import { z } from 'zod';
import {
  CONTROL_STORE,
  type ApprovalRequestRecord,
  type ArtifactRecord,
  type ControlStore,
  type ProjectRecord,
} from '../persistence/control-store.js';

const CreateProjectSchema = z.object({
  organizationId: z.string().min(3),
  name: z.string().min(1).max(160),
  description: z.string().max(4000).default(''),
});

const CreateTargetSchema = TargetVersionSchema.omit({
  id: true,
  targetId: true,
  version: true,
  createdAt: true,
  createdBy: true,
}).extend({ targetId: z.string().min(3).optional() });

const CreateCampaignSchema = z.object({
  organizationId: z.string().min(3),
  projectId: z.string().min(3),
  targetVersionId: z.string().min(3),
  budgetLimit: BudgetLimitSchema,
});

const TransitionRequestSchema = z.object({
  to: CampaignSchema.shape.status,
  predicates: TransitionPredicateSchema.partial().default({}),
  reason: z.string().min(1).max(4000),
});

const ApprovalRequestInputSchema = z.object({
  kind: ProposedActionSchema.shape.kind,
  parameters: z.record(z.string(), z.unknown()),
});

const ApprovalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().min(1).max(4000),
  expiresAt: z.iso.datetime({ offset: true }),
  policyVersion: z.string().min(3),
});

const WorkerSnapshotSchema = z.object({
  workflowId: z.string().min(3),
  runId: z.string().min(3),
  campaign: CampaignSchema,
  hypothesis: HypothesisSchema.optional(),
  plan: ExperimentPlanSchema.optional(),
  proposedAction: ProposedActionSchema.optional(),
  results: z.array(ExperimentResultSchema),
  verificationReport: VerificationReportSchema.optional(),
  bundle: ReproducibilityBundleManifestSchema.optional(),
});

@Injectable()
export class CampaignsService {
  constructor(@Inject(CONTROL_STORE) private readonly store: ControlStore) {}

  async getProject(id: string): Promise<ProjectRecord> {
    const project = await this.store.getProject(id);
    if (!project) throw new DomainError('PROJECT_NOT_FOUND', `Project ${id} was not found`);
    return project;
  }

  listProjects(organizationId?: string): Promise<ProjectRecord[]> {
    return this.store.listProjects(organizationId);
  }

  async createProject(body: unknown, actor: Actor, idempotencyKey: string): Promise<ProjectRecord> {
    const input = CreateProjectSchema.parse(body);
    return this.store.idempotent(
      `project:create:${input.organizationId}:${actor.id}`,
      idempotencyKey,
      input,
      async () => {
        const record: ProjectRecord = {
          id: this.store.nextId('prj'),
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          createdAt: new Date().toISOString(),
          createdBy: actor.id,
        };
        await this.store.createProject(record);
        return record;
      },
    );
  }

  async createTarget(body: unknown, actor: Actor, idempotencyKey: string): Promise<TargetVersion> {
    const input = CreateTargetSchema.parse(body);
    await this.requireProject(input.projectId, input.organizationId);
    return this.store.idempotent(
      `target:create:${input.organizationId}:${input.projectId}:${actor.id}`,
      idempotencyKey,
      input,
      async () => {
        const targetId = input.targetId ?? this.store.nextId('tgt');
        const priorVersions = await this.store.listTargets(undefined, targetId);
        const record = TargetVersionSchema.parse({
          ...input,
          id: this.store.nextId('tgv'),
          targetId,
          version: priorVersions.length + 1,
          createdAt: new Date().toISOString(),
          createdBy: actor.id,
        });
        await this.store.createTarget(record);
        return record;
      },
    );
  }

  listTargets(projectId?: string): Promise<TargetVersion[]> {
    return this.store.listTargets(projectId);
  }

  async createCampaign(body: unknown, actor: Actor, idempotencyKey: string): Promise<Campaign> {
    const input = CreateCampaignSchema.parse(body);
    await this.requireProject(input.projectId, input.organizationId);
    const target = await this.store.getTarget(input.targetVersionId);
    if (!target || target.projectId !== input.projectId) {
      throw new DomainError(
        'TARGET_VERSION_NOT_FOUND',
        `Target version ${input.targetVersionId} was not found in the project`,
      );
    }
    return this.store.idempotent(
      `campaign:create:${input.organizationId}:${input.projectId}:${actor.id}`,
      idempotencyKey,
      input,
      async () => {
        const now = new Date().toISOString();
        const record = CampaignSchema.parse({
          id: this.store.nextId('cmp'),
          ...input,
          status: 'DRAFT',
          resumeStatus: null,
          stateVersion: 0,
          budgetVersion: 1,
          budgetUsage: emptyBudgetUsage(),
          createdAt: now,
          updatedAt: now,
        });
        await this.store.createCampaign(record);
        await this.appendCampaignEvent(record, actor, idempotencyKey, 'campaign.created', {
          status: record.status,
        });
        return record;
      },
    );
  }

  async getCampaign(id: string): Promise<Campaign> {
    const campaign = await this.store.getCampaign(id);
    if (!campaign) throw new DomainError('CAMPAIGN_NOT_FOUND', `Campaign ${id} was not found`);
    return campaign;
  }

  listCampaigns(projectId?: string): Promise<Campaign[]> {
    return this.store.listCampaigns(projectId);
  }

  async listArtifacts(projectId: string): Promise<ArtifactRecord[]> {
    await this.getProject(projectId);
    return this.store.listArtifacts(projectId);
  }

  async listEvidence(campaignId: string): Promise<EvidenceRecord[]> {
    await this.getCampaign(campaignId);
    return this.store.listEvidence(campaignId);
  }

  async listVerificationReports(campaignId: string): Promise<VerificationReport[]> {
    await this.getCampaign(campaignId);
    return this.store.listVerificationReports(campaignId);
  }

  async listReproducibilityBundles(campaignId: string): Promise<ReproducibilityBundleManifest[]> {
    await this.getCampaign(campaignId);
    return this.store.listReproducibilityBundles(campaignId);
  }

  async transitionCampaign(
    id: string,
    body: unknown,
    actor: Actor,
    idempotencyKey: string,
    expectedVersion: number,
  ): Promise<Campaign> {
    const input = TransitionRequestSchema.parse(body);
    return this.store.idempotent(
      `campaign:transition:${id}:${actor.id}`,
      idempotencyKey,
      { expectedVersion, ...input },
      async () => {
        const current = await this.getCampaign(id);
        if (input.to === 'RUNNING' && current.status === 'PAUSED' && current.resumeStatus) {
          const resumed = {
            ...current,
            status: current.resumeStatus,
            resumeStatus: null,
            stateVersion: current.stateVersion + 1,
            updatedAt: new Date().toISOString(),
          } satisfies Campaign;
          await this.store.updateCampaign(id, expectedVersion, resumed);
          await this.appendCampaignEvent(resumed, actor, idempotencyKey, 'campaign.resumed', {
            from: current.status,
            to: resumed.status,
            reason: input.reason,
          });
          return resumed;
        }

        const result = transitionCampaign(current, {
          to: input.to,
          actor,
          predicates: input.predicates,
          reason: input.reason,
          occurredAt: new Date().toISOString(),
        });
        await this.store.updateCampaign(id, expectedVersion, result.campaign);
        await this.appendCampaignEvent(
          result.campaign,
          actor,
          idempotencyKey,
          result.evidenceType,
          {
            from: current.status,
            to: result.campaign.status,
            reason: input.reason,
            invalidates: result.invalidates,
          },
        );
        return result.campaign;
      },
    );
  }

  async listEvents(campaignId: string): Promise<DomainEvent[]> {
    await this.getCampaign(campaignId);
    return this.store.listEvents(campaignId);
  }

  eventStore(): ControlStore {
    return this.store;
  }

  async createApprovalRequest(
    campaignId: string,
    body: unknown,
    actor: Actor,
    idempotencyKey: string,
  ): Promise<ApprovalRequestRecord> {
    const input = ApprovalRequestInputSchema.parse(body);
    const campaign = await this.getCampaign(campaignId);
    return this.store.idempotent(
      `approval:create:${campaignId}:${actor.id}`,
      idempotencyKey,
      input,
      async () => {
        const action = ProposedActionSchema.parse({
          contractVersion: '1.0',
          actionId: this.store.nextId('act'),
          organizationId: campaign.organizationId,
          projectId: campaign.projectId,
          campaignId,
          kind: input.kind,
          riskTier: classifyAction(input.kind),
          parameters: input.parameters,
          requestedBy: actor,
          requestedAt: new Date().toISOString(),
        });
        const record: ApprovalRequestRecord = {
          id: this.store.nextId('aprq'),
          action,
          actionDigest: digestAction(action),
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        };
        await this.store.createApprovalRequest(record);
        return record;
      },
    );
  }

  async decideApproval(
    requestId: string,
    body: unknown,
    actor: Actor,
    idempotencyKey: string,
  ): Promise<ApprovalArtifact> {
    const input = ApprovalDecisionSchema.parse(body);
    if (
      ![
        'RESEARCHER',
        'SCIENTIFIC_REVIEWER',
        'ORGANIZATION_ADMIN',
        'INFRASTRUCTURE_OPERATOR',
      ].includes(actor.role)
    ) {
      throw new DomainError('HUMAN_APPROVAL_REQUIRED', 'A human authority must decide approval');
    }
    return this.store.idempotent(
      `approval:decide:${requestId}:${actor.id}`,
      idempotencyKey,
      input,
      async () => {
        const request = await this.store.getApprovalRequest(requestId);
        if (!request) {
          throw new DomainError(
            'APPROVAL_REQUEST_NOT_FOUND',
            `Approval request ${requestId} was not found`,
          );
        }
        if (request.status !== 'PENDING') {
          throw new DomainError(
            'APPROVAL_ALREADY_CONSUMED',
            'Approval request was already decided',
          );
        }
        const artifact = ApprovalArtifactSchema.parse({
          contractVersion: '1.0',
          approvalId: this.store.nextId('apr'),
          organizationId: request.action.organizationId,
          projectId: request.action.projectId,
          actionDigest: request.actionDigest,
          policyVersion: input.policyVersion,
          decision: input.decision,
          decidedBy: actor,
          decidedAt: new Date().toISOString(),
          expiresAt: input.expiresAt,
          singleUse: true,
          consumedAt: null,
          reason: input.reason,
        });
        await this.store.updateApprovalRequest({
          ...request,
          status: 'DECIDED',
          approval: artifact,
        });
        if (
          input.decision === 'APPROVED' &&
          request.action.requestedBy.id === 'reference-workflow-worker' &&
          request.action.campaignId
        ) {
          await this.resumeReferenceRun(request.action.campaignId, artifact, idempotencyKey);
        }
        return artifact;
      },
    );
  }

  listApprovalRequests(campaignId?: string): Promise<ApprovalRequestRecord[]> {
    return this.store.listApprovalRequests(campaignId);
  }

  async startReferenceRun(id: string, actor: Actor, idempotencyKey: string) {
    const current = await this.getCampaign(id);
    if (current.status !== 'READY') {
      throw new DomainError('CAMPAIGN_NOT_READY', 'A reference run can only start from READY');
    }
    const target = await this.store.getTarget(current.targetVersionId);
    if (!target)
      throw new DomainError('TARGET_VERSION_NOT_FOUND', 'Campaign Target is unavailable');
    const running = await this.transitionCampaign(
      id,
      {
        to: 'RUNNING',
        predicates: { budgetReserved: true },
        reason: 'Launch local reference workflow.',
      },
      actor,
      `${idempotencyKey}:launch`,
      current.stateVersion,
    );
    const snapshot = await this.callReferenceWorker({
      campaign: running,
      target,
      researcher: actor,
    });
    if (!snapshot.proposedAction || snapshot.campaign.status !== 'WAITING_FOR_APPROVAL') {
      throw new DomainError(
        'WORKER_PROTOCOL_INVALID',
        'Reference worker did not produce an approval-gated action',
      );
    }
    const approval = await this.importWorkerApprovalRequest(snapshot.proposedAction);
    const waiting = await this.transitionCampaign(
      id,
      { to: 'WAITING_FOR_APPROVAL', reason: 'Reference experiment requires exact human approval.' },
      { type: 'SERVICE', id: 'reference-workflow-worker', role: 'SYSTEM_SERVICE' },
      `${idempotencyKey}:approval`,
      running.stateVersion,
    );
    return { campaign: waiting, approval, workflowStatus: snapshot.campaign.status };
  }

  private async importWorkerApprovalRequest(action: import('@alphalab/contracts').ProposedAction) {
    const existing = (await this.store.listApprovalRequests(action.campaignId)).find(
      (request) => request.actionDigest === digestAction(action),
    );
    if (existing) return existing;
    const record: ApprovalRequestRecord = {
      id: this.store.nextId('aprq'),
      action,
      actionDigest: digestAction(action),
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    await this.store.createApprovalRequest(record);
    return record;
  }

  private async resumeReferenceRun(
    campaignId: string,
    approval: ApprovalArtifact,
    idempotencyKey: string,
  ): Promise<void> {
    const waiting = await this.getCampaign(campaignId);
    if (waiting.status !== 'WAITING_FOR_APPROVAL') return;
    const target = await this.store.getTarget(waiting.targetVersionId);
    if (!target)
      throw new DomainError('TARGET_VERSION_NOT_FOUND', 'Campaign Target is unavailable');
    const snapshot = await this.callReferenceWorker({
      campaign: waiting,
      target,
      researcher: { type: 'USER', id: 'reference-run-resumer', role: 'RESEARCHER' },
      approval,
    });
    if (
      snapshot.campaign.status !== 'DISCOVERY_CANDIDATE' ||
      !snapshot.verificationReport ||
      !snapshot.hypothesis ||
      !snapshot.plan ||
      !snapshot.bundle ||
      snapshot.results.length === 0
    ) {
      throw new DomainError(
        'WORKER_PROTOCOL_INVALID',
        'Reference worker did not return complete scientific lineage',
      );
    }
    const serviceActor: Actor = {
      type: 'SERVICE',
      id: 'reference-workflow-worker',
      role: 'SYSTEM_SERVICE',
    };
    const scheduled = await this.transitionCampaign(
      campaignId,
      {
        to: 'RUNNING_EXPERIMENT',
        predicates: { approvalValid: true, budgetReserved: true },
        reason: 'Exact approval accepted by reference workflow.',
      },
      serviceActor,
      `${idempotencyKey}:schedule`,
      waiting.stateVersion,
    );
    const verifying = await this.transitionCampaign(
      campaignId,
      {
        to: 'VERIFYING',
        predicates: { executionCompleted: true },
        reason: 'Reference experiment completed.',
      },
      serviceActor,
      `${idempotencyKey}:verify`,
      scheduled.stateVersion,
    );
    const candidate = await this.transitionCampaign(
      campaignId,
      {
        to: 'DISCOVERY_CANDIDATE',
        predicates: { provenanceComplete: true, verificationPassed: true },
        reason: 'Reference verification predicates passed; reviewer acceptance remains required.',
      },
      serviceActor,
      `${idempotencyKey}:candidate`,
      verifying.stateVersion,
    );
    await this.store.updateCampaign(candidate.id, candidate.stateVersion, {
      ...candidate,
      budgetUsage: snapshot.campaign.budgetUsage,
      budgetVersion: candidate.budgetVersion + 1,
      updatedAt: new Date().toISOString(),
    });
    const lineage = await this.persistReferenceLineage(snapshot);
    await this.appendCampaignEvent(
      candidate,
      serviceActor,
      `${idempotencyKey}:evidence`,
      'evidence.lineage.recorded',
      {
        evidenceIds: lineage.evidenceIds,
        artifactDigests: lineage.artifactDigests,
        verificationReportId: snapshot.verificationReport.reportId,
      },
    );
    await this.appendCampaignEvent(
      candidate,
      serviceActor,
      `${idempotencyKey}:bundle`,
      'bundle.exported',
      {
        bundleId: snapshot.bundle.bundleId,
        manifestDigest: snapshot.bundle.manifestDigest,
        verificationReportId: snapshot.verificationReport.reportId,
        verificationStatus: snapshot.verificationReport.status,
      },
    );
  }

  private async persistReferenceLineage(snapshot: z.infer<typeof WorkerSnapshotSchema>): Promise<{
    evidenceIds: string[];
    artifactDigests: string[];
  }> {
    const { campaign, hypothesis, plan, results, verificationReport, bundle, runId } = snapshot;
    if (!hypothesis || !plan || !verificationReport || !bundle || results.length === 0) {
      throw new DomainError('WORKER_PROTOCOL_INVALID', 'Scientific lineage is incomplete');
    }

    const artifacts = results.flatMap((result) => result.artifacts).map((artifact) =>
      ArtifactReferenceSchema.parse(artifact),
    );
    for (const artifact of artifacts) {
      await this.store.createArtifact({
        artifact,
        organizationId: campaign.organizationId,
        projectId: campaign.projectId,
        storageKey: `reference-workflow/${campaign.id}/objects/${artifact.digest.slice(7)}`,
        provenance: {
          campaignId: campaign.id,
          runId,
          targetVersionId: campaign.targetVersionId,
          modelId: 'reference-local-worker-model-v1',
          executorId: plan.executorId,
          imageDigest: plan.imageDigest,
          imageReference: plan.imageReference,
          artifactDigest: artifact.digest,
        },
        createdAt: bundle.createdAt,
      });
    }

    const firstResult = results[0]!;
    const measurementSummary = firstResult.measurements
      .map((measurement) => `${measurement.name}=${String(measurement.value)}${measurement.unit ?? ''}`)
      .join(', ');
    const evidence = [
      EvidenceRecordSchema.parse({
        contractVersion: '1.0',
        evidenceId: `evi_${runId}_hypothesis`,
        organizationId: campaign.organizationId,
        projectId: campaign.projectId,
        campaignId: campaign.id,
        runId,
        targetVersionId: campaign.targetVersionId,
        type: 'HYPOTHESIS',
        status: 'PROPOSED',
        statement: hypothesis.statement,
        artifacts: [],
        supportsClaimIds: [],
        contradictsClaimIds: [],
        sourcePointers: [`workflow:${snapshot.workflowId}`, `hypothesis:${hypothesis.hypothesisId}`],
        createdAt: hypothesis.createdAt,
      }),
      EvidenceRecordSchema.parse({
        contractVersion: '1.0',
        evidenceId: `evi_${runId}_observation`,
        organizationId: campaign.organizationId,
        projectId: campaign.projectId,
        campaignId: campaign.id,
        runId,
        targetVersionId: campaign.targetVersionId,
        type: 'OBSERVATION',
        status: 'OBSERVED',
        statement: `Reference experiment completed: ${measurementSummary}.`,
        artifacts,
        supportsClaimIds: [],
        contradictsClaimIds: [],
        sourcePointers: [
          `experiment-run:${firstResult.experimentRunId}`,
          `invocation:${firstResult.invocationId}`,
        ],
        createdAt: firstResult.completedAt,
      }),
      EvidenceRecordSchema.parse({
        contractVersion: '1.0',
        evidenceId: `evi_${runId}_reproducible`,
        organizationId: campaign.organizationId,
        projectId: campaign.projectId,
        campaignId: campaign.id,
        runId,
        targetVersionId: campaign.targetVersionId,
        type: 'REPRODUCIBLE_EVIDENCE',
        status: 'REPRODUCED',
        statement: `The deterministic reference result is bound to environment ${firstResult.environmentDigest}.`,
        artifacts,
        supportsClaimIds: [],
        contradictsClaimIds: [],
        sourcePointers: [
          `verification-report:${verificationReport.reportId}`,
          `bundle:${bundle.bundleId}`,
        ],
        createdAt: verificationReport.createdAt,
      }),
      EvidenceRecordSchema.parse({
        contractVersion: '1.0',
        evidenceId: `evi_${runId}_candidate`,
        organizationId: campaign.organizationId,
        projectId: campaign.projectId,
        campaignId: campaign.id,
        runId,
        targetVersionId: campaign.targetVersionId,
        type: 'VERIFIED_DISCOVERY_CANDIDATE',
        status: 'REPRODUCED',
        statement: `${hypothesis.statement} Automated policy predicates passed; independent reviewer acceptance remains required.`,
        artifacts,
        supportsClaimIds: [],
        contradictsClaimIds: [],
        sourcePointers: [
          `verification-report:${verificationReport.reportId}`,
          `bundle:${bundle.bundleId}`,
        ],
        createdAt: verificationReport.createdAt,
      }),
    ];
    for (const record of evidence) await this.store.createEvidence(record);
    await this.store.createVerificationReport(verificationReport);
    await this.store.createReproducibilityBundle(bundle);
    return {
      evidenceIds: evidence.map((record) => record.evidenceId),
      artifactDigests: artifacts.map((artifact) => artifact.digest),
    };
  }

  private async callReferenceWorker(input: unknown): Promise<z.infer<typeof WorkerSnapshotSchema>> {
    const origin = process.env.ALPHALAB_WORKER_ORIGIN ?? 'http://127.0.0.1:4311';
    const response = await fetch(`${origin.replace(/\/$/, '')}/v1/reference-runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new DomainError('WORKER_UNAVAILABLE', 'Reference worker request failed', {
        status: response.status,
        payload,
      });
    }
    return WorkerSnapshotSchema.parse(payload);
  }

  private async requireProject(projectId: string, organizationId: string): Promise<ProjectRecord> {
    const project = await this.store.getProject(projectId);
    if (!project || project.organizationId !== organizationId) {
      throw new DomainError(
        'PROJECT_NOT_FOUND',
        `Project ${projectId} was not found in the organization`,
      );
    }
    return project;
  }

  private async appendCampaignEvent(
    campaign: Campaign,
    actor: Actor,
    idempotencyKey: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event = DomainEventSchema.parse({
      contractVersion: '1.0',
      eventId: this.store.nextId('evt'),
      eventType,
      organizationId: campaign.organizationId,
      projectId: campaign.projectId,
      campaignId: campaign.id,
      targetVersionId: campaign.targetVersionId,
      correlationId: campaign.id,
      causationId: idempotencyKey,
      idempotencyKey,
      actor,
      occurredAt: new Date().toISOString(),
      payload,
    });
    await this.store.appendEvent(event);
  }
}
