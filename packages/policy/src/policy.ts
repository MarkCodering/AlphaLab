import { createHash } from 'node:crypto';
import type { ActionKind, ApprovalArtifact, ProposedAction, RiskTier } from '@alphalab/contracts';

export interface PolicyDecision {
  allowed: boolean;
  code: string;
  reason: string;
  riskTier: RiskTier;
  actionDigest: `sha256:${string}`;
}

const redActions = new Set<ActionKind>([
  'EXPERIMENT_EXECUTION',
  'EXTERNAL_NETWORK_ACCESS',
  'EXTERNAL_MODEL_PROVIDER',
  'PRIVILEGED_CONTAINER',
  'CLOUD_INFRASTRUCTURE_APPLY',
  'DESTRUCTIVE_DATA_OPERATION',
  'UNTRUSTED_MODEL_LOAD',
  'CREDENTIAL_ACCESS',
  'DISCOVERY_RELEASE',
  'PHYSICAL_LAB_ACTION',
]);

const yellowActions = new Set<ActionKind>(['MODEL_INFERENCE', 'CLOUD_INFRASTRUCTURE_PLAN']);

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
    .join(',')}}`;
}

export function digestAction(action: ProposedAction): `sha256:${string}` {
  const canonicalAction = {
    contractVersion: action.contractVersion,
    actionId: action.actionId,
    organizationId: action.organizationId,
    projectId: action.projectId,
    campaignId: action.campaignId,
    kind: action.kind,
    riskTier: classifyAction(action.kind),
    parameters: action.parameters,
    requestedBy: action.requestedBy,
    requestedAt: action.requestedAt,
  };
  return `sha256:${createHash('sha256').update(canonicalize(canonicalAction)).digest('hex')}`;
}

export function classifyAction(kind: ActionKind): RiskTier {
  if (redActions.has(kind)) return 'RED';
  if (yellowActions.has(kind)) return 'YELLOW';
  return 'GREEN';
}

export function authorizeAction(
  action: ProposedAction,
  approval: ApprovalArtifact | undefined,
  now: string,
): PolicyDecision {
  const riskTier = classifyAction(action.kind);
  const actionDigest = digestAction(action);

  if (action.requestedBy.role === 'SYSTEM_SERVICE' && action.kind === 'DISCOVERY_RELEASE') {
    return {
      allowed: false,
      code: 'MODEL_OR_SERVICE_CANNOT_RELEASE',
      reason: 'A service cannot authorize release of a scientific claim.',
      riskTier,
      actionDigest,
    };
  }

  if (riskTier !== 'RED') {
    return {
      allowed: true,
      code: 'POLICY_ALLOWED',
      reason: 'Action is within policy.',
      riskTier,
      actionDigest,
    };
  }
  if (!approval) {
    return {
      allowed: false,
      code: 'APPROVAL_REQUIRED',
      reason: 'Red actions require human approval.',
      riskTier,
      actionDigest,
    };
  }
  if (approval.decision !== 'APPROVED') {
    return {
      allowed: false,
      code: 'APPROVAL_NOT_APPROVED',
      reason: 'Approval is rejected or revoked.',
      riskTier,
      actionDigest,
    };
  }
  if (approval.actionDigest !== actionDigest) {
    return {
      allowed: false,
      code: 'APPROVAL_SCOPE_MISMATCH',
      reason: 'Approval does not match the exact action.',
      riskTier,
      actionDigest,
    };
  }
  if (
    approval.organizationId !== action.organizationId ||
    approval.projectId !== action.projectId
  ) {
    return {
      allowed: false,
      code: 'APPROVAL_BOUNDARY_MISMATCH',
      reason: 'Approval belongs to another boundary.',
      riskTier,
      actionDigest,
    };
  }
  if (approval.decidedBy.type !== 'USER' || approval.decidedBy.role === 'SYSTEM_SERVICE') {
    return {
      allowed: false,
      code: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Model or service output is not approval.',
      riskTier,
      actionDigest,
    };
  }
  if (approval.consumedAt !== null) {
    return {
      allowed: false,
      code: 'APPROVAL_ALREADY_CONSUMED',
      reason: 'Approval is single use.',
      riskTier,
      actionDigest,
    };
  }
  if (Date.parse(approval.expiresAt) <= Date.parse(now)) {
    return {
      allowed: false,
      code: 'APPROVAL_EXPIRED',
      reason: 'Approval has expired.',
      riskTier,
      actionDigest,
    };
  }
  return {
    allowed: true,
    code: 'APPROVAL_VALID',
    reason: 'Exact human approval is valid.',
    riskTier,
    actionDigest,
  };
}
