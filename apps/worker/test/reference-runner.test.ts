import { digestAction } from '@alphalab/policy';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReferenceWorkflowRunner } from '../src/reference-runner.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ReferenceWorkflowRunner', () => {
  it('resumes an approval-gated three-run reference workflow and exports a reproducibility bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'alphalab-reference-runner-'));
    roots.push(root);
    const inferenceResult = (requestId: string) => ({
      contractVersion: '1.0' as const,
      requestId,
      status: 'SUCCEEDED' as const,
      providerId: 'python-local-runtime',
      modelId: 'deterministic-statistics-v1',
      modelRevisionDigest: `sha256:${'a'.repeat(64)}`,
      output: {
        count: 4,
        mean: 5,
        minimum: 2,
        maximum: 8,
        populationStandardDeviation: Math.sqrt(5),
        normalizedDigest: `sha256:${'b'.repeat(64)}`,
      },
    });
    let inferenceCalls = 0;
    const runner = new ReferenceWorkflowRunner(root, {
      infer: async ({ requestId }) => {
        inferenceCalls += 1;
        if (inferenceCalls === 2) throw new Error('Injected second-reproduction interruption');
        return inferenceResult(requestId);
      },
    });
    const now = '2026-08-15T00:00:00.000Z';
    const campaign = {
      id: 'cmp_reference_runner',
      organizationId: 'org_reference',
      projectId: 'prj_reference',
      targetVersionId: 'tgv_reference',
      datasetVersionIds: ['dsv_reference'],
      permittedModelIds: ['reference-local-worker-model-v1', 'deterministic-statistics-v1'],
      permittedToolIds: ['reference-local-executor-v1'],
      fallbackMode: 'STOP' as const,
      approvedFallbackModelIds: [],
      status: 'READY' as const,
      resumeStatus: null,
      stateVersion: 0,
      budgetVersion: 1,
      budgetLimit: {
        wallClockSeconds: 600,
        modelCalls: 4,
        tokens: 1_000,
        experiments: 4,
        computeMilliUnits: 4_000,
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
      createdAt: now,
      updatedAt: now,
    };
    const target = {
      id: 'tgv_reference',
      organizationId: campaign.organizationId,
      projectId: campaign.projectId,
      targetId: 'tgt_reference',
      version: 1,
      scientificGoal: 'Run three deterministic reference reproductions.',
      researchQuestion: 'Is the frozen reference mean positive?',
      acceptanceCriteria: ['mean > 0'],
      verificationPolicyId: 'policy_reference',
      stopConditions: ['Stop after three approved reproductions.'],
      createdAt: now,
      createdBy: 'researcher_reference',
    };
    const researcher = {
      type: 'USER' as const,
      id: 'researcher_reference',
      role: 'RESEARCHER' as const,
    };
    const datasets = [
      {
        contractVersion: '1.0' as const,
        datasetVersionId: 'dsv_reference',
        datasetId: 'dst_reference',
        organizationId: campaign.organizationId,
        projectId: campaign.projectId,
        version: 1,
        name: 'Frozen reference values',
        description: 'Values [2, 4, 6, 8] encoded with a terminal newline.',
        format: 'JSON' as const,
        sourcePointer: 'local://reference-values-v1.json',
        license: 'CC0-1.0',
        contentDigest: 'sha256:3b49c633f765420086ab2ec3967a1649d598af8f20e6da28e3520c81a0146641',
        recordCount: 4,
        createdAt: now,
        createdBy: researcher.id,
      },
    ];

    await expect(
      runner.run({
        campaign: { ...campaign, permittedModelIds: ['unapproved-local-model'] },
        target,
        datasets,
        researcher,
      }),
    ).rejects.toThrow('deterministic-statistics-v1');

    const waiting = await runner.run({ campaign, target, datasets, researcher });
    expect(waiting.campaign.status).toBe('WAITING_FOR_APPROVAL');
    expect(waiting.proposedAction).toBeDefined();
    expect(await runner.load(campaign.id)).toMatchObject({ workflowId: `workflow_${campaign.id}` });

    const approval = {
      contractVersion: '1.0' as const,
      approvalId: 'apr_reference',
      organizationId: campaign.organizationId,
      projectId: campaign.projectId,
      actionDigest: digestAction(waiting.proposedAction!),
      policyVersion: 'policy_reference',
      decision: 'APPROVED' as const,
      decidedBy: {
        type: 'USER' as const,
        id: 'reviewer_reference',
        role: 'SCIENTIFIC_REVIEWER' as const,
      },
      decidedAt: now,
      expiresAt: '2099-01-01T00:00:00.000Z',
      singleUse: true as const,
      consumedAt: null,
      reason: 'The exact three-reproduction reference action was reviewed.',
    };
    await expect(
      runner.run({
        campaign,
        target,
        datasets,
        researcher,
        approval,
      }),
    ).rejects.toThrow('Injected second-reproduction interruption');
    const interrupted = await runner.load(campaign.id);
    expect(interrupted?.results).toHaveLength(1);
    expect(interrupted?.campaign.budgetUsage.activeChildren).toBe(0);

    const resumedRunner = new ReferenceWorkflowRunner(root, {
      infer: async ({ requestId }) => inferenceResult(requestId),
    });
    const complete = await resumedRunner.run({
      campaign,
      target,
      datasets,
      researcher,
      approval,
    });

    expect(complete.campaign.status).toBe('DISCOVERY_CANDIDATE');
    expect(complete.verificationReport?.status).toBe('VERIFIED');
    expect(complete.results).toHaveLength(3);
    expect(complete.bundle?.artifacts).toHaveLength(3);
    expect(complete.results[0]?.measurements).toContainEqual({ name: 'mean', value: 5 });
    expect(Object.keys(complete.receipts)).toEqual([
      'hypothesis',
      'plan',
      'supervision',
      'approval',
      'experiment-1',
      'experiment-2',
      'experiment-3',
      'verification',
      'export',
    ]);
  });
});
