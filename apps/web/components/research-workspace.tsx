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
  CampaignRecord,
  DomainEvent,
  ProjectRecord,
  TargetVersion,
} from '../lib/types';

type View = 'workspace' | 'approvals' | 'evidence' | 'audit' | 'runtime';
type HealthState = 'checking' | 'online' | 'offline';

const organizationId = 'local-organization';

const navItems: Array<{
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'workspace', label: 'Campaigns', icon: LayoutDashboard },
  { id: 'approvals', label: 'Approvals', icon: ShieldCheck },
  { id: 'evidence', label: 'Evidence', icon: Database },
  { id: 'audit', label: 'Audit trail', icon: FileCheck2 },
  { id: 'runtime', label: 'Runtime', icon: ServerCog },
];

const transitionActions: Partial<
  Record<
    CampaignRecord['status'],
    { label: string; to: CampaignRecord['status']; predicates: Record<string, boolean> }
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
};

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

export function ResearchWorkspace() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [targets, setTargets] = useState<TargetVersion[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequestRecord[]>([]);
  const [events, setEvents] = useState<DomainEvent[]>([]);
  const [health, setHealth] = useState<HealthState>('checking');
  const [runtimeHealth, setRuntimeHealth] = useState<
    Record<'worker' | 'model' | 'experiment' | 'verifier', HealthState>
  >({ worker: 'checking', model: 'checking', experiment: 'checking', verifier: 'checking' });
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
      const [nextProjects, nextCampaigns, nextApprovals, serviceHealth, nextRuntimeHealth] =
        await Promise.all([
          controlApi.projects(),
          controlApi.campaigns(),
          controlApi.approvals(),
          controlApi.health(),
          controlApi.runtimeHealth(),
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
      const activeId = selectedId ?? nextCampaigns[0]?.id;
      if (activeId) {
        setSelectedId(activeId);
        const active = nextCampaigns.find((campaign) => campaign.id === activeId);
        const [nextEvents, nextTargets] = await Promise.all([
          controlApi.events(activeId),
          active ? controlApi.targets(active.projectId) : Promise.resolve([]),
        ]);
        setEvents(nextEvents);
        setTargets(nextTargets);
      } else if (nextProjects[0]) {
        setTargets(await controlApi.targets(nextProjects[0].id));
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
    const stream = new EventSource(`/api/control/campaigns/${selectedCampaign.id}/stream`);
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
      const campaign = await controlApi.createCampaign({
        organizationId,
        projectId: project.id,
        targetVersionId: target.id,
        budgetLimit: {
          wallClockSeconds: Number(data.get('wallClockSeconds')),
          modelCalls: Number(data.get('modelCalls')),
          tokens: Number(data.get('tokens')),
          experiments: Number(data.get('experiments')),
          computeMilliUnits: Number(data.get('computeMilliUnits')),
          parallelChildren: 1,
        },
      });
      setSelectedId(campaign.id);
      setCreatorOpen(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Campaign creation failed.');
    } finally {
      setBusy(false);
    }
  }

  async function transition(
    to: CampaignRecord['status'],
    predicates: Record<string, boolean>,
    reason: string,
  ) {
    if (!selectedCampaign) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await controlApi.transition(selectedCampaign, { to, predicates, reason });
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

  async function decideApproval(request: ApprovalRequestRecord, decision: 'APPROVED' | 'REJECTED') {
    setBusy(true);
    try {
      await controlApi.decideApproval(
        request.id,
        decision,
        decision === 'APPROVED'
          ? 'Reviewed and authorized by the local researcher.'
          : 'Rejected by the local researcher pending a safer plan.',
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Approval decision failed.');
    } finally {
      setBusy(false);
    }
  }

  const setupIndex = selectedCampaign
    ? setupSequence.indexOf(selectedCampaign.status as (typeof setupSequence)[number])
    : -1;
  const nextAction = selectedCampaign ? transitionActions[selectedCampaign.status] : undefined;

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
          ) : !selectedCampaign ? (
            <EmptyWorkspace onCreate={() => setCreatorOpen(true)} health={health} />
          ) : view === 'workspace' ? (
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
                  <button className="icon-button">
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
                    {nextAction ? (
                      <div className="route-callout">
                        <div>
                          <CircleDot size={17} />
                          <span>
                            <strong>Next controlled transition</strong>
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
                              `${nextAction.label} completed by the local researcher.`,
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
                      <ReadinessRow label="Experiment artifacts" ready={false} />
                      <ReadinessRow label="Reproduction runs" ready={false} />
                      <ReadinessRow label="Independent verification" ready={false} />
                    </div>
                    <div className="evidence-note">
                      <ShieldCheck size={16} />
                      <p>
                        Missing evidence is held as <strong>not tested</strong>, never interpreted
                        as a pass.
                      </p>
                    </div>
                  </Panel>
                  <Panel title="Local runtime" subtitle="No commercial API required" icon={Network}>
                    <div className="runtime-row">
                      <span className={`health-dot ${health}`} />
                      <div>
                        <strong>Control plane</strong>
                        <small>127.0.0.1:4310 · API v1</small>
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
                </div>
              </section>
            </>
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
              description="Operational events are visible now. Reproducible scientific evidence appears only after artifacts, provenance, and verifier predicates are complete."
            >
              <div className="record-table">
                <div className="record-head">
                  <span>Record</span>
                  <span>Classification</span>
                  <span>Actor</span>
                  <span>Recorded</span>
                </div>
                {events.map((event) => (
                  <div className="record-row" key={event.eventId}>
                    <span>
                      <i className="record-icon">
                        <Activity size={14} />
                      </i>
                      <b>{event.eventType}</b>
                      <small>{shortId(event.eventId)}</small>
                    </span>
                    <span>
                      <em className="classification operational">Operational evidence</em>
                    </span>
                    <span>{event.actor.id}</span>
                    <span>{formatTime(event.occurredAt)}</span>
                  </div>
                ))}
              </div>
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
                  detail="Local domain inference"
                  endpoint="Python boundary"
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
            </FocusedPanel>
          )}
        </div>
      </main>

      {creatorOpen && (
        <CampaignCreator
          busy={busy}
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
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
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
