import type { ExperimentInvocation } from '@alphalab/contracts';
import { describe, expect, it } from 'vitest';
import { buildDockerRunArguments, ExperimentExecutorError } from './index.js';

const digest = `sha256:${'a'.repeat(64)}` as const;

function invocation(): ExperimentInvocation {
  return {
    contractVersion: '1.0',
    invocationId: 'invocation-1',
    experimentRunId: 'experiment-run-1',
    organizationId: 'organization-1',
    projectId: 'project-1',
    campaignId: 'campaign-1',
    planDigest: `sha256:${'b'.repeat(64)}`,
    approvalId: 'approval-1',
    imageReference: `python@${digest}`,
    imageDigest: digest,
    command: ['python', '/work/main.py'],
    inputs: [],
    resources: {
      cpuMillis: 1000,
      memoryMiB: 512,
      gpuCount: 0,
      diskMiB: 1024,
      timeoutSeconds: 60,
      maxOutputBytes: 100_000,
    },
    networkPolicy: { mode: 'DENY_ALL', allowedDestinations: [] },
    idempotencyKey: 'experiment-idempotency-1',
  };
}

describe('Docker experiment policy', () => {
  it('builds a non-root, read-only, no-network container invocation', () => {
    const args = buildDockerRunArguments(
      invocation(),
      [{ artifactId: 'artifact-1', hostPath: '/safe/input.json', mountPath: '/inputs/data' }],
      '/safe/outputs',
      'alphalab-test',
    );
    expect(args).toContain('none');
    expect(args).toContain('--read-only');
    expect(args).toContain('ALL');
    expect(args).toContain('no-new-privileges:true');
    expect(args.join(' ')).not.toContain('docker.sock');
    expect(args).toContain(`python@${digest}`);
    expect(args.slice(-3)).toEqual([`python@${digest}`, 'python', '/work/main.py']);
  });

  it('rejects an image tag or mismatched digest', () => {
    expect(() =>
      buildDockerRunArguments(
        { ...invocation(), imageReference: `python@sha256:${'c'.repeat(64)}` },
        [],
        '/safe/outputs',
        'alphalab-test',
      ),
    ).toThrowError(ExperimentExecutorError);
  });

  it('rejects network allowlists until an enforcing proxy exists', () => {
    expect(() =>
      buildDockerRunArguments(
        {
          ...invocation(),
          networkPolicy: { mode: 'ALLOWLIST', allowedDestinations: ['example.test:443'] },
        },
        [],
        '/safe/outputs',
        'alphalab-test',
      ),
    ).toThrowError(/deny-all/i);
  });
});
