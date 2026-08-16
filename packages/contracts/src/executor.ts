import { z } from 'zod';
import { ContractVersionSchema, DigestSchema, IdentifierSchema, RiskTierSchema } from './common.js';

/**
 * Capability declaration for an experiment executor. Campaign policy selects
 * these stable IDs; the manifest makes its isolation boundary inspectable.
 */
export const ExecutorManifestSchema = z.object({
  contractVersion: ContractVersionSchema,
  executorId: IdentifierSchema,
  displayName: z.string().min(1),
  imageReference: z.string().regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/),
  imageDigest: DigestSchema,
  riskTier: RiskTierSchema,
  dataBoundary: z.enum(['LOCAL', 'DEPLOYMENT', 'EXTERNAL']),
  networkPolicy: z.enum(['DENY_ALL', 'ALLOWLIST_ONLY']),
  maxConcurrency: z.number().int().positive(),
  supportedOperations: z.array(z.string().min(1)).min(1),
});
export type ExecutorManifest = z.infer<typeof ExecutorManifestSchema>;
