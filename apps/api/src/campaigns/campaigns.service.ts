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
  type CampaignStatus,
  type DomainEvent,
  type ProposedAction,
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

  getProject(id: string): ProjectRecord {
    const project = this.store.projects.get(id);
    if (!project) throw new DomainError('PROJECT_NOT_FOUND', `Project ${id} was not found`);
    return project;
  }

  listProjects(organizationId?: string): ProjectRecord[] {
    return [...this.store.projects.values()].filter(
      (project) => !organizationId || project.organizationId === organizationId,
    );
  }

  createProject(body: unknown, actor: Actor, idempotencyKey: string): ProjectRecord {
    const input = CreateProjectSchema.parse(body);
    return this.store.idempotent(
      `project:create:${input.organizationId}:${actor.id}`,
      idempotencyKey,
      input,
      () => {
        const record: ProjectRecord = {
          id: this.store.nextId('prj'),
          organizationId: input.organizationId,
          name: input.name,
          description: input.description,
          createdAt: new Date().toISOString(),
          createdBy: actor.id,
        };
        this.store.projects.set(record.id, record);
        return record;
      },
    );
  }

  createTarget(body: unknown, actor: Actor, idempotencyKey: string): TargetVersion {
    const input = CreateTargetSchema.parse(body);
    this.requireProject(input.projectId, input.organizationId);
    return this.store.idempotent(
      `target:create:${input.organizationId}:${input.projectId}:${actor.id}`,
      idempotencyKey,
      input,
      () => {
        const targetId = input.targetId ?? this.store.nextId('tgt');
        const priorVersions = [...this.store.targets.values()].filter(
          (target) => target.targetId === targetId,
        );
        const record = TargetVersionSchema.parse({
          ...input,
          id: this.store.nextId('tgv'),
          targetId,
          version: priorVersions.length + 1,
          createdAt: new Date().toISOString(),
          createdBy: actor.id,
        });
        this.store.targets.set(record.id, record);
        return record;
      },
    );
  }

  listTargets(projectId?: string): TargetVersion[] {
    return [...this.store.targets.values()].filter(
      (target) => !projectId || target.projectId === projectId,
    );
  }

  createCampaign(body: unknown, actor: Actor, idempotencyKey: string): Campaign {
    const input = CreateCampaignSchema.parse(body);
    this.requireProject(input.projectId, input.organizationId);
    const target = this.store.targets.get(input.targetVersionId);
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
      () => {
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
        this.store.campaigns.set(record.id, record);
        this.appendCampaignEvent(record, actor, idempotencyKey, 'campaign.created', {
          status: record.status,
        });
        return record;
      },
    );
  }

  getCampaign(id: string): Campaign {
    const campaign = this.store.campaigns.get(id);
    if (!campaign) throw new DomainError('CAMPAIGN_NOT_FOUND', `Campaign ${id} was not found`);
    return campaign;
  }

  listCampaigns(projectId?: string): Campaign[] {
    return [...this.store.campaigns.values()].filter(
      (campaign) => !projectId || campaign.projectId === projectId,
    );
  }

  transitionCampaign(
    id: string,
    body: unknown,
    actor: Actor,
    idempotencyKey: string,
    expectedVersion: number,
  ): Campaign {
    const input = TransitionRequestSchema.parse(body);
    return this.store.idempotent(
      `campaign:transition:${id}:${actor.id}`,
      idempotencyKey,
      { expectedVersion, ...input },
      () => {
        const current = this.getCampaign(id);
        if (input.to === 'RUNNING' && current.status === 'PAUSED' && current.resumeStatus) {
          const resumed = {
            ...current,
            status: current.resumeStatus,
            resumeStatus: null,
            stateVersion: current.stateVersion + 1,
            updatedAt: new Date().toISOString(),
          } satisfies Campaign;
          this.store.updateCampaign(id, expectedVersion, resumed);
          this.appendCampaignEvent(resumed, actor, idempotencyKey, 'campaign.resumed', {
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
        this.store.updateCampaign(id, expectedVersion, result.campaign);
        this.appendCampaignEvent(result.campaign, actor, idempotencyKey, result.evidenceType, {
          from: current.status,
          to: result.campaign.status,
          reason: input.reason,
          invalidates: result.invalidates,
        });
        return result.campaign;
      },
    );
  }

  listEvents(campaignId: string): DomainEvent[] {
    this.getCampaign(campaignId);
    return this.store.events.filter((event) => event.campaignId === campaignId);
  }

  eventStore(): ControlStore {
    return this.store;
  }

  createApprovalRequest(
    campaignId: string,
    body: unknown,
    actor: Actor,
    idempotencyKey: string,
  ): ApprovalRequestRecord {
    const input = ApprovalRequestInputSchema.parse(body);
    const campaign = this.getCampaign(campaignId);
    return this.store.idempotent(
      `approval:create:${campaignId}:${actor.id}`,
      idempotencyKey,
      input,
      () => {
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
        this.store.approvalRequests.set(record.id, record);
        return record;
      },
    );
  }

  decideApproval(
    requestId: string,
    body: unknown,
    actor: Actor,
    idempotencyKey: string,
  ): ApprovalArtifact {
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
      () => {
        const request = this.store.approvalRequests.get(requestId);
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
        const now = new Date().toISOString();
        const artifact = ApprovalArtifactSchema.parse({
          contractVersion: '1.0',
          approvalId: this.store.nextId('apr'),
          organizationId: request.action.organizationId,
          projectId: request.action.projectId,
          actionDigest: request.actionDigest,
          policyVersion: input.policyVersion,
          decision: input.decision,
          decidedBy: actor,
          decidedAt: now,
          expiresAt: input.expiresAt,
          singleUse: true,
          consumedAt: null,
          reason: input.reason,
        });
        request.status = 'DECIDED';
        request.approval = artifact;
        return artifact;
      },
    );
  }

  listApprovalRequests(campaignId?: string): ApprovalRequestRecord[] {
    return [...this.store.approvalRequests.values()].filter(
      (request) => !campaignId || request.action.campaignId === campaignId,
    );
  }

  private requireProject(projectId: string, organizationId: string): ProjectRecord {
    const project = this.store.projects.get(projectId);
    if (!project || project.organizationId !== organizationId) {
      throw new DomainError(
        'PROJECT_NOT_FOUND',
        `Project ${projectId} was not found in the organization`,
      );
    }
    return project;
  }

  private appendCampaignEvent(
    campaign: Campaign,
    actor: Actor,
    idempotencyKey: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
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
    this.store.appendEvent(event);
  }
}
