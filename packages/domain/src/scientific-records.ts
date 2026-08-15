import type { EvidenceRecord, VerificationReport } from '@alphalab/contracts';
import { DomainError } from './errors.js';

export function assertEvidenceCanSupportFinalClaim(evidence: EvidenceRecord): void {
  if (evidence.status === 'INVALIDATED' || evidence.status === 'SUPERSEDED') {
    throw new DomainError(
      'EVIDENCE_INVALID',
      'Invalidated or superseded evidence cannot support a final claim',
    );
  }
  if (evidence.type !== 'REPRODUCIBLE_EVIDENCE' || evidence.status !== 'REPRODUCED') {
    throw new DomainError(
      'EVIDENCE_NOT_REPRODUCIBLE',
      'Only reproduced scientific evidence may directly support a final scientific claim',
    );
  }
  if (evidence.artifacts.length === 0 || evidence.sourcePointers.length === 0) {
    throw new DomainError(
      'PROVENANCE_INCOMPLETE',
      'Evidence requires artifacts and source pointers',
    );
  }
}

export function assertCandidateEligibility(report: VerificationReport): void {
  if (!report.candidateEligible || report.status !== 'VERIFIED') {
    throw new DomainError(
      'VERIFICATION_NOT_PASSED',
      'The verification report is not candidate eligible',
    );
  }
  const unpassed = report.predicateResults.filter((result) => result.status !== 'PASS');
  if (unpassed.length > 0) {
    throw new DomainError('MISSING_EVIDENCE', 'Every verification predicate must pass', {
      predicateIds: unpassed.map((result) => result.predicateId),
    });
  }
}
