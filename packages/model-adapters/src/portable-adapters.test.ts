import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenAICompatibleAdapter } from './openai-compatible.js';
import { PythonDomainRuntimeAdapter } from './python-runtime.js';

it('requires configured revision digests from OpenAI-compatible runtimes', async () => {
  const adapter = new OpenAICompatibleAdapter({
    providerId: 'vllm-local',
    baseUrl: 'http://127.0.0.1:8000',
    revisionDigests: {},
    fetcher: async () => new Response(JSON.stringify({ data: [{ id: 'model-a' }] })),
  });
  await expect(adapter.discover()).rejects.toMatchObject({ code: 'MODEL_REVISION_UNPINNED' });
});

it('uses strict structured output on a pinned local vLLM-compatible model', async () => {
  const calls: string[] = [];
  const adapter = new OpenAICompatibleAdapter({
    providerId: 'vllm-local',
    baseUrl: 'http://127.0.0.1:8000',
    revisionDigests: { 'model-a': `sha256:${'a'.repeat(64)}` },
    fetcher: async (input, init) => {
      calls.push(String(input));
      if (String(input).endsWith('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'model-a' }] }));
      }
      const body = JSON.parse(String(init?.body)) as { response_format: { type: string } };
      expect(body.response_format.type).toBe('json_schema');
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":7}' } }] }));
    },
  });
  const result = await adapter.generateStructured({
    requestId: 'request-1',
    modelId: 'model-a',
    prompt: 'Return the answer.',
    schema: z.object({ answer: z.number() }),
    jsonSchema: { type: 'object' },
    timeoutMs: 1000,
  });
  expect(result.value.answer).toBe(7);
  expect(calls).toHaveLength(2);
});

describe('Python domain runtime adapter', () => {
  it('returns typed local domain inference', async () => {
    const adapter = new PythonDomainRuntimeAdapter('http://127.0.0.1:8100', async (input) => {
      if (String(input).endsWith('/models')) return new Response('[]');
      return new Response(
        JSON.stringify({
          contractVersion: '1.0',
          requestId: 'request-2',
          status: 'SUCCEEDED',
          providerId: 'python-local-runtime',
          modelId: 'deterministic-statistics-v1',
          modelRevisionDigest: `sha256:${'b'.repeat(64)}`,
          output: { mean: 2 },
        }),
      );
    });
    const result = await adapter.infer({
      requestId: 'request-2',
      modelId: 'deterministic-statistics-v1',
      operation: 'SUMMARY_STATISTICS',
      values: [1, 2, 3],
      seed: 1,
      timeoutMs: 1000,
    });
    expect(result.output).toEqual({ mean: 2 });
  });
});
