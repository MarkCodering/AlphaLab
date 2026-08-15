import { z } from 'zod';

export const ContractVersionSchema = z.literal('1.0');
export type ContractVersion = z.infer<typeof ContractVersionSchema>;

export const IdentifierSchema = z.string().min(3).max(160);
export const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const TimestampSchema = z.iso.datetime({ offset: true });

export const ActorTypeSchema = z.enum(['USER', 'SERVICE']);
export const ActorRoleSchema = z.enum([
  'RESEARCHER',
  'SCIENTIFIC_REVIEWER',
  'ORGANIZATION_ADMIN',
  'INFRASTRUCTURE_OPERATOR',
  'SYSTEM_SERVICE',
]);

export const ActorSchema = z.object({
  type: ActorTypeSchema,
  id: IdentifierSchema,
  role: ActorRoleSchema,
});
export type Actor = z.infer<typeof ActorSchema>;

export const RiskTierSchema = z.enum(['GREEN', 'YELLOW', 'RED']);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const ArtifactReferenceSchema = z.object({
  artifactId: IdentifierSchema,
  digest: DigestSchema,
  mediaType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;
