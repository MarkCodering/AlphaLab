# AlphaLab

AlphaLab is a local-first, policy-gated scientific-discovery platform. It keeps
scientific intent, observations, evidence, and verification separate while it
coordinates model inference and isolated experiments through durable workflows.

This repository implements Target Contract `ALPHALAB-PLATFORM-001`.

## Current implementation

The executable vertical slice contains:

- versioned TypeScript contracts for campaigns, inference, experiments,
  approvals, events, evidence, and verification;
- a responsive Next.js research workspace for campaign creation, state
  transitions, approvals, evidence, audit records, and runtime health;
- a versioned NestJS control plane with optimistic concurrency, idempotency,
  live server-sent events, and a Prisma/PostgreSQL persistence adapter;
- durable workflow checkpoints, bounded experiment execution, portable model
  adapters, and an independent deterministic verifier;
- the campaign state machine, including explicit pause/resume and terminal
  states;
- deterministic budget reservation and reconciliation;
- deny-by-default action classification and approval binding;
- local, hardened Docker Compose, air-gap, and Terraform deployment contracts.

The control plane, worker, model runtime, experiment broker, web workspace, and
deployment profiles are built on these packages. See
[architecture.md](docs/architecture/architecture.md) for the target component
boundaries.

## Development

Requirements: Node.js 22+, pnpm 11+, and uv 0.11+.

```bash
pnpm install
pnpm dev
```

`pnpm dev` is the localhost entry point and starts every app workspace in
parallel. The workspace is at `http://localhost:3000`; API and worker health are
at `http://localhost:4310/v1/health` and `http://localhost:4311/v1/health`.
The isolated model, experiment, and verifier runtimes listen on ports 8100,
8101, and 8102. Individual processes use the `dev:web`, `dev:api`, `dev:worker`,
`dev:model`, `dev:experiment`, and `dev:verifier` scripts. The launcher selects
the next free coordinated localhost ports when defaults are occupied and prints
the effective URLs. Set a port explicitly, for example
`ALPHALAB_WEB_PORT=3001 pnpm dev`, when a stable override is required.

The zero-setup localhost profile uses the in-memory repository. Set
`DATABASE_URL` to a PostgreSQL connection string (or use the Compose profile)
to activate the Prisma repository. The container profile always sets
`ALPHALAB_PERSISTENCE=prisma` and applies the checked-in Prisma migrations
before the API starts.

The worker also exposes an approval-gated deterministic reference workflow at
`POST /v1/reference-runs` (through the frontend proxy at
`/api/runtime/worker/reference-runs`). It accepts a campaign, immutable Target,
and researcher identity; the first call returns `WAITING_FOR_APPROVAL` with the
exact proposed-action digest. Supplying the matching human approval resumes the
durable workflow and returns its verification report and reproducibility bundle.
The workspace launches this flow from a `READY` campaign; the control plane
imports the exact worker action into its approval queue and mirrors the returned
experiment, verification, and discovery-candidate state into the campaign audit
timeline.

Run the verification suite separately:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm audit
```

## Protected invariants

- A campaign is permanently bound to one immutable Target version.
- Models cannot approve actions or change scientific success criteria.
- Red actions require an attributable, unexpired approval for the exact action
  digest.
- Missing evidence is never interpreted as passing evidence.
- Provider fallback is explicit and recorded.
- Budget is reserved before chargeable work is scheduled.
- Finalized evidence is append-only; corrections and invalidations are new
  records.
- Local-only mode denies undeclared external communication.

## Status

AlphaLab is under active implementation. The runnable vertical slice and its
current proof status are recorded in
[implementation-status.md](docs/verification/implementation-status.md).
Passing software tests do not by themselves prove the complete platform
acceptance contract or a scientific discovery.
