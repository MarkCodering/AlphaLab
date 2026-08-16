import { z } from 'zod';
import { ContractVersionSchema, IdentifierSchema, TimestampSchema } from './common.js';

export const ExecutionControlFlagsSchema = z.object({
  campaignExecutionEnabled: z.boolean(),
  experimentExecutionEnabled: z.boolean(),
  externalNetworkAccessEnabled: z.boolean(),
  externalModelProvidersEnabled: z.boolean(),
  huggingFaceModelLoadingEnabled: z.boolean(),
  mcpIntegrationsEnabled: z.boolean(),
  cloudInfrastructureExecutionEnabled: z.boolean(),
  domainSpecificToolsEnabled: z.boolean(),
  verifiedDiscoveryGenerationEnabled: z.boolean(),
  automaticFallbackEnabled: z.boolean(),
  backgroundSchedulingEnabled: z.boolean(),
  evidenceReadOnly: z.boolean(),
});
export type ExecutionControlFlags = z.infer<typeof ExecutionControlFlagsSchema>;

export const ExecutionControlSchema = ExecutionControlFlagsSchema.extend({
  contractVersion: ContractVersionSchema,
  organizationId: IdentifierSchema,
  version: z.number().int().nonnegative(),
  updatedAt: TimestampSchema,
  updatedBy: IdentifierSchema,
});
export type ExecutionControl = z.infer<typeof ExecutionControlSchema>;

export const ExecutionControlUpdateSchema = ExecutionControlFlagsSchema.partial();
export type ExecutionControlUpdate = z.infer<typeof ExecutionControlUpdateSchema>;

export const DEFAULT_EXECUTION_CONTROL_FLAGS: ExecutionControlFlags = {
  campaignExecutionEnabled: true,
  experimentExecutionEnabled: true,
  externalNetworkAccessEnabled: false,
  externalModelProvidersEnabled: false,
  huggingFaceModelLoadingEnabled: false,
  mcpIntegrationsEnabled: false,
  cloudInfrastructureExecutionEnabled: false,
  domainSpecificToolsEnabled: false,
  verifiedDiscoveryGenerationEnabled: false,
  automaticFallbackEnabled: false,
  backgroundSchedulingEnabled: false,
  evidenceReadOnly: false,
};
