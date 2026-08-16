import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ApprovalArtifactSchema,
  ArtifactReferenceSchema,
  BudgetLimitSchema,
  CampaignSchema,
  CampaignWorkflowRecordSchema,
  DatasetVersionSchema,
  DEFAULT_REFERENCE_RUNTIME_POLICY,
  DomainEventSchema,
  DEFAULT_EXECUTION_CONTROL_FLAGS,
  EvidenceRecordSchema,
  ExecutionControlSchema,
  ExecutionControlUpdateSchema,
  ExperimentPlanSchema,
  ExperimentResultSchema,
  HypothesisSchema,
  ProjectMemberGrantSchema,
  ProposedActionSchema,
  ReproducibilityBundleManifestSchema,
  TargetVersionSchema,
  TransitionPredicateSchema,
  VerificationReportSchema,
  type Actor,
  type ApprovalArtifact,
  type Campaign,
  type CampaignWorkflowRecord,
  type DatasetVersion,
  type DomainEvent,
  type EvidenceRecord,
  type ExecutionControl,
  type ProjectMember,
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
  datasetVersionIds: z.array(z.string().min(3)).default([]),
  permittedModelIds: z
    .array(z.string().min(3))
    .min(1)
    .default([...DEFAULT_REFERENCE_RUNTIME_POLICY.permittedModelIds]),
  permittedToolIds: z
    .array(z.string().min(3))
    .min(1)
    .default([...DEFAULT_REFERENCE_RUNTIME_POLICY.permittedToolIds]),
  fallbackMode: z
    .enum(['STOP', 'APPROVED_ONLY'])
    .default(DEFAULT_REFERENCE_RUNTIME_POLICY.fallbackMode),
  approvedFallbackModelIds: z.array(z.string().min(3)).default([]),
  budgetLimit: BudgetLimitSchema,
});

const CreateDatasetSchema = DatasetVersionSchema.omit({
  contractVersion: true,
  datasetVersionId: true,
  datasetId: true,
  version: true,
  createdAt: true,
  createdBy: true,
}).extend({ datasetId: z.string().min(3).optional() });

const CreateCampaignEvidenceSchema = z.object({
  type: z
    .enum(['INTENT', 'HYPOTHESIS', 'OBSERVATION', 'OPERATIONAL_EVIDENCE'])
    .default('OBSERVATION'),
  statement: z.string().min(1).max(16_000),
  sourcePointers: z.array(z.string().min(1).max(4_000)).min(1).max(64),
  supportsClaimIds: z.array(z.string().min(3)).max(64).default([]),
  contradictsClaimIds: z.array(z.string().min(3)).max(64).default([]),
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

const UpdateExecutionControlSchema = ExecutionControlUpdateSchema.refine(
  (value) => Object.keys(value).length > 0,
  'At least one execution control must be provided',
);

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

  async getProject(id: string, actor?: Actor): Promise<ProjectRecord> {
    const project = await this.store.getProject(id);
    if (!project) throw new DomainError('PROJECT_NOT_FOUND', `Project ${id} was not found`);
    if (actor) await this.assertProjectPermission(project.id, actor, 'READ');
    return project;
  }

  async listProjects(actor: Actor, organizationId?: string): Promise<ProjectRecord[]> {
    const projects = await this.store.listProjects(organizationId);
    const visible = await Promise.all(
      projects.map(async (project) =>
        (await this.hasProjectPermission(project, actor, 'READ')) ? project : undefined,
      ),
    );
    return visible.filter((project): project is ProjectRecord => Boolean(project));
  }

  async getExecutionControl(organizationId: string): Promise<ExecutionControl> {
    return (
      (await this.store.getExecutionControl(organizationId)) ??
      ExecutionControlSchema.parse({
        contractVersion: '1.0',
        organizationId,
        version: 0,
        ...DEFAULT_EXECUTION_CONTROL_FLAGS,
        updatedAt: '1970-01-01T00:00:00.000Z',
        updatedBy: 'system-default',
      })
    );
  }

  async updateExecutionControl(
    organizationId: string,
    body: unknown,
    actor: Actor,
    idempotencyKey: string,
    expectedVersion: number,
  ): Promise<ExecutionControl> {
    if (actor.role !== 'ORGANIZATION_ADMIN') {
      throw new DomainError(
        'ORGANIZATION_ADMIN_REQUIRED',
        'Only an organization administrator may change emergency execution controls',
      );
    }
    const input = UpdateExecutionControlSchema.parse(body);
    return this.store.idempotent(
      `execution-control:update:${organizationId}:${actor.id}`,
      idempotencyKey,
      { expectedVersion, input },
      async () => {
        const current = await this.getExecutionControl(organizationId);
        if (current.version !== expectedVersion) {
          throw new DomainError('CONTROL_VERSION_CONFLICT', 'Execution control version changed', {
            expectedVersion,
            actualVersion: current.version,
          });
        }
        const next = ExecutionControlSchema.parse({
          ...current,
          ...input,
          version: current.version + 1,
          updatedAt: new Date().toISOString(),
          updatedBy: actor.id,
        });
        await this.store.saveExecutionControl(next, expectedVersion);
        return next;
      },
    );
  }

  async createProject(body: unknown, actor: Actor, idempotencyKey: string): Promise<ProjectRecord> {
    const input = CreateProjectSchema.parse(body);
    await this.assertEvidenceMutable(input.organizationId);
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
        await this.store.createProjectMember({
          contractVersion: '1.0',
          projectId: record.id,
          organizationId: record.organizationId,
          actorId: actor.id,
          role: 'OWNER',
          createdAt: record.createdAt,
          createdBy: actor.id,
        });
        await this.store.createProjectMember({
          contractVersion: '1.0',
          projectId: record.id,
          organizationId: record.organizationId,
          actorId: 'local-scientific-reviewer',
          role: 'SCIENTIFIC_REVIEWER',
          createdAt: record.createdAt,
          createdBy: 'system-local-bootstrap',
        });
        return record;
      },
    );
  }

  async listProjectMembers(projectId: string, actor: Actor): Promise<ProjectMember[]> {
    await this.getProject(projectId, actor);
    return this.store.listProjectMembers(projectId);
  }

  async grantProjectMember(
    projectId: string,
    body: unknown,
    actor: Actor,
    idempotencyKey: string,
  ): Promise<ProjectMember> {
    const input = ProjectMemberGrantSchema.parse(body);
    const project = await this.getProject(projectId);
    await this.assertProjectOwner(project, actor);
    return this.store.idempotent(
      `project-member:grant:${projectId}:${actor.id}`,
      idempotencyKey,
      input,
      async () => {
        const member = {
          contractVersion: '1.0',
          projectId,
          organizationId: project.organizationId,
          actorId: input.actorId,
          role: input.role,
          createdAt: new Date().toISOString(),
          createdBy: actor.id,
        } satisfies ProjectMember;
        await this.store.createProjectMember(member);
        return member;
      },
    );
  }

  async createTarget(body: unknown, actor: Actor, idempotencyKey: string): Promise<TargetVersion> {
    const input = CreateTargetSchema.parse(body);
    await this.assertEvidenceMutable(input.organizationId);
    await this.requireProject(input.projectId, input.organizationId);
    await this.assertProjectPermission(input.projectId, actor, 'WRITE');
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

  async listTargets(projectId: string | undefined, actor: Actor): Promise<TargetVersion[]> {
    if (projectId) {
      await this.getProject(projectId, actor);
      return this.store.listTargets(projectId);
    }
    const targets = await this.store.listTargets();
    const visible = await Promise.all(
      targets.map(async (target) =>
        (await this.hasProjectPermissionById(target.projectId, actor, 'READ')) ? target : undefined,
      ),
    );
    return visible.filter((target): target is TargetVersion => Boolean(target));
  }

  async createDataset(
    body: unknown,
    actor: Actor,
    idempotencyKey: string,
  ): Promise<DatasetVersion> {
    const input = CreateDatasetSchema.parse(body);
    await this.assertEvidenceMutable(input.organizationId);
    await this.requireProject(input.projectId, input.organizationId);
    await this.assertProjectPermission(input.projectId, actor, 'WRITE');
    return this.store.idempotent(
      `dataset:create:${input.organizationId}:${input.projectId}:${actor.id}`,
      idempotencyKey,
      input,
      async () => {
        const datasetId = input.datasetId ?? this.store.nextId('dst');
        const priorVersions = await this.store.listDatasets(undefined, datasetId);
        const record = DatasetVersionSchema.parse({
          contractVersion: '1.0',
          ...input,
          datasetVersionId: this.store.nextId('dsv'),
          datasetId,
          version: priorVersions.length + 1,
          createdAt: new Date().toISOString(),
          createdBy: actor.id,
        });
        await this.store.createDataset(record);
        return record;
      },
    );
  }

  async listDatasets(projectId: string | undefined, actor: Actor): Promise<DatasetVersion[]> {
    if (projectId) {
      await this.getProject(projectId, actor);
      return this.store.listDatasets(projectId);
    }
    const datasets = await this.store.listDatasets();
    const visible = await Promise.all(
      datasets.map(async (dataset) =>
        (await this.hasProjectPermissionById(dataset.projectId, actor, 'READ'))
          ? dataset
          : undefined,
      ),
    );
    return visible.filter((dataset): dataset is DatasetVersion => Boolean(dataset));
  }

  async createCampaign(body: unknown, actor: Actor, idempotencyKey: string): Promise<Campaign> {
    const input = CreateCampaignSchema.parse(body);
    await this.assertEvidenceMutable(input.organizationId);
    await this.requireProject(input.projectId, input.organizationId);
    await this.assertProjectPermission(input.projectId, actor, 'WRITE');
    const target = await this.store.getTarget(input.targetVersionId);
    if (!target || target.projectId !== input.projectId) {
      throw new DomainError(
        'TARGET_VERSION_NOT_FOUND',
        `Target version ${input.targetVersionId} was not found in the project`,
      );
    }
    const datasets = await Promise.all(
      input.datasetVersionIds.map((datasetVersionId) => this.store.getDataset(datasetVersionId)),
    );
    if (datasets.some((dataset) => !dataset || dataset.projectId !== input.projectId)) {
      throw new DomainError(
        'DATASET_VERSION_NOT_FOUND',
        'Every campaign dataset must be an immutable version in the project',
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

  async getCampaign(id: string, actor?: Actor): Promise<Campaign> {
    const campaign = await this.store.getCampaign(id);
    if (!campaign) throw new DomainError('CAMPAIGN_NOT_FOUND', `Campaign ${id} was not found`);
    if (actor) await this.assertProjectPermission(campaign.projectId, actor, 'READ');
    return campaign;
  }

  async listCampaigns(projectId: string | undefined, actor: Actor): Promise<Campaign[]> {
    if (projectId) {
      await this.getProject(projectId, actor);
      return this.store.listCampaigns(projectId);
    }
    const campaigns = await this.store.listCampaigns();
    const visible = await Promise.all(
      campaigns.map(async (campaign) =>
        (await this.hasProjectPermissionById(campaign.projectId, actor, 'READ'))
          ? campaign
          : undefined,
      ),
    );
    return visible.filter((campaign): campaign is Campaign => Boolean(campaign));
  }

  async listArtifacts(projectId: string, actor: Actor): Promise<ArtifactRecord[]> {
    await this.getProject(projectId, actor);
    return this.store.listArtifacts(projectId);
  }

  async getArtifactBytes(
    projectId: string,
    digest: string,
    actor: Actor,
  ): Promise<{
    artifact: ArtifactRecord['artifact'];
    bytes: Buffer;
  }> {
    const artifact = (await this.listArtifacts(projectId, actor)).find(
      (record) => record.artifact.digest === digest,
    );
    if (!artifact) {
      throw new DomainError(
        'ARTIFACT_NOT_FOUND',
        `Artifact ${digest} was not found in the project`,
      );
    }
    const origin = process.env.ALPHALAB_WORKER_ORIGIN ?? 'http://127.0.0.1:4311';
    let response: Response;
    try {
      response = await fetch(
        `${origin.replace(/\/$/, '')}/v1/artifacts/${encodeURIComponent(digest)}`,
        { signal: AbortSignal.timeout(30_000) },
      );
    } catch {
      throw new DomainError(
        'ARTIFACT_CONTENT_UNAVAILABLE',
        'The artifact store could not be reached',
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      throw new DomainError(
        'ARTIFACT_CONTENT_UNAVAILABLE',
        'The artifact store could not retrieve bytes',
      );
    }
    const receivedDigest = response.headers.get('x-content-digest');
    const calculatedDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (
      receivedDigest !== digest ||
      calculatedDigest !== digest ||
      bytes.byteLength !== artifact.artifact.sizeBytes
    ) {
      throw new DomainError(
        'ARTIFACT_INTEGRITY_FAILED',
        'Artifact retrieval integrity checks failed',
      );
    }
    return { artifact: artifact.artifact, bytes };
  }

  async listEvidence(campaignId: string, actor: Actor): Promise<EvidenceRecord[]> {
    await this.getCampaign(campaignId, actor);
    return this.store.listEvidence(campaignId);
  }

  async createCampaignEvidence(
    campaignId: string,
    body: unknown,
    actor: Actor,
    idempotencyKey: string,
  ): Promise<EvidenceRecord> {
    const input = CreateCampaignEvidenceSchema.parse(body);
    const campaign = await this.getCampaign(campaignId, actor);
    await this.assertEvidenceMutable(campaign.organizationId);
    await this.assertProjectPermission(campaign.projectId, actor, 'WRITE');
    return this.store.idempotent(
      `campaign:evidence:${campaignId}:${actor.id}`,
      idempotencyKey,
      input,
      async () => {
        const createdAt = new Date().toISOString();
        const record = EvidenceRecordSchema.parse({
          contractVersion: '1.0',
          evidenceId: this.store.nextId('evi'),
          organizationId: campaign.organizationId,
          projectId: campaign.projectId,
          campaignId: campaign.id,
          runId: this.store.nextId('intake'),
          targetVersionId: campaign.targetVersionId,
          type: input.type,
          status: input.type === 'INTENT' || input.type === 'HYPOTHESIS' ? 'PROPOSED' : 'OBSERVED',
          statement: input.statement,
          artifacts: [],
          supportsClaimIds: input.supportsClaimIds,
          contradictsClaimIds: input.contradictsClaimIds,
          sourcePointers: input.sourcePointers,
          createdAt,
        });
        await this.store.createEvidence(record);
        await this.appendCampaignEvent(
          campaign,
          actor,
          idempotencyKey,
          'evidence.intake.recorded',
          {
            evidenceId: record.evidenceId,
            type: record.type,
            sourcePointers: record.sourcePointers,
          },
        );
        return record;
      },
    );
  }

  async listVerificationReports(campaignId: string, actor: Actor): Promise<VerificationReport[]> {
    await this.getCampaign(campaignId, actor);
    return this.store.listVerificationReports(campaignId);
  }

  async listReproducibilityBundles(
    campaignId: string,
    actor: Actor,
  ): Promise<ReproducibilityBundleManifest[]> {
    await this.getCampaign(campaignId, actor);
    return this.store.listReproducibilityBundles(campaignId);
  }

  async getWorkflowRecord(campaignId: string, actor: Actor): Promise<CampaignWorkflowRecord> {
    const campaign = await this.getCampaign(campaignId, actor);
    const origin = process.env.ALPHALAB_WORKER_ORIGIN ?? 'http://127.0.0.1:4311';
    let response: Response;
    try {
      response = await fetch(
        `${origin.replace(/\/$/, '')}/v1/reference-runs/${encodeURIComponent(campaignId)}`,
        { signal: AbortSignal.timeout(15_000) },
      );
    } catch {
      throw new DomainError(
        'WORKFLOW_RECORD_UNAVAILABLE',
        'The workflow store could not be reached',
      );
    }
    if (response.status === 404) {
      throw new DomainError(
        'WORKFLOW_RECORD_NOT_FOUND',
        'No durable reference workflow record exists for this campaign',
      );
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new DomainError(
        'WORKFLOW_RECORD_UNAVAILABLE',
        'The workflow record could not be read',
        {
          status: response.status,
        },
      );
    }
    const record = CampaignWorkflowRecordSchema.parse(payload);
    if (
      record.campaign.id !== campaign.id ||
      record.campaign.projectId !== campaign.projectId ||
      record.campaign.organizationId !== campaign.organizationId
    ) {
      throw new DomainError(
        'WORKER_PROTOCOL_INVALID',
        'Workflow record did not match the campaign',
      );
    }
    return record;
  }

  async transitionCampaign(
    id: string,
    body: unknown,
    actor: Actor,
    idempotencyKey: string,
    expectedVersion: number,
  ): Promise<Campaign> {
    const input = TransitionRequestSchema.parse(body);
    const currentCampaign = await this.getCampaign(id);
    await this.assertProjectPermission(
      currentCampaign.projectId,
      actor,
      input.to === 'VERIFIED' ? 'REVIEW' : 'WRITE',
    );
    const control = await this.getExecutionControl(currentCampaign.organizationId);
    if (control.evidenceReadOnly) {
      throw new DomainError(
        'EVIDENCE_PRESERVATION_MODE',
        'State transitions are disabled while evidence preservation mode is active',
      );
    }
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

  async listEvents(campaignId: string, actor: Actor): Promise<DomainEvent[]> {
    await this.getCampaign(campaignId, actor);
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
    await this.assertProjectPermission(campaign.projectId, actor, 'WRITE');
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
    const pending = await this.store.getApprovalRequest(requestId);
    if (pending) await this.assertProjectPermission(pending.action.projectId, actor, 'REVIEW');
    if (
      input.decision === 'APPROVED' &&
      pending?.action.requestedBy.id === 'reference-workflow-worker' &&
      pending.action.campaignId
    ) {
      await this.assertReferenceWorkflowEnabled(pending.action.organizationId);
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

  async listApprovalRequests(
    campaignId: string | undefined,
    actor: Actor,
  ): Promise<ApprovalRequestRecord[]> {
    if (campaignId) {
      await this.getCampaign(campaignId, actor);
      return this.store.listApprovalRequests(campaignId);
    }
    const requests = await this.store.listApprovalRequests();
    const visible = await Promise.all(
      requests.map(async (request) =>
        (await this.hasProjectPermissionById(request.action.projectId, actor, 'READ'))
          ? request
          : undefined,
      ),
    );
    return visible.filter((request): request is ApprovalRequestRecord => Boolean(request));
  }

  async startReferenceRun(id: string, actor: Actor, idempotencyKey: string) {
    const current = await this.getCampaign(id);
    await this.assertProjectPermission(current.projectId, actor, 'WRITE');
    await this.assertReferenceWorkflowEnabled(current.organizationId);
    this.assertReferenceRuntimePolicy(current);
    if (current.status !== 'READY') {
      throw new DomainError('CAMPAIGN_NOT_READY', 'A reference run can only start from READY');
    }
    const target = await this.store.getTarget(current.targetVersionId);
    if (!target)
      throw new DomainError('TARGET_VERSION_NOT_FOUND', 'Campaign Target is unavailable');
    if (current.datasetVersionIds.length === 0) {
      throw new DomainError(
        'DATASET_REQUIRED',
        'The local reference workflow requires a pinned dataset version',
      );
    }
    const datasets = await Promise.all(
      current.datasetVersionIds.map((datasetVersionId) => this.store.getDataset(datasetVersionId)),
    );
    if (datasets.some((dataset) => !dataset)) {
      throw new DomainError('DATASET_VERSION_NOT_FOUND', 'Campaign dataset version is unavailable');
    }
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
      datasets,
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
    await this.assertReferenceWorkflowEnabled(waiting.organizationId);
    if (waiting.status !== 'WAITING_FOR_APPROVAL') return;
    const target = await this.store.getTarget(waiting.targetVersionId);
    if (!target)
      throw new DomainError('TARGET_VERSION_NOT_FOUND', 'Campaign Target is unavailable');
    const datasets = await Promise.all(
      waiting.datasetVersionIds.map((datasetVersionId) => this.store.getDataset(datasetVersionId)),
    );
    if (datasets.length === 0 || datasets.some((dataset) => !dataset)) {
      throw new DomainError('DATASET_VERSION_NOT_FOUND', 'Campaign dataset version is unavailable');
    }
    const snapshot = await this.callReferenceWorker({
      campaign: waiting,
      target,
      datasets,
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

    const firstResult = results[0]!;
    const artifacts = results
      .flatMap((result) => result.artifacts)
      .map((artifact) => ArtifactReferenceSchema.parse(artifact));
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
          domainModel: firstResult.modelProvenance,
          executionProvenance: firstResult.executionProvenance,
          executorId: plan.executorId,
          imageDigest: plan.imageDigest,
          imageReference: plan.imageReference,
          artifactDigest: artifact.digest,
        },
        createdAt: bundle.createdAt,
      });
    }

    const measurementSummary = firstResult.measurements
      .map(
        (measurement) =>
          `${measurement.name}=${String(measurement.value)}${measurement.unit ?? ''}`,
      )
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
        sourcePointers: [
          `workflow:${snapshot.workflowId}`,
          `hypothesis:${hypothesis.hypothesisId}`,
        ],
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

  private async assertEvidenceMutable(organizationId: string): Promise<void> {
    const control = await this.getExecutionControl(organizationId);
    if (control.evidenceReadOnly) {
      throw new DomainError(
        'EVIDENCE_PRESERVATION_MODE',
        'New mutable work is disabled while evidence preservation mode is active',
      );
    }
  }

  private async assertProjectPermission(
    projectId: string,
    actor: Actor,
    permission: 'READ' | 'WRITE' | 'REVIEW',
  ): Promise<void> {
    if (!(await this.hasProjectPermissionById(projectId, actor, permission))) {
      throw new DomainError('ACTOR_NOT_AUTHORIZED', 'Actor lacks the required project membership');
    }
  }

  private async assertProjectOwner(project: ProjectRecord, actor: Actor): Promise<void> {
    if (actor.role === 'SYSTEM_SERVICE') return;
    const member = await this.store.getProjectMember(project.id, actor.id);
    if (member?.organizationId !== project.organizationId || member.role !== 'OWNER') {
      throw new DomainError('ACTOR_NOT_AUTHORIZED', 'Only a project owner may manage membership');
    }
  }

  private async hasProjectPermissionById(
    projectId: string,
    actor: Actor,
    permission: 'READ' | 'WRITE' | 'REVIEW',
  ): Promise<boolean> {
    const project = await this.store.getProject(projectId);
    return project ? this.hasProjectPermission(project, actor, permission) : false;
  }

  private async hasProjectPermission(
    project: ProjectRecord,
    actor: Actor,
    permission: 'READ' | 'WRITE' | 'REVIEW',
  ): Promise<boolean> {
    if (actor.role === 'SYSTEM_SERVICE') return true;
    const member = await this.store.getProjectMember(project.id, actor.id);
    const hasMatchingMembership = member?.organizationId === project.organizationId;
    if (permission === 'READ') {
      return project.createdBy === actor.id || Boolean(hasMatchingMembership);
    }
    return (
      (permission === 'WRITE' &&
        actor.role === 'RESEARCHER' &&
        (project.createdBy === actor.id ||
          (hasMatchingMembership &&
            (member?.role === 'OWNER' || member?.role === 'RESEARCHER')))) ||
      (permission === 'REVIEW' &&
        actor.role === 'SCIENTIFIC_REVIEWER' &&
        hasMatchingMembership &&
        member?.role === 'SCIENTIFIC_REVIEWER')
    );
  }

  private async assertReferenceWorkflowEnabled(organizationId: string): Promise<void> {
    const control = await this.getExecutionControl(organizationId);
    if (control.evidenceReadOnly) {
      throw new DomainError(
        'EVIDENCE_PRESERVATION_MODE',
        'Reference workflow execution is disabled while evidence preservation mode is active',
      );
    }
    if (!control.campaignExecutionEnabled) {
      throw new DomainError(
        'CAMPAIGN_EXECUTION_DISABLED',
        'Campaign execution is disabled by the organization emergency control',
      );
    }
    if (!control.experimentExecutionEnabled) {
      throw new DomainError(
        'EXPERIMENT_EXECUTION_DISABLED',
        'Experiment execution is disabled by the organization emergency control',
      );
    }
  }

  private assertReferenceRuntimePolicy(campaign: Campaign): void {
    if (!campaign.permittedModelIds.includes('deterministic-statistics-v1')) {
      throw new DomainError(
        'MODEL_NOT_PERMITTED',
        'The local reference workflow requires the deterministic-statistics-v1 model to be permitted',
      );
    }
    if (!campaign.permittedToolIds.includes('reference-local-executor-v1')) {
      throw new DomainError(
        'TOOL_NOT_PERMITTED',
        'The local reference workflow requires the reference-local-executor-v1 tool to be permitted',
      );
    }
    if (
      campaign.fallbackMode === 'APPROVED_ONLY' &&
      campaign.approvedFallbackModelIds.length === 0
    ) {
      throw new DomainError(
        'FALLBACK_POLICY_INVALID',
        'Approved-only fallback requires at least one explicitly permitted fallback model',
      );
    }
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
