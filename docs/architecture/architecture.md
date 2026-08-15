# AlphaLab architecture

## Planes

1. **Control:** Next.js workspace, NestJS API, policy, budgets, approvals, and
   durable workflow coordination.
2. **Execution:** model gateway, isolated Python model runtime, trusted
   experiment broker, and untrusted experiment sandboxes.
3. **Evidence:** PostgreSQL metadata, content-addressed object storage,
   append-only scientific records, lineage, and reproducibility bundles.
4. **Assurance:** process supervision, deterministic verification, independent
   scientific review, audit, metrics, logs, and traces.

## Trust boundaries

- Browser traffic terminates at the web/API boundary and is authenticated and
  project-authorized.
- Model inference and experiment execution occur outside the API process.
- The trusted experiment broker can request sandbox creation; experiment
  containers never receive the container-runtime socket.
- External model, MCP, data, and network providers are separately permitted and
  recorded.
- Evidence and approval records are append-only. Corrections create new records.

## Durable action rule

Every external action follows:

1. validate the versioned command;
2. authorize it against the project policy;
3. reserve parent budget atomically;
4. write an idempotency record and outbox event;
5. execute through the isolated adapter;
6. store a side-effect receipt and provenance;
7. reconcile usage;
8. emit a typed success or failure event.

Recovery never relies on model transcript replay and never repeats a side
effect without first reconciling the durable receipt.
