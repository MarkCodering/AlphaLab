import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ModelAdapterError, OllamaAdapter } from './index.js';

const digest = 'a'.repeat(64);

describe('Ollama adapter', () => {
  it('blocks cloud-backed Ollama models in local-only mode', async () => {
    const adapter = new OllamaAdapter({
      fetcher: async () =>
        Response.json({
          models: [
            {
              name: 'cloud-model',
              model: 'cloud-model',
              digest,
              remote_model: 'vendor/model',
              remote_host: 'https://example.test',
              capabilities: ['completion'],
            },
          ],
        }),
    });

    await expect(
      adapter.generateStructured({
        requestId: 'request-1',
        modelId: 'cloud-model',
        prompt: 'Return JSON.',
        schema: z.object({ answer: z.string() }),
        jsonSchema: { type: 'object' },
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({
      code: 'EXTERNAL_MODEL_FORBIDDEN',
    } satisfies Partial<ModelAdapterError>);
  });

  it('validates structured local output against the requested schema', async () => {
    let call = 0;
    const adapter = new OllamaAdapter({
      fetcher: async () => {
        call += 1;
        if (call === 1) {
          return Response.json({
            models: [
              {
                name: 'local-model',
                model: 'local-model',
                digest,
                capabilities: ['completion'],
              },
            ],
          });
        }
        return Response.json({
          response: JSON.stringify({ answer: 'bounded' }),
          prompt_eval_count: 4,
          eval_count: 2,
        });
      },
    });
    const result = await adapter.generateStructured({
      requestId: 'request-2',
      modelId: 'local-model',
      prompt: 'Return JSON.',
      schema: z.object({ answer: z.literal('bounded') }),
      jsonSchema: { type: 'object' },
      timeoutMs: 1000,
    });
    expect(result.value).toEqual({ answer: 'bounded' });
    expect(result.manifest.dataBoundary).toBe('LOCAL');
  });
});
