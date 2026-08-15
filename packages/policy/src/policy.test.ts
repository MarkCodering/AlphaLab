import type { Actor, ApprovalArtifact, ProposedAction } from '@alphalab/contracts';
import { describe, expect, it } from 'vitest';
import { authorizeAction, digestAction } from './index.js';

const requester: Actor = { type: 'USER', id: 'researcher-1', role: 'RESEARCHER' };
const approver: Actor = {
  type: 'USER',
  id: 'reviewer-1',
  role: 'SCIENTIFIC_REVIEWER',
};
const now = '2026-08-15T00:00:00+00:00';

function action(parameters: Record<string, unknown> = { image: 'sha256:abc' }): ProposedAction {
  return {
    contractVersion: '1.0',
    actionId: 'action-1',
    organizationId: 'organization-1',
    projectId: 'project-1',
    campaignId: 'campaign-1',
    kind: 'EXPERIMENT_EXECUTION',
    riskTier: 'RED',
    parameters,
    requestedBy: requester,
    requestedAt: now,
  };
}

function approvalFor(proposed: ProposedAction): ApprovalArtifact {
  return {
    contractVersion: '1.0',
    approvalId: 'approval-1',
    organizationId: proposed.organizationId,
    projectId: proposed.projectId,
    actionDigest: digestAction(proposed),
    policyVersion: 'policy-1',
    decision: 'APPROVED',
    decidedBy: approver,
    decidedAt: now,
    expiresAt: '2026-08-16T00:00:00+00:00',
    singleUse: true,
    consumedAt: null,
    reason: 'Reviewed exact experiment manifest.',
  };
}

describe('execution policy', () => {
  it('denies a red action without approval', () => {
    expect(authorizeAction(action(), undefined, now)).toMatchObject({
      allowed: false,
      code: 'APPROVAL_REQUIRED',
    });
  });

  it('accepts an unexpired human approval bound to the exact action', () => {
    const proposed = action();
    expect(authorizeAction(proposed, approvalFor(proposed), now)).toMatchObject({
      allowed: true,
      code: 'APPROVAL_VALID',
    });
  });

  it('denies approval replay after action parameters change', () => {
    const proposed = action();
    const changed = action({ image: 'sha256:def' });
    expect(authorizeAction(changed, approvalFor(proposed), now)).toMatchObject({
      allowed: false,
      code: 'APPROVAL_SCOPE_MISMATCH',
    });
  });
});
