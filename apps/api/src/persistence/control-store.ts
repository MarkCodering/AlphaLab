import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  ApprovalArtifact,
  ArtifactReference,
  Campaign,
  DatasetVersion,
  DomainEvent,
  ExecutionControl,
  ProposedAction,
  ReproducibilityBundleManifest,
  TargetVersion,
  ProjectMember,
  VerificationReport,
} from '@alphalab/contracts';
import type { EvidenceRecord } from '@alphalab/contracts';
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

export interface ArtifactRecord {
  artifact: ArtifactReference;
  organizationId: string;
  projectId: string;
  storageKey: string;
  provenance: Record<string, unknown>;
  createdAt: string;
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
  createProjectMember(record: ProjectMember): Promise<void>;
  getProjectMember(projectId: string, actorId: string): Promise<ProjectMember | undefined>;
  listProjectMembers(projectId: string): Promise<ProjectMember[]>;
  getProject(id: string): Promise<ProjectRecord | undefined>;
  listProjects(organizationId?: string): Promise<ProjectRecord[]>;
  createTarget(record: TargetVersion): Promise<void>;
  getTarget(id: string): Promise<TargetVersion | undefined>;
  listTargets(projectId?: string, targetId?: string): Promise<TargetVersion[]>;
  createDataset(record: DatasetVersion): Promise<void>;
  getDataset(id: string): Promise<DatasetVersion | undefined>;
  listDatasets(projectId?: string, datasetId?: string): Promise<DatasetVersion[]>;
  getExecutionControl(organizationId: string): Promise<ExecutionControl | undefined>;
  saveExecutionControl(record: ExecutionControl, expectedVersion: number): Promise<void>;
  createCampaign(record: Campaign): Promise<void>;
  getCampaign(id: string): Promise<Campaign | undefined>;
  listCampaigns(projectId?: string): Promise<Campaign[]>;
  updateCampaign(id: string, expectedVersion: number, campaign: Campaign): Promise<void>;
  createApprovalRequest(record: ApprovalRequestRecord): Promise<void>;
  getApprovalRequest(id: string): Promise<ApprovalRequestRecord | undefined>;
  listApprovalRequests(campaignId?: string): Promise<ApprovalRequestRecord[]>;
  updateApprovalRequest(record: ApprovalRequestRecord): Promise<void>;
  createArtifact(record: ArtifactRecord): Promise<void>;
  listArtifacts(projectId: string): Promise<ArtifactRecord[]>;
  createEvidence(record: EvidenceRecord): Promise<void>;
  listEvidence(campaignId: string): Promise<EvidenceRecord[]>;
  createVerificationReport(report: VerificationReport): Promise<void>;
  listVerificationReports(campaignId: string): Promise<VerificationReport[]>;
  createReproducibilityBundle(bundle: ReproducibilityBundleManifest): Promise<void>;
  listReproducibilityBundles(campaignId: string): Promise<ReproducibilityBundleManifest[]>;
  listEvents(campaignId: string): Promise<DomainEvent[]>;
  appendEvent(event: DomainEvent): Promise<void>;
  nextId(prefix: string): string;
}

export class InMemoryControlStore implements ControlStore {
  readonly eventEmitter = new EventEmitter();
  private readonly projects = new Map<string, ProjectRecord>();
  private readonly projectMembers = new Map<string, ProjectMember>();
  private readonly targets = new Map<string, TargetVersion>();
  private readonly datasets = new Map<string, DatasetVersion>();
  private readonly executionControls = new Map<string, ExecutionControl>();
  private readonly campaigns = new Map<string, Campaign>();
  private readonly approvalRequests = new Map<string, ApprovalRequestRecord>();
  private readonly artifacts = new Map<string, ArtifactRecord>();
  private readonly evidence = new Map<string, EvidenceRecord>();
  private readonly verificationReports = new Map<string, VerificationReport>();
  private readonly reproducibilityBundles = new Map<string, ReproducibilityBundleManifest>();
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

  async createProjectMember(record: ProjectMember): Promise<void> {
    const key = `${record.projectId}:${record.actorId}`;
    const existing = this.projectMembers.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
      throw new DomainError('PROJECT_MEMBER_IMMUTABLE', 'Project membership is immutable');
    }
    this.projectMembers.set(key, record);
  }

  async getProjectMember(projectId: string, actorId: string): Promise<ProjectMember | undefined> {
    return this.projectMembers.get(`${projectId}:${actorId}`);
  }

  async listProjectMembers(projectId: string): Promise<ProjectMember[]> {
    return [...this.projectMembers.values()]
      .filter((member) => member.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
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

  async createDataset(record: DatasetVersion): Promise<void> {
    this.datasets.set(record.datasetVersionId, record);
  }

  async getDataset(id: string): Promise<DatasetVersion | undefined> {
    return this.datasets.get(id);
  }

  async listDatasets(projectId?: string, datasetId?: string): Promise<DatasetVersion[]> {
    return [...this.datasets.values()].filter(
      (dataset) =>
        (!projectId || dataset.projectId === projectId) &&
        (!datasetId || dataset.datasetId === datasetId),
    );
  }

  async getExecutionControl(organizationId: string): Promise<ExecutionControl | undefined> {
    return this.executionControls.get(organizationId);
  }

  async saveExecutionControl(record: ExecutionControl, expectedVersion: number): Promise<void> {
    const current = this.executionControls.get(record.organizationId);
    const actualVersion = current?.version ?? 0;
    if (actualVersion !== expectedVersion) {
      throw new DomainError('CONTROL_VERSION_CONFLICT', 'Execution control version changed', {
        expectedVersion,
        actualVersion,
      });
    }
    this.executionControls.set(record.organizationId, record);
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

  async createArtifact(record: ArtifactRecord): Promise<void> {
    const existing = this.artifacts.get(record.artifact.digest);
    if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
      throw new DomainError(
        'ARTIFACT_IMMUTABLE',
        `Artifact ${record.artifact.digest} already exists`,
      );
    }
    this.artifacts.set(record.artifact.digest, record);
  }

  async listArtifacts(projectId: string): Promise<ArtifactRecord[]> {
    return [...this.artifacts.values()]
      .filter((record) => record.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createEvidence(record: EvidenceRecord): Promise<void> {
    const existing = this.evidence.get(record.evidenceId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
      throw new DomainError('EVIDENCE_IMMUTABLE', `Evidence ${record.evidenceId} already exists`);
    }
    this.evidence.set(record.evidenceId, record);
  }

  async listEvidence(campaignId: string): Promise<EvidenceRecord[]> {
    return [...this.evidence.values()]
      .filter((record) => record.campaignId === campaignId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createVerificationReport(report: VerificationReport): Promise<void> {
    const existing = this.verificationReports.get(report.reportId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(report)) {
      throw new DomainError(
        'VERIFICATION_REPORT_IMMUTABLE',
        `Report ${report.reportId} already exists`,
      );
    }
    this.verificationReports.set(report.reportId, report);
  }

  async listVerificationReports(campaignId: string): Promise<VerificationReport[]> {
    return [...this.verificationReports.values()]
      .filter((report) => report.campaignId === campaignId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createReproducibilityBundle(bundle: ReproducibilityBundleManifest): Promise<void> {
    const existing = this.reproducibilityBundles.get(bundle.bundleId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(bundle)) {
      throw new DomainError('BUNDLE_IMMUTABLE', `Bundle ${bundle.bundleId} already exists`);
    }
    this.reproducibilityBundles.set(bundle.bundleId, bundle);
  }

  async listReproducibilityBundles(campaignId: string): Promise<ReproducibilityBundleManifest[]> {
    return [...this.reproducibilityBundles.values()]
      .filter((bundle) => bundle.campaignId === campaignId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
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
