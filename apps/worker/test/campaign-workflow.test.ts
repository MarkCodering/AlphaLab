import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Actor,
  ApprovalArtifact,
  Campaign,
  ExperimentResult,
  TargetVersion,
} from '@alphalab/contracts';
import { LocalArtifactStore, ReproducibilityBundleExporter } from '@alphalab/evidence';
import { DeterministicExperimentExecutor, type ExperimentExecutor } from '@alphalab/experiment-sdk';
import type {
  ModelAdapter,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from '@alphalab/model-adapters';
import { digestAction } from '@alphalab/policy';
import { DeterministicOutcomeVerifier, type VerificationPolicy } from '@alphalab/verifier';
import type { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import { CampaignWorkflow } from '../src/campaign-workflow.js';
import { FileWorkflowStore } from '../src/workflow-store.js';

const roots: string[] = [];
const timestamp = '2026-08-15T00:00:00+00:00';
const imageDigest = `sha256:${'a'.repeat(64)}` as const;
const resultDigest =
  `sha256:${createHash('sha256').update('normalized-result').digest('hex')}` as const;
const environmentDigest =
  `sha256:${createHash('sha256').update('reference-environment').digest('hex')}` as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class ReferenceModel implements ModelAdapter {
  readonly providerId = 'reference-model-provider';
  calls = 0;

  async discover() {
    return [];
  }

  async generateStructured<TSchema extends z.ZodType>(
    request: StructuredGenerationRequest<TSchema>,
  ): Promise<StructuredGenerationResult<z.output<TSchema>>> {
    this.calls += 1;
    const value = request.requestId.endsWith('-hypothesis')
      ? {
          statement: 'The fixed candidate exceeds the frozen baseline.',
          rationale: 'The candidate uses the approved feature transformation.',
          falsificationCriteria: ['Accuracy is below 0.9.'],
          assumptions: ['The frozen fixture is unchanged.'],
        }
      : {
          objective: 'Compare candidate accuracy against the frozen baseline.',
          command: ['python', '/work/reference_experiment.py'],
          parameters: { seed: 7 },
          expectedMeasurements: ['accuracy'],
          successPredicates: ['accuracy >= 0.9'],
        };
    return {
      requestId: request.requestId,
      value: request.schema.parse(value) as z.output<TSchema>,
      manifest: {
        contractVersion: '1.0',
        providerId: this.providerId,
        modelId: 'reference-model',
        revisionDigest: `sha256:${'c'.repeat(64)}`,
        adapterVersion: '1.0.0',
        capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'],
        contextLimit: 8192,
        maxConcurrency: 1,
        dataBoundary: 'LOCAL',
        remoteCodeRequired: false,
      },
      usage: { inputTokens: 0, outputTokens: 0 },
      completedAt: timestamp,
    };
  }
}

class FailIfCalledModel implements ModelAdapter {
  readonly providerId = 'must-not-run';
  async discover() {
    return [];
  }
  async generateStructured<TSchema extends z.ZodType>(
    _request: StructuredGenerationRequest<TSchema>,
  ): Promise<StructuredGenerationResult<z.output<TSchema>>> {
    throw new Error('Completed model nodes were replayed');
  }
}

const researcher: Actor = { type: 'USER', id: 'researcher-1', role: 'RESEARCHER' };
const serviceActor: Actor = { type: 'SERVICE', id: 'worker-1', role: 'SYSTEM_SERVICE' };
const reviewer: Actor = {
  type: 'USER',
  id: 'reviewer-1',
  role: 'SCIENTIFIC_REVIEWER',
};

function campaign(): Campaign {
  return {
    id: 'campaign-1',
    organizationId: 'organization-1',
    projectId: 'project-1',
    targetVersionId: 'target-version-1',
    datasetVersionIds: [],
    permittedModelIds: ['reference-model'],
    permittedToolIds: ['deterministic-reference-executor'],
    fallbackMode: 'STOP',
    approvedFallbackModelIds: [],
    status: 'READY',
    resumeStatus: null,
    stateVersion: 0,
    budgetVersion: 1,
    budgetLimit: {
      wallClockSeconds: 600,
      modelCalls: 4,
      tokens: 10_000,
      experiments: 1,
      computeMilliUnits: 1000,
      parallelChildren: 1,
    },
    budgetUsage: {
      wallClockSeconds: 0,
      modelCalls: 0,
      tokens: 0,
      experiments: 0,
      computeMilliUnits: 0,
      activeChildren: 0,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const target: TargetVersion = {
  id: 'target-version-1',
  organizationId: 'organization-1',
  projectId: 'project-1',
  targetId: 'target-1',
  version: 1,
  scientificGoal: 'Validate a bounded deterministic experiment.',
  researchQuestion: 'Does candidate accuracy reach 0.9?',
  initialHypotheses: ['The approved feature transformation improves accuracy.'],
  acceptanceCriteria: ['accuracy >= 0.9'],
  verificationPolicyId: 'verification-policy-1',
  stopConditions: ['Stop after one experiment.'],
  createdAt: timestamp,
  createdBy: researcher.id,
};

const verificationPolicy: VerificationPolicy = {
  policyVersion: 'verification-policy-1',
  requiredReproductions: 1,
  requireIdenticalNormalizedDigest: true,
  requireArtifacts: true,
  measurementPredicates: [
    { predicateId: 'accuracy-threshold', measurement: 'accuracy', operator: 'GTE', threshold: 0.9 },
  ],
  humanApprovalRequired: true,
};

describe('durable campaign workflow', () => {
  it('pauses for exact approval, resumes without model replay, and exports verified evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'alphalab-workflow-test-'));
    roots.push(root);
    const artifactStore = new LocalArtifactStore(join(root, 'artifacts'));
    const resultArtifact = await artifactStore.putJson({
      measurements: [{ name: 'accuracy', value: 0.91 }],
    });
    let executionCount = 0;
    const executor: ExperimentExecutor = new DeterministicExperimentExecutor(
      (invocation): ExperimentResult => {
        executionCount += 1;
        return {
          resultId: 'result-1',
          experimentRunId: invocation.experimentRunId,
          invocationId: invocation.invocationId,
          status: 'SUCCEEDED',
          measurements: [{ name: 'accuracy', value: 0.91 }],
          artifacts: [resultArtifact],
          modelProvenance: {
            providerId: 'reference-model-provider',
            modelId: 'reference-model',
            modelRevisionDigest: imageDigest,
            normalizedResultDigest: resultDigest,
          },
          executionProvenance: {
            codeRevision: '7f3b5c9a04bdc1e2f7f8e8e8693e7f05b27fe6b8',
            codeRevisionVerified: true,
            modelAdapter: {
              providerId: 'reference-model-provider',
              modelId: 'reference-model',
              modelRevisionDigest: imageDigest,
              adapterVersion: '1.0.0',
              promptTemplateVersion: 'reference-test-v1',
            },
            datasets: [
              {
                datasetVersionId: 'dataset-version-1',
                contentDigest: resultDigest,
              },
            ],
            invocation: {
              imageReference: invocation.imageReference,
              imageDigest: invocation.imageDigest,
              command: invocation.command,
              parameters: { seed: 7 },
              seeds: [7],
            },
          },
          normalizedResultDigest: resultDigest,
          environmentDigest,
          startedAt: timestamp,
          completedAt: timestamp,
          exitCode: 0,
        };
      },
    );
    const store = new FileWorkflowStore(join(root, 'workflows'));
    const exporter = new ReproducibilityBundleExporter(artifactStore, join(root, 'exports'));
    const model = new ReferenceModel();
    const workflow = new CampaignWorkflow({
      store,
      model,
      executor,
      verifier: new DeterministicOutcomeVerifier(),
      bundleExporter: exporter,
      now: () => timestamp,
    });
    const input = {
      campaign: campaign(),
      target,
      researcher,
      serviceActor,
      modelId: 'reference-model',
      executorId: executor.executorId,
      imageReference: `python@${imageDigest}`,
      imageDigest,
      verificationPolicy,
      seeds: [7],
    };

    await expect(
      workflow.run({
        ...input,
        campaign: { ...input.campaign, permittedModelIds: ['unapproved-model'] },
      }),
    ).rejects.toThrow('does not permit reference-model');
    expect(model.calls).toBe(0);

    const paused = await workflow.run(input);
    expect(paused.campaign.status).toBe('WAITING_FOR_APPROVAL');
    expect(paused.proposedAction).toBeDefined();
    expect(model.calls).toBe(2);
    expect(executionCount).toBe(0);

    const approval: ApprovalArtifact = {
      contractVersion: '1.0',
      approvalId: 'approval-1',
      organizationId: paused.campaign.organizationId,
      projectId: paused.campaign.projectId,
      actionDigest: digestAction(paused.proposedAction!),
      policyVersion: 'policy-1',
      decision: 'APPROVED',
      decidedBy: reviewer,
      decidedAt: timestamp,
      expiresAt: '2099-01-01T00:00:00+00:00',
      singleUse: true,
      consumedAt: null,
      reason: 'Reviewed the exact image, command, and plan digest.',
    };
    const resumed = await new CampaignWorkflow({
      store,
      model: new FailIfCalledModel(),
      executor,
      verifier: new DeterministicOutcomeVerifier(),
      bundleExporter: exporter,
      now: () => timestamp,
    }).run({ ...input, approval });

    expect(resumed.campaign.status).toBe('DISCOVERY_CANDIDATE');
    expect(resumed.verificationReport?.candidateEligible).toBe(true);
    expect(resumed.findings).toHaveLength(1);
    expect(resumed.controllerDecisions[0]?.decision).toBe('RUN_EXPERIMENT');
    expect(resumed.bundle).toBeDefined();
    expect(executionCount).toBe(1);
    expect(Object.keys(resumed.receipts)).toEqual([
      'hypothesis',
      'plan',
      'supervision',
      'approval',
      'experiment-1',
      'verification',
      'export',
    ]);
    await expect(
      exporter.verify(join(root, 'exports', resumed.bundle!.bundleId)),
    ).resolves.toMatchObject({ campaignId: 'campaign-1' });

    const replayed = await new CampaignWorkflow({
      store,
      model: new FailIfCalledModel(),
      executor,
      verifier: new DeterministicOutcomeVerifier(),
      bundleExporter: exporter,
      now: () => timestamp,
    }).run({ ...input, approval });
    expect(replayed.bundle?.manifestDigest).toBe(resumed.bundle?.manifestDigest);
    expect(executionCount).toBe(1);

    const insufficientCampaign = { ...campaign(), id: 'campaign-2' };
    const insufficientPolicy: VerificationPolicy = {
      ...verificationPolicy,
      measurementPredicates: [
        {
          predicateId: 'accuracy-threshold',
          measurement: 'accuracy',
          operator: 'GTE',
          threshold: 1,
        },
      ],
    };
    const insufficientInput = {
      ...input,
      campaign: insufficientCampaign,
      verificationPolicy: insufficientPolicy,
    };
    const insufficientWaiting = await workflow.run(insufficientInput);
    const insufficientApproval: ApprovalArtifact = {
      ...approval,
      approvalId: 'approval-2',
      actionDigest: digestAction(insufficientWaiting.proposedAction!),
    };
    const nextReady = await workflow.run({ ...insufficientInput, approval: insufficientApproval });
    expect(nextReady.campaign.status).toBe('NEXT_EXPERIMENT_READY');
    expect(nextReady.nextBestExperimentReport).toMatchObject({
      verificationReportId: nextReady.verificationReport?.reportId,
      unresolvedPredicateIds: ['accuracy-threshold'],
      authority: 'ADVISORY',
    });
    expect(nextReady.controllerDecisions.at(-1)).toMatchObject({ decision: 'REPAIR' });
    expect(nextReady.receipts['next-experiment']).toBeDefined();
  });
});
