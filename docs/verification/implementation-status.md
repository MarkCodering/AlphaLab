# Implementation and proof status

This document separates implemented behavior from acceptance evidence for
Target Contract `ALPHALAB-PLATFORM-001`. A passing software check is not a
scientific verification claim.

## Verified locally on 2026-08-15

- `pnpm dev` starts the web workspace, NestJS API, durable worker, model
  runtime, experiment runner, and verifier runtime on coordinated loopback
  ports. With another AlphaLab instance already using ports 3000 and 4310, a
  second profile started on 3001, 4311, 4312, and 8101-8103; every health
  endpoint returned HTTP 200.
- Browser QA covered the empty workspace, real project/Target/campaign
  creation, a state transition, live data refresh, global Runtime navigation,
  responsive layout, and zero browser console errors.
- TypeScript and Python type/compile checks, unit/integration tests, production
  builds, Prisma schema generation/validation, five Terraform profile plans,
  merged Compose configuration validation, formatting, and repository diff
  checks pass.
- `pnpm audit` reports no known vulnerabilities after patched transitive
  dependency overrides.
- Tests prove exact approval-digest binding, idempotency, optimistic campaign
  transitions, budget accounting, append-only evidence semantics, provider
  fallback denial, deterministic verification, durable pause/resume without
  model replay, and single experiment execution in the vertical slice.
- The worker exposes a durable local reference-run endpoint. Its focused test
  exercises `READY` through `WAITING_FOR_APPROVAL` to
  `DISCOVERY_CANDIDATE`, checks the exact approval digest, writes a
  content-addressed artifact, records all workflow receipts, and exports a
  reproducibility bundle.
- `POST /v1/campaigns/:id/reference-runs` connects a `READY` campaign to that
  worker, records the worker's exact Red action as an approval request, and an
  approved decision resumes the same durable run. The campaign state machine
  then records experiment scheduling, verification, and a discovery candidate;
  the final reviewer acceptance remains separate.

## Implemented but awaiting environment-backed proof

- Prisma is the production ORM and the Compose API is configured to run the
  checked-in PostgreSQL migration before startup. The zero-setup developer path
  intentionally selects the in-memory repository when `DATABASE_URL` is absent.
  A live PostgreSQL migration/restart test was not run because no local
  PostgreSQL service or Docker daemon was available during this verification.
- Dockerfiles and the hardened local/air-gap Compose declarations validate, but
  container image builds, sandbox escape tests, restart recovery, and captured
  zero-egress air-gap evidence require a running Docker daemon.
- Terraform modules validate and produce non-applying plans for Kubernetes,
  AWS, GCP, Azure, and on-premise profiles. They are deployment contracts, not
  authorized cloud infrastructure applies.

## Not yet proven against the full Target Contract

- a frozen-domain scientific benchmark and a reviewer-approved verified
  discovery;
- real Ollama, vLLM, and Hugging Face model parity with provider-loss recovery;
- arbitrary submitted-code isolation under adversarial sandbox testing;
- organization identity, project-role authorization, secrets integration, and
  multi-tenant cross-project isolation in a deployed environment;
- p95 control-plane performance and sustained load budgets;
- complete artifact/object-store, dataset lineage, retention, backup, restore,
  upgrade, rollback, and forward-repair drills;
- real cloud-provider resources and privileged operator-reviewed applies;
- physical laboratory, publication, and other explicitly Red integrations.

Until those proofs exist, missing evidence remains `NOT_TESTED`; it must never
be presented as a passing platform or scientific result.
