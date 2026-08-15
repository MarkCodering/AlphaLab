import { z } from 'zod';
import {
  ArtifactReferenceSchema,
  ContractVersionSchema,
  IdentifierSchema,
  TimestampSchema,
} from './common.js';

export const ScientificRecordTypeSchema = z.enum([
  'INTENT',
  'HYPOTHESIS',
  'OBSERVATION',
  'REPRODUCIBLE_EVIDENCE',
  'OPERATIONAL_EVIDENCE',
  'VERIFIED_DISCOVERY_CANDIDATE',
]);

export const EvidenceStatusSchema = z.enum([
  'PROPOSED',
  'OBSERVED',
  'REPRODUCED',
  'INVALIDATED',
  'SUPERSEDED',
]);

export const EvidenceRecordSchema = z.object({
  contractVersion: ContractVersionSchema,
  evidenceId: IdentifierSchema,
  organizationId: IdentifierSchema,
  projectId: IdentifierSchema,
  campaignId: IdentifierSchema,
  runId: IdentifierSchema,
  targetVersionId: IdentifierSchema,
  type: ScientificRecordTypeSchema,
  status: EvidenceStatusSchema,
  statement: z.string().min(1),
  artifacts: z.array(ArtifactReferenceSchema),
  supportsClaimIds: z.array(IdentifierSchema),
  contradictsClaimIds: z.array(IdentifierSchema),
  sourcePointers: z.array(z.string().min(1)),
  createdAt: TimestampSchema,
  invalidatedByEvidenceId: IdentifierSchema.optional(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

export const VerificationStatusSchema = z.enum([
  'VERIFIED',
  'NOT_VERIFIED',
  'FAILED',
  'NOT_TESTED',
  'CONTRADICTORY',
  'NEEDS_HUMAN',
]);

export const VerificationReportSchema = z.object({
  contractVersion: ContractVersionSchema,
  reportId: IdentifierSchema,
  organizationId: IdentifierSchema,
  projectId: IdentifierSchema,
  campaignId: IdentifierSchema,
  policyVersion: IdentifierSchema,
  status: VerificationStatusSchema,
  predicateResults: z.array(
    z.object({
      predicateId: IdentifierSchema,
      status: z.enum(['PASS', 'FAIL', 'NOT_TESTED']),
      evidenceIds: z.array(IdentifierSchema),
      reason: z.string().min(1),
    }),
  ),
  candidateEligible: z.boolean(),
  humanApprovalRequired: z.boolean(),
  createdAt: TimestampSchema,
});
export type VerificationReport = z.infer<typeof VerificationReportSchema>;
