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
  it('persists an approval-gated reference campaign and exports a reproducibility bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'alphalab-reference-runner-'));
    roots.push(root);
    const runner = new ReferenceWorkflowRunner(root);
    const now = '2026-08-15T00:00:00.000Z';
    const campaign = {
      id: 'cmp_reference_runner',
      organizationId: 'org_reference',
      projectId: 'prj_reference',
      targetVersionId: 'tgv_reference',
      status: 'READY' as const,
      resumeStatus: null,
      stateVersion: 0,
      budgetVersion: 1,
      budgetLimit: {
        wallClockSeconds: 600,
        modelCalls: 4,
        tokens: 1_000,
        experiments: 1,
        computeMilliUnits: 1_000,
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
      scientificGoal: 'Run one deterministic reference experiment.',
      researchQuestion: 'Is the frozen reference mean positive?',
      acceptanceCriteria: ['mean > 0'],
      verificationPolicyId: 'policy_reference',
      stopConditions: ['Stop after one approved experiment.'],
      createdAt: now,
      createdBy: 'researcher_reference',
    };
    const researcher = {
      type: 'USER' as const,
      id: 'researcher_reference',
      role: 'RESEARCHER' as const,
    };

    const waiting = await runner.run({ campaign, target, researcher });
    expect(waiting.campaign.status).toBe('WAITING_FOR_APPROVAL');
    expect(waiting.proposedAction).toBeDefined();
    expect(await runner.load(campaign.id)).toMatchObject({ workflowId: `workflow_${campaign.id}` });

    const complete = await runner.run({
      campaign,
      target,
      researcher,
      approval: {
        contractVersion: '1.0',
        approvalId: 'apr_reference',
        organizationId: campaign.organizationId,
        projectId: campaign.projectId,
        actionDigest: digestAction(waiting.proposedAction!),
        policyVersion: 'policy_reference',
        decision: 'APPROVED',
        decidedBy: { type: 'USER', id: 'reviewer_reference', role: 'SCIENTIFIC_REVIEWER' },
        decidedAt: now,
        expiresAt: '2026-08-16T00:00:00.000Z',
        singleUse: true,
        consumedAt: null,
        reason: 'The exact reference action was reviewed.',
      },
    });

    expect(complete.campaign.status).toBe('DISCOVERY_CANDIDATE');
    expect(complete.verificationReport?.status).toBe('VERIFIED');
    expect(complete.bundle?.artifacts).toHaveLength(1);
    expect(Object.keys(complete.receipts)).toEqual([
      'hypothesis',
      'plan',
      'supervision',
      'approval',
      'experiment',
      'verification',
      'export',
    ]);
  });
});
