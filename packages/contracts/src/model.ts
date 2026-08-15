import { z } from 'zod';
import {
  ArtifactReferenceSchema,
  ContractVersionSchema,
  DigestSchema,
  IdentifierSchema,
} from './common.js';

export const ModelCapabilitySchema = z.enum([
  'TEXT_GENERATION',
  'STREAMING',
  'STRUCTURED_OUTPUT',
  'TOOL_CALLING',
  'EMBEDDING',
  'RERANKING',
  'DOMAIN_INFERENCE',
]);

export const ModelManifestSchema = z.object({
  contractVersion: ContractVersionSchema,
  providerId: IdentifierSchema,
  modelId: IdentifierSchema,
  revisionDigest: DigestSchema,
  adapterVersion: z.string().min(1),
  capabilities: z.array(ModelCapabilitySchema),
  contextLimit: z.number().int().positive(),
  maxConcurrency: z.number().int().positive(),
  dataBoundary: z.enum(['LOCAL', 'DEPLOYMENT', 'EXTERNAL']),
  remoteCodeRequired: z.boolean(),
});
export type ModelManifest = z.infer<typeof ModelManifestSchema>;

export const ModelInferenceRequestSchema = z.object({
  contractVersion: ContractVersionSchema,
  requestId: IdentifierSchema,
  organizationId: IdentifierSchema,
  projectId: IdentifierSchema,
  campaignId: IdentifierSchema,
  runId: IdentifierSchema,
  task: z.enum([
    'HYPOTHESIS_GENERATION',
    'EXPERIMENT_PLANNING',
    'PROCESS_SUPERVISION',
    'CONTROLLER_DECISION',
    'VERIFIER_CRITIQUE',
  ]),
  requiredCapabilities: z.array(ModelCapabilitySchema),
  permittedProviderIds: z.array(IdentifierSchema).min(1),
  contextCapsuleId: IdentifierSchema,
  responseSchemaId: IdentifierSchema,
  authority: z.literal('ADVISORY'),
  fallback: z.object({
    mode: z.enum(['STOP', 'APPROVED_ONLY']),
    approvedProviderIds: z.array(IdentifierSchema),
  }),
  limits: z.object({
    timeoutMs: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
  }),
});
export type ModelInferenceRequest = z.infer<typeof ModelInferenceRequestSchema>;

export const ModelInferenceResultSchema = z.object({
  contractVersion: ContractVersionSchema,
  requestId: IdentifierSchema,
  status: z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNSUPPORTED_CAPABILITY']),
  providerId: IdentifierSchema,
  modelId: IdentifierSchema,
  modelRevisionDigest: DigestSchema,
  adapterVersion: z.string().min(1),
  output: ArtifactReferenceSchema.optional(),
  fallbackFromProviderId: IdentifierSchema.optional(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  errorCode: z.string().optional(),
});
export type ModelInferenceResult = z.infer<typeof ModelInferenceResultSchema>;
