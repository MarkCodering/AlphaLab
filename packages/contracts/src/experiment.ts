import { z } from 'zod';
import {
  ArtifactReferenceSchema,
  ContractVersionSchema,
  DigestSchema,
  IdentifierSchema,
  TimestampSchema,
} from './common.js';

export const ExperimentInvocationSchema = z.object({
  contractVersion: ContractVersionSchema,
  invocationId: IdentifierSchema,
  experimentRunId: IdentifierSchema,
  organizationId: IdentifierSchema,
  projectId: IdentifierSchema,
  campaignId: IdentifierSchema,
  planDigest: DigestSchema,
  approvalId: IdentifierSchema,
  imageReference: z.string().regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/),
  imageDigest: DigestSchema,
  command: z.array(z.string()).min(1),
  inputs: z.array(
    z.object({
      artifact: ArtifactReferenceSchema,
      mountPath: z.string().startsWith('/inputs/'),
      readOnly: z.literal(true),
    }),
  ),
  resources: z.object({
    cpuMillis: z.number().int().positive(),
    memoryMiB: z.number().int().positive(),
    gpuCount: z.number().int().nonnegative(),
    diskMiB: z.number().int().positive(),
    timeoutSeconds: z.number().int().positive(),
    maxOutputBytes: z.number().int().positive(),
  }),
  networkPolicy: z.object({
    mode: z.enum(['DENY_ALL', 'ALLOWLIST']),
    allowedDestinations: z.array(z.string()),
  }),
  idempotencyKey: IdentifierSchema,
});
export type ExperimentInvocation = z.infer<typeof ExperimentInvocationSchema>;

export const ExperimentReceiptSchema = z.object({
  contractVersion: ContractVersionSchema,
  invocationId: IdentifierSchema,
  attemptId: IdentifierSchema,
  status: z.enum(['ACCEPTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'DENIED']),
  startedAt: TimestampSchema.optional(),
  completedAt: TimestampSchema.optional(),
  outputs: z.array(ArtifactReferenceSchema),
  environmentDigest: DigestSchema,
  exitCode: z.number().int().optional(),
  failurePacketId: IdentifierSchema.optional(),
});
export type ExperimentReceipt = z.infer<typeof ExperimentReceiptSchema>;
