import type {
  Actor,
  BudgetLimit,
  Campaign,
  EvidenceRecord,
  VerificationReport,
} from '@alphalab/contracts';
import { describe, expect, it } from 'vitest';
import {
  assertCandidateEligibility,
  assertEvidenceCanSupportFinalClaim,
  emptyBudgetUsage,
  reserveBudget,
  transitionCampaign,
} from './index.js';

const timestamp = '2026-08-15T00:00:00+00:00';
const researcher: Actor = { type: 'USER', id: 'researcher-1', role: 'RESEARCHER' };
const reviewer: Actor = {
  type: 'USER',
  id: 'reviewer-1',
  role: 'SCIENTIFIC_REVIEWER',
};

function campaign(status: Campaign['status']): Campaign {
  return {
    id: 'campaign-1',
    organizationId: 'organization-1',
    projectId: 'project-1',
    targetVersionId: 'target-version-1',
    status,
    resumeStatus: null,
    stateVersion: 0,
    budgetVersion: 1,
    budgetLimit: {
      wallClockSeconds: 600,
      modelCalls: 5,
      tokens: 10_000,
      experiments: 2,
      computeMilliUnits: 10_000,
      parallelChildren: 1,
    },
    budgetUsage: emptyBudgetUsage(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('campaign state machine', () => {
  it('requires exact approval and a budget reservation before experiment execution', () => {
    expect(() =>
      transitionCampaign(campaign('WAITING_FOR_APPROVAL'), {
        to: 'RUNNING_EXPERIMENT',
        actor: researcher,
        predicates: { approvalValid: false, budgetReserved: true },
        reason: 'Run the approved experiment',
        occurredAt: timestamp,
      }),
    ).toThrowError(/predicates/i);
  });

  it('does not allow a researcher to confer verified status', () => {
    expect(() =>
      transitionCampaign(campaign('DISCOVERY_CANDIDATE'), {
        to: 'VERIFIED',
        actor: researcher,
        predicates: {
          provenanceComplete: true,
          verificationPassed: true,
          humanScientificApproval: true,
        },
        reason: 'Accept discovery',
        occurredAt: timestamp,
      }),
    ).toThrowError(/cannot perform/i);
  });

  it('allows an independent reviewer to verify only after every predicate passes', () => {
    const result = transitionCampaign(campaign('DISCOVERY_CANDIDATE'), {
      to: 'VERIFIED',
      actor: reviewer,
      predicates: {
        provenanceComplete: true,
        verificationPassed: true,
        humanScientificApproval: true,
      },
      reason: 'All policy predicates and independent review passed',
      occurredAt: timestamp,
    });
    expect(result.campaign.status).toBe('VERIFIED');
    expect(result.evidenceType).toBe('discovery.verified');
  });

  it('preserves the resume point when paused', () => {
    const result = transitionCampaign(campaign('RUNNING_EXPERIMENT'), {
      to: 'PAUSED',
      actor: researcher,
      reason: 'Pause requested',
      occurredAt: timestamp,
    });
    expect(result.campaign.resumeStatus).toBe('RUNNING_EXPERIMENT');
  });
});

describe('budget ledger', () => {
  const limit: BudgetLimit = {
    wallClockSeconds: 100,
    modelCalls: 2,
    tokens: 1000,
    experiments: 1,
    computeMilliUnits: 1000,
    parallelChildren: 1,
  };

  it('rejects work before it exceeds a hard limit', () => {
    expect(() => reserveBudget(limit, emptyBudgetUsage(), { experiments: 2 })).toThrowError(
      /exceeds/i,
    );
  });
});

describe('scientific evidence invariants', () => {
  it('does not permit an observation to masquerade as reproducible evidence', () => {
    const observation: EvidenceRecord = {
      contractVersion: '1.0',
      evidenceId: 'evidence-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
      campaignId: 'campaign-1',
      runId: 'run-1',
      targetVersionId: 'target-version-1',
      type: 'OBSERVATION',
      status: 'OBSERVED',
      statement: 'One run produced accuracy 0.9.',
      artifacts: [],
      supportsClaimIds: ['claim-1'],
      contradictsClaimIds: [],
      sourcePointers: [],
      createdAt: timestamp,
    };
    expect(() => assertEvidenceCanSupportFinalClaim(observation)).toThrowError(/reproduced/i);
  });

  it('treats a not-tested predicate as a failed candidate gate', () => {
    const report: VerificationReport = {
      contractVersion: '1.0',
      reportId: 'report-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
      campaignId: 'campaign-1',
      policyVersion: 'policy-1',
      status: 'VERIFIED',
      candidateEligible: true,
      humanApprovalRequired: true,
      createdAt: timestamp,
      predicateResults: [
        {
          predicateId: 'predicate-1',
          status: 'NOT_TESTED',
          evidenceIds: [],
          reason: 'No evidence was supplied.',
        },
      ],
    };
    expect(() => assertCandidateEligibility(report)).toThrowError(/must pass/i);
  });
});
