# ADR 0001: Reversible implementation defaults

- Status: accepted provisionally by the instruction to begin implementation
- Date: 2026-08-15
- Target Contract: `ALPHALAB-PLATFORM-001`

## Decision

Begin with a single-organization collaborative product boundary, policy-gated
autonomy, local accounts plus an OIDC adapter boundary, local CPU/GPU deployment
before Kubernetes, and an engineering reference campaign that does not assert
scientific novelty.

`VERIFIED` requires deterministic verification predicates and an attributable
scientific reviewer. Model and service actors remain advisory.

Deterministic workflow-history reconstruction is allowed. Recovery may not
repeat model calls, tool calls, approvals, experiments, or other side effects
without checking the durable side-effect receipt.

## Consequences

All organization and project identifiers remain mandatory even before
multi-organization support exists. These defaults are replaceable through a new
ADR and additive schema changes; they are not claims that the unresolved
scientific or compliance policies have been settled permanently.
