import { describe, expect, it } from 'vitest';
import {
  CampaignStatusSchema,
  DigestSchema,
  ReproducibilityBundleManifestSchema,
  TargetVersionSchema,
} from './index.js';

describe('shared contracts', () => {
  it('includes the explicit pause state', () => {
    expect(CampaignStatusSchema.parse('PAUSED')).toBe('PAUSED');
  });

  it('rejects untagged content digests', () => {
    expect(() => DigestSchema.parse('abc123')).toThrow();
  });

  it('requires at least one acceptance criterion and stop condition', () => {
    const result = TargetVersionSchema.safeParse({
      id: 'target-version-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
      targetId: 'target-1',
      version: 1,
      scientificGoal: 'Evaluate a fixed baseline.',
      researchQuestion: 'Does the candidate exceed the baseline?',
      acceptanceCriteria: [],
      verificationPolicyId: 'verification-policy-1',
      stopConditions: [],
      createdAt: '2026-08-15T00:00:00+00:00',
      createdBy: 'researcher-1',
    });

    expect(result.success).toBe(false);
  });

  it('requires a content-addressed result in every reproducibility manifest', () => {
    const result = ReproducibilityBundleManifestSchema.safeParse({
      contractVersion: '1.0',
      bundleId: 'bundle-1',
      bundleVersion: 1,
      organizationId: 'organization-1',
      projectId: 'project-1',
      campaignId: 'campaign-1',
      targetVersionId: 'target-version-1',
      createdAt: '2026-08-15T00:00:00+00:00',
      createdBy: 'service-1',
      artifacts: [],
      files: [],
      invocation: {
        imageReference: `python@sha256:${'a'.repeat(64)}`,
        imageDigest: `sha256:${'a'.repeat(64)}`,
        command: ['python', '/work/main.py'],
        parameters: {},
        seeds: [7],
      },
    });
    expect(result.success).toBe(false);
  });
});
