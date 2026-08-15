import type { Actor, Campaign, CampaignStatus, TransitionPredicates } from '@alphalab/contracts';
import { DomainError } from './errors.js';

type Role = Actor['role'];

export interface TransitionRequest {
  to: CampaignStatus;
  actor: Actor;
  predicates?: {
    [K in keyof TransitionPredicates]?: TransitionPredicates[K] | undefined;
  };
  reason: string;
  occurredAt: string;
}

export interface TransitionResult {
  campaign: Campaign;
  evidenceType: string;
  invalidates: string[];
}

interface Rule {
  from: CampaignStatus | '*';
  to: CampaignStatus;
  roles: Role[];
  requires?: (keyof TransitionPredicates)[];
  evidenceType: string;
  invalidates?: string[];
}

const humanRoles: Role[] = [
  'RESEARCHER',
  'SCIENTIFIC_REVIEWER',
  'ORGANIZATION_ADMIN',
  'INFRASTRUCTURE_OPERATOR',
];
const serviceAndHumans: Role[] = [...humanRoles, 'SYSTEM_SERVICE'];

const rules: Rule[] = [
  {
    from: 'DRAFT',
    to: 'TARGET_REVIEW',
    roles: ['RESEARCHER'],
    requires: ['targetComplete'],
    evidenceType: 'target.submitted',
  },
  {
    from: 'TARGET_REVIEW',
    to: 'DRAFT',
    roles: ['RESEARCHER', 'SCIENTIFIC_REVIEWER'],
    evidenceType: 'target.revision_requested',
    invalidates: ['route'],
  },
  {
    from: 'TARGET_REVIEW',
    to: 'READY_FOR_ROUTE',
    roles: ['RESEARCHER'],
    requires: ['targetComplete'],
    evidenceType: 'target.version_approved',
  },
  {
    from: 'READY_FOR_ROUTE',
    to: 'ROUTE_REVIEW',
    roles: ['RESEARCHER', 'SYSTEM_SERVICE'],
    evidenceType: 'route.proposed',
  },
  {
    from: 'ROUTE_REVIEW',
    to: 'READY_FOR_ROUTE',
    roles: ['RESEARCHER', 'SCIENTIFIC_REVIEWER'],
    evidenceType: 'route.revision_requested',
    invalidates: ['route'],
  },
  {
    from: 'ROUTE_REVIEW',
    to: 'READY',
    roles: ['RESEARCHER', 'SCIENTIFIC_REVIEWER'],
    requires: ['routeApproved'],
    evidenceType: 'route.approved',
  },
  {
    from: 'READY',
    to: 'RUNNING',
    roles: ['RESEARCHER'],
    requires: ['budgetReserved'],
    evidenceType: 'campaign.launched',
  },
  {
    from: 'RUNNING',
    to: 'WAITING_FOR_APPROVAL',
    roles: ['SYSTEM_SERVICE'],
    evidenceType: 'approval.requested',
  },
  {
    from: 'WAITING_FOR_APPROVAL',
    to: 'RUNNING_EXPERIMENT',
    roles: serviceAndHumans,
    requires: ['approvalValid', 'budgetReserved'],
    evidenceType: 'experiment.scheduled',
  },
  {
    from: 'WAITING_FOR_APPROVAL',
    to: 'NEEDS_HUMAN',
    roles: serviceAndHumans,
    evidenceType: 'approval.unresolved',
  },
  {
    from: 'RUNNING',
    to: 'RUNNING_EXPERIMENT',
    roles: ['SYSTEM_SERVICE'],
    requires: ['approvalValid', 'budgetReserved'],
    evidenceType: 'experiment.scheduled',
  },
  {
    from: 'RUNNING_EXPERIMENT',
    to: 'VERIFYING',
    roles: ['SYSTEM_SERVICE'],
    requires: ['executionCompleted'],
    evidenceType: 'experiment.completed',
  },
  {
    from: 'RUNNING_EXPERIMENT',
    to: 'FAILED',
    roles: ['SYSTEM_SERVICE'],
    evidenceType: 'experiment.failed',
  },
  {
    from: 'VERIFYING',
    to: 'CONTRADICTION',
    roles: ['SYSTEM_SERVICE', 'SCIENTIFIC_REVIEWER'],
    evidenceType: 'verification.contradiction',
    invalidates: ['candidate'],
  },
  {
    from: 'VERIFYING',
    to: 'NEXT_EXPERIMENT_READY',
    roles: ['SYSTEM_SERVICE', 'SCIENTIFIC_REVIEWER'],
    evidenceType: 'experiment.next_ready',
  },
  {
    from: 'VERIFYING',
    to: 'DISCOVERY_CANDIDATE',
    roles: ['SYSTEM_SERVICE', 'SCIENTIFIC_REVIEWER'],
    requires: ['provenanceComplete', 'verificationPassed'],
    evidenceType: 'discovery.candidate_created',
  },
  {
    from: 'VERIFYING',
    to: 'NEEDS_HUMAN',
    roles: serviceAndHumans,
    evidenceType: 'verification.human_required',
  },
  {
    from: 'DISCOVERY_CANDIDATE',
    to: 'VERIFIED',
    roles: ['SCIENTIFIC_REVIEWER'],
    requires: ['provenanceComplete', 'verificationPassed', 'humanScientificApproval'],
    evidenceType: 'discovery.verified',
  },
  {
    from: 'DISCOVERY_CANDIDATE',
    to: 'NEXT_EXPERIMENT_READY',
    roles: ['SCIENTIFIC_REVIEWER'],
    evidenceType: 'discovery.rejected',
    invalidates: ['candidate'],
  },
  {
    from: 'NEXT_EXPERIMENT_READY',
    to: 'WAITING_FOR_APPROVAL',
    roles: ['RESEARCHER', 'SYSTEM_SERVICE'],
    evidenceType: 'approval.requested',
  },
  {
    from: 'NEXT_EXPERIMENT_READY',
    to: 'RUNNING',
    roles: ['SYSTEM_SERVICE'],
    requires: ['budgetReserved'],
    evidenceType: 'campaign.continued',
  },
  {
    from: 'FAILED',
    to: 'RUNNING',
    roles: humanRoles,
    requires: ['budgetReserved'],
    evidenceType: 'campaign.retry_started',
  },
  {
    from: 'BLOCKED',
    to: 'RUNNING',
    roles: serviceAndHumans,
    requires: ['blockerResolved'],
    evidenceType: 'campaign.unblocked',
  },
  {
    from: 'BUDGET_EXHAUSTED',
    to: 'NEEDS_HUMAN',
    roles: humanRoles,
    requires: ['budgetReserved'],
    evidenceType: 'budget.increase_requested',
  },
  {
    from: 'SCOPE_EXPANSION',
    to: 'TARGET_REVIEW',
    roles: ['RESEARCHER'],
    evidenceType: 'scope.target_revision_started',
    invalidates: ['candidate', 'verification'],
  },
  {
    from: 'UNSAFE',
    to: 'NEEDS_HUMAN',
    roles: ['ORGANIZATION_ADMIN', 'INFRASTRUCTURE_OPERATOR'],
    requires: ['securityCleared'],
    evidenceType: 'security.clearance_recorded',
  },
  {
    from: 'PAUSED',
    to: 'RUNNING',
    roles: humanRoles,
    requires: ['budgetReserved'],
    evidenceType: 'campaign.resumed',
  },
  { from: '*', to: 'PAUSED', roles: humanRoles, evidenceType: 'campaign.paused' },
  { from: '*', to: 'CANCELLED', roles: humanRoles, evidenceType: 'campaign.cancelled' },
  { from: '*', to: 'BLOCKED', roles: serviceAndHumans, evidenceType: 'campaign.blocked' },
  {
    from: '*',
    to: 'SCOPE_EXPANSION',
    roles: serviceAndHumans,
    evidenceType: 'campaign.scope_expansion',
  },
  {
    from: '*',
    to: 'BUDGET_EXHAUSTED',
    roles: serviceAndHumans,
    evidenceType: 'budget.exhausted',
  },
  { from: '*', to: 'UNSAFE', roles: serviceAndHumans, evidenceType: 'security.unsafe' },
  { from: '*', to: 'ARCHIVED', roles: humanRoles, evidenceType: 'campaign.archived' },
];

const terminalStates = new Set<CampaignStatus>(['VERIFIED', 'CANCELLED', 'ARCHIVED']);
const pausableStates = new Set<CampaignStatus>([
  'RUNNING',
  'WAITING_FOR_APPROVAL',
  'RUNNING_EXPERIMENT',
  'VERIFYING',
  'NEXT_EXPERIMENT_READY',
]);
const archivableStates = new Set<CampaignStatus>([
  'VERIFIED',
  'CANCELLED',
  'FAILED',
  'BUDGET_EXHAUSTED',
  'CONTRADICTION',
]);

export function transitionCampaign(
  campaign: Campaign,
  request: TransitionRequest,
): TransitionResult {
  if (campaign.status === request.to) {
    throw new DomainError('NO_STATE_CHANGE', `Campaign is already ${request.to}`);
  }
  if (campaign.status === 'ARCHIVED') {
    throw new DomainError('TERMINAL_STATE', 'Archived campaigns cannot transition');
  }
  if (terminalStates.has(campaign.status) && request.to !== 'ARCHIVED') {
    throw new DomainError('TERMINAL_STATE', `${campaign.status} campaigns can only be archived`);
  }
  if (request.to === 'PAUSED' && !pausableStates.has(campaign.status)) {
    throw new DomainError('INVALID_TRANSITION', `${campaign.status} cannot be paused`);
  }
  if (request.to === 'ARCHIVED' && !archivableStates.has(campaign.status)) {
    throw new DomainError('INVALID_TRANSITION', `${campaign.status} cannot be archived`);
  }

  const rule = rules.find(
    (candidate) =>
      (candidate.from === campaign.status || candidate.from === '*') && candidate.to === request.to,
  );
  if (!rule) {
    throw new DomainError(
      'INVALID_TRANSITION',
      `${campaign.status} cannot transition to ${request.to}`,
    );
  }
  if (!rule.roles.includes(request.actor.role)) {
    throw new DomainError(
      'ACTOR_NOT_AUTHORIZED',
      `${request.actor.role} cannot perform this transition`,
    );
  }

  const predicates = request.predicates ?? {};
  const missing = (rule.requires ?? []).filter((predicate) => predicates[predicate] !== true);
  if (missing.length > 0) {
    throw new DomainError('PREDICATE_NOT_SATISFIED', 'Transition predicates are not satisfied', {
      missing,
    });
  }

  const resumeStatus = request.to === 'PAUSED' ? campaign.status : null;
  return {
    campaign: {
      ...campaign,
      status: request.to,
      resumeStatus,
      stateVersion: campaign.stateVersion + 1,
      updatedAt: request.occurredAt,
    },
    evidenceType: rule.evidenceType,
    invalidates: rule.invalidates ?? [],
  };
}
