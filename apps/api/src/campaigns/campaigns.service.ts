import { Inject, Injectable } from '@nestjs/common';
import {
  ApprovalArtifactSchema,
  BudgetLimitSchema,
  CampaignSchema,
  DomainEventSchema,
  ProposedActionSchema,
  TargetVersionSchema,
  TransitionPredicateSchema,
  type Actor,
  type ApprovalArtifact,
  type Campaign,
  type DomainEvent,
  type TargetVersion,
} from '@alphalab/contracts';
import { DomainError, emptyBudgetUsage, transitionCampaign } from '@alphalab/domain';
import { classifyAction, digestAction } from '@alphalab/policy';
import { z } from 'zod';
import {
  CONTROL_STORE,
  type ApprovalRequestRecord,
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
        return artifact;
      },
    );
  }

  listApprovalRequests(campaignId?: string): Promise<ApprovalRequestRecord[]> {
    return this.store.listApprovalRequests(campaignId);
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
