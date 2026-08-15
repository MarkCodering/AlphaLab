import { describe, expect, it } from 'vitest';
import { ToolInvocationSchema, ToolManifestSchema, authorizeToolInvocation } from './index.js';

const manifest = ToolManifestSchema.parse({
  contractVersion: '1.0',
  toolId: 'literature-local',
  version: '1.0.0',
  description: 'Search an approved local corpus',
  inputSchemaId: 'literature-query-v1',
  outputSchemaId: 'literature-result-v1',
  dataBoundary: 'LOCAL',
  riskTier: 'GREEN',
  idempotent: true,
});

it('denies hosts that were not declared by the tool', () => {
  const invocation = ToolInvocationSchema.parse({
    contractVersion: '1.0',
    invocationId: 'invocation-1',
    organizationId: 'organization-1',
    projectId: 'project-1',
    campaignId: 'campaign-1',
    runId: 'run-1',
    toolId: manifest.toolId,
    input: {},
    permittedNetworkHosts: ['example.com'],
    timeoutMs: 1000,
  });
  expect(() => authorizeToolInvocation(manifest, invocation, true)).toThrow('Undeclared hosts');
});

describe('red tool gates', () => {
  it('requires an exact approval digest before invocation', () => {
    const red = { ...manifest, riskTier: 'RED' as const };
    const invocation = ToolInvocationSchema.parse({
      contractVersion: '1.0',
      invocationId: 'invocation-2',
      organizationId: 'organization-1',
      projectId: 'project-1',
      campaignId: 'campaign-1',
      runId: 'run-1',
      toolId: manifest.toolId,
      input: {},
      permittedNetworkHosts: [],
      timeoutMs: 1000,
    });
    expect(() => authorizeToolInvocation(red, invocation, true)).toThrow('approval digest');
  });
});
