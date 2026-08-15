import { ModelManifestSchema, type ModelManifest } from '@alphalab/contracts';
import { z } from 'zod';
import {
  ModelAdapterError,
  type ModelAdapter,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from './adapter.js';

const OllamaTagsSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      model: z.string(),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      remote_model: z.string().optional(),
      remote_host: z.string().optional(),
      details: z
        .object({
          context_length: z.number().int().positive().optional(),
        })
        .passthrough()
        .optional(),
      capabilities: z.array(z.string()).optional(),
    }),
  ),
});

const OllamaGenerateResponseSchema = z.object({
  response: z.string(),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
});

export interface OllamaAdapterOptions {
  baseUrl?: string;
  allowExternal?: boolean;
  fetcher?: typeof fetch;
}

export class OllamaAdapter implements ModelAdapter {
  readonly providerId = 'ollama-local';
  private readonly baseUrl: string;
  private readonly allowExternal: boolean;
  private readonly fetcher: typeof fetch;

  constructor(options: OllamaAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
    this.allowExternal = options.allowExternal ?? false;
    this.fetcher = options.fetcher ?? fetch;
  }

  async discover(): Promise<ModelManifest[]> {
    const response = await this.fetcher(`${this.baseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new ModelAdapterError(
        'PROVIDER_UNAVAILABLE',
        `Ollama returned HTTP ${response.status}`,
      );
    }
    const tags = OllamaTagsSchema.parse(await response.json());
    return tags.models.map((model) =>
      ModelManifestSchema.parse({
        contractVersion: '1.0',
        providerId: this.providerId,
        modelId: model.model,
        revisionDigest: `sha256:${model.digest}`,
        adapterVersion: '1.0.0',
        capabilities: mapCapabilities(model.capabilities ?? []),
        contextLimit: model.details?.context_length ?? 4096,
        maxConcurrency: 1,
        dataBoundary: model.remote_model || model.remote_host ? 'EXTERNAL' : 'LOCAL',
        remoteCodeRequired: false,
      }),
    );
  }

  async generateStructured<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<StructuredGenerationResult<z.output<TSchema>>> {
    const manifests = await this.discover();
    const manifest = manifests.find((candidate) => candidate.modelId === request.modelId);
    if (!manifest) {
      throw new ModelAdapterError(
        'MODEL_NOT_FOUND',
        `Ollama model ${request.modelId} is unavailable`,
      );
    }
    if (manifest.dataBoundary === 'EXTERNAL' && !this.allowExternal) {
      throw new ModelAdapterError(
        'EXTERNAL_MODEL_FORBIDDEN',
        `Model ${request.modelId} leaves the deployment boundary`,
      );
    }
    if (!manifest.capabilities.includes('STRUCTURED_OUTPUT')) {
      throw new ModelAdapterError(
        'UNSUPPORTED_CAPABILITY',
        `Model ${request.modelId} does not declare structured output`,
      );
    }

    const response = await this.fetcher(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: request.modelId,
        prompt: request.prompt,
        stream: false,
        format: request.jsonSchema,
        options: {
          temperature: request.temperature ?? 0,
          ...(request.seed === undefined ? {} : { seed: request.seed }),
        },
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    if (!response.ok) {
      throw new ModelAdapterError('INFERENCE_FAILED', `Ollama returned HTTP ${response.status}`);
    }
    const generated = OllamaGenerateResponseSchema.parse(await response.json());
    let decoded: unknown;
    try {
      decoded = JSON.parse(generated.response);
    } catch (error) {
      throw new ModelAdapterError('OUTPUT_INVALID', 'Ollama returned invalid JSON', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      requestId: request.requestId,
      value: request.schema.parse(decoded) as z.output<TSchema>,
      manifest,
      usage: {
        inputTokens: generated.prompt_eval_count ?? 0,
        outputTokens: generated.eval_count ?? 0,
      },
      completedAt: new Date().toISOString(),
    };
  }
}

function mapCapabilities(capabilities: string[]): ModelManifest['capabilities'] {
  const mapped: ModelManifest['capabilities'] = ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'];
  if (capabilities.includes('tools')) mapped.push('TOOL_CALLING');
  if (capabilities.includes('embedding')) mapped.push('EMBEDDING');
  return mapped;
}
