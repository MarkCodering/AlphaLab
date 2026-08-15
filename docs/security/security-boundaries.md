# Security boundaries

The control plane, model runtime, and experiment runner are separate trust
boundaries. Until executable security tests prove otherwise, experiment code,
model packages, datasets, archives, MCP responses, and retrieved documents are
untrusted.

## Mandatory defaults

- deny external network access;
- deny remote model code;
- deny privileged containers;
- deny host/container-runtime socket mounts;
- deny Red actions without exact human approval;
- deny fallback unless it is explicitly configured;
- deny cross-project reads regardless of identifier knowledge;
- deny candidate generation when evidence is missing or invalidated;
- store no raw credential in model context, workflow payload, log, or trace.

These are required controls, not yet claims of deployed enforcement.
