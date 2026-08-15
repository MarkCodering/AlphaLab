# ADR 0002: Domain-owned durable workflow port

- Status: accepted
- Date: 2026-08-15

## Decision

Campaign semantics, state transitions, idempotency keys, and side-effect
receipts belong to AlphaLab's domain packages. A workflow adapter may use
Temporal, but Temporal event history is not the product evidence model and does
not define scientific success.

## Rationale

This permits durable recovery without coupling campaign meaning to one
orchestration provider. A PostgreSQL leased-worker adapter can be implemented if
Temporal cannot satisfy the final deployment or replay policy.
