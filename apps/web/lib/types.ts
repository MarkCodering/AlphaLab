import type {
  ApprovalArtifact,
  BudgetLimit,
  BudgetUsage,
  CampaignStatus,
  DomainEvent,
  ProposedAction,
  TargetVersion,
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

export type { DomainEvent, TargetVersion };
