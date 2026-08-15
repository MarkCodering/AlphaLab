import { ModelManifestSchema, type ModelManifest } from '@alphalab/contracts';
import { z } from 'zod';
import {
  ModelAdapterError,
  type ModelAdapter,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from './adapter.js';

const ModelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) })),
});

const CompletionResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
    })
    .optional(),
});

export interface OpenAICompatibleAdapterOptions {
  providerId: string;
  baseUrl: string;
  revisionDigests: Record<string, `sha256:${string}`>;
  contextLimits?: Record<string, number>;
  allowExternal?: boolean;
  authorizationHeader?: string;
  fetcher?: typeof fetch;
}

export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly providerId: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: OpenAICompatibleAdapterOptions) {
    this.providerId = options.providerId;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetcher = options.fetcher ?? fetch;
    if (!options.allowExternal && !isLoopback(this.baseUrl)) {
      throw new ModelAdapterError(
        'EXTERNAL_MODEL_FORBIDDEN',
        `Provider ${options.providerId} is outside the local boundary`,
      );
    }
  }

  async discover(): Promise<ModelManifest[]> {
    const response = await this.fetcher(`${this.baseUrl}/v1/models`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new ModelAdapterError(
        'PROVIDER_UNAVAILABLE',
        `Provider returned HTTP ${response.status}`,
      );
    }
    const models = ModelsResponseSchema.parse(await response.json());
    return models.data.map(({ id }) => {
      const revisionDigest = this.options.revisionDigests[id];
      if (!revisionDigest) {
        throw new ModelAdapterError(
          'MODEL_REVISION_UNPINNED',
          `Model ${id} has no approved immutable revision digest`,
        );
      }
      return ModelManifestSchema.parse({
        contractVersion: '1.0',
        providerId: this.providerId,
        modelId: id,
        revisionDigest,
        adapterVersion: '1.0.0',
        capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'],
        contextLimit: this.options.contextLimits?.[id] ?? 4096,
        maxConcurrency: 1,
        dataBoundary: isLoopback(this.baseUrl) ? 'LOCAL' : 'EXTERNAL',
        remoteCodeRequired: false,
      });
    });
  }

  async generateStructured<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<StructuredGenerationResult<z.output<TSchema>>> {
    const manifest = (await this.discover()).find((model) => model.modelId === request.modelId);
    if (!manifest)
      throw new ModelAdapterError('MODEL_NOT_FOUND', `Model ${request.modelId} is unavailable`);
    const response = await this.fetcher(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({
        model: request.modelId,
        messages: [{ role: 'user', content: request.prompt }],
        temperature: request.temperature ?? 0,
        seed: request.seed,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'alphalab_response', strict: true, schema: request.jsonSchema },
        },
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    if (!response.ok) {
      throw new ModelAdapterError('INFERENCE_FAILED', `Provider returned HTTP ${response.status}`);
    }
    const completion = CompletionResponseSchema.parse(await response.json());
    const content = completion.choices[0]!.message.content;
    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
    } catch {
      throw new ModelAdapterError('OUTPUT_INVALID', 'Provider returned invalid structured JSON');
    }
    return {
      requestId: request.requestId,
      value: request.schema.parse(decoded) as z.output<TSchema>,
      manifest,
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
      completedAt: new Date().toISOString(),
    };
  }

  private headers(): Record<string, string> {
    return this.options.authorizationHeader
      ? { authorization: this.options.authorizationHeader }
      : {};
  }
}

function isLoopback(value: string): boolean {
  const hostname = new URL(value).hostname;
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);
}
