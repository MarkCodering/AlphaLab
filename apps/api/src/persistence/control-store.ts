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
  projects: Map<string, ProjectRecord>;
  targets: Map<string, TargetVersion>;
  campaigns: Map<string, Campaign>;
  approvalRequests: Map<string, ApprovalRequestRecord>;
  events: DomainEvent[];
  eventEmitter: EventEmitter;
  idempotent<T>(scope: string, key: string, request: unknown, operation: () => T): T;
  updateCampaign(id: string, expectedVersion: number, campaign: Campaign): void;
  appendEvent(event: DomainEvent): void;
  nextId(prefix: string): string;
}

export class InMemoryControlStore implements ControlStore {
  readonly projects = new Map<string, ProjectRecord>();
  readonly targets = new Map<string, TargetVersion>();
  readonly campaigns = new Map<string, Campaign>();
  readonly approvalRequests = new Map<string, ApprovalRequestRecord>();
  readonly events: DomainEvent[] = [];
  readonly eventEmitter = new EventEmitter();
  private readonly idempotencyRecords = new Map<
    string,
    { requestDigest: string; result: unknown }
  >();

  idempotent<T>(scope: string, key: string, request: unknown, operation: () => T): T {
    const recordKey = `${scope}:${key}`;
    const requestDigest = createHash('sha256').update(canonicalize(request)).digest('hex');
    const existing = this.idempotencyRecords.get(recordKey);
    if (existing) {
      if (existing.requestDigest !== requestDigest) {
        throw new DomainError(
          'IDEMPOTENCY_CONFLICT',
          'The idempotency key was already used for a different request',
        );
      }
      return existing.result as T;
    }
    const result = operation();
    this.idempotencyRecords.set(recordKey, { requestDigest, result });
    return result;
  }

  updateCampaign(id: string, expectedVersion: number, campaign: Campaign): void {
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

  appendEvent(event: DomainEvent): void {
    this.events.push(event);
    this.eventEmitter.emit('domain-event', event);
  }

  nextId(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
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
