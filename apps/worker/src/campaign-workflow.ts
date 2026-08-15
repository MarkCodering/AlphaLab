import { randomUUID } from 'node:crypto';
import {
  ApprovalArtifactSchema,
  ControllerDecisionSchema,
  ExperimentInvocationSchema,
  ExperimentPlanSchema,
  HypothesisSchema,
  ProposedActionSchema,
  SupervisorFindingSchema,
  type Actor,
  type ApprovalArtifact,
  type Campaign,
  type ExperimentPlan,
  type ProposedAction,
  type TargetVersion,
} from '@alphalab/contracts';
import { reserveBudget, transitionCampaign } from '@alphalab/domain';
import type { ReproducibilityBundleExporter } from '@alphalab/evidence';
import type { ExperimentExecutor } from '@alphalab/experiment-sdk';
import type { ModelAdapter } from '@alphalab/model-adapters';
import { authorizeAction, classifyAction, digestAction } from '@alphalab/policy';
import type { DeterministicOutcomeVerifier, VerificationPolicy } from '@alphalab/verifier';
import { z } from 'zod';
import {
  digestValue,
  type CampaignWorkflowSnapshot,
  type WorkflowNodeId,
  type WorkflowStore,
} from './workflow-store.js';

const HypothesisProposalSchema = z.object({
  statement: z.string().min(1),
  rationale: z.string().min(1),
  falsificationCriteria: z.array(z.string().min(1)).min(1),
  assumptions: z.array(z.string().min(1)),
});

const PlanProposalSchema = z.object({
  objective: z.string().min(1),
  command: z.array(z.string()).min(1),
  parameters: z.record(z.string(), z.unknown()),
  expectedMeasurements: z.array(z.string().min(1)).min(1),
  successPredicates: z.array(z.string().min(1)).min(1),
});

export interface CampaignWorkflowInput {
  campaign: Campaign;
  target: TargetVersion;
  researcher: Actor;
  serviceActor: Actor;
  modelId: string;
  executorId: string;
  imageReference: string;
  imageDigest: `sha256:${string}`;
  verificationPolicy: VerificationPolicy;
  seeds: number[];
  approval?: ApprovalArtifact;
}

export interface CampaignWorkflowDependencies {
  store: WorkflowStore;
  model: ModelAdapter;
  executor: ExperimentExecutor;
  verifier: DeterministicOutcomeVerifier;
  bundleExporter: ReproducibilityBundleExporter;
  now?: () => string;
}

export class CampaignWorkflow {
  private readonly now: () => string;

  constructor(private readonly dependencies: CampaignWorkflowDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  async run(input: CampaignWorkflowInput): Promise<CampaignWorkflowSnapshot> {
    this.validateInput(input);
    let snapshot =
      (await this.dependencies.store.load(input.campaign.id)) ?? this.initialize(input.campaign);

    if (snapshot.campaign.status === 'READY') {
      snapshot.campaign = transitionCampaign(snapshot.campaign, {
        to: 'RUNNING',
        actor: input.researcher,
        predicates: { budgetReserved: true },
        reason: 'Launch approved campaign workflow.',
        occurredAt: this.now(),
      }).campaign;
      await this.checkpoint(snapshot);
    }

    if (!snapshot.hypothesis) {
      snapshot.campaign = this.reserve(snapshot.campaign, { modelCalls: 1 });
      const requestId = `${snapshot.runId}-hypothesis`;
      const generated = await this.dependencies.model.generateStructured({
        requestId,
        modelId: input.modelId,
        prompt: buildHypothesisPrompt(input.target),
        schema: HypothesisProposalSchema,
        jsonSchema: {
          type: 'object',
          required: ['statement', 'rationale', 'falsificationCriteria', 'assumptions'],
        },
        timeoutMs: 120_000,
        temperature: 0,
        seed: input.seeds[0]!,
      });
      snapshot.hypothesis = HypothesisSchema.parse({
        hypothesisId: `hyp_${randomUUID()}`,
        campaignId: snapshot.campaign.id,
        ...generated.value,
        generatedByRequestId: requestId,
        createdAt: this.now(),
      });
      this.receipt(snapshot, 'hypothesis', input.target, snapshot.hypothesis);
      await this.checkpoint(snapshot);
    }

    if (!snapshot.plan) {
      snapshot.campaign = this.reserve(snapshot.campaign, { modelCalls: 1 });
      const requestId = `${snapshot.runId}-plan`;
      const generated = await this.dependencies.model.generateStructured({
        requestId,
        modelId: input.modelId,
        prompt: buildPlanPrompt(input.target, snapshot.hypothesis),
        schema: PlanProposalSchema,
        jsonSchema: {
          type: 'object',
          required: [
            'objective',
            'command',
            'parameters',
            'expectedMeasurements',
            'successPredicates',
          ],
        },
        timeoutMs: 120_000,
        temperature: 0,
        seed: input.seeds[0]!,
      });
      snapshot.plan = ExperimentPlanSchema.parse({
        planId: `plan_${randomUUID()}`,
        campaignId: snapshot.campaign.id,
        hypothesisId: snapshot.hypothesis.hypothesisId,
        version: 1,
        ...generated.value,
        executorId: input.executorId,
        imageReference: input.imageReference,
        imageDigest: input.imageDigest,
        estimatedComputeMilliUnits: 100,
        estimatedWallClockSeconds: 60,
        requiresNetwork: false,
        createdAt: this.now(),
      });
      this.receipt(snapshot, 'plan', snapshot.hypothesis, snapshot.plan);
      await this.checkpoint(snapshot);
    }

    if (snapshot.findings.length === 0) {
      const finding = SupervisorFindingSchema.parse({
        findingId: `find_${randomUUID()}`,
        campaignId: snapshot.campaign.id,
        runId: snapshot.runId,
        severity: snapshot.plan.requiresNetwork ? 'CRITICAL' : 'INFO',
        category: snapshot.plan.requiresNetwork ? 'SECURITY_DEFECT' : 'ASSUMPTION',
        statement: snapshot.plan.requiresNetwork
          ? 'The plan requests network access and requires a separate Red approval.'
          : 'The plan assumes the frozen input artifacts are sufficient and performs no retrieval.',
        evidenceIds: [],
        blocksProgress: snapshot.plan.requiresNetwork,
        createdAt: this.now(),
      });
      snapshot.findings.push(finding);
      snapshot.controllerDecisions.push(
        ControllerDecisionSchema.parse({
          decisionId: `dec_${randomUUID()}`,
          campaignId: snapshot.campaign.id,
          runId: snapshot.runId,
          decision: finding.blocksProgress ? 'NEEDS_HUMAN' : 'RUN_EXPERIMENT',
          reason: finding.statement,
          policyPredicateIds: ['policy-experiment-approval'],
          authority: 'ADVISORY',
          createdAt: this.now(),
        }),
      );
      this.receipt(snapshot, 'supervision', snapshot.plan, finding);
      await this.checkpoint(snapshot);
    }

    if (!snapshot.proposedAction) {
      snapshot.proposedAction = this.proposeExperiment(
        snapshot,
        snapshot.plan!,
        input.serviceActor,
      );
      snapshot.campaign = transitionCampaign(snapshot.campaign, {
        to: 'WAITING_FOR_APPROVAL',
        actor: input.serviceActor,
        reason: 'Experiment execution is a Red action.',
        occurredAt: this.now(),
      }).campaign;
      await this.checkpoint(snapshot);
    }

    if (!input.approval) return snapshot;

    if (!snapshot.approval) {
      const decision = authorizeAction(snapshot.proposedAction, input.approval, this.now());
      if (!decision.allowed) {
        snapshot.lastError = { code: decision.code, message: decision.reason };
        await this.checkpoint(snapshot);
        return snapshot;
      }
      snapshot.approval = ApprovalArtifactSchema.parse({
        ...input.approval,
        consumedAt: this.now(),
      });
      this.receipt(snapshot, 'approval', snapshot.proposedAction, snapshot.approval);
      await this.checkpoint(snapshot);
    }

    if (snapshot.results.length === 0) {
      snapshot.campaign = this.reserve(snapshot.campaign, {
        experiments: 1,
        computeMilliUnits: snapshot.plan.estimatedComputeMilliUnits,
        wallClockSeconds: snapshot.plan.estimatedWallClockSeconds,
        activeChildren: 1,
      });
      snapshot.campaign = transitionCampaign(snapshot.campaign, {
        to: 'RUNNING_EXPERIMENT',
        actor: input.serviceActor,
        predicates: { approvalValid: true, budgetReserved: true },
        reason: 'The exact experiment action has valid human approval.',
        occurredAt: this.now(),
      }).campaign;
      await this.checkpoint(snapshot);

      const invocation = ExperimentInvocationSchema.parse({
        contractVersion: '1.0',
        invocationId: `${snapshot.runId}-experiment-1`,
        experimentRunId: `${snapshot.runId}-experiment-run-1`,
        organizationId: snapshot.campaign.organizationId,
        projectId: snapshot.campaign.projectId,
        campaignId: snapshot.campaign.id,
        planDigest: digestValue(snapshot.plan),
        approvalId: snapshot.approval.approvalId,
        imageReference: snapshot.plan.imageReference,
        imageDigest: snapshot.plan.imageDigest,
        command: snapshot.plan.command,
        inputs: [],
        resources: {
          cpuMillis: 1000,
          memoryMiB: 512,
          gpuCount: 0,
          diskMiB: 1024,
          timeoutSeconds: snapshot.plan.estimatedWallClockSeconds,
          maxOutputBytes: 10_000_000,
        },
        networkPolicy: { mode: 'DENY_ALL', allowedDestinations: [] },
        idempotencyKey: `${snapshot.runId}-experiment-1`,
      });
      const reconciled = await this.dependencies.executor.lookup(invocation.invocationId);
      const result = reconciled ?? (await this.dependencies.executor.execute(invocation));
      snapshot.results.push(result);
      snapshot.campaign = {
        ...snapshot.campaign,
        budgetUsage: {
          ...snapshot.campaign.budgetUsage,
          activeChildren: Math.max(0, snapshot.campaign.budgetUsage.activeChildren - 1),
        },
      };
      this.receipt(snapshot, 'experiment', invocation, result);
      snapshot.campaign = transitionCampaign(snapshot.campaign, {
        to: 'VERIFYING',
        actor: input.serviceActor,
        predicates: { executionCompleted: true },
        reason: 'Experiment result and artifacts were persisted.',
        occurredAt: this.now(),
      }).campaign;
      await this.checkpoint(snapshot);
    }

    if (!snapshot.verificationReport) {
      snapshot.verificationReport = this.dependencies.verifier.verify({
        organizationId: snapshot.campaign.organizationId,
        projectId: snapshot.campaign.projectId,
        campaignId: snapshot.campaign.id,
        results: snapshot.results,
        findings: snapshot.findings,
        policy: input.verificationPolicy,
        createdAt: this.now(),
      });
      this.receipt(snapshot, 'verification', snapshot.results, snapshot.verificationReport);
      const nextStatus = snapshot.verificationReport.candidateEligible
        ? 'DISCOVERY_CANDIDATE'
        : 'NEXT_EXPERIMENT_READY';
      snapshot.campaign = transitionCampaign(snapshot.campaign, {
        to: nextStatus,
        actor: input.serviceActor,
        predicates: {
          provenanceComplete: snapshot.results.every((result) => result.artifacts.length > 0),
          verificationPassed: snapshot.verificationReport.candidateEligible,
        },
        reason: snapshot.verificationReport.candidateEligible
          ? 'All automated verification predicates passed.'
          : 'Evidence is insufficient; prepare the next experiment.',
        occurredAt: this.now(),
      }).campaign;
      await this.checkpoint(snapshot);
    }

    if (!snapshot.bundle) {
      const firstResult = snapshot.results[0];
      if (!firstResult?.normalizedResultDigest) {
        throw new Error('Cannot export a bundle without a normalized result digest');
      }
      const exported = await this.dependencies.bundleExporter.export({
        organizationId: snapshot.campaign.organizationId,
        projectId: snapshot.campaign.projectId,
        campaignId: snapshot.campaign.id,
        targetVersionId: snapshot.campaign.targetVersionId,
        createdBy: input.serviceActor.id,
        createdAt: this.now(),
        artifacts: snapshot.results.flatMap((result) => result.artifacts),
        invocation: {
          imageReference: snapshot.plan.imageReference,
          imageDigest: snapshot.plan.imageDigest,
          command: snapshot.plan.command,
          parameters: snapshot.plan.parameters,
          seeds: input.seeds,
        },
        normalizedResultDigest: firstResult.normalizedResultDigest as `sha256:${string}`,
      });
      snapshot.bundle = exported.manifest;
      this.receipt(snapshot, 'export', snapshot.verificationReport, snapshot.bundle);
      await this.checkpoint(snapshot);
    }

    return snapshot;
  }

  private initialize(campaign: Campaign): CampaignWorkflowSnapshot {
    return {
      schemaVersion: 1,
      workflowId: `workflow_${campaign.id}`,
      runId: `run_${randomUUID()}`,
      campaign,
      results: [],
      findings: [],
      controllerDecisions: [],
      receipts: {},
      updatedAt: this.now(),
    };
  }

  private validateInput(input: CampaignWorkflowInput): void {
    if (input.campaign.targetVersionId !== input.target.id) {
      throw new Error('Campaign Target version does not match the supplied immutable Target');
    }
    if (input.researcher.role !== 'RESEARCHER' || input.serviceActor.role !== 'SYSTEM_SERVICE') {
      throw new Error('Workflow actors do not have the required roles');
    }
    if (input.seeds.length === 0) throw new Error('At least one random seed is required');
  }

  private proposeExperiment(
    snapshot: CampaignWorkflowSnapshot,
    plan: ExperimentPlan,
    actor: Actor,
  ): ProposedAction {
    const action = ProposedActionSchema.parse({
      contractVersion: '1.0',
      actionId: `act_${randomUUID()}`,
      organizationId: snapshot.campaign.organizationId,
      projectId: snapshot.campaign.projectId,
      campaignId: snapshot.campaign.id,
      kind: 'EXPERIMENT_EXECUTION',
      riskTier: classifyAction('EXPERIMENT_EXECUTION'),
      parameters: {
        planDigest: digestValue(plan),
        imageReference: plan.imageReference,
        imageDigest: plan.imageDigest,
        command: plan.command,
      },
      requestedBy: actor,
      requestedAt: this.now(),
    });
    digestAction(action);
    return action;
  }

  private reserve(campaign: Campaign, request: Parameters<typeof reserveBudget>[2]): Campaign {
    return {
      ...campaign,
      budgetUsage: reserveBudget(campaign.budgetLimit, campaign.budgetUsage, request),
      updatedAt: this.now(),
    };
  }

  private receipt(
    snapshot: CampaignWorkflowSnapshot,
    nodeId: WorkflowNodeId,
    input: unknown,
    output: unknown,
  ): void {
    snapshot.receipts[nodeId] = {
      nodeId,
      inputDigest: digestValue(input),
      outputDigest: digestValue(output),
      completedAt: this.now(),
    };
  }

  private async checkpoint(snapshot: CampaignWorkflowSnapshot): Promise<void> {
    snapshot.updatedAt = this.now();
    await this.dependencies.store.save(snapshot);
  }
}

function buildHypothesisPrompt(target: TargetVersion): string {
  return [
    'Generate one falsifiable scientific hypothesis as JSON.',
    `Scientific goal: ${target.scientificGoal}`,
    `Research question: ${target.researchQuestion}`,
    `Acceptance criteria: ${target.acceptanceCriteria.join('; ')}`,
    'Do not redefine the goal or acceptance criteria.',
  ].join('\n');
}

function buildPlanPrompt(target: TargetVersion, hypothesis: unknown): string {
  return [
    'Produce one bounded experiment plan as JSON.',
    `Target: ${target.scientificGoal}`,
    `Hypothesis: ${JSON.stringify(hypothesis)}`,
    'The plan must not require external network access.',
  ].join('\n');
}
