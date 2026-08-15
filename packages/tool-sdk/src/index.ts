import { z } from 'zod';

export const ToolManifestSchema = z.object({
  contractVersion: z.literal('1.0'),
  toolId: z.string().min(3),
  version: z.string().min(1),
  description: z.string().min(1),
  inputSchemaId: z.string().min(3),
  outputSchemaId: z.string().min(3),
  dataBoundary: z.enum(['LOCAL', 'DEPLOYMENT', 'EXTERNAL']),
  networkHosts: z.array(z.string()).default([]),
  secretHandles: z.array(z.string()).default([]),
  riskTier: z.enum(['GREEN', 'YELLOW', 'RED']),
  idempotent: z.boolean(),
});
export type ToolManifest = z.infer<typeof ToolManifestSchema>;

export const ToolInvocationSchema = z.object({
  contractVersion: z.literal('1.0'),
  invocationId: z.string().min(3),
  organizationId: z.string().min(3),
  projectId: z.string().min(3),
  campaignId: z.string().min(3),
  runId: z.string().min(3),
  toolId: z.string().min(3),
  input: z.record(z.string(), z.unknown()),
  permittedNetworkHosts: z.array(z.string()),
  approvalDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  timeoutMs: z.number().int().positive(),
});
export type ToolInvocation = z.infer<typeof ToolInvocationSchema>;

export class ToolPolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolPolicyError';
  }
}

export function authorizeToolInvocation(
  manifest: ToolManifest,
  invocation: ToolInvocation,
  localOnly: boolean,
): void {
  if (manifest.toolId !== invocation.toolId) {
    throw new ToolPolicyError('TOOL_ID_MISMATCH', 'Invocation does not match the tool manifest');
  }
  if (localOnly && manifest.dataBoundary === 'EXTERNAL') {
    throw new ToolPolicyError(
      'EXTERNAL_TOOL_FORBIDDEN',
      'External tools are disabled in local-only mode',
    );
  }
  const undeclaredHosts = invocation.permittedNetworkHosts.filter(
    (host) => !manifest.networkHosts.includes(host),
  );
  if (undeclaredHosts.length > 0) {
    throw new ToolPolicyError(
      'NETWORK_HOST_FORBIDDEN',
      `Undeclared hosts: ${undeclaredHosts.join(', ')}`,
    );
  }
  if (manifest.riskTier === 'RED' && !invocation.approvalDigest) {
    throw new ToolPolicyError(
      'APPROVAL_REQUIRED',
      'Red tool invocations require an approval digest',
    );
  }
}
