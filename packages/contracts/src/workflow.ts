import { z } from 'zod';
import { ApprovalArtifactSchema, ProposedActionSchema } from './approval.js';
import { CampaignSchema } from './campaign.js';
import { DigestSchema, IdentifierSchema, TimestampSchema } from './common.js';
import { VerificationReportSchema } from './evidence.js';
import {
  ControllerDecisionSchema,
  ExperimentPlanSchema,
  ExperimentResultSchema,
  HypothesisSchema,
  NextBestExperimentReportSchema,
  ReproducibilityBundleManifestSchema,
  SupervisorFindingSchema,
} from './scientific.js';

export const WorkflowReceiptSchema = z.object({
  nodeId: z.string().min(1),
  inputDigest: DigestSchema,
  outputDigest: DigestSchema,
  completedAt: TimestampSchema,
});
export type WorkflowReceipt = z.infer<typeof WorkflowReceiptSchema>;

export const CampaignWorkflowRecordSchema = z.object({
  schemaVersion: z.literal(1),
  workflowId: IdentifierSchema,
  runId: IdentifierSchema,
  campaign: CampaignSchema,
  hypothesis: HypothesisSchema.optional(),
  plan: ExperimentPlanSchema.optional(),
  proposedAction: ProposedActionSchema.optional(),
  approval: ApprovalArtifactSchema.optional(),
  results: z.array(ExperimentResultSchema),
  findings: z.array(SupervisorFindingSchema),
  controllerDecisions: z.array(ControllerDecisionSchema),
  nextBestExperimentReport: NextBestExperimentReportSchema.optional(),
  verificationReport: VerificationReportSchema.optional(),
  bundle: ReproducibilityBundleManifestSchema.optional(),
  receipts: z.record(z.string(), WorkflowReceiptSchema),
  lastError: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .optional(),
  updatedAt: TimestampSchema,
});
export type CampaignWorkflowRecord = z.infer<typeof CampaignWorkflowRecordSchema>;
