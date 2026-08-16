# Implementation and proof status

This document separates implemented behavior from acceptance evidence for
Target Contract `ALPHALAB-PLATFORM-001`. A passing software check is not a
scientific verification claim.

## Verified locally on 2026-08-16

- `pnpm dev` starts the web workspace, NestJS API, durable worker, model
  runtime, experiment runner, and verifier runtime on coordinated loopback
  ports. With another AlphaLab instance already using ports 3000 and 4310, a
  second profile started on 3001, 4311, 4312, and 8101-8103; every health
  endpoint returned HTTP 200.
- The local control-plane runtime was exercised directly over its versioned HTTP
  API. Browser-rendered QA is intentionally not claimed here because it has not
  been run during this verification session.
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
  reproducibility bundle. The reference policy requires three deterministic
  reproductions; every reproduction has its own invocation and durable
  receipt, while identical content deduplicates to one immutable artifact.
- `POST /v1/campaigns/:id/reference-runs` connects a `READY` campaign to that
  worker, records the worker's exact Red action as an approval request, and an
  approved decision resumes the same durable run. The campaign state machine
  then records experiment scheduling, verification, and a discovery candidate;
  the final reviewer acceptance remains separate.
- `GET /v1/campaigns/:id/workflow` now validates and returns the worker-owned
  durable workflow record only after project authorization and campaign identity
  checks. The workspace uses it to show retained hypotheses, approved plans,
  supervisor findings, controller decisions, measured outcomes, and any
  next-best-experiment report. A failed verification produces an advisory
  report that names the missing predicates but contains no executable action;
  a separate policy-checked, approval-gated plan is still required. API and
  worker integration tests cover the typed record boundary. This is a local
  reference-workflow surface, not a claim that every campaign type has a
  worker-owned scientific record.
- The campaign workspace exposes the committed experiment console separately
  from reasoning and evidence views. It displays the exact approved command,
  image provenance, per-reproduction state, exit code, measurements, model and
  environment identifiers, and only offers artifact download when the API has
  an integrity-checked persisted artifact record.
- Completing that path now persists immutable artifact metadata, typed
  hypothesis/observation/reproducible/candidate evidence records, an
  independent verification report, and the reproducibility manifest through
  the Prisma control-store boundary. The Evidence workspace reads those
  persisted records rather than presenting operational events as scientific
  evidence. An API runtime proof completed the local reference campaign and
  retrieved all four evidence records, a `VERIFIED` report, one artifact, and
  one bundle manifest.
- Researchers can also add source-pointer-backed `INTENT`, `HYPOTHESIS`,
  `OBSERVATION`, or `OPERATIONAL_EVIDENCE` records through the Evidence intake
  surface. The API assigns run and evidence identifiers, enforces project write
  authority and evidence-preservation mode, and disallows a user from entering
  final reproducible or verified-candidate evidence through that path.
- Dataset versions are now append-only, project-scoped records with a source
  pointer, licence, content digest, record count, and explicit campaign
  binding. The workspace exposes a Dataset view and the campaign creator
  freezes a dataset version before it creates a campaign. The reference worker
  rejects inputs other than its verified local fixture digest, so the local
  demonstration cannot silently represent arbitrary data as executed.
- Scientific Targets now retain researcher-authored initial hypotheses with the
  immutable Target version. The campaign creator collects them, the Target
  panel compares them with generated workflow hypotheses and their retained
  falsification criteria, and the worker receives them as comparison context
  while remaining unable to redefine the Target's success criteria.
- The Scientific record now includes dedicated, append-only supervision and
  controller ledgers rather than showing only the latest status. Findings carry
  severity, while controller decisions remain visibly advisory and cannot be
  confused with a human approval artifact.
- A fresh runtime proof created a versioned frozen dataset, bound it to a
  campaign, completed the approval-gated reference workflow, and retrieved the
  campaign with its unchanged dataset-version ID alongside four typed evidence
  records, a `VERIFIED` report, one bundle, and one artifact.
- A second live proof approved an action explicitly bound to three
  reproductions. It reached `DISCOVERY_CANDIDATE` only after the verifier
  reported `3 successful reproductions; 3 required` and one normalized-result
  digest. The bundle retained three artifact entries; content addressing
  correctly deduplicated them to one stored artifact record.
- The Evidence workspace now lists every retained artifact payload and downloads
  it through `GET /v1/projects/:projectId/artifacts/:digest`. The API retrieves
  the worker-owned object only when the project has persisted its artifact
  record, then verifies the returned digest header, SHA-256 bytes, and recorded
  length before returning the declared media type. A fresh live proof retrieved
  an 842-byte JSON artifact whose API response digest matched both its persisted
  record and a newly calculated SHA-256 hash.
- The Runtime workspace now reads typed model manifests from the isolated
  model-runtime service and renders the real provider, immutable revision,
  capability declarations, data boundary, concurrency, and remote-code policy.
  The current local manifest is a deterministic domain-inference provider;
  additional provider manifests remain an implementation and parity-testing
  requirement, not an implied capability.
- Every campaign now persists its permitted model IDs, permitted executor IDs,
  and fallback policy before work begins. The campaign creator selects the
  local model and executor explicitly, the workspace keeps that policy visible,
  and both API and worker refuse to launch the reference workflow when its
  required model or executor is not permitted. The local reference workflow
  records a `STOP` fallback policy; it does not imply a general provider
  selection or fallback implementation.
- The portable adapter layer now includes a capability-aware provider router.
  It stops on an unavailable selected provider unless an approved fallback is
  explicit; when a fallback succeeds, it returns a typed provenance record with
  the original provider, fallback provider, reason, and unchanged advisory
  authority. Focused adapter tests cover fallback, stop, and incompatible-model
  behavior; this is not yet a live multi-provider parity demonstration.
- Organization execution controls are persisted through Prisma, use optimistic
  versioning, and can be changed only by an `ORGANIZATION_ADMIN` actor. The
  Runtime workspace displays the active policy read-only for researchers.
  Campaign execution, experiment execution, and evidence-preservation mode are
  enforced on the reference workflow; the remaining persisted controls are
  explicit policy state pending connection to their respective external-model,
  loading, MCP, infrastructure, and scheduling integrations.
- The reference experiment now calls the isolated local domain-model runtime
  instead of reimplementing its statistics inside the worker. Its persisted
  artifact records the domain provider, model identifier, immutable revision
  digest, and normalized result digest. The deterministic reference model is a
  narrow proof of that boundary, not a parity claim for all model providers.
- Candidate eligibility now requires a provenance predicate in addition to
  numerical verification. Each successful reference reproduction must retain a
  verified source revision, model adapter and prompt-template version, pinned
  dataset version/hash, image digest, command, parameters, and seed. The
  reproducibility manifest carries this invocation provenance, persisted
  artifact metadata retains it, and the Evidence workspace renders the source,
  adapter, and frozen-input lineage beside its verified payload download.
- `DISCOVERY_CANDIDATE` now has a visible, distinct scientific-reviewer action
  in the workspace. It can move to `VERIFIED` only with the provenance,
  verification, and human-scientific-approval predicates. A live local proof
  completed the three-run, provenance-complete reference campaign, then
  recorded a `discovery.verified` event attributable to a
  `SCIENTIFIC_REVIEWER`; a model or the original researcher cannot take that
  transition.
- The workspace exposes pause, durable resume, cancel, and archive controls at
  the campaign boundary. Archiving is only offered for terminal or explicitly
  archivable states and records an attributable transition; it retains the
  campaign's evidence rather than deleting it.
- Projects now receive immutable persisted memberships for their creator
  (`OWNER`) and the local scientific-reviewer fixture. Project-scoped mutation
  and read endpoints—including campaigns, evidence, approval requests, event
  history, and artifact download—require the appropriate membership. The API
  test proves an unrelated researcher cannot fetch a known project, receives
  an empty project list, cannot mutate the project, and can gain project access
  only through an owner-attributable, idempotent membership grant. The workspace
  exposes the membership ledger and grant control. The current loopback UI
  still supplies development actor headers, so this is authorization-policy
  coverage rather than a claim of authenticated identity.

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

- a frozen-domain scientific benchmark beyond the narrow deterministic
  reference workflow;
- real Ollama, vLLM, and Hugging Face model parity with provider-loss recovery;
- arbitrary submitted-code isolation under adversarial sandbox testing;
- authenticated organization identity and session-to-project-membership
  binding, secrets integration, and multi-tenant cross-project isolation in a
  deployed environment;
- p95 control-plane performance and sustained load budgets;
- external/object-store operations, arbitrary-dataset execution, data
  retention, backup, restore, upgrade, rollback, and forward-repair drills;
- real cloud-provider resources and privileged operator-reviewed applies;
- physical laboratory, publication, and other explicitly Red integrations.

Until those proofs exist, missing evidence remains `NOT_TESTED`; it must never
be presented as a passing platform or scientific result.
