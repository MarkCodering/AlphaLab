import type {
  ApprovalRequestRecord,
  ArtifactRecord,
  CampaignRecord,
  CampaignWorkflowRecord,
  DatasetVersion,
  DomainEvent,
  EvidenceRecord,
  ExecutionControl,
  ExecutorManifest,
  ModelManifest,
  ProjectMember,
  ProjectRecord,
  ReproducibilityBundleManifest,
  TargetVersion,
  VerificationReport,
} from './types';

const API_ROOT = '/api/control';
const actorHeaders = {
  'x-actor-id': 'local-researcher',
  'x-actor-role': 'RESEARCHER',
};

interface ApiErrorBody {
  code?: string;
  message?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...actorHeaders,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(error.message ?? error.code ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

async function requestBlob(path: string): Promise<Blob> {
  const response = await fetch(`${API_ROOT}${path}`, {
    cache: 'no-store',
    headers: {
      ...actorHeaders,
    },
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(error.message ?? error.code ?? `Artifact download failed (${response.status})`);
  }
  return response.blob();
}

function mutationHeaders(extra?: HeadersInit): HeadersInit {
  return { 'idempotency-key': crypto.randomUUID(), ...extra };
}

async function isHealthy(path: string): Promise<boolean> {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

async function runtimeRequest<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Runtime request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export const controlApi = {
  health: () => request<{ status: string; service: string; contractVersion: string }>('/health'),
  runtimeHealth: async () => {
    const [worker, model, experiment, verifier] = await Promise.all([
      isHealthy('/api/runtime/worker/health'),
      isHealthy('/api/runtime/model/health'),
      isHealthy('/api/runtime/experiment/health'),
      isHealthy('/api/runtime/verifier/health'),
    ]);
    return { worker, model, experiment, verifier };
  },
  modelManifests: () => runtimeRequest<ModelManifest[]>('/api/runtime/model/models'),
  executorManifests: () => runtimeRequest<ExecutorManifest[]>('/api/runtime/worker/executors'),
  executionControl: (organizationId: string) =>
    request<ExecutionControl>(
      `/organizations/${encodeURIComponent(organizationId)}/execution-controls`,
    ),
  projects: () => request<ProjectRecord[]>('/projects'),
  projectMembers: (projectId: string) =>
    request<ProjectMember[]>(`/projects/${encodeURIComponent(projectId)}/members`),
  targets: (projectId: string) =>
    request<TargetVersion[]>(`/targets?projectId=${encodeURIComponent(projectId)}`),
  datasets: (projectId: string) =>
    request<DatasetVersion[]>(`/datasets?projectId=${encodeURIComponent(projectId)}`),
  campaigns: (projectId?: string) =>
    request<CampaignRecord[]>(
      `/campaigns${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
    ),
  campaign: (campaignId: string) => request<CampaignRecord>(`/campaigns/${campaignId}`),
  workflow: (campaignId: string) =>
    request<CampaignWorkflowRecord>(`/campaigns/${campaignId}/workflow`),
  events: (campaignId: string) => request<DomainEvent[]>(`/campaigns/${campaignId}/events`),
  artifacts: (projectId: string) => request<ArtifactRecord[]>(`/projects/${projectId}/artifacts`),
  artifactDownload: (projectId: string, digest: string) =>
    requestBlob(
      `/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(digest)}`,
    ),
  evidence: (campaignId: string) => request<EvidenceRecord[]>(`/campaigns/${campaignId}/evidence`),
  createEvidence: (
    campaignId: string,
    body: Pick<
      EvidenceRecord,
      'type' | 'statement' | 'sourcePointers' | 'supportsClaimIds' | 'contradictsClaimIds'
    >,
  ) =>
    request<EvidenceRecord>(`/campaigns/${encodeURIComponent(campaignId)}/evidence`, {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify(body),
    }),
  verificationReports: (campaignId: string) =>
    request<VerificationReport[]>(`/campaigns/${campaignId}/verification-reports`),
  reproducibilityBundles: (campaignId: string) =>
    request<ReproducibilityBundleManifest[]>(`/campaigns/${campaignId}/reproducibility-bundles`),
  approvals: (campaignId?: string) =>
    request<ApprovalRequestRecord[]>(
      `/approval-requests${campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : ''}`,
    ),
  createProject: (body: { organizationId: string; name: string; description: string }) =>
    request<ProjectRecord>('/projects', {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify(body),
    }),
  grantProjectMember: (
    projectId: string,
    body: { actorId: string; role: 'RESEARCHER' | 'SCIENTIFIC_REVIEWER' | 'VIEWER' },
  ) =>
    request<ProjectMember>(`/projects/${encodeURIComponent(projectId)}/members`, {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify(body),
    }),
  createTarget: (
    body: Omit<TargetVersion, 'id' | 'targetId' | 'version' | 'createdAt' | 'createdBy'>,
  ) =>
    request<TargetVersion>('/targets', {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify(body),
    }),
  createDataset: (
    body: Omit<
      DatasetVersion,
      'contractVersion' | 'datasetVersionId' | 'datasetId' | 'version' | 'createdAt' | 'createdBy'
    > & { datasetId?: string },
  ) =>
    request<DatasetVersion>('/datasets', {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify(body),
    }),
  createCampaign: (body: {
    organizationId: string;
    projectId: string;
    targetVersionId: string;
    datasetVersionIds?: string[];
    permittedModelIds: string[];
    permittedToolIds: string[];
    fallbackMode: CampaignRecord['fallbackMode'];
    approvedFallbackModelIds: string[];
    budgetLimit: CampaignRecord['budgetLimit'];
  }) =>
    request<CampaignRecord>('/campaigns', {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify(body),
    }),
  transition: (
    campaign: CampaignRecord,
    body: { to: CampaignRecord['status']; predicates?: Record<string, boolean>; reason: string },
    actor?: { id: string; role: 'RESEARCHER' | 'SCIENTIFIC_REVIEWER' },
  ) =>
    request<CampaignRecord>(`/campaigns/${campaign.id}/transitions`, {
      method: 'POST',
      headers: mutationHeaders({
        'if-match': String(campaign.stateVersion),
        ...(actor ? { 'x-actor-id': actor.id, 'x-actor-role': actor.role } : {}),
      }),
      body: JSON.stringify(body),
    }),
  startReferenceRun: (campaignId: string) =>
    request<{ campaign: CampaignRecord }>(`/campaigns/${campaignId}/reference-runs`, {
      method: 'POST',
      headers: mutationHeaders(),
    }),
  decideApproval: (
    requestId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string,
    actor?: { id: string; role: 'RESEARCHER' | 'SCIENTIFIC_REVIEWER' },
  ) =>
    request(`/approval-requests/${requestId}/decisions`, {
      method: 'POST',
      headers: mutationHeaders(
        actor ? { 'x-actor-id': actor.id, 'x-actor-role': actor.role } : undefined,
      ),
      body: JSON.stringify({
        decision,
        reason,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        policyVersion: 'local-policy-v1',
      }),
    }),
};
