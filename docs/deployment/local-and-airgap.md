# Local and air-gapped deployment

The ordinary developer path is `pnpm dev`. It binds every process to loopback,
selects free coordinated ports, and does not require Docker.

The container profile requires explicit local credentials:

```bash
cp .env.example .env
docker compose --env-file .env -f docker/compose.local.yml up --build
```

The `alphalab-internal` network is marked internal. Application services drop
all Linux capabilities, enable `no-new-privileges`, use read-only root
filesystems, and receive no container-runtime socket. The experiment runner in
this profile exposes only approved built-in operations; arbitrary submitted
code must use the digest-bound sandbox executor in `@alphalab/experiment-sdk`.

For an offline host, preload the exact images and application artifacts, then
validate that no pull is possible:

```bash
docker compose --env-file .env \
  -f docker/compose.local.yml \
  -f docker/compose.airgap.yml \
  up --no-build
```

`pull_policy: never` prevents an implicit registry fallback. A complete air-gap
acceptance run must additionally capture DNS and network traffic and prove zero
external calls; the Compose declaration alone is not that evidence.
