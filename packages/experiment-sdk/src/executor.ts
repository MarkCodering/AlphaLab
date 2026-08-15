import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import {
  ExperimentResultSchema,
  type ArtifactReference,
  type ExperimentInvocation,
  type ExperimentResult,
  type Measurement,
} from '@alphalab/contracts';

export interface ResolvedExperimentInput {
  artifactId: string;
  hostPath: string;
  mountPath: string;
}

export interface ExperimentExecutor {
  readonly executorId: string;
  lookup(invocationId: string): Promise<ExperimentResult | undefined>;
  execute(
    invocation: ExperimentInvocation,
    inputs?: ResolvedExperimentInput[],
  ): Promise<ExperimentResult>;
  cancel(invocationId: string): Promise<boolean>;
}

export class ExperimentExecutorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ExperimentExecutorError';
  }
}

export interface DockerExecutorOptions {
  dockerBinary?: string;
  workspaceRoot?: string;
  maxLogBytes?: number;
}

export class DockerExperimentExecutor implements ExperimentExecutor {
  readonly executorId = 'docker-local-v1';
  private readonly dockerBinary: string;
  private readonly workspaceRoot: string;
  private readonly maxLogBytes: number;
  private readonly receipts = new Map<string, ExperimentResult>();
  private readonly active = new Map<string, ReturnType<typeof spawn>>();

  constructor(options: DockerExecutorOptions = {}) {
    this.dockerBinary = options.dockerBinary ?? 'docker';
    this.workspaceRoot = options.workspaceRoot ?? tmpdir();
    this.maxLogBytes = options.maxLogBytes ?? 1_000_000;
  }

  async lookup(invocationId: string): Promise<ExperimentResult | undefined> {
    return this.receipts.get(invocationId);
  }

  async execute(
    invocation: ExperimentInvocation,
    inputs: ResolvedExperimentInput[] = [],
  ): Promise<ExperimentResult> {
    const existing = this.receipts.get(invocation.invocationId);
    if (existing) return existing;

    const workspace = await mkdtemp(join(resolve(this.workspaceRoot), 'alphalab-run-'));
    const outputPath = join(workspace, 'outputs');
    await mkdir(outputPath, { recursive: true });
    const startedAt = new Date().toISOString();
    const containerName = `alphalab-${safeName(invocation.invocationId)}`;
    const args = buildDockerRunArguments(invocation, inputs, outputPath, containerName);
    const child = spawn(this.dockerBinary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '' },
    });
    this.active.set(invocation.invocationId, child);

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = boundedAppend(stdout, chunk.toString('utf8'), this.maxLogBytes);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = boundedAppend(stderr, chunk.toString('utf8'), this.maxLogBytes);
    });

    const timeout = setTimeout(
      () => child.kill('SIGTERM'),
      invocation.resources.timeoutSeconds * 1000,
    );
    const exitCode = await new Promise<number>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolveExit(code ?? 137));
    }).finally(() => {
      clearTimeout(timeout);
      this.active.delete(invocation.invocationId);
    });

    const completedAt = new Date().toISOString();
    const artifacts = await collectArtifacts(outputPath);
    const resultDocument = await readResultDocument(outputPath);
    const normalizedResultDigest = resultDocument
      ? sha256(JSON.stringify(canonicalize(resultDocument)))
      : undefined;
    const environmentDigest = sha256(
      JSON.stringify({ image: invocation.imageReference, executorId: this.executorId }),
    );
    const base = {
      resultId: `res_${randomUUID()}`,
      experimentRunId: invocation.experimentRunId,
      invocationId: invocation.invocationId,
      status: exitCode === 0 ? ('SUCCEEDED' as const) : ('FAILED' as const),
      measurements: parseMeasurements(resultDocument),
      artifacts,
      environmentDigest,
      startedAt,
      completedAt,
      exitCode,
      ...(normalizedResultDigest ? { normalizedResultDigest } : {}),
      ...(exitCode === 0 ? {} : { failurePacketId: `fail_${randomUUID()}` }),
    };
    const result = ExperimentResultSchema.parse(base);
    this.receipts.set(invocation.invocationId, result);

    if (exitCode !== 0) {
      throw new ExperimentExecutorError('EXPERIMENT_FAILED', 'Experiment container failed', {
        exitCode,
        stdout,
        stderr,
        result,
      });
    }
    return result;
  }

  async cancel(invocationId: string): Promise<boolean> {
    const child = this.active.get(invocationId);
    if (!child) return false;
    return child.kill('SIGTERM');
  }
}

export function buildDockerRunArguments(
  invocation: ExperimentInvocation,
  inputs: ResolvedExperimentInput[],
  outputHostPath: string,
  containerName: string,
): string[] {
  validateImageIdentity(invocation.imageReference, invocation.imageDigest);
  if (!isAbsolute(outputHostPath)) {
    throw new ExperimentExecutorError('OUTPUT_PATH_INVALID', 'Output host path must be absolute');
  }
  if (invocation.networkPolicy.mode !== 'DENY_ALL') {
    throw new ExperimentExecutorError(
      'NETWORK_POLICY_UNSUPPORTED',
      'The local Docker executor supports only deny-all networking',
    );
  }
  if (inputs.some((input) => !isAbsolute(input.hostPath))) {
    throw new ExperimentExecutorError(
      'INPUT_PATH_INVALID',
      'Every resolved input path must be absolute',
    );
  }

  const uid = typeof process.getuid === 'function' ? process.getuid() : 65532;
  const gid = typeof process.getgid === 'function' ? process.getgid() : 65532;
  const args = [
    'run',
    '--rm',
    '--name',
    containerName,
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--pids-limit',
    '128',
    '--user',
    `${uid}:${gid}`,
    '--cpus',
    String(invocation.resources.cpuMillis / 1000),
    '--memory',
    `${invocation.resources.memoryMiB}m`,
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=64m',
    '--mount',
    `type=bind,src=${resolve(outputHostPath)},dst=/outputs,rw`,
  ];
  for (const input of inputs) {
    args.push(
      '--mount',
      `type=bind,src=${resolve(input.hostPath)},dst=${input.mountPath},readonly`,
    );
  }
  if (invocation.resources.gpuCount > 0) {
    args.push('--gpus', String(invocation.resources.gpuCount));
  }
  args.push(invocation.imageReference, ...invocation.command);
  return args;
}

export class DeterministicExperimentExecutor implements ExperimentExecutor {
  readonly executorId = 'deterministic-reference-executor';
  private readonly receipts = new Map<string, ExperimentResult>();

  constructor(private readonly factory: (invocation: ExperimentInvocation) => ExperimentResult) {}

  async lookup(invocationId: string): Promise<ExperimentResult | undefined> {
    return this.receipts.get(invocationId);
  }

  async execute(invocation: ExperimentInvocation): Promise<ExperimentResult> {
    const existing = this.receipts.get(invocation.invocationId);
    if (existing) return existing;
    const result = ExperimentResultSchema.parse(this.factory(invocation));
    this.receipts.set(invocation.invocationId, result);
    return result;
  }

  async cancel(): Promise<boolean> {
    return false;
  }
}

function validateImageIdentity(imageReference: string, digest: string): void {
  if (!imageReference.endsWith(`@${digest}`)) {
    throw new ExperimentExecutorError(
      'IMAGE_DIGEST_MISMATCH',
      'Image reference is not bound to the declared digest',
    );
  }
}

function safeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .slice(0, 48);
}

function boundedAppend(current: string, addition: string, maximum: number): string {
  return `${current}${addition}`.slice(-maximum);
}

async function collectArtifacts(root: string): Promise<ArtifactReference[]> {
  const files = await walkFiles(root);
  return Promise.all(
    files.map(async (path) => {
      const bytes = await readFile(path);
      return {
        artifactId: `art_${sha256(path).slice(7, 23)}`,
        digest: sha256(bytes),
        mediaType: path.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        sizeBytes: bytes.byteLength,
      };
    }),
  );
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root).catch(() => []);
  const files: string[] = [];
  for (const entry of entries.sort()) {
    const path = join(root, entry);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) continue;
    if (metadata.isDirectory()) files.push(...(await walkFiles(path)));
    if (metadata.isFile()) files.push(path);
  }
  return files;
}

async function readResultDocument(root: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(root, 'result.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

function parseMeasurements(document: unknown): Measurement[] {
  if (!document || typeof document !== 'object') return [];
  const measurements = (document as { measurements?: unknown }).measurements;
  return Array.isArray(measurements) ? (measurements as Measurement[]) : [];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function sha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
