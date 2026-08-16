import { z } from 'zod';
import {
  ArtifactReferenceSchema,
  ContractVersionSchema,
  DigestSchema,
  IdentifierSchema,
  TimestampSchema,
} from './common.js';

export const DatasetFormatSchema = z.enum(['CSV', 'JSON', 'PARQUET', 'OTHER']);
export type DatasetFormat = z.infer<typeof DatasetFormatSchema>;

export const DatasetVersionSchema = z.object({
  contractVersion: ContractVersionSchema,
  datasetVersionId: IdentifierSchema,
  datasetId: IdentifierSchema,
  organizationId: IdentifierSchema,
  projectId: IdentifierSchema,
  version: z.number().int().positive(),
  name: z.string().min(1).max(160),
  description: z.string().max(4000),
  format: DatasetFormatSchema,
  sourcePointer: z.string().min(1).max(4000),
  license: z.string().min(1).max(400),
  contentDigest: DigestSchema,
  artifact: ArtifactReferenceSchema.optional(),
  recordCount: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  createdBy: IdentifierSchema,
});
export type DatasetVersion = z.infer<typeof DatasetVersionSchema>;
