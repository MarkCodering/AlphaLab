import type {
  ApprovalRequestRecord,
  CampaignRecord,
  DomainEvent,
  ProjectRecord,
  TargetVersion,
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
  projects: () => request<ProjectRecord[]>('/projects'),
  targets: (projectId: string) =>
    request<TargetVersion[]>(`/targets?projectId=${encodeURIComponent(projectId)}`),
  campaigns: (projectId?: string) =>
    request<CampaignRecord[]>(
      `/campaigns${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
    ),
  campaign: (campaignId: string) => request<CampaignRecord>(`/campaigns/${campaignId}`),
  events: (campaignId: string) => request<DomainEvent[]>(`/campaigns/${campaignId}/events`),
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
  createTarget: (
    body: Omit<TargetVersion, 'id' | 'targetId' | 'version' | 'createdAt' | 'createdBy'>,
  ) =>
    request<TargetVersion>('/targets', {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify(body),
    }),
  createCampaign: (body: {
    organizationId: string;
    projectId: string;
    targetVersionId: string;
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
  ) =>
    request<CampaignRecord>(`/campaigns/${campaign.id}/transitions`, {
      method: 'POST',
      headers: mutationHeaders({ 'if-match': String(campaign.stateVersion) }),
      body: JSON.stringify(body),
    }),
  startReferenceRun: (campaignId: string) =>
    request<{ campaign: CampaignRecord }>(`/campaigns/${campaignId}/reference-runs`, {
      method: 'POST',
      headers: mutationHeaders(),
    }),
  decideApproval: (requestId: string, decision: 'APPROVED' | 'REJECTED', reason: string) =>
    request(`/approval-requests/${requestId}/decisions`, {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify({
        decision,
        reason,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        policyVersion: 'local-policy-v1',
      }),
    }),
};
