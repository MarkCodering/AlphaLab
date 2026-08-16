'use client';

import {
  Activity,
  Archive,
  ArrowRight,
  Beaker,
  BookOpenText,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Database,
  Download,
  FileCheck2,
  FlaskConical,
  Gauge,
  GitBranch,
  Hexagon,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
  X,
  XCircle,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { controlApi } from '../lib/api';
import { budgetPercent, campaignTone, setupSequence, shortId } from '../lib/campaign';
import type {
  ApprovalRequestRecord,
  ArtifactRecord,
  CampaignRecord,
  CampaignWorkflowRecord,
  DatasetVersion,
  DomainEvent,
  EvidenceRecord,
  ExecutionControl,
  ModelManifest,
  ProjectMember,
  ProjectRecord,
  ReproducibilityBundleManifest,
  TargetVersion,
  VerificationReport,
} from '../lib/types';

type View = 'workspace' | 'datasets' | 'approvals' | 'evidence' | 'audit' | 'runtime';
type HealthState = 'checking' | 'online' | 'offline';

const organizationId = 'local-organization';

const navItems: Array<{
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'workspace', label: 'Campaigns', icon: LayoutDashboard },
  { id: 'datasets', label: 'Datasets', icon: Database },
  { id: 'approvals', label: 'Approvals', icon: ShieldCheck },
  { id: 'evidence', label: 'Evidence', icon: BookOpenText },
  { id: 'audit', label: 'Audit trail', icon: FileCheck2 },
  { id: 'runtime', label: 'Runtime', icon: ServerCog },
];

const transitionActions: Partial<
  Record<
    CampaignRecord['status'],
    {
      label: string;
      to: CampaignRecord['status'];
      predicates: Record<string, boolean>;
      actor?: { id: string; role: 'RESEARCHER' | 'SCIENTIFIC_REVIEWER' };
    }
  >
> = {
  DRAFT: { label: 'Submit target', to: 'TARGET_REVIEW', predicates: { targetComplete: true } },
  TARGET_REVIEW: {
    label: 'Approve target',
    to: 'READY_FOR_ROUTE',
    predicates: { targetComplete: true },
  },
  READY_FOR_ROUTE: { label: 'Generate route', to: 'ROUTE_REVIEW', predicates: {} },
  ROUTE_REVIEW: { label: 'Approve route', to: 'READY', predicates: { routeApproved: true } },
  READY: { label: 'Launch campaign', to: 'RUNNING', predicates: { budgetReserved: true } },
  DISCOVERY_CANDIDATE: {
    label: 'Record scientific acceptance',
    to: 'VERIFIED',
    predicates: {
      provenanceComplete: true,
      verificationPassed: true,
      humanScientificApproval: true,
    },
    actor: { id: 'local-scientific-reviewer', role: 'SCIENTIFIC_REVIEWER' },
  },
};

const archivableCampaignStatuses: CampaignRecord['status'][] = [
  'VERIFIED',
  'CANCELLED',
  'FAILED',
  'BUDGET_EXHAUSTED',
  'CONTRADICTION',
];

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function labelize(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ');
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function artifactLineage(record: ArtifactRecord): string | null {
  const provenance = record.provenance.executionProvenance;
  if (!provenance || typeof provenance !== 'object') return null;
  const values = provenance as Record<string, unknown>;
  const revision = typeof values.codeRevision === 'string' ? values.codeRevision : null;
  const verified = values.codeRevisionVerified === true;
  const adapter =
    values.modelAdapter && typeof values.modelAdapter === 'object'
      ? (values.modelAdapter as Record<string, unknown>)
      : null;
  const model = typeof adapter?.modelId === 'string' ? adapter.modelId : null;
  const datasets = Array.isArray(values.datasets) ? values.datasets.length : 0;
  if (!revision && !model && datasets === 0) return null;
  const source = revision
    ? `${verified ? 'verified' : 'unverified'} source ${shortId(revision)}`
    : 'source revision unavailable';
  return [source, model ? `adapter ${model}` : null, datasets ? `${datasets} frozen input` : null]
    .filter(Boolean)
    .join(' · ');
}

export function ResearchWorkspace() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [targets, setTargets] = useState<TargetVersion[]>([]);
  const [datasets, setDatasets] = useState<DatasetVersion[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [workflowRecord, setWorkflowRecord] = useState<CampaignWorkflowRecord | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRequestRecord[]>([]);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);
  const [verificationReports, setVerificationReports] = useState<VerificationReport[]>([]);
  const [reproducibilityBundles, setReproducibilityBundles] = useState<
    ReproducibilityBundleManifest[]
  >([]);
  const [health, setHealth] = useState<HealthState>('checking');
  const [runtimeHealth, setRuntimeHealth] = useState<
    Record<'worker' | 'model' | 'experiment' | 'verifier', HealthState>
  >({ worker: 'checking', model: 'checking', experiment: 'checking', verifier: 'checking' });
  const [modelManifests, setModelManifests] = useState<ModelManifest[]>([]);
  const [executionControl, setExecutionControl] = useState<ExecutionControl | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('workspace');
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedId) ?? campaigns[0] ?? null,
    [campaigns, selectedId],
  );
  const selectedProject = useMemo(
    () =>
      projects.find((project) => project.id === selectedCampaign?.projectId) ?? projects[0] ?? null,
    [projects, selectedCampaign],
  );
  const selectedTarget = useMemo(
    () => targets.find((target) => target.id === selectedCampaign?.targetVersionId) ?? null,
    [targets, selectedCampaign],
  );
  const campaignApprovals = useMemo(
    () => approvals.filter((approval) => approval.action.campaignId === selectedCampaign?.id),
    [approvals, selectedCampaign],
  );
  const pendingCount = approvals.filter((approval) => approval.status === 'PENDING').length;

  const refresh = useCallback(async () => {
    try {
      const [
        nextProjects,
        nextCampaigns,
        nextApprovals,
        serviceHealth,
        nextRuntimeHealth,
        nextModels,
        nextExecutionControl,
      ] = await Promise.all([
        controlApi.projects(),
        controlApi.campaigns(),
        controlApi.approvals(),
        controlApi.health(),
        controlApi.runtimeHealth(),
        controlApi.modelManifests().catch(() => []),
        controlApi.executionControl(organizationId).catch(() => null),
      ]);
      setProjects(nextProjects);
      setCampaigns(nextCampaigns);
      setApprovals(nextApprovals);
      setHealth(serviceHealth.status === 'ok' ? 'online' : 'offline');
      setRuntimeHealth(
        Object.fromEntries(
          Object.entries(nextRuntimeHealth).map(([service, ready]) => [
            service,
            ready ? 'online' : 'offline',
          ]),
        ) as Record<'worker' | 'model' | 'experiment' | 'verifier', HealthState>,
      );
      setModelManifests(nextModels);
      setExecutionControl(nextExecutionControl);
      const activeId = selectedId ?? nextCampaigns[0]?.id;
      if (activeId) {
        setSelectedId(activeId);
        const active = nextCampaigns.find((campaign) => campaign.id === activeId);
        const [
          nextEvents,
          nextTargets,
          nextDatasets,
          nextEvidence,
          nextReports,
          nextBundles,
          nextArtifacts,
          nextMembers,
          nextWorkflow,
        ] = await Promise.all([
          controlApi.events(activeId),
          active ? controlApi.targets(active.projectId) : Promise.resolve([]),
          active ? controlApi.datasets(active.projectId) : Promise.resolve([]),
          controlApi.evidence(activeId),
          controlApi.verificationReports(activeId),
          controlApi.reproducibilityBundles(activeId),
          active ? controlApi.artifacts(active.projectId) : Promise.resolve([]),
          active ? controlApi.projectMembers(active.projectId) : Promise.resolve([]),
          controlApi.workflow(activeId).catch(() => null),
        ]);
        setEvents(nextEvents);
        setTargets(nextTargets);
        setDatasets(nextDatasets);
        setEvidence(nextEvidence);
        setVerificationReports(nextReports);
        setReproducibilityBundles(nextBundles);
        setArtifacts(nextArtifacts);
        setProjectMembers(nextMembers);
        setWorkflowRecord(nextWorkflow);
      } else if (nextProjects[0]) {
        const [nextTargets, nextDatasets, nextMembers] = await Promise.all([
          controlApi.targets(nextProjects[0].id),
          controlApi.datasets(nextProjects[0].id),
          controlApi.projectMembers(nextProjects[0].id),
        ]);
        setTargets(nextTargets);
        setDatasets(nextDatasets);
        setProjectMembers(nextMembers);
        setEvents([]);
        setEvidence([]);
        setVerificationReports([]);
        setReproducibilityBundles([]);
        setArtifacts([]);
        setWorkflowRecord(null);
      } else {
        setProjectMembers([]);
        setWorkflowRecord(null);
      }
      setError(null);
    } catch (cause) {
      setHealth('offline');
      setError(cause instanceof Error ? cause.message : 'Could not reach the control plane.');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedCampaign) return;
    const stream = new EventSource(
      `/api/control/campaigns/${selectedCampaign.id}/stream?actorId=local-researcher&actorRole=RESEARCHER`,
    );
    stream.onmessage = () => void refresh();
    const eventNames = [
      'campaign.created',
      'target.submitted',
      'target.version_approved',
      'route.proposed',
      'route.approved',
      'campaign.launched',
      'campaign.paused',
      'campaign.resumed',
      'campaign.cancelled',
      'approval.requested',
      'experiment.completed',
      'evidence.intake.recorded',
      'evidence.lineage.recorded',
      'bundle.exported',
    ];
    eventNames.forEach((name) => stream.addEventListener(name, () => void refresh()));
    return () => stream.close();
  }, [selectedCampaign?.id, refresh]);

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const project = await controlApi.createProject({
        organizationId,
        name: String(data.get('projectName')),
        description: String(data.get('description')),
      });
      const target = await controlApi.createTarget({
        organizationId,
        projectId: project.id,
        scientificGoal: String(data.get('scientificGoal')),
        researchQuestion: String(data.get('researchQuestion')),
        initialHypotheses: String(data.get('initialHypotheses'))
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        acceptanceCriteria: String(data.get('acceptanceCriteria'))
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        verificationPolicyId: 'verification-policy-local-v1',
        stopConditions: String(data.get('stopConditions'))
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      });
      const dataset = await controlApi.createDataset({
        organizationId,
        projectId: project.id,
        name: String(data.get('datasetName')),
        description: String(data.get('datasetDescription')),
        format: String(data.get('datasetFormat')) as DatasetVersion['format'],
        sourcePointer: String(data.get('datasetSourcePointer')),
        license: String(data.get('datasetLicense')),
        contentDigest: String(data.get('datasetContentDigest')) as `sha256:${string}`,
        recordCount: Number(data.get('datasetRecordCount')),
      });
      const campaign = await controlApi.createCampaign({
        organizationId,
        projectId: project.id,
        targetVersionId: target.id,
        datasetVersionIds: [dataset.datasetVersionId],
        permittedModelIds: [
          'reference-local-worker-model-v1',
          String(data.get('permittedModelId')),
        ],
        permittedToolIds: [String(data.get('permittedToolId'))],
        fallbackMode: 'STOP',
        approvedFallbackModelIds: [],
        budgetLimit: {
          wallClockSeconds: Number(data.get('wallClockSeconds')),
          modelCalls: Number(data.get('modelCalls')),
          tokens: Number(data.get('tokens')),
          experiments: Number(data.get('experiments')),
          computeMilliUnits: Number(data.get('computeMilliUnits')),
          parallelChildren: 1,
        },
      });
      const initialEvidence = String(data.get('initialEvidence')).trim();
      if (initialEvidence) {
        const sourcePointers = String(data.get('initialEvidenceSource'))
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        await controlApi.createEvidence(campaign.id, {
          type: 'OBSERVATION',
          statement: initialEvidence,
          sourcePointers,
          supportsClaimIds: [],
          contradictsClaimIds: [],
        });
      }
      setSelectedId(campaign.id);
      setCreatorOpen(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Campaign creation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function createDataset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) {
      setError('Create a project before registering a dataset.');
      return;
    }
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      await controlApi.createDataset({
        organizationId: selectedProject.organizationId,
        projectId: selectedProject.id,
        name: String(data.get('name')),
        description: String(data.get('description')),
        format: String(data.get('format')) as DatasetVersion['format'],
        sourcePointer: String(data.get('sourcePointer')),
        license: String(data.get('license')),
        contentDigest: String(data.get('contentDigest')) as `sha256:${string}`,
        recordCount: Number(data.get('recordCount')),
      });
      await refresh();
      event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Dataset registration failed.');
    } finally {
      setBusy(false);
    }
  }

  async function createEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCampaign) {
      setError('Create a campaign before registering scientific evidence.');
      return;
    }
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      await controlApi.createEvidence(selectedCampaign.id, {
        type: String(data.get('type')) as EvidenceRecord['type'],
        statement: String(data.get('statement')),
        sourcePointers: String(data.get('sourcePointers'))
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        supportsClaimIds: [],
        contradictsClaimIds: [],
      });
      event.currentTarget.reset();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not retain the evidence record.');
    } finally {
      setBusy(false);
    }
  }

  async function grantProjectMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) {
      setError('Create a project before assigning project access.');
      return;
    }
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      await controlApi.grantProjectMember(selectedProject.id, {
        actorId: String(data.get('actorId')),
        role: String(data.get('role')) as 'RESEARCHER' | 'SCIENTIFIC_REVIEWER' | 'VIEWER',
      });
      event.currentTarget.reset();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not grant project access.');
    } finally {
      setBusy(false);
    }
  }

  async function transition(
    to: CampaignRecord['status'],
    predicates: Record<string, boolean>,
    reason: string,
    actor?: { id: string; role: 'RESEARCHER' | 'SCIENTIFIC_REVIEWER' },
  ) {
    if (!selectedCampaign) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await controlApi.transition(
        selectedCampaign,
        { to, predicates, reason },
        actor,
      );
      setCampaigns((current) =>
        current.map((campaign) => (campaign.id === updated.id ? updated : campaign)),
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Campaign transition failed.');
    } finally {
      setBusy(false);
    }
  }

  async function startReferenceRun() {
    if (!selectedCampaign) return;
    setBusy(true);
    setError(null);
    try {
      await controlApi.startReferenceRun(selectedCampaign.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reference workflow launch failed.');
    } finally {
      setBusy(false);
    }
  }

  async function decideApproval(request: ApprovalRequestRecord, decision: 'APPROVED' | 'REJECTED') {
    setBusy(true);
    try {
      await controlApi.decideApproval(
        request.id,
        decision,
        decision === 'APPROVED'
          ? 'Reviewed and authorized by the local scientific reviewer.'
          : 'Rejected by the local scientific reviewer pending a safer plan.',
        { id: 'local-scientific-reviewer', role: 'SCIENTIFIC_REVIEWER' },
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval decision failed.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadArtifact(record: ArtifactRecord) {
    if (!selectedProject) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await controlApi.artifactDownload(selectedProject.id, record.artifact.digest);
      const extension = record.artifact.mediaType === 'application/json' ? '.json' : '';
      downloadBlob(blob, `${record.artifact.artifactId}${extension}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Artifact download failed.');
    } finally {
      setBusy(false);
    }
  }

  const setupIndex = selectedCampaign
    ? setupSequence.indexOf(selectedCampaign.status as (typeof setupSequence)[number])
    : -1;
  const nextAction = selectedCampaign ? transitionActions[selectedCampaign.status] : undefined;
  const hasArtifacts = artifacts.length > 0;
  const hasReproductions = reproducibilityBundles.some(
    (bundle) => bundle.invocation.seeds.length >= 3,
  );
  const hasIndependentVerification = verificationReports.some(
    (report) => report.status === 'VERIFIED',
  );
  const latestBundle = reproducibilityBundles.at(-1);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark">
            <Hexagon size={24} strokeWidth={1.6} />
            <span>α</span>
          </div>
          <div>
            <strong>AlphaLab</strong>
            <small>Research OS</small>
          </div>
          <button
            className="icon-button sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="main-nav" aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? 'nav-item active' : 'nav-item'}
                onClick={() => {
                  setView(item.id);
                  setSidebarOpen(false);
                }}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {item.id === 'approvals' && pendingCount > 0 && <em>{pendingCount}</em>}
              </button>
            );
          })}
        </nav>

        <div className="project-list">
          <div className="project-list-heading">
            <span>Campaigns</span>
            <button onClick={() => setCreatorOpen(true)} aria-label="New campaign">
              <Plus size={15} />
            </button>
          </div>
          {campaigns.map((campaign) => {
            const project = projects.find((item) => item.id === campaign.projectId);
            return (
              <button
                key={campaign.id}
                className={
                  campaign.id === selectedCampaign?.id ? 'project-item selected' : 'project-item'
                }
                onClick={() => {
                  setSelectedId(campaign.id);
                  setView('workspace');
                }}
              >
                <span className={`status-dot ${campaignTone(campaign.status)}`} />
                <span>
                  <strong>{project?.name ?? 'Untitled project'}</strong>
                  <small>
                    {labelize(campaign.status)} · {shortId(campaign.id)}
                  </small>
                </span>
              </button>
            );
          })}
          {!loading && campaigns.length === 0 && <p className="project-empty">No campaigns yet.</p>}
        </div>

        <div className="sidebar-footer">
          <div className="local-profile">
            <span>MC</span>
            <div>
              <strong>Local researcher</strong>
              <small>Researcher authority</small>
            </div>
            <ChevronDown size={15} />
          </div>
          <div className="runtime-chip">
            <span className={`health-dot ${health}`} />
            Local control plane <strong>{health}</strong>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={19} />
          </button>
          <div className="crumbs">
            <span>{selectedProject?.name ?? 'Research workspace'}</span>
            <b>/</b>
            <strong>
              {selectedCampaign ? `Campaign ${shortId(selectedCampaign.id)}` : 'New campaign'}
            </strong>
          </div>
          <div className="top-actions">
            <button className="search-button">
              <Search size={16} />
              <span>Search records</span>
              <kbd>⌘ K</kbd>
            </button>
            <button className="icon-button" onClick={() => void refresh()} aria-label="Refresh">
              <RefreshCw size={16} />
            </button>
            <button className="primary compact" onClick={() => setCreatorOpen(true)}>
              <Plus size={16} />
              New campaign
            </button>
          </div>
        </header>

        {error && (
          <div className="error-banner">
            <XCircle size={17} />
            <span>{error}</span>
            <button onClick={() => setError(null)}>
              <X size={15} />
            </button>
          </div>
        )}

        <div className="content-wrap">
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={24} />
              <span>Connecting to the local control plane…</span>
            </div>
          ) : !selectedCampaign && view === 'workspace' ? (
            <EmptyWorkspace onCreate={() => setCreatorOpen(true)} health={health} />
          ) : view === 'workspace' && selectedCampaign ? (
            <>
              <section className="campaign-heading">
                <div>
                  <div className="eyebrow">
                    <span className={`status-dot ${campaignTone(selectedCampaign.status)}`} />
                    {labelize(selectedCampaign.status)}
                    <b>•</b>Target v{selectedTarget?.version ?? 1}
                  </div>
                  <h1>{selectedProject?.name ?? 'Scientific campaign'}</h1>
                  <p>
                    {selectedTarget?.researchQuestion ?? 'Loading the immutable scientific Target…'}
                  </p>
                </div>
                <div className="campaign-actions">
                  {[
                    'RUNNING',
                    'WAITING_FOR_APPROVAL',
                    'RUNNING_EXPERIMENT',
                    'VERIFYING',
                    'NEXT_EXPERIMENT_READY',
                  ].includes(selectedCampaign.status) && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void transition('PAUSED', {}, 'Paused by the researcher.')}
                    >
                      <Pause size={16} />
                      Pause
                    </button>
                  )}
                  {selectedCampaign.status === 'PAUSED' && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void transition(
                          'RUNNING',
                          { budgetReserved: true },
                          'Resumed by the researcher.',
                        )
                      }
                    >
                      <Play size={16} />
                      Resume
                    </button>
                  )}
                  {!['CANCELLED', 'VERIFIED', 'ARCHIVED'].includes(selectedCampaign.status) && (
                    <button
                      className="ghost danger"
                      disabled={busy}
                      onClick={() =>
                        void transition('CANCELLED', {}, 'Cancelled by the researcher.')
                      }
                    >
                      <Square size={14} />
                      Cancel
                    </button>
                  )}
                  {archivableCampaignStatuses.includes(selectedCampaign.status) && (
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() =>
                        void transition(
                          'ARCHIVED',
                          {},
                          'Archived by the researcher; evidence remains retained.',
                        )
                      }
                    >
                      <Archive size={14} />
                      Archive
                    </button>
                  )}
                  <button
                    className="icon-button"
                    disabled={!latestBundle}
                    onClick={() =>
                      latestBundle &&
                      downloadJson(
                        latestBundle,
                        `alphalab-reproducibility-manifest-${latestBundle.bundleId}.json`,
                      )
                    }
                    aria-label="Download reproducibility manifest"
                    title={
                      latestBundle
                        ? 'Download reproducibility manifest'
                        : 'No reproducibility manifest is available yet'
                    }
                  >
                    <Download size={16} />
                  </button>
                </div>
              </section>

              <section className="metric-grid">
                <Metric
                  icon={Sparkles}
                  label="Model calls"
                  value={`${selectedCampaign.budgetUsage.modelCalls}`}
                  detail={`of ${selectedCampaign.budgetLimit.modelCalls}`}
                  percent={budgetPercent(
                    selectedCampaign.budgetUsage.modelCalls,
                    selectedCampaign.budgetLimit.modelCalls,
                  )}
                />
                <Metric
                  icon={Network}
                  label="Tokens"
                  value={`${selectedCampaign.budgetUsage.tokens}`}
                  detail={`of ${selectedCampaign.budgetLimit.tokens}`}
                  percent={budgetPercent(
                    selectedCampaign.budgetUsage.tokens,
                    selectedCampaign.budgetLimit.tokens,
                  )}
                />
                <Metric
                  icon={Beaker}
                  label="Experiments"
                  value={`${selectedCampaign.budgetUsage.experiments}`}
                  detail={`of ${selectedCampaign.budgetLimit.experiments}`}
                  percent={budgetPercent(
                    selectedCampaign.budgetUsage.experiments,
                    selectedCampaign.budgetLimit.experiments,
                  )}
                />
                <Metric
                  icon={Gauge}
                  label="Compute"
                  value={`${selectedCampaign.budgetUsage.computeMilliUnits}`}
                  detail={`of ${selectedCampaign.budgetLimit.computeMilliUnits} mU`}
                  percent={budgetPercent(
                    selectedCampaign.budgetUsage.computeMilliUnits,
                    selectedCampaign.budgetLimit.computeMilliUnits,
                  )}
                />
                <Metric
                  icon={Clock3}
                  label="Wall time"
                  value={`${selectedCampaign.budgetUsage.wallClockSeconds}s`}
                  detail={`of ${selectedCampaign.budgetLimit.wallClockSeconds}s`}
                  percent={budgetPercent(
                    selectedCampaign.budgetUsage.wallClockSeconds,
                    selectedCampaign.budgetLimit.wallClockSeconds,
                  )}
                />
              </section>

              <section className="workspace-grid">
                <div className="workspace-primary">
                  <Panel
                    title="Campaign route"
                    subtitle="Authority-bound progress through the scientific workflow"
                    icon={GitBranch}
                    action={
                      <span className="live-label">
                        <i />
                        Live
                      </span>
                    }
                  >
                    <div className="route-graph">
                      {setupSequence.map((status, index) => {
                        const complete =
                          setupIndex > index ||
                          (setupIndex === -1 &&
                            !setupSequence.includes(selectedCampaign.status as never));
                        const current = selectedCampaign.status === status;
                        return (
                          <div
                            className={`route-node ${complete ? 'complete' : ''} ${current ? 'current' : ''}`}
                            key={status}
                          >
                            <span>{complete ? <Check size={14} /> : index + 1}</span>
                            <strong>{labelize(status)}</strong>
                          </div>
                        );
                      })}
                      <div
                        className={`route-node ${!setupSequence.includes(selectedCampaign.status as never) ? 'current' : ''}`}
                      >
                        <span>
                          <FlaskConical size={14} />
                        </span>
                        <strong>Discovery loop</strong>
                      </div>
                    </div>
                    {selectedCampaign.status === 'READY' ? (
                      <div className="route-callout">
                        <div>
                          <FlaskConical size={17} />
                          <span>
                            <strong>Local reference workflow</strong>
                            <small>
                              Generates a bounded plan, then pauses for exact human approval.
                            </small>
                          </span>
                        </div>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => void startReferenceRun()}
                        >
                          {busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
                          Run reference workflow
                        </button>
                      </div>
                    ) : nextAction ? (
                      <div className="route-callout">
                        <div>
                          <CircleDot size={17} />
                          <span>
                            <strong>
                              {nextAction.actor?.role === 'SCIENTIFIC_REVIEWER'
                                ? 'Scientific reviewer decision'
                                : 'Next controlled transition'}
                            </strong>
                            <small>
                              {labelize(selectedCampaign.status)} → {labelize(nextAction.to)}
                            </small>
                          </span>
                        </div>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void transition(
                              nextAction.to,
                              nextAction.predicates,
                              `${nextAction.label} completed by the ${nextAction.actor?.role === 'SCIENTIFIC_REVIEWER' ? 'local scientific reviewer' : 'local researcher'}.`,
                              nextAction.actor,
                            )
                          }
                        >
                          {busy ? (
                            <LoaderCircle className="spin" size={16} />
                          ) : (
                            <ArrowRight size={16} />
                          )}
                          {nextAction.label}
                        </button>
                      </div>
                    ) : (
                      <div className="route-callout quiet">
                        <div>
                          <Activity size={17} />
                          <span>
                            <strong>Workflow is {labelize(selectedCampaign.status)}</strong>
                            <small>
                              State changes and findings appear here as they are emitted.
                            </small>
                          </span>
                        </div>
                      </div>
                    )}
                  </Panel>

                  <Panel
                    title="Scientific Target"
                    subtitle="Human-owned definition of success · immutable version"
                    icon={BookOpenText}
                    action={<button className="text-button">View version history</button>}
                  >
                    <div className="target-block">
                      <span>Scientific goal</span>
                      <p>{selectedTarget?.scientificGoal ?? 'Target record unavailable.'}</p>
                    </div>
                    <div className="criteria-grid">
                      <div>
                        <h4>Researcher hypotheses</h4>
                        {selectedTarget?.initialHypotheses.length ? (
                          selectedTarget.initialHypotheses.map((hypothesis, index) => (
                            <div className="check-line" key={hypothesis}>
                              <span>{index + 1}</span>
                              <p>{hypothesis}</p>
                            </div>
                          ))
                        ) : (
                          <p className="target-empty">No initial hypotheses were recorded.</p>
                        )}
                      </div>
                      <div>
                        <h4>Acceptance criteria</h4>
                        {selectedTarget?.acceptanceCriteria.map((criterion, index) => (
                          <div className="check-line" key={criterion}>
                            <span>{index + 1}</span>
                            <p>{criterion}</p>
                          </div>
                        ))}
                      </div>
                      <div>
                        <h4>Stop conditions</h4>
                        {selectedTarget?.stopConditions.map((condition) => (
                          <div className="stop-line" key={condition}>
                            <Square size={11} />
                            <p>{condition}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <HypothesisComparison record={workflowRecord} target={selectedTarget} />
                  </Panel>

                  <Panel
                    title="Scientific record"
                    subtitle="Durable reasoning, supervision, and measured outcomes"
                    icon={FlaskConical}
                  >
                    <WorkflowRecordPanel record={workflowRecord} />
                  </Panel>

                  <Panel
                    title="Experiment console"
                    subtitle="Committed invocations, measurements, and output integrity"
                    icon={TerminalSquare}
                  >
                    <ExperimentConsole
                      artifacts={artifacts}
                      record={workflowRecord}
                      onDownloadArtifact={(record) => void downloadArtifact(record)}
                    />
                  </Panel>

                  <Panel
                    title="Operational timeline"
                    subtitle={`${events.length} attributable events recorded`}
                    icon={Activity}
                    action={
                      <button className="text-button" onClick={() => setView('audit')}>
                        Open audit trail
                      </button>
                    }
                  >
                    <div className="event-list">
                      {[...events]
                        .reverse()
                        .slice(0, 5)
                        .map((event, index) => (
                          <EventRow
                            event={event}
                            key={event.eventId}
                            last={index === Math.min(events.length, 5) - 1}
                          />
                        ))}
                      {events.length === 0 && (
                        <PanelEmpty
                          icon={Activity}
                          title="No state events yet"
                          text="Campaign events will appear without a page refresh."
                        />
                      )}
                    </div>
                  </Panel>
                </div>

                <div className="workspace-rail">
                  <Panel
                    title="Human gates"
                    subtitle={`${campaignApprovals.filter((item) => item.status === 'PENDING').length} awaiting decision`}
                    icon={ShieldCheck}
                  >
                    <ApprovalList
                      approvals={campaignApprovals}
                      busy={busy}
                      onDecide={decideApproval}
                      compact
                    />
                  </Panel>
                  <Panel
                    title="Evidence readiness"
                    subtitle="Claims remain separate from observations"
                    icon={Database}
                  >
                    <div className="evidence-readiness">
                      <ReadinessRow label="Target provenance" ready={Boolean(selectedTarget)} />
                      <ReadinessRow label="Experiment artifacts" ready={hasArtifacts} />
                      <ReadinessRow label="Reproduction runs" ready={hasReproductions} />
                      <ReadinessRow
                        label="Independent verification"
                        ready={hasIndependentVerification}
                      />
                    </div>
                    <div className="evidence-note">
                      <ShieldCheck size={16} />
                      <p>
                        Missing evidence is held as <strong>not tested</strong>, never interpreted
                        as a pass.
                      </p>
                    </div>
                  </Panel>
                  <Panel
                    title="Project authority"
                    subtitle="Immutable project memberships"
                    icon={ShieldCheck}
                  >
                    <ProjectMemberManager
                      busy={busy}
                      members={projectMembers}
                      project={selectedProject}
                      onGrant={grantProjectMember}
                    />
                  </Panel>
                  <Panel title="Local runtime" subtitle="No commercial API required" icon={Network}>
                    <div className="runtime-row">
                      <span className={`health-dot ${health}`} />
                      <div>
                        <strong>Control plane</strong>
                        <small>Loopback · API v1</small>
                      </div>
                      <b>{health}</b>
                    </div>
                    <div className="runtime-row">
                      <span className={`health-dot ${runtimeHealth.model}`} />
                      <div>
                        <strong>Model runtime</strong>
                        <small>Python domain-inference boundary</small>
                      </div>
                      <b>{runtimeHealth.model}</b>
                    </div>
                    <button className="wide-link" onClick={() => setView('runtime')}>
                      Inspect system health <ArrowRight size={14} />
                    </button>
                  </Panel>
                  <Panel
                    title="Runtime policy"
                    subtitle="Pinned before execution"
                    icon={TerminalSquare}
                  >
                    <div className="runtime-policy-list">
                      <div>
                        <span>Permitted model</span>
                        <strong>{selectedCampaign.permittedModelIds.join(', ')}</strong>
                      </div>
                      <div>
                        <span>Permitted executor</span>
                        <strong>{selectedCampaign.permittedToolIds.join(', ')}</strong>
                      </div>
                      <div>
                        <span>Provider fallback</span>
                        <strong>
                          {selectedCampaign.fallbackMode === 'STOP'
                            ? 'Stop on provider loss'
                            : `Approved only (${selectedCampaign.approvedFallbackModelIds.join(', ')})`}
                        </strong>
                      </div>
                    </div>
                  </Panel>
                </div>
              </section>
            </>
          ) : view === 'datasets' ? (
            <FocusedPanel
              eyebrow="Scientific inputs"
              title="Dataset registry"
              description="Dataset versions are immutable project records. Source pointers, licence metadata, and content hashes are retained before an experiment can rely on an input."
            >
              <DatasetManager
                busy={busy}
                datasets={datasets}
                project={selectedProject}
                onSubmit={createDataset}
              />
            </FocusedPanel>
          ) : view === 'approvals' ? (
            <FocusedPanel
              eyebrow="Authority"
              title="Human approval queue"
              description="Every red action is bound to the exact proposed-action digest. Decisions are attributable, expiring, and single-use."
            >
              <ApprovalList approvals={approvals} busy={busy} onDecide={decideApproval} />
            </FocusedPanel>
          ) : view === 'evidence' ? (
            <FocusedPanel
              eyebrow="Lineage"
              title="Evidence explorer"
              description="Immutable scientific records remain distinct from operational activity. Artifacts, verification predicates, and reproducibility manifests are retained as separate evidence."
            >
              <EvidenceExplorer
                artifacts={artifacts}
                bundles={reproducibilityBundles}
                busy={busy}
                campaign={selectedCampaign}
                evidence={evidence}
                reports={verificationReports}
                project={selectedProject}
                onDownloadArtifact={(record) => void downloadArtifact(record)}
                onSubmit={createEvidence}
              />
            </FocusedPanel>
          ) : view === 'audit' ? (
            <FocusedPanel
              eyebrow="Append-only history"
              title="Campaign audit trail"
              description="Attributable state changes with correlation, causation, and idempotency identifiers."
            >
              <div className="audit-list">
                {[...events].reverse().map((event) => (
                  <EventRow event={event} key={event.eventId} />
                ))}
              </div>
            </FocusedPanel>
          ) : (
            <FocusedPanel
              eyebrow="Local deployment"
              title="System health"
              description="The localhost profile keeps application control traffic on loopback and records explicit provider state."
            >
              <div className="health-grid">
                <HealthCard
                  title="Control plane"
                  status={health}
                  detail="NestJS · Prisma persistence boundary"
                  endpoint="Versioned API"
                  icon={Boxes}
                />
                <HealthCard
                  title="Research workspace"
                  status="online"
                  detail="Next.js · live event client"
                  endpoint="Local browser"
                  icon={LayoutDashboard}
                />
                <HealthCard
                  title="Workflow worker"
                  status={runtimeHealth.worker}
                  detail="Durable checkpoint coordinator"
                  endpoint="Worker health"
                  icon={GitBranch}
                />
                <HealthCard
                  title="Model runtime"
                  status={runtimeHealth.model}
                  detail={`${modelManifests.length} discovered local manifest${modelManifests.length === 1 ? '' : 's'}`}
                  endpoint="Manifest boundary"
                  icon={TerminalSquare}
                />
                <HealthCard
                  title="Experiment runner"
                  status={runtimeHealth.experiment}
                  detail="Approval-digest execution"
                  endpoint="Isolated boundary"
                  icon={FlaskConical}
                />
                <HealthCard
                  title="Verifier runtime"
                  status={runtimeHealth.verifier}
                  detail="Deterministic predicates"
                  endpoint="Independent boundary"
                  icon={ShieldCheck}
                />
              </div>
              <ModelRegistry manifests={modelManifests} runtimeStatus={runtimeHealth.model} />
              <SafetyControlPanel control={executionControl} />
            </FocusedPanel>
          )}
        </div>
      </main>

      {creatorOpen && (
        <CampaignCreator
          busy={busy}
          modelManifests={modelManifests}
          onClose={() => setCreatorOpen(false)}
          onSubmit={createCampaign}
        />
      )}
    </div>
  );
}

function EmptyWorkspace({ onCreate, health }: { onCreate: () => void; health: string }) {
  return (
    <div className="empty-workspace">
      <div className="empty-illustration">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <Hexagon size={92} strokeWidth={0.75} />
        <span>α</span>
        <i className="particle p1" />
        <i className="particle p2" />
        <i className="particle p3" />
      </div>
      <div className="eyebrow centered">
        <span className={`health-dot ${health}`} />
        Local-first scientific discovery
      </div>
      <h1>
        Turn a question into
        <br />
        inspectable evidence.
      </h1>
      <p>
        Define one immutable scientific Target, bind its budgets and authority, then let AlphaLab
        orchestrate a reproducible campaign.
      </p>
      <button className="primary hero-button" onClick={onCreate}>
        <Plus size={17} />
        Create your first campaign
      </button>
      <div className="empty-promises">
        <span>
          <ShieldCheck size={15} />
          Human-gated actions
        </span>
        <span>
          <Database size={15} />
          Append-only evidence
        </span>
        <span>
          <RefreshCw size={15} />
          Durable resume
        </span>
      </div>
    </div>
  );
}

function CampaignCreator({
  busy,
  modelManifests,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  modelManifests: ModelManifest[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const modelIds = Array.from(
    new Set(['deterministic-statistics-v1', ...modelManifests.map((manifest) => manifest.modelId)]),
  );
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="creator" role="dialog" aria-modal="true" aria-labelledby="creator-title">
        <header>
          <div>
            <span className="eyebrow">New bounded campaign</span>
            <h2 id="creator-title">Define the scientific Target</h2>
            <p>This version becomes the authoritative definition of success for the campaign.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>
        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <label>
              <span>Project name</span>
              <input name="projectName" required defaultValue="Reference reproducibility study" />
            </label>
            <label>
              <span>Project description</span>
              <input name="description" defaultValue="A local, bounded validation campaign." />
            </label>
          </div>
          <div className="creator-section-heading">
            <strong>Permitted runtime policy</strong>
            <span>Execution stops if this model or executor is not explicitly allowed.</span>
          </div>
          <div className="form-grid">
            <label>
              <span>Local domain model</span>
              <select name="permittedModelId" defaultValue="deterministic-statistics-v1">
                {modelIds.map((modelId) => (
                  <option key={modelId} value={modelId}>
                    {modelId}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Permitted executor</span>
              <select name="permittedToolId" defaultValue="reference-local-executor-v1">
                <option value="reference-local-executor-v1">Reference local executor</option>
              </select>
            </label>
          </div>
          <p className="runtime-policy-note">
            Provider fallback is disabled for this local reference workflow. A future fallback must
            be explicitly named, approved, and recorded in evidence provenance.
          </p>
          <label>
            <span>Scientific goal</span>
            <textarea
              name="scientificGoal"
              required
              rows={2}
              defaultValue="Validate that one isolated experiment produces a reproducible normalized result."
            />
          </label>
          <label>
            <span>Research question</span>
            <textarea
              name="researchQuestion"
              required
              rows={2}
              defaultValue="Can the approved reference experiment reproduce an identical result hash across three runs?"
            />
          </label>
          <label>
            <span>
              Initial hypotheses <small>one per line</small>
            </span>
            <textarea
              name="initialHypotheses"
              rows={3}
              defaultValue="The frozen reference sample has a positive mean."
            />
          </label>
          <div className="form-grid">
            <label>
              <span>Initial evidence or observation</span>
              <textarea
                name="initialEvidence"
                rows={3}
                defaultValue="The frozen reference dataset contains the values [2, 4, 6, 8]."
              />
            </label>
            <label>
              <span>
                Evidence source <small>one pointer per line</small>
              </span>
              <textarea
                name="initialEvidenceSource"
                rows={3}
                defaultValue="local://reference-values-v1.json"
              />
            </label>
          </div>
          <div className="creator-section-heading">
            <strong>Immutable reference dataset</strong>
            <span>Source, licence, and content hash are retained with this campaign.</span>
          </div>
          <div className="form-grid">
            <label>
              <span>Dataset name</span>
              <input name="datasetName" required defaultValue="Frozen reference values" />
            </label>
            <label>
              <span>Format</span>
              <select name="datasetFormat" defaultValue="JSON">
                <option value="JSON">JSON</option>
                <option value="CSV">CSV</option>
                <option value="PARQUET">Parquet</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
          </div>
          <label>
            <span>Dataset description</span>
            <input
              name="datasetDescription"
              required
              defaultValue="Fixed local values [2, 4, 6, 8] for deterministic summary statistics."
            />
          </label>
          <div className="form-grid">
            <label>
              <span>Source pointer</span>
              <input
                name="datasetSourcePointer"
                required
                defaultValue="local://reference-values-v1.json"
              />
            </label>
            <label>
              <span>Licence</span>
              <input name="datasetLicense" required defaultValue="CC0-1.0" />
            </label>
          </div>
          <div className="form-grid">
            <label>
              <span>Content SHA-256</span>
              <input
                name="datasetContentDigest"
                required
                spellCheck="false"
                defaultValue="sha256:3b49c633f765420086ab2ec3967a1649d598af8f20e6da28e3520c81a0146641"
              />
            </label>
            <label>
              <span>Record count</span>
              <input name="datasetRecordCount" type="number" min="0" defaultValue="4" />
            </label>
          </div>
          <div className="form-grid">
            <label>
              <span>
                Acceptance criteria <small>one per line</small>
              </span>
              <textarea
                name="acceptanceCriteria"
                required
                rows={4}
                defaultValue={
                  'Three successful isolated reproductions.\nIdentical normalized result hashes.\nComplete artifact and environment provenance.'
                }
              />
            </label>
            <label>
              <span>
                Stop conditions <small>one per line</small>
              </span>
              <textarea
                name="stopConditions"
                required
                rows={4}
                defaultValue={
                  'Stop after one approved experiment plan.\nStop immediately on unsafe execution.\nStop when any budget is exhausted.'
                }
              />
            </label>
          </div>
          <div className="budget-fieldset">
            <div>
              <strong>Campaign budget</strong>
              <span>Hard limits stop new chargeable work.</span>
            </div>
            <div className="budget-inputs">
              <label>
                <span>Minutes</span>
                <input name="wallClockSeconds" type="number" min="60" defaultValue="1800" />
              </label>
              <label>
                <span>Model calls</span>
                <input name="modelCalls" type="number" min="0" defaultValue="6" />
              </label>
              <label>
                <span>Tokens</span>
                <input name="tokens" type="number" min="0" defaultValue="12000" />
              </label>
              <label>
                <span>Experiments</span>
                <input name="experiments" type="number" min="0" defaultValue="3" />
              </label>
              <label>
                <span>Compute mU</span>
                <input name="computeMilliUnits" type="number" min="0" defaultValue="3000" />
              </label>
            </div>
          </div>
          <footer>
            <p>
              <ShieldCheck size={15} />
              Red actions still require separate human approval.
            </p>
            <div>
              <button type="button" className="secondary" onClick={onClose}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}
                Create bounded campaign
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  icon: typeof Activity;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-heading">
        <div className="panel-title-icon">
          <Icon size={16} />
        </div>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        {action && <div className="panel-action">{action}</div>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  percent,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  percent: number;
}) {
  return (
    <div className="metric-card">
      <div className="metric-top">
        <span>
          <Icon size={16} />
        </span>
        <small>{label}</small>
        <em>{percent}%</em>
      </div>
      <div className="metric-value">
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
      <div className="meter">
        <i style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function EventRow({ event, last = false }: { event: DomainEvent; last?: boolean }) {
  return (
    <div className="event-row">
      <div className="event-track">
        <span>
          <Check size={12} />
        </span>
        {!last && <i />}
      </div>
      <div>
        <strong>{event.eventType.replaceAll('.', ' ')}</strong>
        <p>
          {typeof event.payload.reason === 'string'
            ? event.payload.reason
            : `Recorded by ${event.actor.id}`}
        </p>
        <small>
          {formatTime(event.occurredAt)} · {shortId(event.eventId)}
        </small>
      </div>
    </div>
  );
}

function WorkflowRecordPanel({ record }: { record: CampaignWorkflowRecord | null }) {
  if (!record) {
    return (
      <PanelEmpty
        icon={FlaskConical}
        title="No durable workflow record yet"
        text="The scientific record appears when the local reference workflow has generated a hypothesis and experiment plan."
      />
    );
  }
  const measurements = record.results.flatMap((result) => result.measurements);
  const latestDecision = record.controllerDecisions.at(-1);
  const workflowNodes = Object.values(record.receipts).sort((left, right) =>
    left.completedAt.localeCompare(right.completedAt),
  );
  return (
    <div className="workflow-record">
      <div className="workflow-record-meta">
        <span>run {shortId(record.runId)}</span>
        <span>{record.receipts ? Object.keys(record.receipts).length : 0} durable receipts</span>
        <span>updated {formatTime(record.updatedAt)}</span>
      </div>
      <div className="workflow-graph" aria-label="Durable workflow graph">
        <div className="workflow-graph-heading">
          <small>Durable workflow graph</small>
          <span>{workflowNodes.length} committed nodes</span>
        </div>
        {workflowNodes.length ? (
          <ol>
            {workflowNodes.map((receipt, index) => (
              <li key={receipt.nodeId}>
                <i>{index + 1}</i>
                <span>
                  <strong>{labelize(receipt.nodeId)}</strong>
                  <small>{formatTime(receipt.completedAt)}</small>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p>No workflow nodes have committed yet.</p>
        )}
      </div>
      <div className="workflow-record-grid">
        <article>
          <small>Hypothesis</small>
          <strong>{record.hypothesis?.statement ?? 'Pending generation'}</strong>
          <p>{record.hypothesis?.rationale ?? 'No hypothesis has been retained yet.'}</p>
        </article>
        <article>
          <small>Experiment plan</small>
          <strong>{record.plan?.objective ?? 'Pending plan'}</strong>
          <p>
            {record.plan
              ? `${record.plan.executorId} · ${record.plan.command.join(' ')}`
              : 'The approved executor and command will appear here.'}
          </p>
        </article>
        <article>
          <small>Supervisor finding</small>
          <strong>{record.findings.at(-1)?.category ?? 'No finding'}</strong>
          <p>{record.findings.at(-1)?.statement ?? 'No process-supervision finding recorded.'}</p>
        </article>
        <article>
          <small>Controller decision</small>
          <strong>{latestDecision?.decision ?? 'Awaiting decision'}</strong>
          <p>{latestDecision?.reason ?? 'The advisory controller has not issued a decision.'}</p>
        </article>
      </div>
      <div className="supervision-ledger">
        <article>
          <div className="supervision-ledger-heading">
            <small>Process-supervision findings</small>
            <span>{record.findings.length} retained</span>
          </div>
          {record.findings.length ? (
            <ul>
              {record.findings.map((finding) => (
                <li key={finding.findingId}>
                  <em className={finding.severity.toLowerCase()}>{finding.severity}</em>
                  <p>{finding.statement}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No supervision finding has been committed.</p>
          )}
        </article>
        <article>
          <div className="supervision-ledger-heading">
            <small>Controller decisions</small>
            <span>{record.controllerDecisions.length} advisory</span>
          </div>
          {record.controllerDecisions.length ? (
            <ul>
              {record.controllerDecisions.map((decision) => (
                <li key={decision.decisionId}>
                  <em>{labelize(decision.decision)}</em>
                  <p>{decision.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No controller decision has been committed.</p>
          )}
        </article>
      </div>
      <div className="workflow-measurements">
        <div>
          <small>Measured outcomes</small>
          <span>
            {record.results.length} reproduction{record.results.length === 1 ? '' : 's'}
          </span>
        </div>
        {measurements.length ? (
          <div className="measurement-list">
            {measurements.map((measurement, index) => (
              <span key={`${measurement.name}-${index}`}>
                <b>{measurement.name}</b>
                <em>
                  {String(measurement.value)}
                  {measurement.unit ? ` ${measurement.unit}` : ''}
                </em>
              </span>
            ))}
          </div>
        ) : (
          <p>No measurements have been committed yet.</p>
        )}
      </div>
      {record.nextBestExperimentReport && (
        <div className="next-experiment-report">
          <div>
            <small>Next best experiment</small>
            <strong>{record.nextBestExperimentReport.recommendedObjective}</strong>
            <p>{record.nextBestExperimentReport.rationale}</p>
          </div>
          <ul aria-label="Unresolved verification predicates">
            {record.nextBestExperimentReport.unresolvedPredicateIds.map((predicateId) => (
              <li key={predicateId}>{predicateId}</li>
            ))}
          </ul>
        </div>
      )}
      {record.lastError && (
        <p className="workflow-record-error">
          {record.lastError.code}: {record.lastError.message}
        </p>
      )}
    </div>
  );
}

function HypothesisComparison({
  record,
  target,
}: {
  record: CampaignWorkflowRecord | null;
  target: TargetVersion | null | undefined;
}) {
  const generated = record?.hypothesis;
  return (
    <div className="hypothesis-comparison">
      <div className="hypothesis-comparison-heading">
        <span>Hypothesis comparison</span>
        <small>Human input remains distinct from generated reasoning.</small>
      </div>
      <div className="hypothesis-comparison-grid">
        <article>
          <small>Researcher supplied</small>
          {target?.initialHypotheses.length ? (
            <ul>
              {target.initialHypotheses.map((hypothesis) => (
                <li key={hypothesis}>{hypothesis}</li>
              ))}
            </ul>
          ) : (
            <p>No starting hypothesis was recorded.</p>
          )}
        </article>
        <article>
          <small>Workflow generated</small>
          {generated ? (
            <>
              <strong>{generated.statement}</strong>
              <p>{generated.rationale}</p>
            </>
          ) : (
            <p>The campaign has not committed a generated hypothesis yet.</p>
          )}
        </article>
        <article>
          <small>Falsification criteria</small>
          {generated?.falsificationCriteria.length ? (
            <ul>
              {generated.falsificationCriteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
          ) : (
            <p>Falsification criteria will be retained with the generated hypothesis.</p>
          )}
        </article>
      </div>
    </div>
  );
}

function ExperimentConsole({
  artifacts,
  record,
  onDownloadArtifact,
}: {
  artifacts: ArtifactRecord[];
  record: CampaignWorkflowRecord | null;
  onDownloadArtifact: (artifact: ArtifactRecord) => void;
}) {
  if (!record?.results.length) {
    return (
      <PanelEmpty
        icon={TerminalSquare}
        title="No committed experiment result"
        text="The exact approved invocation, its measured outputs, and integrity-bound artifacts will appear here after the worker checkpoints them."
      />
    );
  }
  const artifactByDigest = new Map(
    artifacts.map((artifact) => [artifact.artifact.digest, artifact]),
  );
  return (
    <div className="experiment-console">
      <div className="experiment-console-command">
        <span>Approved command</span>
        <code>{record.plan?.command.join(' ') ?? 'Plan command unavailable'}</code>
        <small>{record.plan?.imageReference ?? 'Image provenance unavailable'}</small>
      </div>
      <div className="experiment-run-list">
        {record.results.map((result, index) => (
          <article key={result.resultId}>
            <header>
              <span>
                <i className={`status-dot ${result.status === 'SUCCEEDED' ? 'active' : 'warn'}`} />
                reproduction {index + 1}
              </span>
              <code>
                {result.status} · exit {result.exitCode}
              </code>
            </header>
            <p>
              {result.measurements.length
                ? result.measurements
                    .map(
                      (measurement) =>
                        `${measurement.name}=${String(measurement.value)}${measurement.unit ?? ''}`,
                    )
                    .join(' · ')
                : 'No measurements were committed.'}
            </p>
            <footer>
              <span>{result.modelProvenance?.modelId ?? 'model provenance unavailable'}</span>
              <span>{shortId(result.environmentDigest)}</span>
              {result.artifacts.map((artifact) => {
                const retained = artifactByDigest.get(artifact.digest);
                return retained ? (
                  <button
                    className="text-button"
                    key={artifact.digest}
                    onClick={() => onDownloadArtifact(retained)}
                    title={`Download ${artifact.digest}`}
                  >
                    <Download size={12} />
                    {shortId(artifact.digest)}
                  </button>
                ) : (
                  <span key={artifact.digest}>{shortId(artifact.digest)}</span>
                );
              })}
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}

function EvidenceExplorer({
  artifacts,
  bundles,
  busy,
  campaign,
  evidence,
  reports,
  project,
  onDownloadArtifact,
  onSubmit,
}: {
  artifacts: ArtifactRecord[];
  bundles: ReproducibilityBundleManifest[];
  busy: boolean;
  campaign: CampaignRecord | null;
  evidence: EvidenceRecord[];
  reports: VerificationReport[];
  project: ProjectRecord | null;
  onDownloadArtifact: (artifact: ArtifactRecord) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const latestReport = reports.at(-1);
  const latestBundle = bundles.at(-1);
  return (
    <div className="evidence-explorer">
      <form className="evidence-intake" onSubmit={onSubmit}>
        <div className="evidence-intake-heading">
          <div>
            <small>Researcher intake</small>
            <strong>Retain available evidence</strong>
          </div>
          <button className="primary compact" disabled={busy || !campaign}>
            {busy ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}
            Add evidence
          </button>
        </div>
        <div className="form-grid">
          <label>
            <span>Record type</span>
            <select name="type" defaultValue="OBSERVATION" disabled={!campaign}>
              <option value="OBSERVATION">Observation</option>
              <option value="HYPOTHESIS">Hypothesis</option>
              <option value="INTENT">Intent</option>
              <option value="OPERATIONAL_EVIDENCE">Operational evidence</option>
            </select>
          </label>
          <label>
            <span>Source pointer</span>
            <input
              name="sourcePointers"
              required
              disabled={!campaign}
              placeholder="local://notes/assay-observation.md"
            />
          </label>
        </div>
        <label>
          <span>Evidence statement</span>
          <textarea
            name="statement"
            required
            disabled={!campaign}
            rows={3}
            placeholder="State what was observed, and keep the source separate from any conclusion."
          />
        </label>
      </form>
      {evidence.length === 0 ? (
        <PanelEmpty
          icon={Database}
          title="No scientific evidence recorded"
          text="Retain the evidence available at campaign start, then inspect hypotheses, observations, reproducible evidence, verification predicates, and exports here."
        />
      ) : (
        <>
          <div className="evidence-summary-grid">
            <article>
              <small>Immutable records</small>
              <strong>{evidence.length}</strong>
              <span>
                {evidence.filter((record) => record.type === 'OBSERVATION').length} observations
              </span>
            </article>
            <article>
              <small>Integrity-bound artifacts</small>
              <strong>{artifacts.length}</strong>
              <span>
                {artifacts.reduce((total, artifact) => total + artifact.artifact.sizeBytes, 0)}{' '}
                bytes indexed
              </span>
            </article>
            <article>
              <small>Verification</small>
              <strong>{latestReport?.status ?? 'NOT TESTED'}</strong>
              <span>
                {latestReport?.candidateEligible ? 'Candidate eligible' : 'No candidate issued'}
              </span>
            </article>
            <article>
              <small>Reproducibility bundle</small>
              <strong>{latestBundle ? 'EXPORTED' : 'PENDING'}</strong>
              <span>{latestBundle ? shortId(latestBundle.bundleId) : 'No manifest available'}</span>
            </article>
          </div>
          <div className="record-table">
            <div className="record-head">
              <span>Scientific record</span>
              <span>Evidence status</span>
              <span>Provenance</span>
              <span>Recorded</span>
            </div>
            {evidence.map((record) => (
              <div className="record-row" key={record.evidenceId}>
                <span>
                  <i className="record-icon">
                    <Database size={14} />
                  </i>
                  <b>{labelize(record.type)}</b>
                  <small>{shortId(record.evidenceId)}</small>
                </span>
                <span>
                  <em className={`classification ${record.status.toLowerCase()}`}>
                    {labelize(record.status)}
                  </em>
                  <small>
                    {record.artifacts.length} artifact{record.artifacts.length === 1 ? '' : 's'}
                  </small>
                </span>
                <span>
                  <b>{record.sourcePointers[0] ?? 'No external source'}</b>
                  <small>run {shortId(record.runId)}</small>
                </span>
                <span>{formatTime(record.createdAt)}</span>
              </div>
            ))}
          </div>
          <div className="artifact-records">
            <div className="artifact-records-heading">
              <div>
                <small>Artifact payloads</small>
                <p>Content-addressed outputs are retrieved only after a digest and size check.</p>
              </div>
              <span>{artifacts.length} preserved</span>
            </div>
            {artifacts.length > 0 ? (
              <div className="artifact-record-list">
                {artifacts.map((record) => {
                  const lineage = artifactLineage(record);
                  return (
                    <div className="artifact-record-row" key={record.artifact.digest}>
                      <span>
                        <i className="record-icon">
                          <Archive size={14} />
                        </i>
                        <b>{record.artifact.artifactId}</b>
                        <small>
                          {shortId(record.artifact.digest)} · {record.artifact.sizeBytes} bytes
                        </small>
                        {lineage && <small className="artifact-lineage">{lineage}</small>}
                      </span>
                      <span>{record.artifact.mediaType}</span>
                      <button
                        className="text-button export-manifest"
                        disabled={!project}
                        title={`Download ${record.artifact.digest}`}
                        onClick={() => onDownloadArtifact(record)}
                      >
                        <Download size={13} />
                        Download
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="artifact-records-empty">
                No immutable payloads are attached to these records.
              </p>
            )}
          </div>
          <div className="evidence-detail-grid">
            <article>
              <small>Outcome-verification report</small>
              {latestReport ? (
                <>
                  <strong>{latestReport.status}</strong>
                  <p>
                    {
                      latestReport.predicateResults.filter(
                        (predicate) => predicate.status === 'PASS',
                      ).length
                    }
                    /{latestReport.predicateResults.length} predicates passed ·{' '}
                    {latestReport.humanApprovalRequired
                      ? 'independent review required'
                      : 'no further review required'}
                  </p>
                </>
              ) : (
                <p>Not tested. No verifier report exists for this campaign.</p>
              )}
            </article>
            <article>
              <small>Reproducibility manifest</small>
              {latestBundle ? (
                <>
                  <strong>{latestBundle.files.length} preserved files</strong>
                  <p>
                    {shortId(latestBundle.normalizedResultDigest)} · seed{' '}
                    {latestBundle.invocation.seeds.join(', ')}
                  </p>
                  <button
                    className="text-button export-manifest"
                    onClick={() =>
                      downloadJson(
                        latestBundle,
                        `alphalab-reproducibility-manifest-${latestBundle.bundleId}.json`,
                      )
                    }
                  >
                    <Download size={13} />
                    Download manifest
                  </button>
                </>
              ) : (
                <p>Not exported. A bundle is created only after a verifiable result.</p>
              )}
            </article>
          </div>
        </>
      )}
    </div>
  );
}

function DatasetManager({
  busy,
  datasets,
  project,
  onSubmit,
}: {
  busy: boolean;
  datasets: DatasetVersion[];
  project: ProjectRecord | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!project) {
    return (
      <PanelEmpty
        icon={Database}
        title="No project selected"
        text="Create a project before registering an immutable dataset version."
      />
    );
  }
  return (
    <div className="dataset-manager">
      <form className="dataset-form" onSubmit={onSubmit}>
        <div className="dataset-form-heading">
          <div>
            <small>Register an immutable version</small>
            <strong>{project.name}</strong>
          </div>
          <button className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}
            Register version
          </button>
        </div>
        <div className="form-grid">
          <label>
            <span>Dataset name</span>
            <input name="name" required placeholder="Validated assay records" />
          </label>
          <label>
            <span>Format</span>
            <select name="format" defaultValue="CSV">
              <option value="CSV">CSV</option>
              <option value="JSON">JSON</option>
              <option value="PARQUET">Parquet</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
        </div>
        <label>
          <span>Description</span>
          <input
            name="description"
            required
            placeholder="What this version contains and its intended use"
          />
        </label>
        <div className="form-grid">
          <label>
            <span>Source pointer</span>
            <input name="sourcePointer" required placeholder="local://datasets/assay-v1.csv" />
          </label>
          <label>
            <span>Licence</span>
            <input name="license" required placeholder="CC-BY-4.0" />
          </label>
        </div>
        <div className="form-grid">
          <label>
            <span>Content SHA-256</span>
            <input name="contentDigest" required placeholder="sha256:…" spellCheck="false" />
          </label>
          <label>
            <span>Record count</span>
            <input name="recordCount" required type="number" min="0" placeholder="0" />
          </label>
        </div>
      </form>
      <div className="record-table">
        <div className="record-head">
          <span>Dataset version</span>
          <span>Source and licence</span>
          <span>Integrity</span>
          <span>Registered</span>
        </div>
        {datasets.map((dataset) => (
          <div className="record-row" key={dataset.datasetVersionId}>
            <span>
              <i className="record-icon">
                <Database size={14} />
              </i>
              <b>{dataset.name}</b>
              <small>
                v{dataset.version} · {dataset.format} · {dataset.recordCount ?? 'unknown'} records
              </small>
            </span>
            <span>
              <b>{dataset.sourcePointer}</b>
              <small>{dataset.license}</small>
            </span>
            <span>
              <b>{shortId(dataset.contentDigest)}</b>
              <small>{dataset.artifact ? 'artifact recorded' : 'source-only registration'}</small>
            </span>
            <span>{formatTime(dataset.createdAt)}</span>
          </div>
        ))}
        {datasets.length === 0 && (
          <div className="dataset-empty">
            No dataset versions registered for this project. Register a local source before binding
            it to a campaign.
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectMemberManager({
  busy,
  members,
  project,
  onGrant,
}: {
  busy: boolean;
  members: ProjectMember[];
  project: ProjectRecord | null;
  onGrant: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!project) {
    return (
      <PanelEmpty
        icon={ShieldCheck}
        title="No project selected"
        text="Project membership becomes available when a project is created."
      />
    );
  }
  return (
    <div className="member-manager">
      <div className="member-list" aria-label="Project members">
        {members.map((member) => (
          <div className="member-row" key={member.actorId}>
            <span className="member-avatar">{member.actorId.slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{member.actorId}</strong>
              <small>Granted by {member.createdBy}</small>
            </div>
            <em className={`member-role ${member.role.toLowerCase()}`}>{labelize(member.role)}</em>
          </div>
        ))}
      </div>
      <form className="member-grant-form" onSubmit={onGrant}>
        <label>
          <span>Actor ID</span>
          <input name="actorId" required minLength={3} placeholder="researcher-2" />
        </label>
        <label>
          <span>Authority</span>
          <select name="role" defaultValue="RESEARCHER">
            <option value="RESEARCHER">Researcher</option>
            <option value="SCIENTIFIC_REVIEWER">Scientific reviewer</option>
            <option value="VIEWER">Viewer</option>
          </select>
        </label>
        <button className="secondary" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}
          Grant access
        </button>
      </form>
      <p className="member-note">
        Membership changes are append-only. Production identity binding remains separate from the
        local development actor profile.
      </p>
    </div>
  );
}

function ApprovalList({
  approvals,
  busy,
  onDecide,
  compact = false,
}: {
  approvals: ApprovalRequestRecord[];
  busy: boolean;
  onDecide: (request: ApprovalRequestRecord, decision: 'APPROVED' | 'REJECTED') => void;
  compact?: boolean;
}) {
  if (approvals.length === 0)
    return (
      <PanelEmpty
        icon={ShieldCheck}
        title="No pending human gates"
        text="Red actions will appear with their exact digest and requested authority."
      />
    );
  return (
    <div className={compact ? 'approval-list compact' : 'approval-list'}>
      {approvals.map((approval) => (
        <article className="approval-card" key={approval.id}>
          <div className="approval-card-head">
            <span className={approval.status === 'PENDING' ? 'approval-risk' : 'approval-decided'}>
              {approval.action.riskTier}
            </span>
            <small>{formatTime(approval.createdAt)}</small>
          </div>
          <h4>{labelize(approval.action.kind)}</h4>
          <p>Requested by {approval.action.requestedBy.id}</p>
          <code>{approval.actionDigest.slice(0, compact ? 25 : 42)}…</code>
          {approval.status === 'PENDING' ? (
            <div className="approval-actions">
              <button
                disabled={busy}
                className="reject"
                onClick={() => onDecide(approval, 'REJECTED')}
              >
                <X size={14} />
                Reject
              </button>
              <button
                disabled={busy}
                className="approve"
                onClick={() => onDecide(approval, 'APPROVED')}
              >
                <Check size={14} />
                Approve
              </button>
            </div>
          ) : (
            <div className="decision-line">
              <CheckCircle2 size={14} />
              {approval.approval?.decision.toLowerCase()} by {approval.approval?.decidedBy.id}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

function ReadinessRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="readiness-row">
      <span className={ready ? 'ready' : ''}>
        {ready ? <Check size={12} /> : <Clock3 size={12} />}
      </span>
      <p>{label}</p>
      <small>{ready ? 'complete' : 'not tested'}</small>
    </div>
  );
}

function PanelEmpty({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Activity;
  title: string;
  text: string;
}) {
  return (
    <div className="panel-empty">
      <span>
        <Icon size={19} />
      </span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function ModelRegistry({
  manifests,
  runtimeStatus,
}: {
  manifests: ModelManifest[];
  runtimeStatus: HealthState;
}) {
  return (
    <section className="model-registry" aria-labelledby="model-registry-title">
      <header className="model-registry-heading">
        <div>
          <span>Provider manifests</span>
          <h2 id="model-registry-title">Runtime model inventory</h2>
        </div>
        <div className="model-registry-status">
          <i className={`health-dot ${runtimeStatus}`} />
          {runtimeStatus}
        </div>
      </header>
      {manifests.length ? (
        <div className="model-manifest-grid">
          {manifests.map((manifest) => (
            <article className="model-manifest" key={`${manifest.providerId}-${manifest.modelId}`}>
              <div className="model-manifest-topline">
                <span className={`boundary-tag ${manifest.dataBoundary.toLowerCase()}`}>
                  {manifest.dataBoundary.toLowerCase()} boundary
                </span>
                <small>adapter {manifest.adapterVersion}</small>
              </div>
              <h3>{manifest.modelId}</h3>
              <p>{manifest.providerId}</p>
              <dl>
                <div>
                  <dt>Revision</dt>
                  <dd>{shortId(manifest.revisionDigest)}</dd>
                </div>
                <div>
                  <dt>Context</dt>
                  <dd>{manifest.contextLimit.toLocaleString()} tokens</dd>
                </div>
                <div>
                  <dt>Concurrency</dt>
                  <dd>{manifest.maxConcurrency} active</dd>
                </div>
                <div>
                  <dt>Remote code</dt>
                  <dd>{manifest.remoteCodeRequired ? 'required' : 'disabled'}</dd>
                </div>
              </dl>
              <div className="capability-list" aria-label="Declared capabilities">
                {manifest.capabilities.map((capability) => (
                  <span key={capability}>{labelize(capability)}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <PanelEmpty
          icon={ServerCog}
          title={runtimeStatus === 'offline' ? 'Model runtime unreachable' : 'No manifest returned'}
          text="A campaign cannot infer provider capability or data-boundary policy until the model runtime serves a typed manifest."
        />
      )}
    </section>
  );
}

const executionControlLabels: Array<{
  key: keyof Pick<
    ExecutionControl,
    | 'campaignExecutionEnabled'
    | 'experimentExecutionEnabled'
    | 'externalNetworkAccessEnabled'
    | 'externalModelProvidersEnabled'
    | 'huggingFaceModelLoadingEnabled'
    | 'automaticFallbackEnabled'
    | 'backgroundSchedulingEnabled'
    | 'evidenceReadOnly'
  >;
  label: string;
  detail: string;
}> = [
  {
    key: 'campaignExecutionEnabled',
    label: 'Campaign execution',
    detail: 'Start new controlled runs',
  },
  {
    key: 'experimentExecutionEnabled',
    label: 'Experiment execution',
    detail: 'Approve runnable experiments',
  },
  {
    key: 'externalNetworkAccessEnabled',
    label: 'External network',
    detail: 'Outbound data access',
  },
  {
    key: 'externalModelProvidersEnabled',
    label: 'External providers',
    detail: 'Non-local model routes',
  },
  {
    key: 'huggingFaceModelLoadingEnabled',
    label: 'Model loading',
    detail: 'Hugging Face load path',
  },
  { key: 'automaticFallbackEnabled', label: 'Automatic fallback', detail: 'Provider substitution' },
  { key: 'backgroundSchedulingEnabled', label: 'Background scheduling', detail: 'Unattended work' },
  { key: 'evidenceReadOnly', label: 'Evidence preservation', detail: 'Freeze mutable work' },
];

function SafetyControlPanel({ control }: { control: ExecutionControl | null }) {
  return (
    <section className="safety-control-panel" aria-labelledby="safety-control-title">
      <header className="safety-control-heading">
        <div>
          <span>Emergency controls</span>
          <h2 id="safety-control-title">Organization execution policy</h2>
          <p>
            Read-only for researchers. Changes require an organization administrator and a version
            match.
          </p>
        </div>
        {control && <code>policy v{control.version}</code>}
      </header>
      {control ? (
        <div className="safety-control-grid">
          {executionControlLabels.map((item) => {
            const enabled = control[item.key];
            const preservation = item.key === 'evidenceReadOnly';
            const active = preservation ? enabled : !enabled;
            return (
              <article className={active ? 'control-state active' : 'control-state'} key={item.key}>
                <i className={active ? 'health-dot offline' : 'health-dot online'} />
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </div>
                <b>
                  {preservation
                    ? enabled
                      ? 'active'
                      : 'standby'
                    : enabled
                      ? 'enabled'
                      : 'blocked'}
                </b>
              </article>
            );
          })}
        </div>
      ) : (
        <PanelEmpty
          icon={ShieldCheck}
          title="Execution controls unavailable"
          text="The safety-control endpoint did not return a policy, so the workspace cannot present its operator state."
        />
      )}
    </section>
  );
}

function FocusedPanel({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="focused-view">
      <header>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <div className="focused-content">{children}</div>
    </section>
  );
}

function HealthCard({
  title,
  status,
  detail,
  endpoint,
  icon: Icon,
}: {
  title: string;
  status: string;
  detail: string;
  endpoint: string;
  icon: typeof Activity;
}) {
  return (
    <article className="health-card">
      <div>
        <span>
          <Icon size={18} />
        </span>
        <i className={`health-dot ${status}`} />
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      <code>{endpoint}</code>
      <small>{status}</small>
    </article>
  );
}
