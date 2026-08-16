import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EvidenceStoreError, LocalArtifactStore, ReproducibilityBundleExporter } from './index.js';

const roots: string[] = [];
const imageDigest = `sha256:${'a'.repeat(64)}` as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('content-addressed evidence', () => {
  it('exports and verifies a reproducibility bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'alphalab-evidence-test-'));
    roots.push(root);
    const store = new LocalArtifactStore(join(root, 'store'));
    const artifact = await store.putJson({ measurements: [{ name: 'accuracy', value: 0.91 }] });
    const exporter = new ReproducibilityBundleExporter(store, join(root, 'exports'));
    const exported = await exporter.export({
      organizationId: 'organization-1',
      projectId: 'project-1',
      campaignId: 'campaign-1',
      targetVersionId: 'target-version-1',
      createdBy: 'worker-1',
      createdAt: '2026-08-15T00:00:00+00:00',
      artifacts: [artifact],
      invocation: {
        imageReference: `python@${imageDigest}`,
        imageDigest,
        command: ['python', '/work/main.py'],
        parameters: {},
        seeds: [7],
      },
      normalizedResultDigest: artifact.digest as `sha256:${string}`,
    });
    const verified = await exporter.verify(exported.directory);
    expect(verified.manifestDigest).toMatch(/^sha256:/);
    expect(verified.files).toHaveLength(1);
  });

  it('detects bundle tampering', async () => {
    const root = await mkdtemp(join(tmpdir(), 'alphalab-evidence-test-'));
    roots.push(root);
    const store = new LocalArtifactStore(join(root, 'store'));
    const artifact = await store.putJson({ result: 'original' });
    const exporter = new ReproducibilityBundleExporter(store, join(root, 'exports'));
    const exported = await exporter.export({
      organizationId: 'organization-1',
      projectId: 'project-1',
      campaignId: 'campaign-1',
      targetVersionId: 'target-version-1',
      createdBy: 'worker-1',
      artifacts: [artifact],
      invocation: {
        imageReference: `python@${imageDigest}`,
        imageDigest,
        command: ['python'],
        parameters: {},
        seeds: [7],
      },
      normalizedResultDigest: artifact.digest as `sha256:${string}`,
    });
    await writeFile(join(exported.directory, 'artifacts', artifact.artifactId), 'tampered');
    await expect(exporter.verify(exported.directory)).rejects.toBeInstanceOf(EvidenceStoreError);
  });

  it('retrieves content by its immutable digest and rejects malformed digests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'alphalab-evidence-test-'));
    roots.push(root);
    const store = new LocalArtifactStore(join(root, 'store'));
    const artifact = await store.putBytes(Buffer.from('immutable evidence\n'), 'text/plain');

    await expect(store.getBytesByDigest(artifact.digest)).resolves.toEqual(
      Buffer.from('immutable evidence\n'),
    );
    await expect(store.getBytesByDigest('sha256:not-a-digest')).rejects.toMatchObject({
      code: 'DIGEST_INVALID',
    });
  });
});
