# Deployment profiles

| Profile                  | Runtime                                           | Storage                                                    | Identity and secrets                              | GPU                | Principal limitation                               |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- | ------------------ | -------------------------------------------------- |
| Local CPU                | Loopback Node/Python processes                    | Local files; optional PostgreSQL/MinIO                     | Local researcher session; environment handles     | No                 | Single machine, developer durability               |
| Local GPU                | Local runtime plus selected device backend        | Same as local CPU                                          | Same as local CPU                                 | Runtime-specific   | Accelerator support is model/runtime specific      |
| Single-server on-premise | Rootless containers on an internal network        | PostgreSQL, S3-compatible object storage, encrypted backup | OIDC or local break-glass; mounted secret handles | Optional           | Host remains one failure domain                    |
| Air-gapped               | Preloaded, digest-pinned containers               | Local encrypted volumes and offline backup                 | Local identity; offline secret ceremony           | Optional           | Updates and vulnerability feeds are manual         |
| Generic Kubernetes       | Non-root workloads, deny-by-default NetworkPolicy | Managed or in-cluster PostgreSQL and object storage        | Workload identity and external secret manager     | Optional node pool | Cluster primitives vary by distribution            |
| AWS reference            | Kubernetes-compatible application contract        | RDS-compatible PostgreSQL and S3-compatible objects        | Workload identity and managed secret handles      | Optional           | Environment owners supply reviewed AWS resources   |
| Google Cloud reference   | Kubernetes-compatible application contract        | Managed PostgreSQL and object storage                      | Workload identity and managed secret handles      | Optional           | Environment owners supply reviewed GCP resources   |
| Azure reference          | Kubernetes-compatible application contract        | Managed PostgreSQL and object storage                      | Workload identity and managed secret handles      | Optional           | Environment owners supply reviewed Azure resources |

Terraform currently emits a validated, reviewable deployment contract for each
maintained infrastructure profile. It deliberately has no production apply
authority and does not invent organization-specific networks, identities,
domains, retention rules, or backup objectives. Environment owners compose the
contract into their governed infrastructure modules and keep apply credentials
outside ordinary CI.
