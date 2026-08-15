import { randomUUID } from 'node:crypto';
import {
  VerificationReportSchema,
  type ExperimentResult,
  type SupervisorFinding,
  type VerificationReport,
} from '@alphalab/contracts';

export type MeasurementOperator = 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ';

export interface MeasurementPredicate {
  predicateId: string;
  measurement: string;
  operator: MeasurementOperator;
  threshold: number;
}

export interface VerificationPolicy {
  policyVersion: string;
  requiredReproductions: number;
  requireIdenticalNormalizedDigest: boolean;
  requireArtifacts: boolean;
  measurementPredicates: MeasurementPredicate[];
  humanApprovalRequired: true;
}

export interface VerificationInput {
  organizationId: string;
  projectId: string;
  campaignId: string;
  results: ExperimentResult[];
  findings: SupervisorFinding[];
  policy: VerificationPolicy;
  createdAt?: string;
}

export class DeterministicOutcomeVerifier {
  verify(input: VerificationInput): VerificationReport {
    const predicateResults: VerificationReport['predicateResults'] = [];
    const successful = input.results.filter((result) => result.status === 'SUCCEEDED');
    predicateResults.push({
      predicateId: 'predicate-reproduction-count',
      status: successful.length >= input.policy.requiredReproductions ? 'PASS' : 'FAIL',
      evidenceIds: successful.map((result) => result.resultId),
      reason: `${successful.length} successful reproductions; ${input.policy.requiredReproductions} required.`,
    });

    if (input.policy.requireIdenticalNormalizedDigest) {
      const digests = successful
        .map((result) => result.normalizedResultDigest)
        .filter((digest): digest is NonNullable<typeof digest> => Boolean(digest));
      predicateResults.push({
        predicateId: 'predicate-normalized-result-integrity',
        status:
          digests.length >= input.policy.requiredReproductions && new Set(digests).size === 1
            ? 'PASS'
            : 'FAIL',
        evidenceIds: successful.map((result) => result.resultId),
        reason:
          digests.length === 0
            ? 'No normalized result digest was recorded.'
            : `${new Set(digests).size} distinct normalized result digests were observed.`,
      });
    }

    if (input.policy.requireArtifacts) {
      predicateResults.push({
        predicateId: 'predicate-artifacts-present',
        status:
          successful.length > 0 && successful.every((result) => result.artifacts.length > 0)
            ? 'PASS'
            : 'FAIL',
        evidenceIds: successful.flatMap((result) =>
          result.artifacts.map((artifact) => artifact.artifactId),
        ),
        reason: 'Every successful run must preserve at least one content-addressed artifact.',
      });
    }

    for (const predicate of input.policy.measurementPredicates) {
      const values = successful.flatMap((result) =>
        result.measurements
          .filter((measurement) => measurement.name === predicate.measurement)
          .map((measurement) => measurement.value)
          .filter((value): value is number => typeof value === 'number'),
      );
      const passed =
        values.length >= input.policy.requiredReproductions &&
        values.every((value) => compare(value, predicate.operator, predicate.threshold));
      predicateResults.push({
        predicateId: predicate.predicateId,
        status: values.length === 0 ? 'NOT_TESTED' : passed ? 'PASS' : 'FAIL',
        evidenceIds: successful.map((result) => result.resultId),
        reason:
          values.length === 0
            ? `Measurement ${predicate.measurement} was not observed.`
            : `Observed ${predicate.measurement}: ${values.join(', ')}; expected ${predicate.operator} ${predicate.threshold}.`,
      });
    }

    const blockingFindings = input.findings.filter(
      (finding) => finding.blocksProgress || finding.severity === 'CRITICAL',
    );
    predicateResults.push({
      predicateId: 'predicate-no-blocking-supervisor-findings',
      status: blockingFindings.length === 0 ? 'PASS' : 'FAIL',
      evidenceIds: blockingFindings.map((finding) => finding.findingId),
      reason:
        blockingFindings.length === 0
          ? 'No blocking process-supervision findings were present.'
          : `${blockingFindings.length} blocking findings remain.`,
    });

    const hasNotTested = predicateResults.some((predicate) => predicate.status === 'NOT_TESTED');
    const hasFailure = predicateResults.some((predicate) => predicate.status === 'FAIL');
    const status = hasNotTested ? 'NOT_TESTED' : hasFailure ? 'NOT_VERIFIED' : 'VERIFIED';
    return VerificationReportSchema.parse({
      contractVersion: '1.0',
      reportId: `vrf_${randomUUID()}`,
      organizationId: input.organizationId,
      projectId: input.projectId,
      campaignId: input.campaignId,
      policyVersion: input.policy.policyVersion,
      status,
      predicateResults,
      candidateEligible: status === 'VERIFIED',
      humanApprovalRequired: input.policy.humanApprovalRequired,
      createdAt: input.createdAt ?? new Date().toISOString(),
    });
  }
}

function compare(value: number, operator: MeasurementOperator, threshold: number): boolean {
  switch (operator) {
    case 'GT':
      return value > threshold;
    case 'GTE':
      return value >= threshold;
    case 'LT':
      return value < threshold;
    case 'LTE':
      return value <= threshold;
    case 'EQ':
      return value === threshold;
  }
}
