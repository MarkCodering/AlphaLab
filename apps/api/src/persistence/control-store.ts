import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  ApprovalArtifact,
  Campaign,
  DomainEvent,
  ProposedAction,
  TargetVersion,
} from '@alphalab/contracts';
import { DomainError } from '@alphalab/domain';

export const CONTROL_STORE = Symbol('CONTROL_STORE');

export interface ProjectRecord {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  createdAt: string;
  createdBy: string;
}

export interface ApprovalRequestRecord {
  id: string;
  action: ProposedAction;
  actionDigest: `sha256:${string}`;
  status: 'PENDING' | 'DECIDED';
  createdAt: string;
  approval?: ApprovalArtifact;
}

export interface ControlStore {
  readonly eventEmitter: EventEmitter;
  idempotent<T>(
    scope: string,
    key: string,
    request: unknown,
    operation: () => Promise<T>,
  ): Promise<T>;
  createProject(record: ProjectRecord): Promise<void>;
  getProject(id: string): Promise<ProjectRecord | undefined>;
  listProjects(organizationId?: string): Promise<ProjectRecord[]>;
  createTarget(record: TargetVersion): Promise<void>;
  getTarget(id: string): Promise<TargetVersion | undefined>;
  listTargets(projectId?: string, targetId?: string): Promise<TargetVersion[]>;
  createCampaign(record: Campaign): Promise<void>;
  getCampaign(id: string): Promise<Campaign | undefined>;
  listCampaigns(projectId?: string): Promise<Campaign[]>;
  updateCampaign(id: string, expectedVersion: number, campaign: Campaign): Promise<void>;
  createApprovalRequest(record: ApprovalRequestRecord): Promise<void>;
  getApprovalRequest(id: string): Promise<ApprovalRequestRecord | undefined>;
  listApprovalRequests(campaignId?: string): Promise<ApprovalRequestRecord[]>;
  updateApprovalRequest(record: ApprovalRequestRecord): Promise<void>;
  listEvents(campaignId: string): Promise<DomainEvent[]>;
  appendEvent(event: DomainEvent): Promise<void>;
  nextId(prefix: string): string;
}

export class InMemoryControlStore implements ControlStore {
  readonly eventEmitter = new EventEmitter();
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly targets = new Map<string, TargetVersion>();
  private readonly campaigns = new Map<string, Campaign>();
  private readonly approvalRequests = new Map<string, ApprovalRequestRecord>();
  private readonly events: DomainEvent[] = [];
  private readonly idempotencyRecords = new Map<
    string,
    { requestDigest: string; result: unknown }
  >();

  async idempotent<T>(
    scope: string,
    key: string,
    request: unknown,
    operation: () => Promise<T>,
  ): Promise<T> {
    const recordKey = `${scope}:${key}`;
    const requestDigest = digestRequest(request);
    const existing = this.idempotencyRecords.get(recordKey);
    if (existing) {
      assertMatchingRequest(existing.requestDigest, requestDigest);
      return existing.result as T;
    }
    const result = await operation();
    this.idempotencyRecords.set(recordKey, { requestDigest, result });
    return result;
  }

  async createProject(record: ProjectRecord): Promise<void> {
    this.projects.set(record.id, record);
  }

  async getProject(id: string): Promise<ProjectRecord | undefined> {
    return this.projects.get(id);
  }

  async listProjects(organizationId?: string): Promise<ProjectRecord[]> {
    return [...this.projects.values()].filter(
      (project) => !organizationId || project.organizationId === organizationId,
    );
  }

  async createTarget(record: TargetVersion): Promise<void> {
    this.targets.set(record.id, record);
  }

  async getTarget(id: string): Promise<TargetVersion | undefined> {
    return this.targets.get(id);
  }

  async listTargets(projectId?: string, targetId?: string): Promise<TargetVersion[]> {
    return [...this.targets.values()].filter(
      (target) =>
        (!projectId || target.projectId === projectId) &&
        (!targetId || target.targetId === targetId),
    );
  }

  async createCampaign(record: Campaign): Promise<void> {
    this.campaigns.set(record.id, record);
  }

  async getCampaign(id: string): Promise<Campaign | undefined> {
    return this.campaigns.get(id);
  }

  async listCampaigns(projectId?: string): Promise<Campaign[]> {
    return [...this.campaigns.values()].filter(
      (campaign) => !projectId || campaign.projectId === projectId,
    );
  }

  async updateCampaign(id: string, expectedVersion: number, campaign: Campaign): Promise<void> {
    const current = this.campaigns.get(id);
    if (!current) throw new DomainError('CAMPAIGN_NOT_FOUND', `Campaign ${id} was not found`);
    if (current.stateVersion !== expectedVersion) {
      throw new DomainError('STATE_VERSION_CONFLICT', 'Campaign state version changed', {
        expectedVersion,
        actualVersion: current.stateVersion,
      });
    }
    this.campaigns.set(id, campaign);
  }

  async createApprovalRequest(record: ApprovalRequestRecord): Promise<void> {
    this.approvalRequests.set(record.id, record);
  }

  async getApprovalRequest(id: string): Promise<ApprovalRequestRecord | undefined> {
    return this.approvalRequests.get(id);
  }

  async listApprovalRequests(campaignId?: string): Promise<ApprovalRequestRecord[]> {
    return [...this.approvalRequests.values()].filter(
      (request) => !campaignId || request.action.campaignId === campaignId,
    );
  }

  async updateApprovalRequest(record: ApprovalRequestRecord): Promise<void> {
    this.approvalRequests.set(record.id, record);
  }

  async listEvents(campaignId: string): Promise<DomainEvent[]> {
    return this.events.filter((event) => event.campaignId === campaignId);
  }

  async appendEvent(event: DomainEvent): Promise<void> {
    this.events.push(event);
    this.eventEmitter.emit('domain-event', event);
  }

  nextId(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}

export function digestRequest(request: unknown): string {
  return createHash('sha256').update(canonicalize(request)).digest('hex');
}

export function assertMatchingRequest(existing: string, candidate: string): void {
  if (existing !== candidate) {
    throw new DomainError(
      'IDEMPOTENCY_CONFLICT',
      'The idempotency key was already used for a different request',
    );
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
    .join(',')}}`;
}
