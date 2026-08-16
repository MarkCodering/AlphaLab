import { z } from 'zod';
import {
  ArtifactReferenceSchema,
  ContractVersionSchema,
  DigestSchema,
  IdentifierSchema,
  TimestampSchema,
} from './common.js';

export const HypothesisSchema = z.object({
  hypothesisId: IdentifierSchema,
  campaignId: IdentifierSchema,
  statement: z.string().min(1),
  rationale: z.string().min(1),
  falsificationCriteria: z.array(z.string().min(1)).min(1),
  assumptions: z.array(z.string().min(1)),
  generatedByRequestId: IdentifierSchema,
  createdAt: TimestampSchema,
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

export const ExperimentPlanSchema = z.object({
  planId: IdentifierSchema,
  campaignId: IdentifierSchema,
  hypothesisId: IdentifierSchema,
  version: z.number().int().positive(),
  objective: z.string().min(1),
  executorId: IdentifierSchema,
  imageReference: z.string().regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/),
  imageDigest: DigestSchema,
  command: z.array(z.string()).min(1),
  parameters: z.record(z.string(), z.unknown()),
  expectedMeasurements: z.array(z.string().min(1)).min(1),
  successPredicates: z.array(z.string().min(1)).min(1),
  estimatedComputeMilliUnits: z.number().int().nonnegative(),
  estimatedWallClockSeconds: z.number().int().positive(),
  requiresNetwork: z.boolean(),
  createdAt: TimestampSchema,
});
export type ExperimentPlan = z.infer<typeof ExperimentPlanSchema>;

export const MeasurementSchema = z.object({
  name: z.string().min(1),
  value: z.union([z.number(), z.string(), z.boolean()]),
  unit: z.string().min(1).optional(),
  tolerance: z.number().nonnegative().optional(),
});
export type Measurement = z.infer<typeof MeasurementSchema>;

export const ExperimentExecutionProvenanceSchema = z.object({
  codeRevision: z.string().min(1),
  codeRevisionVerified: z.boolean(),
  modelAdapter: z.object({
    providerId: IdentifierSchema,
    modelId: IdentifierSchema,
    modelRevisionDigest: DigestSchema,
    adapterVersion: z.string().min(1),
    promptTemplateVersion: z.string().min(1),
  }),
  datasets: z
    .array(
      z.object({
        datasetVersionId: IdentifierSchema,
        contentDigest: DigestSchema,
      }),
    )
    .min(1),
  invocation: z.object({
    imageReference: z.string().regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/),
    imageDigest: DigestSchema,
    command: z.array(z.string()).min(1),
    parameters: z.record(z.string(), z.unknown()),
    seeds: z.array(z.number().int()).min(1),
  }),
});
export type ExperimentExecutionProvenance = z.infer<typeof ExperimentExecutionProvenanceSchema>;

export const ExperimentResultSchema = z.object({
  resultId: IdentifierSchema,
  experimentRunId: IdentifierSchema,
  invocationId: IdentifierSchema,
  status: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED']),
  measurements: z.array(MeasurementSchema),
  artifacts: z.array(ArtifactReferenceSchema),
  modelProvenance: z
    .object({
      providerId: IdentifierSchema,
      modelId: IdentifierSchema,
      modelRevisionDigest: DigestSchema,
      normalizedResultDigest: DigestSchema,
    })
    .optional(),
  executionProvenance: ExperimentExecutionProvenanceSchema.optional(),
  normalizedResultDigest: DigestSchema.optional(),
  environmentDigest: DigestSchema,
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
  exitCode: z.number().int(),
  failurePacketId: IdentifierSchema.optional(),
});
export type ExperimentResult = z.infer<typeof ExperimentResultSchema>;

export const SupervisorFindingSchema = z.object({
  findingId: IdentifierSchema,
  campaignId: IdentifierSchema,
  runId: IdentifierSchema,
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  category: z.enum([
    'UNSUPPORTED_CLAIM',
    'ASSUMPTION',
    'METHOD_DEFECT',
    'STATISTICAL_DEFECT',
    'SECURITY_DEFECT',
    'PROVENANCE_DEFECT',
  ]),
  statement: z.string().min(1),
  evidenceIds: z.array(IdentifierSchema),
  blocksProgress: z.boolean(),
  createdAt: TimestampSchema,
});
export type SupervisorFinding = z.infer<typeof SupervisorFindingSchema>;

export const ControllerDecisionSchema = z.object({
  decisionId: IdentifierSchema,
  campaignId: IdentifierSchema,
  runId: IdentifierSchema,
  decision: z.enum([
    'CONTINUE',
    'BRANCH',
    'REPAIR',
    'BACKTRACK',
    'STOP',
    'RUN_EXPERIMENT',
    'NEEDS_HUMAN',
  ]),
  reason: z.string().min(1),
  policyPredicateIds: z.array(IdentifierSchema),
  authority: z.literal('ADVISORY'),
  createdAt: TimestampSchema,
});
export type ControllerDecision = z.infer<typeof ControllerDecisionSchema>;

/**
 * An advisory recommendation emitted when verification does not establish a
 * candidate. It deliberately contains no executable command: any follow-on
 * experiment must still be planned, policy-checked, and approved separately.
 */
export const NextBestExperimentReportSchema = z.object({
  contractVersion: ContractVersionSchema,
  reportId: IdentifierSchema,
  organizationId: IdentifierSchema,
  projectId: IdentifierSchema,
  campaignId: IdentifierSchema,
  runId: IdentifierSchema,
  hypothesisId: IdentifierSchema.optional(),
  verificationReportId: IdentifierSchema,
  summary: z.string().min(1),
  unresolvedPredicateIds: z.array(IdentifierSchema).min(1),
  evidenceGaps: z.array(z.string().min(1)).min(1),
  recommendedObjective: z.string().min(1),
  rationale: z.string().min(1),
  authority: z.literal('ADVISORY'),
  createdAt: TimestampSchema,
});
export type NextBestExperimentReport = z.infer<typeof NextBestExperimentReportSchema>;

export const ContextCapsuleSchema = z.object({
  contractVersion: ContractVersionSchema,
  contextCapsuleId: IdentifierSchema,
  organizationId: IdentifierSchema,
  projectId: IdentifierSchema,
  campaignId: IdentifierSchema,
  purpose: z.string().min(1),
  targetVersionId: IdentifierSchema,
  evidenceIds: z.array(IdentifierSchema),
  artifactRefs: z.array(ArtifactReferenceSchema),
  structuredFacts: z.record(z.string(), z.unknown()),
  tokenBudget: z.number().int().positive(),
  contentDigest: DigestSchema,
  createdAt: TimestampSchema,
});
export type ContextCapsule = z.infer<typeof ContextCapsuleSchema>;

export const FailurePacketSchema = z.object({
  contractVersion: ContractVersionSchema,
  failurePacketId: IdentifierSchema,
  campaignId: IdentifierSchema,
  runId: IdentifierSchema,
  invocationId: IdentifierSchema.optional(),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
  retryable: z.boolean(),
  attempt: z.number().int().positive(),
  artifactRefs: z.array(ArtifactReferenceSchema),
  recoveryOptions: z.array(z.string().min(1)),
  createdAt: TimestampSchema,
});
export type FailurePacket = z.infer<typeof FailurePacketSchema>;

export const ReproducibilityBundleManifestSchema = z.object({
  contractVersion: ContractVersionSchema,
  bundleId: IdentifierSchema,
  bundleVersion: z.literal(1),
  organizationId: IdentifierSchema,
  projectId: IdentifierSchema,
  campaignId: IdentifierSchema,
  targetVersionId: IdentifierSchema,
  createdAt: TimestampSchema,
  createdBy: IdentifierSchema,
  artifacts: z.array(ArtifactReferenceSchema),
  files: z.array(
    z.object({
      path: z.string().min(1),
      digest: DigestSchema,
      sizeBytes: z.number().int().nonnegative(),
    }),
  ),
  invocation: z.object({
    imageReference: z.string().regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/),
    imageDigest: DigestSchema,
    command: z.array(z.string()).min(1),
    parameters: z.record(z.string(), z.unknown()),
    seeds: z.array(z.number().int()),
    codeRevision: z.string().min(1).optional(),
    codeRevisionVerified: z.boolean().optional(),
    modelAdapter: z
      .object({
        providerId: IdentifierSchema,
        modelId: IdentifierSchema,
        modelRevisionDigest: DigestSchema,
        adapterVersion: z.string().min(1),
        promptTemplateVersion: z.string().min(1),
      })
      .optional(),
    datasets: z
      .array(
        z.object({
          datasetVersionId: IdentifierSchema,
          contentDigest: DigestSchema,
        }),
      )
      .optional(),
  }),
  normalizedResultDigest: DigestSchema,
  manifestDigest: DigestSchema.optional(),
});
export type ReproducibilityBundleManifest = z.infer<typeof ReproducibilityBundleManifestSchema>;
