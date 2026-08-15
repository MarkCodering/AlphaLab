import type { ExperimentResult } from '@alphalab/contracts';
import { describe, expect, it } from 'vitest';
import { DeterministicOutcomeVerifier, type VerificationPolicy } from './index.js';

const digest = `sha256:${'a'.repeat(64)}` as const;
const environmentDigest = `sha256:${'b'.repeat(64)}` as const;

function result(id: string, score = 0.91): ExperimentResult {
  return {
    resultId: id,
    experimentRunId: `run-${id}`,
    invocationId: `invocation-${id}`,
    status: 'SUCCEEDED',
    measurements: [{ name: 'accuracy', value: score }],
    artifacts: [
      { artifactId: `artifact-${id}`, digest, mediaType: 'application/json', sizeBytes: 10 },
    ],
    normalizedResultDigest: digest,
    environmentDigest,
    startedAt: '2026-08-15T00:00:00+00:00',
    completedAt: '2026-08-15T00:00:01+00:00',
    exitCode: 0,
  };
}

const policy: VerificationPolicy = {
  policyVersion: 'verification-policy-1',
  requiredReproductions: 2,
  requireIdenticalNormalizedDigest: true,
  requireArtifacts: true,
  measurementPredicates: [
    { predicateId: 'accuracy-threshold', measurement: 'accuracy', operator: 'GTE', threshold: 0.9 },
  ],
  humanApprovalRequired: true,
};

describe('deterministic outcome verifier', () => {
  it('creates an eligible candidate only when every predicate passes', () => {
    const report = new DeterministicOutcomeVerifier().verify({
      organizationId: 'organization-1',
      projectId: 'project-1',
      campaignId: 'campaign-1',
      results: [result('result-1'), result('result-2')],
      findings: [],
      policy,
      createdAt: '2026-08-15T00:00:02+00:00',
    });
    expect(report.status).toBe('VERIFIED');
    expect(report.candidateEligible).toBe(true);
  });

  it('never turns a missing measurement into passing evidence', () => {
    const missing = { ...result('result-1'), measurements: [] };
    const report = new DeterministicOutcomeVerifier().verify({
      organizationId: 'organization-1',
      projectId: 'project-1',
      campaignId: 'campaign-1',
      results: [missing, { ...missing, resultId: 'result-2' }],
      findings: [],
      policy,
    });
    expect(report.status).toBe('NOT_TESTED');
    expect(report.candidateEligible).toBe(false);
  });
});
