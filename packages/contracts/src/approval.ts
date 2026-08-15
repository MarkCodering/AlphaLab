import { z } from 'zod';
import {
  ActorSchema,
  ContractVersionSchema,
  DigestSchema,
  IdentifierSchema,
  RiskTierSchema,
  TimestampSchema,
} from './common.js';

export const ActionKindSchema = z.enum([
  'MODEL_INFERENCE',
  'EXPERIMENT_EXECUTION',
  'EXTERNAL_NETWORK_ACCESS',
  'EXTERNAL_MODEL_PROVIDER',
  'PRIVILEGED_CONTAINER',
  'CLOUD_INFRASTRUCTURE_PLAN',
  'CLOUD_INFRASTRUCTURE_APPLY',
  'DESTRUCTIVE_DATA_OPERATION',
  'UNTRUSTED_MODEL_LOAD',
  'CREDENTIAL_ACCESS',
  'DISCOVERY_RELEASE',
  'PHYSICAL_LAB_ACTION',
]);
export type ActionKind = z.infer<typeof ActionKindSchema>;

export const ProposedActionSchema = z.object({
  contractVersion: ContractVersionSchema,
  actionId: IdentifierSchema,
  organizationId: IdentifierSchema,
  projectId: IdentifierSchema,
  campaignId: IdentifierSchema.optional(),
  kind: ActionKindSchema,
  riskTier: RiskTierSchema,
  parameters: z.record(z.string(), z.unknown()),
  requestedBy: ActorSchema,
  requestedAt: TimestampSchema,
});
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

export const ApprovalArtifactSchema = z.object({
  contractVersion: ContractVersionSchema,
  approvalId: IdentifierSchema,
  organizationId: IdentifierSchema,
  projectId: IdentifierSchema,
  actionDigest: DigestSchema,
  policyVersion: IdentifierSchema,
  decision: z.enum(['APPROVED', 'REJECTED', 'REVOKED']),
  decidedBy: ActorSchema,
  decidedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  singleUse: z.literal(true),
  consumedAt: TimestampSchema.nullable(),
  reason: z.string().min(1),
});
export type ApprovalArtifact = z.infer<typeof ApprovalArtifactSchema>;
