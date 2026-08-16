import type { ModelCapability } from '@alphalab/contracts';
import type { z } from 'zod';
import {
  ModelAdapterError,
  type ModelAdapter,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from './adapter.js';

export interface RoutedStructuredGenerationRequest<
  TSchema extends z.ZodType,
> extends StructuredGenerationRequest<TSchema> {
  requiredCapabilities: ModelCapability[];
  permittedProviderIds: string[];
  authority: 'ADVISORY';
  fallback: {
    mode: 'STOP' | 'APPROVED_ONLY';
    approvedProviderIds: string[];
  };
}

export interface ProviderAttempt {
  providerId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'UNSUPPORTED_CAPABILITY';
  reason?: string;
}

export interface ProviderFallbackRecord {
  originalProviderId: string;
  fallbackProviderId: string;
  reason: string;
  authority: 'ADVISORY';
}

export interface ProviderRouteResult<T> {
  result: StructuredGenerationResult<T>;
  attempts: ProviderAttempt[];
  fallback?: ProviderFallbackRecord;
}

/**
 * Resolves a structured-generation request without allowing a provider change
 * to become invisible. A successful fallback is always emitted as a typed
 * record for the campaign/audit layer to persist with affected evidence.
 */
export class ModelProviderRouter {
  private readonly adapters = new Map<string, ModelAdapter>();

  constructor(adapters: ModelAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.providerId)) {
        throw new ModelAdapterError(
          'DUPLICATE_PROVIDER_ADAPTER',
          `Provider adapter ${adapter.providerId} was registered more than once`,
        );
      }
      this.adapters.set(adapter.providerId, adapter);
    }
  }

  async generateStructured<TSchema extends z.ZodType>(
    request: RoutedStructuredGenerationRequest<TSchema>,
  ): Promise<ProviderRouteResult<z.output<TSchema>>> {
    const candidateIds = this.candidateIds(request);
    const attempts: ProviderAttempt[] = [];
    let firstFailure: string | undefined;
    let terminalError: unknown;

    for (const providerId of candidateIds) {
      const adapter = this.adapters.get(providerId);
      if (!adapter) {
        const reason = `No adapter is registered for permitted provider ${providerId}`;
        attempts.push({ providerId, status: 'FAILED', reason });
        firstFailure ??= reason;
        terminalError = new ModelAdapterError('PROVIDER_UNAVAILABLE', reason);
        continue;
      }

      try {
        const manifests = await adapter.discover();
        const manifest = manifests.find((candidate) => candidate.modelId === request.modelId);
        if (!manifest) {
          throw new ModelAdapterError(
            'MODEL_NOT_FOUND',
            `Provider ${providerId} does not expose model ${request.modelId}`,
          );
        }
        const missingCapabilities = request.requiredCapabilities.filter(
          (capability) => !manifest.capabilities.includes(capability),
        );
        if (missingCapabilities.length) {
          const reason = `Provider ${providerId} model ${request.modelId} lacks ${missingCapabilities.join(', ')}`;
          attempts.push({ providerId, status: 'UNSUPPORTED_CAPABILITY', reason });
          firstFailure ??= reason;
          terminalError = new ModelAdapterError('UNSUPPORTED_CAPABILITY', reason, {
            missingCapabilities,
          });
          continue;
        }

        const result = await adapter.generateStructured(request);
        attempts.push({ providerId, status: 'SUCCEEDED' });
        const originalProviderId = candidateIds[0]!;
        return {
          result,
          attempts,
          ...(providerId === originalProviderId
            ? {}
            : {
                fallback: {
                  originalProviderId,
                  fallbackProviderId: providerId,
                  reason: firstFailure ?? 'The originally selected provider did not complete.',
                  authority: request.authority,
                },
              }),
        };
      } catch (error) {
        const reason = describeError(error);
        attempts.push({ providerId, status: 'FAILED', reason });
        firstFailure ??= reason;
        terminalError = error;
      }
    }

    if (terminalError instanceof ModelAdapterError) throw terminalError;
    throw new ModelAdapterError(
      'PROVIDER_UNAVAILABLE',
      `No permitted provider completed ${request.requestId}: ${firstFailure ?? 'unknown failure'}`,
      { attempts },
    );
  }

  private candidateIds<TSchema extends z.ZodType>(
    request: RoutedStructuredGenerationRequest<TSchema>,
  ): string[] {
    const [primary, ...alternatives] = request.permittedProviderIds;
    if (!primary) {
      throw new ModelAdapterError(
        'PROVIDER_NOT_PERMITTED',
        'At least one provider must be permitted',
      );
    }
    if (request.fallback.mode === 'STOP') return [primary];
    const approved = new Set(request.fallback.approvedProviderIds);
    return [primary, ...alternatives.filter((providerId) => approved.has(providerId))];
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Provider raised a non-error failure.';
}
