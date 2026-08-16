import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  ActorSchema,
  ApprovalArtifactSchema,
  CampaignSchema,
  DatasetVersionSchema,
  ExecutorManifestSchema,
  ExperimentResultSchema,
  TargetVersionSchema,
} from '@alphalab/contracts';
import { LocalArtifactStore, ReproducibilityBundleExporter } from '@alphalab/evidence';
import type { ExperimentExecutor } from '@alphalab/experiment-sdk';
import type {
  ModelAdapter,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from '@alphalab/model-adapters';
import { DeterministicOutcomeVerifier, type VerificationPolicy } from '@alphalab/verifier';
import { z } from 'zod';
import { CampaignWorkflow } from './campaign-workflow.js';
import { FileWorkflowStore, type CampaignWorkflowSnapshot as Snapshot } from './workflow-store.js';

const referenceImageDigest = `sha256:${'b'.repeat(64)}` as const;
const referenceEnvironmentDigest = `sha256:${createHash('sha256')
  .update('alphalab-reference-worker-v1')
  .digest('hex')}` as const;
const referenceDatasetDigest =
  'sha256:3b49c633f765420086ab2ec3967a1649d598af8f20e6da28e3520c81a0146641' as const;
const referenceModelRevisionDigest = `sha256:${createHash('sha256')
  .update('reference-local-worker-model-v1')
  .digest('hex')}` as const;
const referenceAdapterVersion = '1.0.0';
const referencePromptTemplateVersion = 'reference-workflow-v1';

export const referenceExecutorManifest = ExecutorManifestSchema.parse({
  contractVersion: '1.0',
  executorId: 'reference-local-executor-v1',
  displayName: 'Reference local executor',
  imageReference: `alphalab/reference-summary@${referenceImageDigest}`,
  imageDigest: referenceImageDigest,
  riskTier: 'RED',
  dataBoundary: 'LOCAL',
  networkPolicy: 'DENY_ALL',
  maxConcurrency: 1,
  supportedOperations: ['SUMMARY_STATISTICS'],
});

const DomainInferenceResultSchema = z.object({
  contractVersion: z.literal('1.0'),
  requestId: z.string(),
  status: z.literal('SUCCEEDED'),
  providerId: z.string(),
  modelId: z.string(),
  modelRevisionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  output: z.object({
    count: z.number().int(),
    mean: z.number(),
    minimum: z.number(),
    maximum: z.number(),
    populationStandardDeviation: z.number(),
    normalizedDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }),
});
type DomainInferenceResult = z.infer<typeof DomainInferenceResultSchema>;

export interface DomainInferenceClient {
  infer(input: {
    requestId: string;
    values: number[];
    seed: number;
  }): Promise<DomainInferenceResult>;
}

class LocalDomainInferenceClient implements DomainInferenceClient {
  async infer(input: { requestId: string; values: number[]; seed: number }) {
    const origin = process.env.ALPHALAB_MODEL_ORIGIN ?? 'http://127.0.0.1:8100';
    const response = await fetch(`${origin.replace(/\/$/, '')}/v1/inference/domain`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contractVersion: '1.0',
        requestId: input.requestId,
        modelId: 'deterministic-statistics-v1',
        operation: 'SUMMARY_STATISTICS',
        values: input.values,
        seed: input.seed,
        timeoutMs: 30_000,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Local domain model runtime returned HTTP ${response.status}`);
    }
    return DomainInferenceResultSchema.parse(payload);
  }
}

export const ReferenceRunRequestSchema = z.object({
  campaign: CampaignSchema,
  target: TargetVersionSchema,
  datasets: z.array(DatasetVersionSchema).min(1),
  researcher: ActorSchema.refine((actor) => actor.role === 'RESEARCHER', {
    message: 'reference workflows require a researcher actor',
  }),
  approval: ApprovalArtifactSchema.optional(),
});
export type ReferenceRunRequest = z.infer<typeof ReferenceRunRequestSchema>;

class ReferenceModel implements ModelAdapter {
  readonly providerId = 'reference-local-worker-model';

  async discover() {
    return [];
  }

  async generateStructured<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<StructuredGenerationResult<z.output<TSchema>>> {
    const value = request.requestId.endsWith('-hypothesis')
      ? {
          statement: 'The frozen reference sample has a positive mean.',
          rationale: 'The approved local reference values are deterministic and finite.',
          falsificationCriteria: ['The normalized mean is not greater than zero.'],
          assumptions: ['The local reference sample remains immutable for this run.'],
        }
      : {
          objective: 'Compute summary statistics for the frozen local reference sample.',
          command: ['alphalab-reference-summary'],
          parameters: { values: [2, 4, 6, 8], seed: 7 },
          expectedMeasurements: ['mean', 'populationStandardDeviation'],
          successPredicates: ['mean > 0'],
        };
    return {
      requestId: request.requestId,
      value: request.schema.parse(value) as z.output<TSchema>,
      manifest: {
        contractVersion: '1.0',
        providerId: this.providerId,
        modelId: 'reference-local-worker-model-v1',
        revisionDigest: referenceModelRevisionDigest,
        adapterVersion: referenceAdapterVersion,
        capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'],
        contextLimit: 8192,
        maxConcurrency: 1,
        dataBoundary: 'LOCAL',
        remoteCodeRequired: false,
      },
      usage: { inputTokens: 0, outputTokens: 0 },
      completedAt: new Date().toISOString(),
    };
  }
}

class ReferenceExperimentExecutor implements ExperimentExecutor {
  readonly executorId = referenceExecutorManifest.executorId;
  private readonly receipts = new Map<string, Awaited<ReturnType<ExperimentExecutor['execute']>>>();

  constructor(
    private readonly artifacts: LocalArtifactStore,
    private readonly dataset: z.infer<typeof DatasetVersionSchema>,
    private readonly domainInference: DomainInferenceClient,
  ) {}

  async lookup(invocationId: string) {
    return this.receipts.get(invocationId);
  }

  async execute(invocation: Parameters<ExperimentExecutor['execute']>[0]) {
    const existing = this.receipts.get(invocation.invocationId);
    if (existing) return existing;
    const values = [2, 4, 6, 8];
    const inference = await this.domainInference.infer({
      requestId: `req_${invocation.invocationId}_domain`,
      values,
      seed: 7,
    });
    const resultDocument = {
      operation: 'SUMMARY_STATISTICS',
      values,
      seed: 7,
      dataset: {
        datasetVersionId: this.dataset.datasetVersionId,
        contentDigest: this.dataset.contentDigest,
        sourcePointer: this.dataset.sourcePointer,
      },
      domainModel: {
        providerId: inference.providerId,
        modelId: inference.modelId,
        modelRevisionDigest: inference.modelRevisionDigest,
        normalizedDigest: inference.output.normalizedDigest,
      },
      measurements: [
        { name: 'mean', value: inference.output.mean },
        {
          name: 'populationStandardDeviation',
          value: inference.output.populationStandardDeviation,
        },
      ],
      network: 'DENY_ALL',
    };
    const artifact = await this.artifacts.putJson(resultDocument);
    const normalizedResultDigest = `sha256:${createHash('sha256')
      .update(JSON.stringify(resultDocument))
      .digest('hex')}` as const;
    const now = new Date().toISOString();
    const result = ExperimentResultSchema.parse({
      resultId: `res_${invocation.invocationId}`,
      experimentRunId: invocation.experimentRunId,
      invocationId: invocation.invocationId,
      status: 'SUCCEEDED',
      measurements: resultDocument.measurements,
      artifacts: [artifact],
      modelProvenance: {
        providerId: inference.providerId,
        modelId: inference.modelId,
        modelRevisionDigest: inference.modelRevisionDigest,
        normalizedResultDigest: inference.output.normalizedDigest,
      },
      executionProvenance: referenceExecutionProvenance(this.dataset, invocation),
      normalizedResultDigest,
      environmentDigest: referenceEnvironmentDigest,
      startedAt: now,
      completedAt: now,
      exitCode: 0,
    });
    this.receipts.set(invocation.invocationId, result);
    return result;
  }

  async cancel(): Promise<boolean> {
    return false;
  }
}

function referenceExecutionProvenance(
  dataset: z.infer<typeof DatasetVersionSchema>,
  invocation: Parameters<ExperimentExecutor['execute']>[0],
) {
  const sourceRevision = resolveSourceRevision();
  return {
    codeRevision: sourceRevision.value,
    codeRevisionVerified: sourceRevision.verified,
    modelAdapter: {
      providerId: 'reference-local-worker-model',
      modelId: 'reference-local-worker-model-v1',
      modelRevisionDigest: referenceModelRevisionDigest,
      adapterVersion: referenceAdapterVersion,
      promptTemplateVersion: referencePromptTemplateVersion,
    },
    datasets: [
      {
        datasetVersionId: dataset.datasetVersionId,
        contentDigest: dataset.contentDigest,
      },
    ],
    invocation: {
      imageReference: invocation.imageReference,
      imageDigest: invocation.imageDigest,
      command: invocation.command,
      parameters: { values: [2, 4, 6, 8], seed: 7 },
      seeds: [7],
    },
  };
}

function resolveSourceRevision(): { value: string; verified: boolean } {
  const configured = process.env.ALPHALAB_SOURCE_REVISION?.trim();
  if (configured) return { value: configured, verified: true };
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return revision
      ? { value: revision, verified: true }
      : { value: 'unavailable', verified: false };
  } catch {
    return { value: 'unavailable', verified: false };
  }
}

const verificationPolicy: VerificationPolicy = {
  policyVersion: 'reference-local-policy-v1',
  requiredReproductions: 3,
  requireIdenticalNormalizedDigest: true,
  requireArtifacts: true,
  measurementPredicates: [
    { predicateId: 'reference-positive-mean', measurement: 'mean', operator: 'GT', threshold: 0 },
  ],
  humanApprovalRequired: true,
};

export class ReferenceWorkflowRunner {
  private readonly store: FileWorkflowStore;
  private readonly artifactStore: LocalArtifactStore;
  private readonly active = new Map<string, Promise<Snapshot>>();

  constructor(
    private readonly root: string,
    private readonly domainInference: DomainInferenceClient = new LocalDomainInferenceClient(),
  ) {
    this.store = new FileWorkflowStore(`${root}/workflows`);
    this.artifactStore = new LocalArtifactStore(`${root}/artifacts`);
  }

  async run(raw: unknown): Promise<Snapshot> {
    const input = ReferenceRunRequestSchema.parse(raw);
    const active = this.active.get(input.campaign.id);
    if (active) return active;
    const operation = this.runOne(input).finally(() => this.active.delete(input.campaign.id));
    this.active.set(input.campaign.id, operation);
    return operation;
  }

  load(campaignId: string): Promise<Snapshot | undefined> {
    return this.store.load(campaignId);
  }

  private async runOne(input: ReferenceRunRequest): Promise<Snapshot> {
    if (!input.campaign.permittedModelIds.includes('deterministic-statistics-v1')) {
      throw new Error(
        'The local reference workflow requires deterministic-statistics-v1 in the campaign model policy.',
      );
    }
    if (!input.campaign.permittedToolIds.includes('reference-local-executor-v1')) {
      throw new Error(
        'The local reference workflow requires reference-local-executor-v1 in the campaign tool policy.',
      );
    }
    if (
      input.campaign.fallbackMode === 'APPROVED_ONLY' &&
      input.campaign.approvedFallbackModelIds.length === 0
    ) {
      throw new Error('Approved-only fallback requires an explicitly permitted fallback model.');
    }
    const dataset = input.datasets.find(
      (candidate) => candidate.contentDigest === referenceDatasetDigest,
    );
    if (!dataset) {
      throw new Error(
        'The local reference workflow requires the frozen reference dataset digest; choose a compatible executor for other datasets.',
      );
    }
    const executor = new ReferenceExperimentExecutor(
      this.artifactStore,
      dataset,
      this.domainInference,
    );
    const workflow = new CampaignWorkflow({
      store: this.store,
      model: new ReferenceModel(),
      executor,
      verifier: new DeterministicOutcomeVerifier(),
      bundleExporter: new ReproducibilityBundleExporter(this.artifactStore, `${this.root}/exports`),
    });
    return workflow.run({
      campaign: input.campaign,
      target: input.target,
      researcher: input.researcher,
      serviceActor: { type: 'SERVICE', id: 'reference-workflow-worker', role: 'SYSTEM_SERVICE' },
      modelId: 'reference-local-worker-model-v1',
      executorId: executor.executorId,
      imageReference: `alphalab/reference-summary@${referenceImageDigest}`,
      imageDigest: referenceImageDigest,
      verificationPolicy,
      seeds: [7, 7, 7],
      ...(input.approval ? { approval: input.approval } : {}),
    });
  }
}
