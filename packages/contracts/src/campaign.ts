import { z } from 'zod';
import { IdentifierSchema, TimestampSchema } from './common.js';

export const CampaignStatusSchema = z.enum([
  'DRAFT',
  'TARGET_REVIEW',
  'READY_FOR_ROUTE',
  'ROUTE_REVIEW',
  'READY',
  'RUNNING',
  'WAITING_FOR_APPROVAL',
  'RUNNING_EXPERIMENT',
  'VERIFYING',
  'NEEDS_HUMAN',
  'BLOCKED',
  'CONTRADICTION',
  'SCOPE_EXPANSION',
  'BUDGET_EXHAUSTED',
  'UNSAFE',
  'FAILED',
  'NEXT_EXPERIMENT_READY',
  'DISCOVERY_CANDIDATE',
  'VERIFIED',
  'PAUSED',
  'CANCELLED',
  'ARCHIVED',
]);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

export const BudgetLimitSchema = z.object({
  wallClockSeconds: z.number().int().positive(),
  modelCalls: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  experiments: z.number().int().nonnegative(),
  computeMilliUnits: z.number().int().nonnegative(),
  parallelChildren: z.number().int().positive(),
});
export type BudgetLimit = z.infer<typeof BudgetLimitSchema>;

export const BudgetUsageSchema = z.object({
  wallClockSeconds: z.number().int().nonnegative(),
  modelCalls: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  experiments: z.number().int().nonnegative(),
  computeMilliUnits: z.number().int().nonnegative(),
  activeChildren: z.number().int().nonnegative(),
});
export type BudgetUsage = z.infer<typeof BudgetUsageSchema>;

export const CampaignRuntimePolicySchema = z.object({
  permittedModelIds: z.array(IdentifierSchema).min(1),
  permittedToolIds: z.array(IdentifierSchema).min(1),
  fallbackMode: z.enum(['STOP', 'APPROVED_ONLY']),
  approvedFallbackModelIds: z.array(IdentifierSchema),
});
export type CampaignRuntimePolicy = z.infer<typeof CampaignRuntimePolicySchema>;

export const DEFAULT_REFERENCE_RUNTIME_POLICY = {
  permittedModelIds: ['reference-local-worker-model-v1', 'deterministic-statistics-v1'],
  permittedToolIds: ['reference-local-executor-v1'],
  fallbackMode: 'STOP',
  approvedFallbackModelIds: [],
} as const satisfies CampaignRuntimePolicy;

export const TargetVersionSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  projectId: IdentifierSchema,
  targetId: IdentifierSchema,
  version: z.number().int().positive(),
  scientificGoal: z.string().min(1),
  researchQuestion: z.string().min(1),
  initialHypotheses: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  verificationPolicyId: IdentifierSchema,
  stopConditions: z.array(z.string().min(1)).min(1),
  createdAt: TimestampSchema,
  createdBy: IdentifierSchema,
});
export type TargetVersion = z.infer<typeof TargetVersionSchema>;

export const CampaignSchema = z.object({
  id: IdentifierSchema,
  organizationId: IdentifierSchema,
  projectId: IdentifierSchema,
  targetVersionId: IdentifierSchema,
  datasetVersionIds: z.array(IdentifierSchema).default([]),
  permittedModelIds: z
    .array(IdentifierSchema)
    .min(1)
    .default([...DEFAULT_REFERENCE_RUNTIME_POLICY.permittedModelIds]),
  permittedToolIds: z
    .array(IdentifierSchema)
    .min(1)
    .default([...DEFAULT_REFERENCE_RUNTIME_POLICY.permittedToolIds]),
  fallbackMode: z
    .enum(['STOP', 'APPROVED_ONLY'])
    .default(DEFAULT_REFERENCE_RUNTIME_POLICY.fallbackMode),
  approvedFallbackModelIds: z
    .array(IdentifierSchema)
    .default([...DEFAULT_REFERENCE_RUNTIME_POLICY.approvedFallbackModelIds]),
  status: CampaignStatusSchema,
  resumeStatus: CampaignStatusSchema.nullable(),
  stateVersion: z.number().int().nonnegative(),
  budgetVersion: z.number().int().positive(),
  budgetLimit: BudgetLimitSchema,
  budgetUsage: BudgetUsageSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Campaign = z.infer<typeof CampaignSchema>;

export const TransitionPredicateSchema = z.object({
  targetComplete: z.boolean().default(false),
  routeApproved: z.boolean().default(false),
  budgetReserved: z.boolean().default(false),
  approvalValid: z.boolean().default(false),
  executionCompleted: z.boolean().default(false),
  provenanceComplete: z.boolean().default(false),
  verificationPassed: z.boolean().default(false),
  humanScientificApproval: z.boolean().default(false),
  blockerResolved: z.boolean().default(false),
  securityCleared: z.boolean().default(false),
});
export type TransitionPredicates = z.infer<typeof TransitionPredicateSchema>;
