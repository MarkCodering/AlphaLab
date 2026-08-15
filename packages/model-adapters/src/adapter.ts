import type { ModelManifest } from '@alphalab/contracts';
import type { z } from 'zod';

export interface StructuredGenerationRequest<TSchema extends z.ZodType> {
  requestId: string;
  modelId: string;
  prompt: string;
  schema: TSchema;
  jsonSchema: Record<string, unknown>;
  timeoutMs: number;
  temperature?: number;
  seed?: number;
}

export interface StructuredGenerationResult<T> {
  requestId: string;
  value: T;
  manifest: ModelManifest;
  usage: { inputTokens: number; outputTokens: number };
  completedAt: string;
}

export interface ModelAdapter {
  readonly providerId: string;
  discover(): Promise<ModelManifest[]>;
  generateStructured<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<StructuredGenerationResult<z.output<TSchema>>>;
}

export class ModelAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ModelAdapterError';
  }
}
