import type {
  ApprovalArtifact,
  ArtifactReference,
  BudgetLimit,
  BudgetUsage,
  CampaignStatus,
  CampaignWorkflowRecord,
  DatasetVersion,
  DomainEvent,
  EvidenceRecord,
  ExecutorManifest,
  ExecutionControl,
  ModelManifest,
  ProjectMember,
  ProposedAction,
  ReproducibilityBundleManifest,
  TargetVersion,
  VerificationReport,
} from '@alphalab/contracts';

export interface ProjectRecord {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  createdAt: string;
  createdBy: string;
}

export interface CampaignRecord {
  id: string;
  organizationId: string;
  projectId: string;
  targetVersionId: string;
  datasetVersionIds: string[];
  permittedModelIds: string[];
  permittedToolIds: string[];
  fallbackMode: 'STOP' | 'APPROVED_ONLY';
  approvedFallbackModelIds: string[];
  status: CampaignStatus;
  resumeStatus: CampaignStatus | null;
  stateVersion: number;
  budgetVersion: number;
  budgetLimit: BudgetLimit;
  budgetUsage: BudgetUsage;
  createdAt: string;
  updatedAt: string;
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

export type {
  CampaignWorkflowRecord,
  DatasetVersion,
  DomainEvent,
  EvidenceRecord,
  ExecutorManifest,
  ExecutionControl,
  ModelManifest,
  ProjectMember,
  ReproducibilityBundleManifest,
  TargetVersion,
  VerificationReport,
};
