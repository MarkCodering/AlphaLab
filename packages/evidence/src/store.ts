import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ArtifactReferenceSchema,
  ReproducibilityBundleManifestSchema,
  type ArtifactReference,
  type ReproducibilityBundleManifest,
} from '@alphalab/contracts';

export class EvidenceStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EvidenceStoreError';
  }
}

export class LocalArtifactStore {
  constructor(private readonly root: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.objectRoot(), { recursive: true });
  }

  async putBytes(bytes: Uint8Array, mediaType: string): Promise<ArtifactReference> {
    await this.initialize();
    const digest = sha256(bytes);
    const objectPath = this.pathForDigest(digest);
    await mkdir(resolve(objectPath, '..'), { recursive: true });
    await writeFile(objectPath, bytes, { flag: 'wx' }).catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readFile(objectPath);
      if (sha256(existing) !== digest) {
        throw new EvidenceStoreError('ARTIFACT_INTEGRITY_FAILED', 'Existing object hash differs');
      }
    });
    return ArtifactReferenceSchema.parse({
      artifactId: `art_${digest.slice(7, 23)}`,
      digest,
      mediaType,
      sizeBytes: bytes.byteLength,
    });
  }

  async putJson(value: unknown): Promise<ArtifactReference> {
    const bytes = Buffer.from(`${JSON.stringify(canonicalize(value), null, 2)}\n`, 'utf8');
    return this.putBytes(bytes, 'application/json');
  }

  async getBytes(artifact: ArtifactReference): Promise<Buffer> {
    const bytes = await readFile(this.pathForDigest(artifact.digest));
    if (bytes.byteLength !== artifact.sizeBytes || sha256(bytes) !== artifact.digest) {
      throw new EvidenceStoreError(
        'ARTIFACT_INTEGRITY_FAILED',
        `Artifact ${artifact.artifactId} failed integrity verification`,
      );
    }
    return bytes;
  }

  sourcePath(artifact: ArtifactReference): string {
    return this.pathForDigest(artifact.digest);
  }

  private objectRoot(): string {
    return resolve(this.root, 'objects', 'sha256');
  }

  private pathForDigest(digest: string): string {
    const hash = digest.replace(/^sha256:/, '');
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new EvidenceStoreError('DIGEST_INVALID', 'Artifact digest is invalid');
    }
    return join(this.objectRoot(), hash.slice(0, 2), hash.slice(2));
  }
}

export interface BundleExportInput {
  organizationId: string;
  projectId: string;
  campaignId: string;
  targetVersionId: string;
  createdBy: string;
  createdAt?: string;
  artifacts: ArtifactReference[];
  invocation: ReproducibilityBundleManifest['invocation'];
  normalizedResultDigest: `sha256:${string}`;
}

export class ReproducibilityBundleExporter {
  constructor(
    private readonly artifactStore: LocalArtifactStore,
    private readonly exportRoot: string,
  ) {}

  async export(input: BundleExportInput): Promise<{
    directory: string;
    manifest: ReproducibilityBundleManifest;
  }> {
    const bundleId = `bundle_${randomUUID()}`;
    const directory = resolve(this.exportRoot, bundleId);
    const artifactDirectory = join(directory, 'artifacts');
    await mkdir(artifactDirectory, { recursive: true });

    const files: ReproducibilityBundleManifest['files'] = [];
    for (const artifact of [...input.artifacts].sort((left, right) =>
      left.artifactId.localeCompare(right.artifactId),
    )) {
      await this.artifactStore.getBytes(artifact);
      const relativePath = `artifacts/${artifact.artifactId}`;
      const destination = join(directory, relativePath);
      await copyFile(this.artifactStore.sourcePath(artifact), destination);
      files.push({ path: relativePath, digest: artifact.digest, sizeBytes: artifact.sizeBytes });
    }

    const unsignedManifest = ReproducibilityBundleManifestSchema.parse({
      contractVersion: '1.0',
      bundleId,
      bundleVersion: 1,
      organizationId: input.organizationId,
      projectId: input.projectId,
      campaignId: input.campaignId,
      targetVersionId: input.targetVersionId,
      createdAt: input.createdAt ?? new Date().toISOString(),
      createdBy: input.createdBy,
      artifacts: input.artifacts,
      files,
      invocation: input.invocation,
      normalizedResultDigest: input.normalizedResultDigest,
    });
    const manifestDigest = sha256(
      Buffer.from(JSON.stringify(canonicalize(unsignedManifest)), 'utf8'),
    );
    const manifest = ReproducibilityBundleManifestSchema.parse({
      ...unsignedManifest,
      manifestDigest,
    });
    await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
    });
    return { directory, manifest };
  }

  async verify(directory: string): Promise<ReproducibilityBundleManifest> {
    const manifest = ReproducibilityBundleManifestSchema.parse(
      JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')),
    );
    const { manifestDigest, ...unsigned } = manifest;
    if (manifestDigest !== sha256(Buffer.from(JSON.stringify(canonicalize(unsigned)), 'utf8'))) {
      throw new EvidenceStoreError('MANIFEST_INTEGRITY_FAILED', 'Manifest digest does not match');
    }
    for (const file of manifest.files) {
      const path = resolve(directory, file.path);
      if (!path.startsWith(`${resolve(directory)}/`)) {
        throw new EvidenceStoreError('BUNDLE_PATH_INVALID', 'Bundle path leaves the export root');
      }
      const bytes = await readFile(path);
      if (bytes.byteLength !== file.sizeBytes || sha256(bytes) !== file.digest) {
        throw new EvidenceStoreError('BUNDLE_INTEGRITY_FAILED', `Bundle file ${file.path} differs`);
      }
    }
    return manifest;
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function sha256(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
