import { ModelManifestSchema, type ModelManifest } from '@alphalab/contracts';
import { z } from 'zod';
import { ModelAdapterError } from './adapter.js';

const DomainResultSchema = z.object({
  contractVersion: z.literal('1.0'),
  requestId: z.string(),
  status: z.enum(['SUCCEEDED', 'FAILED', 'UNSUPPORTED_CAPABILITY']),
  providerId: z.string(),
  modelId: z.string(),
  modelRevisionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  output: z.record(z.string(), z.unknown()).nullable().optional(),
  errorCode: z.string().nullable().optional(),
});

export interface DomainInferenceRequest {
  requestId: string;
  modelId: string;
  operation: 'SUMMARY_STATISTICS';
  values: number[];
  seed: number;
  timeoutMs: number;
}

export class PythonDomainRuntimeAdapter {
  readonly providerId = 'python-local-runtime';
  private readonly baseUrl: string;

  constructor(
    baseUrl = 'http://127.0.0.1:8100',
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    const hostname = new URL(this.baseUrl).hostname;
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname)) {
      throw new ModelAdapterError(
        'EXTERNAL_MODEL_FORBIDDEN',
        'The Python model runtime adapter is local-only',
      );
    }
  }

  async discover(): Promise<ModelManifest[]> {
    const response = await this.fetcher(`${this.baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok)
      throw new ModelAdapterError('PROVIDER_UNAVAILABLE', 'Python runtime is unavailable');
    return z.array(ModelManifestSchema).parse(await response.json());
  }

  async infer(request: DomainInferenceRequest) {
    const response = await this.fetcher(`${this.baseUrl}/v1/inference/domain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contractVersion: '1.0',
        requestId: request.requestId,
        modelId: request.modelId,
        operation: request.operation,
        values: request.values,
        seed: request.seed,
        timeoutMs: request.timeoutMs,
      }),
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    if (!response.ok)
      throw new ModelAdapterError(
        'INFERENCE_FAILED',
        `Python runtime returned HTTP ${response.status}`,
      );
    return DomainResultSchema.parse(await response.json());
  }
}
