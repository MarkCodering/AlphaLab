import { createHash } from 'node:crypto';
import { ModelManifestSchema } from '@alphalab/contracts';
import type { z } from 'zod';
import type {
  ModelAdapter,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from './adapter.js';

export class DeterministicModelAdapter implements ModelAdapter {
  readonly providerId = 'deterministic-reference';

  constructor(private readonly responses: Record<string, unknown>) {}

  async discover() {
    return [
      ModelManifestSchema.parse({
        contractVersion: '1.0',
        providerId: this.providerId,
        modelId: 'reference-model',
        revisionDigest: `sha256:${createHash('sha256').update('reference-model-v1').digest('hex')}`,
        adapterVersion: '1.0.0',
        capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'],
        contextLimit: 8192,
        maxConcurrency: 1,
        dataBoundary: 'LOCAL',
        remoteCodeRequired: false,
      }),
    ];
  }

  async generateStructured<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<StructuredGenerationResult<z.output<TSchema>>> {
    const response = this.responses[request.requestId];
    return {
      requestId: request.requestId,
      value: request.schema.parse(response) as z.output<TSchema>,
      manifest: (await this.discover())[0]!,
      usage: { inputTokens: 0, outputTokens: 0 },
      completedAt: new Date().toISOString(),
    };
  }
}
