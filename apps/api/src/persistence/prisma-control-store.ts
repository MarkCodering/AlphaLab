import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ApprovalArtifactSchema,
  ArtifactReferenceSchema,
  CampaignSchema,
  DomainEventSchema,
  EvidenceRecordSchema,
  ProposedActionSchema,
  ReproducibilityBundleManifestSchema,
  TargetVersionSchema,
  VerificationReportSchema,
  type Campaign,
  type DomainEvent,
  type EvidenceRecord,
  type ReproducibilityBundleManifest,
  type TargetVersion,
  type VerificationReport,
} from '@alphalab/contracts';
import { DomainError } from '@alphalab/domain';
import { PrismaClient, Prisma } from '../generated/prisma/client.js';
import type {
  ApprovalRequestRecord,
  ArtifactRecord,
  ControlStore,
  ProjectRecord,
} from './control-store.js';
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

  async createArtifact(record: ArtifactRecord): Promise<void> {
    const existing = await this.db().artifact.findUnique({ where: { digest: record.artifact.digest } });
    if (existing) {
      const current = artifactFromDatabase(existing);
      if (JSON.stringify(current) !== JSON.stringify(record)) {
        throw new DomainError('ARTIFACT_IMMUTABLE', `Artifact ${record.artifact.digest} already exists`);
      }
      return;
    }
    await this.db().artifact.create({
      data: {
        digest: record.artifact.digest,
        organizationId: record.organizationId,
        projectId: record.projectId,
        mediaType: record.artifact.mediaType,
        byteLength: BigInt(record.artifact.sizeBytes),
        storageKey: record.storageKey,
        provenance: toJson(record.provenance),
        createdAt: new Date(record.createdAt),
      },
    });
  }

  async listArtifacts(projectId: string): Promise<ArtifactRecord[]> {
    const records = await this.db().artifact.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return records.map(artifactFromDatabase);
  }

  async createEvidence(record: EvidenceRecord): Promise<void> {
    const existing = await this.db().evidenceRecord.findUnique({ where: { id: record.evidenceId } });
    if (existing) {
      const current = evidenceFromDatabase(existing);
      if (JSON.stringify(current) !== JSON.stringify(record)) {
        throw new DomainError('EVIDENCE_IMMUTABLE', `Evidence ${record.evidenceId} already exists`);
      }
      return;
    }
    await this.db().evidenceRecord.create({
      data: {
        id: record.evidenceId,
        organizationId: record.organizationId,
        projectId: record.projectId,
        campaignId: record.campaignId,
        runId: record.runId,
        targetVersionId: record.targetVersionId,
        classification: record.type,
        statement: record.statement,
        artifactDigests: record.artifacts.map((artifact) => artifact.digest),
        supportsClaimIds: record.supportsClaimIds,
        contradictsClaimIds: record.contradictsClaimIds,
        sourcePointers: record.sourcePointers,
        provenance: toJson({ artifacts: record.artifacts }),
        status: record.status,
        invalidatesId: record.invalidatedByEvidenceId ?? null,
        createdAt: new Date(record.createdAt),
      },
    });
  }

  async listEvidence(campaignId: string): Promise<EvidenceRecord[]> {
    const records = await this.db().evidenceRecord.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map(evidenceFromDatabase);
  }

  async createVerificationReport(report: VerificationReport): Promise<void> {
    const existing = await this.db().verificationReport.findUnique({ where: { id: report.reportId } });
    if (existing) {
      const current = verificationReportFromDatabase(existing);
      if (JSON.stringify(current) !== JSON.stringify(report)) {
        throw new DomainError(
          'VERIFICATION_REPORT_IMMUTABLE',
          `Report ${report.reportId} already exists`,
        );
      }
      return;
    }
    await this.db().verificationReport.create({
      data: {
        id: report.reportId,
        organizationId: report.organizationId,
        projectId: report.projectId,
        campaignId: report.campaignId,
        policyVersion: report.policyVersion,
        status: report.status,
        predicateResults: toJson(report.predicateResults),
        candidateEligible: report.candidateEligible,
        humanApprovalRequired: report.humanApprovalRequired,
        createdAt: new Date(report.createdAt),
      },
    });
  }

  async listVerificationReports(campaignId: string): Promise<VerificationReport[]> {
    const records = await this.db().verificationReport.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map(verificationReportFromDatabase);
  }

  async createReproducibilityBundle(bundle: ReproducibilityBundleManifest): Promise<void> {
    const existing = await this.db().reproducibilityBundle.findUnique({ where: { id: bundle.bundleId } });
    if (existing) {
      const current = reproducibilityBundleFromDatabase(existing);
      if (JSON.stringify(current) !== JSON.stringify(bundle)) {
        throw new DomainError('BUNDLE_IMMUTABLE', `Bundle ${bundle.bundleId} already exists`);
      }
      return;
    }
    await this.db().reproducibilityBundle.create({
      data: {
        id: bundle.bundleId,
        organizationId: bundle.organizationId,
        projectId: bundle.projectId,
        campaignId: bundle.campaignId,
        targetVersionId: bundle.targetVersionId,
        manifest: toJson(bundle),
        manifestDigest: bundle.manifestDigest ?? null,
        createdAt: new Date(bundle.createdAt),
      },
    });
  }

  async listReproducibilityBundles(campaignId: string): Promise<ReproducibilityBundleManifest[]> {
    const records = await this.db().reproducibilityBundle.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'asc' },
    });
    return records.map(reproducibilityBundleFromDatabase);
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

function artifactFromDatabase(record: {
  digest: string;
  organizationId: string;
  projectId: string;
  mediaType: string;
  byteLength: bigint;
  storageKey: string;
  provenance: Prisma.JsonValue;
  createdAt: Date;
}): ArtifactRecord {
  const digest = record.digest as `sha256:${string}`;
  return {
    artifact: ArtifactReferenceSchema.parse({
      artifactId: `art_${digest.slice(7, 23)}`,
      digest,
      mediaType: record.mediaType,
      sizeBytes: Number(record.byteLength),
    }),
    organizationId: record.organizationId,
    projectId: record.projectId,
    storageKey: record.storageKey,
    provenance: record.provenance as Record<string, unknown>,
    createdAt: record.createdAt.toISOString(),
  };
}

function evidenceFromDatabase(record: {
  id: string;
  organizationId: string;
  projectId: string;
  campaignId: string;
  runId: string;
  targetVersionId: string;
  classification: string;
  statement: string;
  provenance: Prisma.JsonValue;
  status: string;
  supportsClaimIds: string[];
  contradictsClaimIds: string[];
  sourcePointers: string[];
  invalidatesId: string | null;
  createdAt: Date;
}): EvidenceRecord {
  const provenance = record.provenance as { artifacts?: unknown };
  return EvidenceRecordSchema.parse({
    contractVersion: '1.0',
    evidenceId: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    campaignId: record.campaignId,
    runId: record.runId,
    targetVersionId: record.targetVersionId,
    type: record.classification,
    status: record.status,
    statement: record.statement,
    artifacts: provenance.artifacts ?? [],
    supportsClaimIds: record.supportsClaimIds,
    contradictsClaimIds: record.contradictsClaimIds,
    sourcePointers: record.sourcePointers,
    ...(record.invalidatesId ? { invalidatedByEvidenceId: record.invalidatesId } : {}),
    createdAt: record.createdAt.toISOString(),
  });
}

function verificationReportFromDatabase(record: {
  id: string;
  organizationId: string;
  projectId: string;
  campaignId: string;
  policyVersion: string;
  status: string;
  predicateResults: Prisma.JsonValue;
  candidateEligible: boolean;
  humanApprovalRequired: boolean;
  createdAt: Date;
}): VerificationReport {
  return VerificationReportSchema.parse({
    contractVersion: '1.0',
    reportId: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
    campaignId: record.campaignId,
    policyVersion: record.policyVersion,
    status: record.status,
    predicateResults: record.predicateResults,
    candidateEligible: record.candidateEligible,
    humanApprovalRequired: record.humanApprovalRequired,
    createdAt: record.createdAt.toISOString(),
  });
}

function reproducibilityBundleFromDatabase(record: {
  manifest: Prisma.JsonValue;
}): ReproducibilityBundleManifest {
  return ReproducibilityBundleManifestSchema.parse(record.manifest);
}
