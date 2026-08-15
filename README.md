# AlphaLab

AlphaLab is a local-first, policy-gated scientific-discovery platform. It keeps
scientific intent, observations, evidence, and verification separate while it
coordinates model inference and isolated experiments through durable workflows.

This repository implements Target Contract `ALPHALAB-PLATFORM-001`.

## Current implementation

The first executable foundation contains:

- versioned TypeScript contracts for campaigns, inference, experiments,
  approvals, events, evidence, and verification;
- the campaign state machine, including explicit pause/resume and terminal
  states;
- deterministic budget reservation and reconciliation;
- deny-by-default action classification and approval binding;
- architecture decisions recording the reversible defaults used to begin the
  implementation.

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

Run the verification suite separately:

```bash
pnpm typecheck
pnpm test
pnpm build
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

AlphaLab is under active implementation. Passing package tests prove only the
implemented contract and domain predicates; they do not yet prove the complete
platform acceptance contract or a scientific discovery.
