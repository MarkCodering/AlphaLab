import { createHash } from 'node:crypto';
import { ModelManifestSchema, type ModelCapability } from '@alphalab/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ModelAdapterError,
  ModelProviderRouter,
  type ModelAdapter,
  type StructuredGenerationRequest,
} from './index.js';

const OutputSchema = z.object({ value: z.string() });

class StubAdapter implements ModelAdapter {
  calls = 0;

  constructor(
    readonly providerId: string,
    private readonly capabilities: ModelCapability[],
    private readonly failure?: ModelAdapterError,
  ) {}

  async discover() {
    return [
      ModelManifestSchema.parse({
        contractVersion: '1.0',
        providerId: this.providerId,
        modelId: 'shared-model',
        revisionDigest: `sha256:${createHash('sha256').update(this.providerId).digest('hex')}`,
        adapterVersion: '1.0.0',
        capabilities: this.capabilities,
        contextLimit: 8192,
        maxConcurrency: 1,
        dataBoundary: 'LOCAL',
        remoteCodeRequired: false,
      }),
    ];
  }

  async generateStructured<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ) {
    this.calls += 1;
    if (this.failure) throw this.failure;
    return {
      requestId: request.requestId,
      value: request.schema.parse({ value: this.providerId }) as z.output<TSchema>,
      manifest: (await this.discover())[0]!,
      usage: { inputTokens: 1, outputTokens: 1 },
      completedAt: '2026-08-15T00:00:00.000Z',
    };
  }
}

function request(
  overrides: Partial<Parameters<ModelProviderRouter['generateStructured']>[0]> = {},
) {
  return {
    requestId: 'req_provider_router',
    modelId: 'shared-model',
    prompt: 'Return structured output.',
    schema: OutputSchema,
    jsonSchema: {},
    timeoutMs: 1_000,
    requiredCapabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'] as ModelCapability[],
    permittedProviderIds: ['primary-local', 'fallback-local'],
    authority: 'ADVISORY' as const,
    fallback: { mode: 'APPROVED_ONLY' as const, approvedProviderIds: ['fallback-local'] },
    ...overrides,
  };
}

describe('ModelProviderRouter', () => {
  it('records an explicit approved fallback instead of silently substituting providers', async () => {
    const primary = new StubAdapter(
      'primary-local',
      ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'],
      new ModelAdapterError('PROVIDER_UNAVAILABLE', 'primary runtime unavailable'),
    );
    const fallback = new StubAdapter('fallback-local', ['TEXT_GENERATION', 'STRUCTURED_OUTPUT']);
    const routed = await new ModelProviderRouter([primary, fallback]).generateStructured(request());

    expect(routed.result.value).toEqual({ value: 'fallback-local' });
    expect(routed.fallback).toEqual({
      originalProviderId: 'primary-local',
      fallbackProviderId: 'fallback-local',
      reason: 'primary runtime unavailable',
      authority: 'ADVISORY',
    });
    expect(routed.attempts.map((attempt) => attempt.status)).toEqual(['FAILED', 'SUCCEEDED']);
  });

  it('stops after the selected provider when fallback policy is STOP', async () => {
    const primary = new StubAdapter(
      'primary-local',
      ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'],
      new ModelAdapterError('PROVIDER_UNAVAILABLE', 'primary runtime unavailable'),
    );
    const fallback = new StubAdapter('fallback-local', ['TEXT_GENERATION', 'STRUCTURED_OUTPUT']);
    const router = new ModelProviderRouter([primary, fallback]);

    await expect(
      router.generateStructured(request({ fallback: { mode: 'STOP', approvedProviderIds: [] } })),
    ).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(fallback.calls).toBe(0);
  });

  it('returns a typed unsupported-capability error before invoking an incompatible model', async () => {
    const primary = new StubAdapter('primary-local', ['TEXT_GENERATION']);
    const router = new ModelProviderRouter([primary]);

    await expect(
      router.generateStructured(
        request({
          permittedProviderIds: ['primary-local'],
          fallback: { mode: 'STOP', approvedProviderIds: [] },
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
    expect(primary.calls).toBe(0);
  });
});
