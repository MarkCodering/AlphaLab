import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  ApprovalArtifact,
  Campaign,
  ControllerDecision,
  ExperimentPlan,
  ExperimentResult,
  Hypothesis,
  NextBestExperimentReport,
  ProposedAction,
  ReproducibilityBundleManifest,
  SupervisorFinding,
  VerificationReport,
} from '@alphalab/contracts';

export type WorkflowNodeId =
  | 'hypothesis'
  | 'plan'
  | 'supervision'
  | 'approval'
  | `experiment-${number}`
  | 'verification'
  | 'next-experiment'
  | 'export';

export interface NodeReceipt {
  nodeId: WorkflowNodeId;
  inputDigest: `sha256:${string}`;
  outputDigest: `sha256:${string}`;
  completedAt: string;
}

export interface CampaignWorkflowSnapshot {
  schemaVersion: 1;
  workflowId: string;
  runId: string;
  campaign: Campaign;
  hypothesis?: Hypothesis;
  plan?: ExperimentPlan;
  proposedAction?: ProposedAction;
  approval?: ApprovalArtifact;
  results: ExperimentResult[];
  findings: SupervisorFinding[];
  controllerDecisions: ControllerDecision[];
  nextBestExperimentReport?: NextBestExperimentReport;
  verificationReport?: VerificationReport;
  bundle?: ReproducibilityBundleManifest;
  receipts: Partial<Record<WorkflowNodeId, NodeReceipt>>;
  lastError?: { code: string; message: string };
  updatedAt: string;
}

export interface WorkflowStore {
  load(campaignId: string): Promise<CampaignWorkflowSnapshot | undefined>;
  save(snapshot: CampaignWorkflowSnapshot): Promise<void>;
}

export class FileWorkflowStore implements WorkflowStore {
  constructor(private readonly root: string) {}

  async load(campaignId: string): Promise<CampaignWorkflowSnapshot | undefined> {
    try {
      return JSON.parse(
        await readFile(this.pathFor(campaignId), 'utf8'),
      ) as CampaignWorkflowSnapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async save(snapshot: CampaignWorkflowSnapshot): Promise<void> {
    await mkdir(resolve(this.root), { recursive: true });
    const destination = this.pathFor(snapshot.campaign.id);
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'w' });
    await rename(temporary, destination);
  }

  private pathFor(campaignId: string): string {
    const filename = createHash('sha256').update(campaignId).digest('hex');
    return join(resolve(this.root), `${filename}.json`);
  }
}

export function digestValue(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')}`;
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
