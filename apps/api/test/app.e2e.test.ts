import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DomainErrorFilter } from '../src/common/domain-error.filter.js';

const actorHeaders = {
  'x-actor-id': 'researcher-1',
  'x-actor-role': 'RESEARCHER',
};

describe('AlphaLab control plane', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalFilters(new DomainErrorFilter());
    await app.init();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
  });

  it('reports a versioned health contract', async () => {
    const response = await request(app.getHttpServer()).get('/v1/health').expect(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'alphalab-api',
      contractVersion: '1.0',
    });
  });

  it('creates an idempotent bounded campaign and records its transitions', async () => {
    const projectBody = {
      organizationId: 'organization-1',
      name: 'Reference research',
      description: 'Engineering validation campaign',
    };
    const firstProject = await request(app.getHttpServer())
      .post('/v1/projects')
      .set(actorHeaders)
      .set('idempotency-key', 'create-project-1')
      .send(projectBody)
      .expect(201);
    const replayedProject = await request(app.getHttpServer())
      .post('/v1/projects')
      .set(actorHeaders)
      .set('idempotency-key', 'create-project-1')
      .send(projectBody)
      .expect(201);
    expect(replayedProject.body.id).toBe(firstProject.body.id);

    const projects = await request(app.getHttpServer())
      .get('/v1/projects?organizationId=organization-1')
      .expect(200);
    expect(projects.body).toEqual([expect.objectContaining({ id: firstProject.body.id })]);

    const idempotencyConflict = await request(app.getHttpServer())
      .post('/v1/projects')
      .set(actorHeaders)
      .set('idempotency-key', 'create-project-1')
      .send({ ...projectBody, name: 'Changed request' })
      .expect(409);
    expect(idempotencyConflict.body.code).toBe('IDEMPOTENCY_CONFLICT');

    const target = await request(app.getHttpServer())
      .post('/v1/targets')
      .set(actorHeaders)
      .set('idempotency-key', 'create-target-1')
      .send({
        organizationId: 'organization-1',
        projectId: firstProject.body.id,
        scientificGoal: 'Validate the bounded campaign workflow.',
        researchQuestion: 'Can one approved experiment complete reproducibly?',
        acceptanceCriteria: ['Normalized result hash matches the approved fixture.'],
        verificationPolicyId: 'verification-policy-1',
        stopConditions: ['Stop after one experiment.'],
      })
      .expect(201);

    const targets = await request(app.getHttpServer())
      .get(`/v1/targets?projectId=${firstProject.body.id}`)
      .expect(200);
    expect(targets.body).toEqual([expect.objectContaining({ id: target.body.id, version: 1 })]);

    const campaign = await request(app.getHttpServer())
      .post('/v1/campaigns')
      .set(actorHeaders)
      .set('idempotency-key', 'create-campaign-1')
      .send({
        organizationId: 'organization-1',
        projectId: firstProject.body.id,
        targetVersionId: target.body.id,
        budgetLimit: {
          wallClockSeconds: 600,
          modelCalls: 2,
          tokens: 4000,
          experiments: 1,
          computeMilliUnits: 1000,
          parallelChildren: 1,
        },
      })
      .expect(201);
    expect(campaign.body).toMatchObject({ status: 'DRAFT', stateVersion: 0 });

    const submitted = await request(app.getHttpServer())
      .post(`/v1/campaigns/${campaign.body.id}/transitions`)
      .set(actorHeaders)
      .set('idempotency-key', 'transition-campaign-1')
      .set('if-match', '0')
      .send({
        to: 'TARGET_REVIEW',
        predicates: { targetComplete: true },
        reason: 'Target has all mandatory predicates.',
      })
      .expect(201);
    expect(submitted.body).toMatchObject({ status: 'TARGET_REVIEW', stateVersion: 1 });

    const events = await request(app.getHttpServer())
      .get(`/v1/campaigns/${campaign.body.id}/events`)
      .expect(200);
    expect(events.body.map((event: { eventType: string }) => event.eventType)).toEqual([
      'campaign.created',
      'target.submitted',
    ]);
  });

  it('rejects a stale transition version', async () => {
    const project = await request(app.getHttpServer())
      .post('/v1/projects')
      .set(actorHeaders)
      .set('idempotency-key', 'stale-project')
      .send({ organizationId: 'organization-1', name: 'Stale test' })
      .expect(201);
    const target = await request(app.getHttpServer())
      .post('/v1/targets')
      .set(actorHeaders)
      .set('idempotency-key', 'stale-target')
      .send({
        organizationId: 'organization-1',
        projectId: project.body.id,
        scientificGoal: 'Test concurrency.',
        researchQuestion: 'Are stale writes denied?',
        acceptanceCriteria: ['A stale transition receives HTTP 409.'],
        verificationPolicyId: 'verification-policy-1',
        stopConditions: ['Stop after the conflict.'],
      })
      .expect(201);
    const campaign = await request(app.getHttpServer())
      .post('/v1/campaigns')
      .set(actorHeaders)
      .set('idempotency-key', 'stale-campaign')
      .send({
        organizationId: 'organization-1',
        projectId: project.body.id,
        targetVersionId: target.body.id,
        budgetLimit: {
          wallClockSeconds: 60,
          modelCalls: 1,
          tokens: 100,
          experiments: 1,
          computeMilliUnits: 100,
          parallelChildren: 1,
        },
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/campaigns/${campaign.body.id}/transitions`)
      .set(actorHeaders)
      .set('idempotency-key', 'stale-transition-1')
      .set('if-match', '0')
      .send({
        to: 'TARGET_REVIEW',
        predicates: { targetComplete: true },
        reason: 'First transition.',
      })
      .expect(201);

    const conflict = await request(app.getHttpServer())
      .post(`/v1/campaigns/${campaign.body.id}/transitions`)
      .set(actorHeaders)
      .set('idempotency-key', 'stale-transition-2')
      .set('if-match', '0')
      .send({
        to: 'DRAFT',
        reason: 'Stale transition.',
      })
      .expect(409);
    expect(conflict.body.code).toBe('STATE_VERSION_CONFLICT');
  });

  it('runs the approval-gated reference workflow through the control plane', async () => {
    let workerAction: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const input = JSON.parse(String(init.body)) as {
          campaign: Record<string, unknown>;
          target: Record<string, unknown>;
          approval?: unknown;
        };
        if (!input.approval) {
          workerAction = {
            contractVersion: '1.0',
            actionId: 'act_reference_worker',
            organizationId: input.campaign.organizationId,
            projectId: input.campaign.projectId,
            campaignId: input.campaign.id,
            kind: 'EXPERIMENT_EXECUTION',
            riskTier: 'RED',
            parameters: { planDigest: `sha256:${'a'.repeat(64)}` },
            requestedBy: {
              type: 'SERVICE',
              id: 'reference-workflow-worker',
              role: 'SYSTEM_SERVICE',
            },
            requestedAt: '2026-08-15T00:00:00.000Z',
          };
          return new Response(
            JSON.stringify({
              workflowId: `workflow_${input.campaign.id}`,
              runId: `run_${input.campaign.id}`,
              campaign: { ...input.campaign, status: 'WAITING_FOR_APPROVAL' },
              results: [],
              proposedAction: workerAction,
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            workflowId: `workflow_${input.campaign.id}`,
            runId: `run_${input.campaign.id}`,
            campaign: {
              ...input.campaign,
              status: 'DISCOVERY_CANDIDATE',
              budgetUsage: {
                wallClockSeconds: 60,
                modelCalls: 2,
                tokens: 0,
                experiments: 1,
                computeMilliUnits: 100,
                activeChildren: 0,
              },
            },
            hypothesis: {
              hypothesisId: 'hyp_reference_worker',
              campaignId: input.campaign.id,
              statement: 'The frozen reference sample has a positive mean.',
              rationale: 'A deterministic reference sample is used.',
              falsificationCriteria: ['The mean is not positive.'],
              assumptions: ['The reference sample remains immutable.'],
              generatedByRequestId: 'req_reference_hypothesis',
              createdAt: '2026-08-15T00:00:00.000Z',
            },
            plan: {
              planId: 'plan_reference_worker',
              campaignId: input.campaign.id,
              hypothesisId: 'hyp_reference_worker',
              version: 1,
              objective: 'Compute reference summary statistics.',
              executorId: 'reference-local-executor-v1',
              imageReference: `alphalab/reference-summary@sha256:${'b'.repeat(64)}`,
              imageDigest: `sha256:${'b'.repeat(64)}`,
              command: ['alphalab-reference-summary'],
              parameters: { values: [2, 4, 6, 8], seed: 7 },
              expectedMeasurements: ['mean'],
              successPredicates: ['mean > 0'],
              estimatedComputeMilliUnits: 100,
              estimatedWallClockSeconds: 60,
              requiresNetwork: false,
              createdAt: '2026-08-15T00:00:00.000Z',
            },
            results: [
              {
                resultId: 'result_reference_worker',
                experimentRunId: 'experiment_run_reference_worker',
                invocationId: 'invocation_reference_worker',
                status: 'SUCCEEDED',
                measurements: [{ name: 'mean', value: 5 }],
                artifacts: [
                  {
                    artifactId: 'artifact_reference_worker',
                    digest: `sha256:${'c'.repeat(64)}`,
                    mediaType: 'application/json',
                    sizeBytes: 42,
                  },
                ],
                normalizedResultDigest: `sha256:${'d'.repeat(64)}`,
                environmentDigest: `sha256:${'e'.repeat(64)}`,
                startedAt: '2026-08-15T00:00:00.000Z',
                completedAt: '2026-08-15T00:00:01.000Z',
                exitCode: 0,
              },
            ],
            verificationReport: {
              contractVersion: '1.0',
              reportId: 'vrf_reference_worker',
              organizationId: input.campaign.organizationId,
              projectId: input.campaign.projectId,
              campaignId: input.campaign.id,
              policyVersion: input.target.verificationPolicyId,
              status: 'VERIFIED',
              predicateResults: [
                {
                  predicateId: 'reference-positive-mean',
                  status: 'PASS',
                  evidenceIds: [],
                  reason: 'The deterministic local reference experiment passed.',
                },
              ],
              candidateEligible: true,
              humanApprovalRequired: true,
              createdAt: '2026-08-15T00:00:00.000Z',
            },
            bundle: {
              contractVersion: '1.0',
              bundleId: 'bundle_reference_worker',
              bundleVersion: 1,
              organizationId: input.campaign.organizationId,
              projectId: input.campaign.projectId,
              campaignId: input.campaign.id,
              targetVersionId: input.campaign.targetVersionId,
              createdAt: '2026-08-15T00:00:01.000Z',
              createdBy: 'reference-workflow-worker',
              artifacts: [
                {
                  artifactId: 'artifact_reference_worker',
                  digest: `sha256:${'c'.repeat(64)}`,
                  mediaType: 'application/json',
                  sizeBytes: 42,
                },
              ],
              files: [
                {
                  path: 'artifacts/artifact_reference_worker',
                  digest: `sha256:${'c'.repeat(64)}`,
                  sizeBytes: 42,
                },
              ],
              invocation: {
                imageReference: `alphalab/reference-summary@sha256:${'b'.repeat(64)}`,
                imageDigest: `sha256:${'b'.repeat(64)}`,
                command: ['alphalab-reference-summary'],
                parameters: { values: [2, 4, 6, 8], seed: 7 },
                seeds: [7],
              },
              normalizedResultDigest: `sha256:${'d'.repeat(64)}`,
              manifestDigest: `sha256:${'f'.repeat(64)}`,
            },
          }),
          { status: 200 },
        );
      }),
    );

    const project = await request(app.getHttpServer())
      .post('/v1/projects')
      .set(actorHeaders)
      .set('idempotency-key', 'reference-project')
      .send({ organizationId: 'organization-1', name: 'Reference runner' })
      .expect(201);
    const target = await request(app.getHttpServer())
      .post('/v1/targets')
      .set(actorHeaders)
      .set('idempotency-key', 'reference-target')
      .send({
        organizationId: 'organization-1',
        projectId: project.body.id,
        scientificGoal: 'Test the worker bridge.',
        researchQuestion: 'Can an exact approved action run?',
        acceptanceCriteria: ['A candidate is created only after verification.'],
        verificationPolicyId: 'policy-reference',
        stopConditions: ['Stop after one run.'],
      })
      .expect(201);
    const campaign = await request(app.getHttpServer())
      .post('/v1/campaigns')
      .set(actorHeaders)
      .set('idempotency-key', 'reference-campaign')
      .send({
        organizationId: 'organization-1',
        projectId: project.body.id,
        targetVersionId: target.body.id,
        budgetLimit: {
          wallClockSeconds: 600,
          modelCalls: 4,
          tokens: 1000,
          experiments: 1,
          computeMilliUnits: 1000,
          parallelChildren: 1,
        },
      })
      .expect(201);
    let state = campaign.body;
    for (const [to, predicates] of [
      ['TARGET_REVIEW', { targetComplete: true }],
      ['READY_FOR_ROUTE', { targetComplete: true }],
      ['ROUTE_REVIEW', {}],
      ['READY', { routeApproved: true }],
    ] as const) {
      state = (
        await request(app.getHttpServer())
          .post(`/v1/campaigns/${campaign.body.id}/transitions`)
          .set(actorHeaders)
          .set('idempotency-key', `reference-${to}`)
          .set('if-match', String(state.stateVersion))
          .send({ to, predicates, reason: `Move to ${to}.` })
          .expect(201)
      ).body;
    }

    const launched = await request(app.getHttpServer())
      .post(`/v1/campaigns/${campaign.body.id}/reference-runs`)
      .set(actorHeaders)
      .set('idempotency-key', 'reference-launch')
      .expect(201);
    expect(launched.body.campaign.status).toBe('WAITING_FOR_APPROVAL');
    expect(workerAction).toBeDefined();
    const approvals = await request(app.getHttpServer()).get('/v1/approval-requests').expect(200);
    const approval = approvals.body[0];
    await request(app.getHttpServer())
      .post(`/v1/approval-requests/${approval.id}/decisions`)
      .set({ 'x-actor-id': 'reviewer-1', 'x-actor-role': 'SCIENTIFIC_REVIEWER' })
      .set('idempotency-key', 'reference-approve')
      .send({
        decision: 'APPROVED',
        reason: 'Reviewed.',
        expiresAt: '2026-08-16T00:00:00.000Z',
        policyVersion: 'policy-reference',
      })
      .expect(201);
    const finalCampaign = await request(app.getHttpServer())
      .get(`/v1/campaigns/${campaign.body.id}`)
      .expect(200);
    expect(finalCampaign.body).toMatchObject({
      status: 'DISCOVERY_CANDIDATE',
      budgetUsage: { experiments: 1, modelCalls: 2 },
    });
    const evidence = await request(app.getHttpServer())
      .get(`/v1/campaigns/${campaign.body.id}/evidence`)
      .expect(200);
    const reports = await request(app.getHttpServer())
      .get(`/v1/campaigns/${campaign.body.id}/verification-reports`)
      .expect(200);
    const bundles = await request(app.getHttpServer())
      .get(`/v1/campaigns/${campaign.body.id}/reproducibility-bundles`)
      .expect(200);
    const artifacts = await request(app.getHttpServer())
      .get(`/v1/projects/${project.body.id}/artifacts`)
      .expect(200);
    expect(evidence.body).toHaveLength(4);
    expect(evidence.body.map((record: { type: string }) => record.type)).toEqual(
      expect.arrayContaining([
        'HYPOTHESIS',
        'OBSERVATION',
        'REPRODUCIBLE_EVIDENCE',
        'VERIFIED_DISCOVERY_CANDIDATE',
      ]),
    );
    expect(reports.body).toMatchObject([{ reportId: 'vrf_reference_worker', status: 'VERIFIED' }]);
    expect(bundles.body).toMatchObject([{ bundleId: 'bundle_reference_worker' }]);
    expect(artifacts.body).toMatchObject([
      { artifact: { digest: `sha256:${'c'.repeat(64)}` }, projectId: project.body.id },
    ]);
  });
});
