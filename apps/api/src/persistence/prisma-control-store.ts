import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ApprovalArtifactSchema,
  CampaignSchema,
  DomainEventSchema,
  ProposedActionSchema,
  TargetVersionSchema,
  type Campaign,
  type DomainEvent,
  type TargetVersion,
} from '@alphalab/contracts';
import { DomainError } from '@alphalab/domain';
import { PrismaClient, Prisma } from '../generated/prisma/client.js';
import type { ApprovalRequestRecord, ControlStore, ProjectRecord } from './control-store.js';
import { assertMatchingRequest, digestRequest } from './control-store.js';

type TransactionClient = Prisma.TransactionClient;

export class PrismaControlStore implements ControlStore {
  readonly eventEmitter = new EventEmitter();
  private readonly client: PrismaClient;
  private readonly transactions = new AsyncLocalStorage<TransactionClient>();

  constructor(connectionString: string) {
    this.client = new PrismaClient({ adapter: new PrismaPg(connectionString) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  async idempotent<T>(
    scope: string,
    key: string,
    request: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    const recordKey = `${scope}:${key}`;
    const requestDigest = digestRequest(request);
    return this.client.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${recordKey}, 0))`;
      const existing = await transaction.idempotencyRecord.findUnique({
        where: { scope: recordKey },
      });
      if (existing) {
        assertMatchingRequest(existing.requestDigest, requestDigest);
        return existing.responseBody as T;
      }
      return this.transactions.run(transaction, async () => {
        const result = await operation();
        await transaction.idempotencyRecord.create({
          data: {
            scope: recordKey,
            requestDigest,
            responseBody: toJson(result),
          },
        });
        return result;
      });
    });
  }

  async createProject(record: ProjectRecord): Promise<void> {
    await this.db().project.create({
      data: { ...record, createdAt: new Date(record.createdAt) },
    });
  }

  async getProject(id: string): Promise<ProjectRecord | undefined> {
    const record = await this.db().project.findUnique({ where: { id } });
    return record ? { ...record, createdAt: record.createdAt.toISOString() } : undefined;
  }

  async listProjects(organizationId?: string): Promise<ProjectRecord[]> {
    const records = await this.db().project.findMany({
      ...(organizationId ? { where: { organizationId } } : {}),
      orderBy: { createdAt: 'desc' },
    });
    return records.map((record) => ({ ...record, createdAt: record.createdAt.toISOString() }));
  }

  async createTarget(record: TargetVersion): Promise<void> {
    await this.db().targetVersion.create({
      data: { ...record, createdAt: new Date(record.createdAt) },
    });
  }

  async getTarget(id: string): Promise<TargetVersion | undefined> {
    const record = await this.db().targetVersion.findUnique({ where: { id } });
    return record ? targetFromDatabase(record) : undefined;
  }

  async listTargets(projectId?: string, targetId?: string): Promise<TargetVersion[]> {
    const records = await this.db().targetVersion.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(targetId ? { targetId } : {}),
      },
      orderBy: [{ targetId: 'asc' }, { version: 'asc' }],
    });
    return records.map(targetFromDatabase);
  }

  async createCampaign(record: Campaign): Promise<void> {
    await this.db().campaign.create({
      data: {
        ...record,
        budgetLimit: toJson(record.budgetLimit),
        budgetUsage: toJson(record.budgetUsage),
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      },
    });
  }

  async getCampaign(id: string): Promise<Campaign | undefined> {
    const record = await this.db().campaign.findUnique({ where: { id } });
    return record ? campaignFromDatabase(record) : undefined;
  }

  async listCampaigns(projectId?: string): Promise<Campaign[]> {
    const records = await this.db().campaign.findMany({
      ...(projectId ? { where: { projectId } } : {}),
      orderBy: { updatedAt: 'desc' },
    });
    return records.map(campaignFromDatabase);
  }

  async updateCampaign(id: string, expectedVersion: number, campaign: Campaign): Promise<void> {
    const updated = await this.db().campaign.updateMany({
      where: { id, stateVersion: expectedVersion },
      data: {
        status: campaign.status,
        resumeStatus: campaign.resumeStatus,
        stateVersion: campaign.stateVersion,
        budgetVersion: campaign.budgetVersion,
        budgetLimit: toJson(campaign.budgetLimit),
        budgetUsage: toJson(campaign.budgetUsage),
        updatedAt: new Date(campaign.updatedAt),
      },
    });
    if (updated.count === 0) {
      const current = await this.db().campaign.findUnique({ where: { id } });
      if (!current) throw new DomainError('CAMPAIGN_NOT_FOUND', `Campaign ${id} was not found`);
      throw new DomainError('STATE_VERSION_CONFLICT', 'Campaign state version changed', {
        expectedVersion,
        actualVersion: current.stateVersion,
      });
    }
  }

  async createApprovalRequest(record: ApprovalRequestRecord): Promise<void> {
    await this.db().approvalRequest.create({
      data: {
        id: record.id,
        campaignId: record.action.campaignId ?? null,
        action: toJson(record.action),
        actionDigest: record.actionDigest,
        status: record.status,
        createdAt: new Date(record.createdAt),
      },
    });
  }

  async getApprovalRequest(id: string): Promise<ApprovalRequestRecord | undefined> {
    const record = await this.db().approvalRequest.findUnique({ where: { id } });
    return record ? approvalFromDatabase(record) : undefined;
  }

  async listApprovalRequests(campaignId?: string): Promise<ApprovalRequestRecord[]> {
    const records = await this.db().approvalRequest.findMany({
      ...(campaignId ? { where: { campaignId } } : {}),
      orderBy: { createdAt: 'desc' },
    });
    return records.map(approvalFromDatabase);
  }

  async updateApprovalRequest(record: ApprovalRequestRecord): Promise<void> {
    await this.db().approvalRequest.update({
      where: { id: record.id },
      data: {
        status: record.status,
        approval: record.approval ? toJson(record.approval) : Prisma.JsonNull,
      },
    });
  }

  async listEvents(campaignId: string): Promise<DomainEvent[]> {
    const records = await this.db().domainEvent.findMany({
      where: { campaignId },
      orderBy: { occurredAt: 'asc' },
    });
    return records.map((record) =>
      DomainEventSchema.parse({
        ...record,
        occurredAt: record.occurredAt.toISOString(),
      }),
    );
  }

  async appendEvent(event: DomainEvent): Promise<void> {
    await this.db().domainEvent.create({
      data: {
        contractVersion: event.contractVersion,
        eventId: event.eventId,
        eventType: event.eventType,
        organizationId: event.organizationId,
        projectId: event.projectId,
        campaignId: event.campaignId ?? null,
        targetVersionId: event.targetVersionId ?? null,
        correlationId: event.correlationId,
        causationId: event.causationId,
        idempotencyKey: event.idempotencyKey,
        actor: toJson(event.actor),
        payload: toJson(event.payload),
        occurredAt: new Date(event.occurredAt),
      },
    });
    this.eventEmitter.emit('domain-event', event);
  }

  nextId(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }

  private db(): TransactionClient {
    return this.transactions.getStore() ?? (this.client as unknown as TransactionClient);
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function targetFromDatabase(record: {
  id: string;
  organizationId: string;
  projectId: string;
  targetId: string;
  version: number;
  scientificGoal: string;
  researchQuestion: string;
  acceptanceCriteria: string[];
  verificationPolicyId: string;
  stopConditions: string[];
  createdAt: Date;
  createdBy: string;
}): TargetVersion {
  return TargetVersionSchema.parse({ ...record, createdAt: record.createdAt.toISOString() });
}

function campaignFromDatabase(record: {
  id: string;
  organizationId: string;
  projectId: string;
  targetVersionId: string;
  status: string;
  resumeStatus: string | null;
  stateVersion: number;
  budgetVersion: number;
  budgetLimit: Prisma.JsonValue;
  budgetUsage: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): Campaign {
  return CampaignSchema.parse({
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function approvalFromDatabase(record: {
  id: string;
  action: Prisma.JsonValue;
  actionDigest: string;
  status: string;
  approval: Prisma.JsonValue | null;
  createdAt: Date;
}): ApprovalRequestRecord {
  const approval = record.approval ? ApprovalArtifactSchema.parse(record.approval) : undefined;
  return {
    id: record.id,
    action: ProposedActionSchema.parse(record.action),
    actionDigest: record.actionDigest as `sha256:${string}`,
    status: record.status as ApprovalRequestRecord['status'],
    createdAt: record.createdAt.toISOString(),
    ...(approval ? { approval } : {}),
  };
}
