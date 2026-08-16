import 'reflect-metadata';
import { createHash } from 'node:crypto';
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
const referenceArtifactBytes = Buffer.from('{"measurements":[{"name":"mean","value":5}]}\n');
const referenceArtifactDigest = `sha256:${createHash('sha256')
  .update(referenceArtifactBytes)
  .digest('hex')}` as const;

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

  it('keeps organization emergency controls administrator-only and versioned', async () => {
    const initial = await request(app.getHttpServer())
      .get('/v1/organizations/organization-1/execution-controls')
      .expect(200);
    expect(initial.body).toMatchObject({
      version: 0,
      campaignExecutionEnabled: true,
      experimentExecutionEnabled: true,
      externalNetworkAccessEnabled: false,
      evidenceReadOnly: false,
    });

    const denied = await request(app.getHttpServer())
      .put('/v1/organizations/organization-1/execution-controls')
      .set(actorHeaders)
      .set('idempotency-key', 'researcher-control-change')
      .set('if-match', '0')
      .send({ experimentExecutionEnabled: false })
      .expect(403);
    expect(denied.body.code).toBe('ORGANIZATION_ADMIN_REQUIRED');

    const administratorHeaders = {
      'x-actor-id': 'organization-admin-1',
      'x-actor-role': 'ORGANIZATION_ADMIN',
    };
    const updated = await request(app.getHttpServer())
      .put('/v1/organizations/organization-1/execution-controls')
      .set(administratorHeaders)
      .set('idempotency-key', 'admin-control-change')
      .set('if-match', '0')
      .send({ experimentExecutionEnabled: false, evidenceReadOnly: true })
      .expect(200);
    expect(updated.body).toMatchObject({
      version: 1,
      experimentExecutionEnabled: false,
      evidenceReadOnly: true,
      externalNetworkAccessEnabled: false,
      updatedBy: 'organization-admin-1',
    });

    const stale = await request(app.getHttpServer())
      .put('/v1/organizations/organization-1/execution-controls')
      .set(administratorHeaders)
      .set('idempotency-key', 'admin-control-stale')
      .set('if-match', '0')
      .send({ evidenceReadOnly: false })
      .expect(409);
    expect(stale.body.code).toBe('CONTROL_VERSION_CONFLICT');
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
      .set(actorHeaders)
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
      .set(actorHeaders)
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
    expect(campaign.body).toMatchObject({
      status: 'DRAFT',
      stateVersion: 0,
      permittedModelIds: ['reference-local-worker-model-v1', 'deterministic-statistics-v1'],
      permittedToolIds: ['reference-local-executor-v1'],
      fallbackMode: 'STOP',
      approvedFallbackModelIds: [],
    });
    const disallowedRuntime = await request(app.getHttpServer())
      .post('/v1/campaigns')
      .set(actorHeaders)
      .set('idempotency-key', 'disallowed-runtime-campaign')
      .send({
        organizationId: 'organization-1',
        projectId: firstProject.body.id,
        targetVersionId: target.body.id,
        permittedModelIds: ['unapproved-local-model'],
        permittedToolIds: ['reference-local-executor-v1'],
        fallbackMode: 'STOP',
        approvedFallbackModelIds: [],
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
    const deniedLaunch = await request(app.getHttpServer())
      .post(`/v1/campaigns/${disallowedRuntime.body.id}/reference-runs`)
      .set(actorHeaders)
      .set('idempotency-key', 'disallowed-runtime-launch')
      .expect(422);
    expect(deniedLaunch.body.code).toBe('MODEL_NOT_PERMITTED');

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
      .set(actorHeaders)
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
    const dataset = await request(app.getHttpServer())
      .post('/v1/datasets')
      .set(actorHeaders)
      .set('idempotency-key', 'reference-dataset')
      .send({
        organizationId: 'organization-1',
        projectId: project.body.id,
        name: 'Frozen reference values',
        description: 'Values [2, 4, 6, 8] encoded with a terminal newline.',
        format: 'JSON',
        sourcePointer: 'local://reference-values-v1.json',
        license: 'CC0-1.0',
        contentDigest: 'sha256:3b49c633f765420086ab2ec3967a1649d598af8f20e6da28e3520c81a0146641',
        recordCount: 4,
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
        datasetVersionIds: [dataset.body.datasetVersionId],
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

  it('denies project-changing actions to an actor without membership', async () => {
    const project = await request(app.getHttpServer())
      .post('/v1/projects')
      .set(actorHeaders)
      .set('idempotency-key', 'membership-project')
      .send({ organizationId: 'organization-1', name: 'Private project' })
      .expect(201);
    const unrelatedActor = {
      'x-actor-id': 'unrelated-researcher',
      'x-actor-role': 'RESEARCHER',
    };
    await request(app.getHttpServer())
      .get(`/v1/projects/${project.body.id}`)
      .set(unrelatedActor)
      .expect(403);
    const hiddenProjects = await request(app.getHttpServer())
      .get('/v1/projects?organizationId=organization-1')
      .set(unrelatedActor)
      .expect(200);
    expect(hiddenProjects.body).toEqual([]);
    await request(app.getHttpServer())
      .get(`/v1/projects/${project.body.id}/members`)
      .set(unrelatedActor)
      .expect(403);
    const grantedMember = await request(app.getHttpServer())
      .post(`/v1/projects/${project.body.id}/members`)
      .set(actorHeaders)
      .set('idempotency-key', 'membership-grant-researcher')
      .send({ actorId: 'authorized-researcher', role: 'RESEARCHER' })
      .expect(201);
    expect(grantedMember.body).toMatchObject({
      actorId: 'authorized-researcher',
      role: 'RESEARCHER',
      createdBy: 'researcher-1',
    });
    await request(app.getHttpServer())
      .get(`/v1/projects/${project.body.id}`)
      .set({ 'x-actor-id': 'authorized-researcher', 'x-actor-role': 'RESEARCHER' })
      .expect(200);
    const denied = await request(app.getHttpServer())
      .post('/v1/targets')
      .set(unrelatedActor)
      .set('idempotency-key', 'membership-denied-target')
      .send({
        organizationId: 'organization-1',
        projectId: project.body.id,
        scientificGoal: 'Attempt cross-project mutation.',
        researchQuestion: 'Is project membership enforced?',
        acceptanceCriteria: ['The mutation is rejected.'],
        verificationPolicyId: 'membership-policy',
        stopConditions: ['Stop after denial.'],
      })
      .expect(403);
    expect(denied.body.code).toBe('ACTOR_NOT_AUTHORIZED');
  });

  it('keeps dataset versions immutable and project-scoped', async () => {
    const project = await request(app.getHttpServer())
      .post('/v1/projects')
      .set(actorHeaders)
      .set('idempotency-key', 'dataset-project')
      .send({ organizationId: 'organization-1', name: 'Dataset test' })
      .expect(201);
    const datasetBody = {
      organizationId: 'organization-1',
      projectId: project.body.id,
      name: 'Frozen reference values',
      description: 'Reference values used for deterministic local validation.',
      format: 'JSON',
      sourcePointer: 'local://reference-values-v1.json',
      license: 'CC0-1.0',
      contentDigest: `sha256:${'a'.repeat(64)}`,
      recordCount: 4,
    };
    const first = await request(app.getHttpServer())
      .post('/v1/datasets')
      .set(actorHeaders)
      .set('idempotency-key', 'dataset-create-v1')
      .send(datasetBody)
      .expect(201);
    const replayed = await request(app.getHttpServer())
      .post('/v1/datasets')
      .set(actorHeaders)
      .set('idempotency-key', 'dataset-create-v1')
      .send(datasetBody)
      .expect(201);
    expect(replayed.body.datasetVersionId).toBe(first.body.datasetVersionId);

    const revised = await request(app.getHttpServer())
      .post('/v1/datasets')
      .set(actorHeaders)
      .set('idempotency-key', 'dataset-create-v2')
      .send({
        ...datasetBody,
        datasetId: first.body.datasetId,
        contentDigest: `sha256:${'b'.repeat(64)}`,
      })
      .expect(201);
    expect(revised.body).toMatchObject({ datasetId: first.body.datasetId, version: 2 });

    const listed = await request(app.getHttpServer())
      .get(`/v1/datasets?projectId=${project.body.id}`)
      .set(actorHeaders)
      .expect(200);
    expect(listed.body.map((dataset: { version: number }) => dataset.version)).toEqual([1, 2]);
  });

  it('runs the approval-gated reference workflow through the control plane', async () => {
    let workerAction: Record<string, unknown> | undefined;
    let completedWorkflowRecord: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (String(_url).includes('/v1/artifacts/')) {
          return new Response(referenceArtifactBytes, {
            status: 200,
            headers: { 'x-content-digest': referenceArtifactDigest },
          });
        }
        if (String(_url).includes('/v1/reference-runs/')) {
          return completedWorkflowRecord
            ? new Response(JSON.stringify(completedWorkflowRecord), { status: 200 })
            : new Response(JSON.stringify({ code: 'REFERENCE_RUN_NOT_FOUND' }), { status: 404 });
        }
        const input = JSON.parse(String(init?.body)) as {
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
        completedWorkflowRecord = {
          schemaVersion: 1,
          updatedAt: '2026-08-15T00:00:01.000Z',
          findings: [],
          controllerDecisions: [],
          receipts: {},
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
                  digest: referenceArtifactDigest,
                  mediaType: 'application/json',
                  sizeBytes: referenceArtifactBytes.byteLength,
                },
              ],
              modelProvenance: {
                providerId: 'python-local-runtime',
                modelId: 'deterministic-statistics-v1',
                modelRevisionDigest: `sha256:${'1'.repeat(64)}`,
                normalizedResultDigest: `sha256:${'2'.repeat(64)}`,
              },
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
                digest: referenceArtifactDigest,
                mediaType: 'application/json',
                sizeBytes: referenceArtifactBytes.byteLength,
              },
            ],
            files: [
              {
                path: 'artifacts/artifact_reference_worker',
                digest: referenceArtifactDigest,
                sizeBytes: referenceArtifactBytes.byteLength,
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
        };
        return new Response(JSON.stringify(completedWorkflowRecord), { status: 200 });
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
        initialHypotheses: ['The frozen reference sample has a positive mean.'],
        acceptanceCriteria: ['A candidate is created only after verification.'],
        verificationPolicyId: 'policy-reference',
        stopConditions: ['Stop after one run.'],
      })
      .expect(201);
    expect(target.body.initialHypotheses).toEqual([
      'The frozen reference sample has a positive mean.',
    ]);
    const referenceDataset = await request(app.getHttpServer())
      .post('/v1/datasets')
      .set(actorHeaders)
      .set('idempotency-key', 'reference-dataset-runner')
      .send({
        organizationId: 'organization-1',
        projectId: project.body.id,
        name: 'Frozen reference values',
        description: 'Values [2, 4, 6, 8] encoded with a terminal newline.',
        format: 'JSON',
        sourcePointer: 'local://reference-values-v1.json',
        license: 'CC0-1.0',
        contentDigest: 'sha256:3b49c633f765420086ab2ec3967a1649d598af8f20e6da28e3520c81a0146641',
        recordCount: 4,
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
        datasetVersionIds: [referenceDataset.body.datasetVersionId],
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
    const intakeEvidence = await request(app.getHttpServer())
      .post(`/v1/campaigns/${campaign.body.id}/evidence`)
      .set(actorHeaders)
      .set('idempotency-key', 'reference-intake-evidence')
      .send({
        type: 'OBSERVATION',
        statement: 'The frozen reference dataset is available for the bounded campaign.',
        sourcePointers: ['local://reference-values-v1.json'],
      })
      .expect(201);
    expect(intakeEvidence.body).toMatchObject({
      type: 'OBSERVATION',
      status: 'OBSERVED',
      artifacts: [],
    });
    await request(app.getHttpServer())
      .post(`/v1/campaigns/${campaign.body.id}/evidence`)
      .set(actorHeaders)
      .set('idempotency-key', 'reference-forged-candidate')
      .send({
        type: 'VERIFIED_DISCOVERY_CANDIDATE',
        statement: 'A user must not inject a final verified-discovery record.',
        sourcePointers: ['local://reference-values-v1.json'],
      })
      .expect(400);
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

    const administratorHeaders = {
      'x-actor-id': 'organization-admin-1',
      'x-actor-role': 'ORGANIZATION_ADMIN',
    };
    await request(app.getHttpServer())
      .put('/v1/organizations/organization-1/execution-controls')
      .set(administratorHeaders)
      .set('idempotency-key', 'reference-stop-experiments')
      .set('if-match', '0')
      .send({ experimentExecutionEnabled: false })
      .expect(200);
    const stopped = await request(app.getHttpServer())
      .post(`/v1/campaigns/${campaign.body.id}/reference-runs`)
      .set(actorHeaders)
      .set('idempotency-key', 'reference-blocked-launch')
      .expect(422);
    expect(stopped.body.code).toBe('EXPERIMENT_EXECUTION_DISABLED');
    await request(app.getHttpServer())
      .put('/v1/organizations/organization-1/execution-controls')
      .set(administratorHeaders)
      .set('idempotency-key', 'reference-allow-experiments')
      .set('if-match', '1')
      .send({ experimentExecutionEnabled: true })
      .expect(200);

    const launched = await request(app.getHttpServer())
      .post(`/v1/campaigns/${campaign.body.id}/reference-runs`)
      .set(actorHeaders)
      .set('idempotency-key', 'reference-launch')
      .expect(201);
    expect(launched.body.campaign.status).toBe('WAITING_FOR_APPROVAL');
    expect(workerAction).toBeDefined();
    const approvals = await request(app.getHttpServer())
      .get('/v1/approval-requests')
      .set(actorHeaders)
      .expect(200);
    const approval = approvals.body[0];
    await request(app.getHttpServer())
      .post(`/v1/approval-requests/${approval.id}/decisions`)
      .set({ 'x-actor-id': 'local-scientific-reviewer', 'x-actor-role': 'SCIENTIFIC_REVIEWER' })
      .set('idempotency-key', 'reference-approve')
      .send({
        decision: 'APPROVED',
        reason: 'Reviewed.',
        expiresAt: '2099-01-01T00:00:00.000Z',
        policyVersion: 'policy-reference',
      })
      .expect(201);
    const finalCampaign = await request(app.getHttpServer())
      .get(`/v1/campaigns/${campaign.body.id}`)
      .set(actorHeaders)
      .expect(200);
    expect(finalCampaign.body).toMatchObject({
      status: 'DISCOVERY_CANDIDATE',
      budgetUsage: { experiments: 1, modelCalls: 2 },
    });
    const workflowRecord = await request(app.getHttpServer())
      .get(`/v1/campaigns/${campaign.body.id}/workflow`)
      .set(actorHeaders)
      .expect(200);
    expect(workflowRecord.body).toMatchObject({
      workflowId: `workflow_${campaign.body.id}`,
      hypothesis: { hypothesisId: 'hyp_reference_worker' },
      plan: { planId: 'plan_reference_worker' },
      results: [{ resultId: 'result_reference_worker' }],
    });
    const evidence = await request(app.getHttpServer())
      .get(`/v1/campaigns/${campaign.body.id}/evidence`)
      .set(actorHeaders)
      .expect(200);
    const reports = await request(app.getHttpServer())
      .get(`/v1/campaigns/${campaign.body.id}/verification-reports`)
      .set(actorHeaders)
      .expect(200);
    const bundles = await request(app.getHttpServer())
      .get(`/v1/campaigns/${campaign.body.id}/reproducibility-bundles`)
      .set(actorHeaders)
      .expect(200);
    const artifacts = await request(app.getHttpServer())
      .get(`/v1/projects/${project.body.id}/artifacts`)
      .set(actorHeaders)
      .expect(200);
    expect(evidence.body).toHaveLength(5);
    expect(evidence.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceId: intakeEvidence.body.evidenceId,
          statement: 'The frozen reference dataset is available for the bounded campaign.',
        }),
      ]),
    );
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
      { artifact: { digest: referenceArtifactDigest }, projectId: project.body.id },
    ]);
    const reviewerAcceptance = await request(app.getHttpServer())
      .post(`/v1/campaigns/${campaign.body.id}/transitions`)
      .set({ 'x-actor-id': 'local-scientific-reviewer', 'x-actor-role': 'SCIENTIFIC_REVIEWER' })
      .set('idempotency-key', 'reference-final-review')
      .set('if-match', String(finalCampaign.body.stateVersion))
      .send({
        to: 'VERIFIED',
        predicates: {
          provenanceComplete: true,
          verificationPassed: true,
          humanScientificApproval: true,
        },
        reason: 'Scientific reviewer accepted the candidate.',
      })
      .expect(201);
    expect(reviewerAcceptance.body.status).toBe('VERIFIED');
    const downloaded = await request(app.getHttpServer())
      .get(`/v1/projects/${project.body.id}/artifacts/${referenceArtifactDigest}`)
      .set(actorHeaders)
      .expect(200);
    expect(downloaded.headers['x-content-digest']).toBe(referenceArtifactDigest);
    expect(downloaded.headers['content-length']).toBe(String(referenceArtifactBytes.byteLength));
    expect(downloaded.headers['content-disposition']).toContain('artifact_reference_worker');
  });
});
