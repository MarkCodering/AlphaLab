import { createHash } from 'node:crypto';
import {
  ActorSchema,
  ApprovalArtifactSchema,
  CampaignSchema,
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

export const ReferenceRunRequestSchema = z.object({
  campaign: CampaignSchema,
  target: TargetVersionSchema,
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
        revisionDigest: `sha256:${createHash('sha256')
          .update('reference-local-worker-model-v1')
          .digest('hex')}`,
        adapterVersion: '1.0.0',
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
  readonly executorId = 'reference-local-executor-v1';
  private readonly receipts = new Map<string, Awaited<ReturnType<ExperimentExecutor['execute']>>>();

  constructor(private readonly artifacts: LocalArtifactStore) {}

  async lookup(invocationId: string) {
    return this.receipts.get(invocationId);
  }

  async execute(invocation: Parameters<ExperimentExecutor['execute']>[0]) {
    const existing = this.receipts.get(invocation.invocationId);
    if (existing) return existing;
    const values = [2, 4, 6, 8];
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    const variance =
      values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
    const resultDocument = {
      operation: 'SUMMARY_STATISTICS',
      values,
      seed: 7,
      measurements: [
        { name: 'mean', value: mean },
        { name: 'populationStandardDeviation', value: Math.sqrt(variance) },
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

const verificationPolicy: VerificationPolicy = {
  policyVersion: 'reference-local-policy-v1',
  requiredReproductions: 1,
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

  constructor(private readonly root: string) {
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
    const executor = new ReferenceExperimentExecutor(this.artifactStore);
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
      seeds: [7],
      ...(input.approval ? { approval: input.approval } : {}),
    });
  }
}
