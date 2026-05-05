# Demo Deployment Spec v1

## Summary
This document is the single source of truth for the `demo-deploy` line: deployment topology, environment variables, offline bundle contents, bootstrap stages, and deployment verification.

Every deployment-facing script, env template, bundle manifest, and runbook must follow this document. If code, scripts, or env examples disagree with this spec, the implementation must be corrected. Deployments must not rely on manual fixes, container patching, ad hoc SQL, or Keycloak admin console changes.

This specification defines the required contract for the demo deployment line only. The real-cluster line has a separate contract:

- `docs/contracts/cluster-deployment-spec-v1.md`

The higher-level guidance for address truth, config ownership, release gates, and testing responsibilities is documented in:

- `docs/contracts/address-truth-and-release-governance-v1.md`

That governance document does not override this spec. It explains how development, precheck, packaging, deployment, and verify must work together so this spec remains true in practice.

## Deployment Model

### Purpose
- `demo-deploy` is the demo / single-host release line.
- It keeps application services on Docker Compose.
- It supports two operator-selected deployment modes:
  - `full`
  - `simple`
- It is not the real-cluster release path.

### Deployment Modes
- `DEMO_DEPLOY_MODE=full`
  - Docker Compose substrate and app
  - local `kind`
  - JuiceFS CSI
  - `sandbox-manager`
  - managed Agent task runner configuration
  - sandbox workload execution for Agent tasks
- `DEMO_DEPLOY_MODE=simple`
  - Docker Compose substrate and app
  - `universal-proxy`
  - managed Agent task runner configuration
  - no `kind`, JuiceFS CSI, or `sandbox-manager`

### Topology
- Host services run with Docker Compose.
- Sandbox workloads run in a local `kind` Kubernetes cluster only in `full`.
- JuiceFS CSI is the only sandbox workspace persistence model in `full`.

### Compose Services
- `postgres`
- `mongo`
- `redis`
- `minio`
- `keycloak`
- `api`
- `web`

### kind Services (`full` only)
- `juicefs-csi-controller`
- `juicefs-csi-node`
- `sandbox-manager`
- internal workload pods
- workspace binding PV/PVC resources

### Release Lifecycle
- `prepare`
- `reset`
- `deploy`
- `bootstrap`
- `verify`
- `report`

These six stages are the only supported deployment flow.

- `simple` deploys, bootstraps, verifies, and reports the Compose app plus managed Agent Runner seed.
- `full` deploys, bootstraps, verifies, and reports the Compose app plus sandbox-backed Agent task execution surface.

## Offline Bundle Manifest Contract

The demo deployment bundle manifest has two distinct inclusion contracts:

- `bundle_files`
  - explicit static bundle assets that operators and runtime stages consume directly
- `bundle_source_sets`
  - helper-owned dynamic families that must be copied into the bundle and mounted for verify without enumerating each member in the manifest

The backend-real story verify family must be declared through:

- `bundle_source_sets[].name = backend_real_story_verify_source_set`
- `bundle_source_sets[].helper = scripts/lib/release-story-verify-source-set.sh`

Story markdown files under `e2e/stories/backend-real/` must enter the bundle through that source set, not by being hard-coded one by one in `bundle_files`.

## Address Model

### Public Addresses
- `PUBLIC_WEB_BASE_URL`
- `PUBLIC_API_BASE_URL`
- `PUBLIC_KEYCLOAK_BASE_URL`

These values are used for browser navigation, login redirects, and public callbacks.

### Container-Internal Addresses
- `COMPOSE_INTERNAL_API_BASE_URL`
- `COMPOSE_INTERNAL_KEYCLOAK_BASE_URL`

These values are used by containers talking to each other inside Compose.

### Host-Local Access Addresses
- `HOST_LOCAL_POSTGRES_HOST`
- `HOST_LOCAL_POSTGRES_PORT`
- `HOST_LOCAL_MINIO_ENDPOINT`

These values are only for host-machine verification and local maintenance on the deployed server.

They are intentionally separate from client-visible file library mount addresses, container-internal object storage/database addresses, and runner/k8s execution addresses.

### Client Mount Addresses
- `CLIENT_PUBLIC_POSTGRES_HOST`
- `CLIENT_PUBLIC_POSTGRES_PORT`
- `CLIENT_PUBLIC_MINIO_ENDPOINT`

These values are used when generating JuiceFS mount instructions for people using their own machines.

The API container must use the container-internal MinIO admin address:
- `MINIO_ENDPOINT=minio`
- `MINIO_PORT=9000`
- `MINIO_USE_SSL=false`

The deployment flow must not reuse public MinIO ports such as `19000` for container-internal admin traffic.

### Agent Task Execution Addresses
- These addresses are runtime-derived, not operator-provided.
- Managed Agent task execution uses runner-visible host aliases derived by the deployment environment.
- Sandbox execution uses stable Kubernetes service names for data dependencies.
- The deployment/bootstrap layer is responsible for binding those service names to the actual PostgreSQL and MinIO targets.
- The HTTP and WS variants must stay aligned to the same resolved host identity for the current deployment.
- The deployment flow must fail fast if runtime execution hosts cannot be resolved.

### Agent Workspace Mount Options
- `MBOS_AGENT_JUICEFS_MOUNT_OPTIONS`

This value controls user-space JuiceFS mount options for Agent task runner file-library workspaces. The default deployed value should be empty so mounts prefer consistency-oriented behavior. Performance-oriented options such as `writeback_cache` must only be enabled explicitly and documented for the target environment.

### Runtime Proxy Model
- `RUNTIME_PROXY_MODE`
- `RUNTIME_HTTP_PROXY`
- `RUNTIME_HTTPS_PROXY`
- `RUNTIME_ALL_PROXY`
- `RUNTIME_ADDITIONAL_NO_PROXY`

Runtime proxy configuration is formal operator input, not an implicit hard-coded sanitization rule.

- `RUNTIME_PROXY_MODE=sanitized`
  - generated runtime env must clear `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and their lowercase variants
- `RUNTIME_PROXY_MODE=inherit`
  - generated runtime env must inherit the current shell proxy values at render/bootstrap time and normalize them into both uppercase and lowercase variants
- `RUNTIME_PROXY_MODE=custom`
  - generated runtime env must use `RUNTIME_HTTP_PROXY`, `RUNTIME_HTTPS_PROXY`, and `RUNTIME_ALL_PROXY`

`NO_PROXY` / `no_proxy` must keep the merged deployment strategy:
- built-in runtime bypass hosts are always included
- operator-supplied `RUNTIME_ADDITIONAL_NO_PROXY` entries are appended
- existing shell `NO_PROXY` / `no_proxy` input is inherited only as part of the current `inherit` runtime proxy mode

The same runtime proxy truth must drive:
- rendered `base.env` / `internal.env`
- docker runtime `-e` arguments for verify containers and any managed runner launch checks
- managed runner image/runtime launch decisions during bootstrap

Runtime proxy fingerprints must fail closed when proxy values differ, even if `NO_PROXY` still matches.

### Internal Sandbox Address
- `SANDBOX_HOST_PORT`

The operator provides the exposed host port only. The runtime sandbox manager URL is derived by the deployment environment and must not be edited directly.

### kind DNS Overrides
- `KIND_CLUSTER_DNS_UPSTREAMS`
- `KIND_CLUSTER_DNS_UPSTREAMS_FILE`

These inputs are optional operator overrides for `scripts/cluster-deploy/apply-kind-dns.sh` when the local `kind` cluster needs explicit CoreDNS upstream resolvers.

- `KIND_CLUSTER_DNS_UPSTREAMS`
  - inline resolver list, accepting whitespace/comma/newline-separated values
- `KIND_CLUSTER_DNS_UPSTREAMS_FILE`
  - path to a resolver file consumed by the same DNS apply flow

When both are empty, the DNS apply flow falls back to host resolver discovery and repo defaults.

## Shared Persistent Truth

### System Workspace Configuration
- System workspace configuration must be stored in shared Mongo-backed persistence.
- `web` and `api` must read the same workspace configuration records.
- In deployment mode, system workspace persistence must fail fast if shared Mongo configuration is missing.
- Silent in-memory fallback is only allowed in explicit test mode.

### Workspace Availability Contract
A workspace may be marked `ready` only when:
- the system management record exists
- the backend workspace registration exists
- workspace-scoped collections are materialized
- project/files/Agent task APIs can resolve the workspace

Publishing a workspace must complete the full backend initialization path before writing `ready`.

## Required Environment Variables

Deployment configuration has a single editable source:
- `env/site.env`

Service-specific env files are generated from `site.env` by the formal render step. Operators must not edit generated service env files directly.

Preset workspace admin and project creator identities are selected by stable username/email and resolved to the current Keycloak `sub` during bootstrap. Deployment inputs must not contain fixed user UUIDs.

### Mode Selector
- `DEMO_DEPLOY_MODE`

### Storage and Ports
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `POSTGRES_PORT`
- `MONGO_ROOT_USERNAME`
- `MONGO_ROOT_PASSWORD`
- `MONGO_DB`
- `MONGO_PORT`
- `REDIS_PORT`
- `MINIO_ROOT_USER`
- `MINIO_ROOT_PASSWORD`
- `MINIO_BUCKET`
- `MINIO_API_PORT`
- `MINIO_CONSOLE_PORT`

### Identity and Access
- `KEYCLOAK_ADMIN`
- `KEYCLOAK_ADMIN_PASSWORD`
- `KEYCLOAK_DB`
- `KEYCLOAK_PORT`
- `KEYCLOAK_REALM`
- `KEYCLOAK_CLIENT_ID`
- `SYSTEM_ADMIN_USERNAME`
- `SYSTEM_ADMIN_PASSWORD`
- `SYSTEM_ADMIN_SESSION_COOKIE_SECURE`

### Public Runtime Addresses
- `PUBLIC_WEB_BASE_URL`
- `PUBLIC_API_BASE_URL`
- `PUBLIC_KEYCLOAK_BASE_URL`

### Execution and Shared Runtime
- `SYSTEM_WORKSPACE_REGISTRY_MODE`
- `COMPOSE_INTERNAL_API_BASE_URL`
- `COMPOSE_INTERNAL_KEYCLOAK_BASE_URL`
- `RUNTIME_PROXY_MODE`
- `RUNTIME_ADDITIONAL_NO_PROXY`
- `HOST_LOCAL_POSTGRES_HOST`
- `HOST_LOCAL_POSTGRES_PORT`
- `HOST_LOCAL_MINIO_ENDPOINT`
- `CLIENT_PUBLIC_POSTGRES_HOST`
- `CLIENT_PUBLIC_POSTGRES_PORT`
- `CLIENT_PUBLIC_MINIO_ENDPOINT`
- `SANDBOX_SERVICE_KEY`
- `SANDBOX_HOST_PORT`
- `KIND_CLUSTER_DNS_UPSTREAMS`
- `KIND_CLUSTER_DNS_UPSTREAMS_FILE`
- `MBOS_AGENT_BUILTIN_SKILLS_DIR`
- `MBOS_AGENT_JUICEFS_MOUNT_OPTIONS`

### Runtime Proxy (`custom` only for explicit upstream values)
- `RUNTIME_HTTP_PROXY`
- `RUNTIME_HTTPS_PROXY`
- `RUNTIME_ALL_PROXY`

### Internal JuiceFS CSI (`full` only)
- `INTERNAL_AGENT_K8S_NAMESPACE`
- `INTERNAL_AGENT_JUICEFS_CSI_DRIVER`
- `INTERNAL_AGENT_WORKSPACE_CAPACITY`
- `INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME`
- `INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS`
- `INTERNAL_AGENT_JUICEFS_SUBDIR`
- `INTERNAL_AGENT_JUICEFS_MOUNT_SERVICE_ACCOUNT`
- `INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE`

### Bootstrap and Demo Seed
- `INTEGRATION_PUBLIC_WEB_BASES`
- `INTEGRATION_DEV_ADMIN_USERNAME`
- `INTEGRATION_DEV_ADMIN_PASSWORD`
- `INTEGRATION_USER_USERNAME`
- `INTEGRATION_USER_PASSWORD`
- `INTEGRATION_MEMBER_USERNAME`
- `INTEGRATION_MEMBER_PASSWORD`
- `MBOS_DEFAULT_WORKSPACE_ID`
- `MBOS_DEFAULT_WORKSPACE_NAME`
- `MBOS_DEFAULT_WORKSPACE_ADMIN_EMAIL`
- `PRESET_PROJECT_NAME`
- `PRESET_CREDENTIAL_NAME`
- `PRESET_ANTHROPIC_ENDPOINT_NAME`
- `PRESET_OPENAI_ENDPOINT_NAME`
- `PRESET_AGENT_RUNNER_NAME`
- `PRESET_ENDPOINT_API_KEY`
- `PRESET_ENDPOINT_MODEL`
- `PRESET_ENDPOINT_MAX_CONTEXT_TOKENS`
- `PRESET_ENDPOINT_MAX_OUTPUT_TOKENS`
- `PRESET_ENDPOINT_TIMEOUT_SECONDS`
- `PRESET_ANTHROPIC_ENDPOINT_BASE_URL`
- `PRESET_ANTHROPIC_ENDPOINT_PROTOCOL`
- `PRESET_OPENAI_ENDPOINT_BASE_URL`
- `PRESET_OPENAI_ENDPOINT_PROTOCOL`

All deployment configuration keys must be declared in `env/site.env`. Generated service env files derive container-specific and runtime-specific values such as `DATABASE_URL`, `MONGO_URL`, `KEYCLOAK_ISSUER_URL`, `MBOS_API_BASE`, `NEXT_PUBLIC_API_BASE`, execution host URLs, and JuiceFS internal overrides. Deployment-specific defaults belong in `site.env`; runtime-derived host identities belong in the formal runtime address resolution step, not hidden in deploy-time sed rewrites.

Browser-facing public configuration is runtime truth. The web application must read browser `api_base`, Keycloak public coordinates, and browser-only feature flags from the runtime-injected public config contract, not from build-time-baked `NEXT_PUBLIC_*` values. A release bundle is only valid when the same built web image can run against local and remote `site.env` values without rebuilding.

## Offline Bundle Contract

The offline bundle must contain:
- Compose manifests
- kind config
- JuiceFS CSI manifests
- sandbox manifests
- env examples
- the single editable `env/site.env.example`
- deployment scripts
- operator runbook
- bundle README
- checksums
- this deployment spec
- the machine-readable deployment manifest

The bundle build must always create a fresh directory for the current `release_id`. It must not reuse an existing bundle directory, and it must not carry forward historical image tar files from earlier local experiments.

The bundle is always complete. Operators choose `simple` or `full` at deploy time through `env/site.env`. `simple` mode may leave bundled `kind` and CSI assets unused.

### Layered Image Contract
- Stable and heavy dependencies must be built into reusable base images.
- Frequently changing business code must be built into thin derived images.
- The offline bundle must include both:
  - reusable base images
  - release-specific derived images
- Base image tags must be content-addressed from their stable inputs so unchanged layers can be reused across local rebuilds and remote uploads.

### Required Tools in Bundle
- `kind`
- `kubectl`
- `juicefs`
- `mc`

### Required Images in Bundle
- Compose dependency images
- AgentSmith app image
- Agent task runner image
- deployment verify runner image
- sandbox manager image
- kind node image
- JuiceFS CSI images
- CSI sidecar images

The bundle build must fail if any required file, tool, image, or manifest reference is missing.

### Verify Execution Contract
- Deployment verification must run from a bundled verify image, not from ad hoc host source trees.
- The verify image must include the Playwright integration configuration and all files needed for the release user story.
- Deployment verification must include an explicit Files correctness check in addition to the Chat/Agent task release stories.
- That Files check must validate:
  - temporary file library create/delete
  - folder create
  - upload
  - list
  - download
  - share-link
  - move
  - cleanup
  - client-visible mount address truth
- The verify image must be able to:
  - reach the deployed Web/API/Keycloak endpoints over host networking
  - use the host Docker daemon for bundled verify helpers when a scenario requires a containerized check
  - use `juicefs` locally to observe mounted file library contents
- Deployment verification must not assume the target host already has repo source code, Node dependencies, or Playwright installed.

### Local Precheck Contract
- These commands are pre-build producer checks for release bundle correctness, not the human release sign-off entrypoint.
- Human release readiness still starts from `npm run release:ready` and is inspected with `npm run release:status`.
- Before building release images or an offline bundle, developers must run `npm run test:release:precheck`.
- Before building release images or an offline bundle, developers must also run `npm run test:demo-bundle:inputs`.
- Before building release images or an offline bundle, developers must also run `npm run test:demo-rendered-env`.
- Before building release images or an offline bundle, developers must also run `npm run test:client-public-runtime`.
- Developers running a local Agent task runner directly from source must use `npm run agent:task-runner` with the same rendered runtime env schema instead of ad hoc env exports.
- The local precheck must use locally started Web/API services and real Keycloak dependencies instead of a release bundle.
- The local precheck must fail fast if:
  - the system administrator login flow cannot reach `/system/workspaces`
  - the public workspace list, workspace detail, and workspace login page disagree about the workspace identity provider truth
  - a public Keycloak token cannot access `/api/v1/me/profile`
  - `Default Workspace -> Projects` shows a denied state before membership data has finished loading
  - a newly published workspace cannot be opened by its admin and queried through `/api/v1/workspaces/{id}/projects`
  - workspace settings cannot resolve project creator directory search results from the published workspace identity provider
  - the system-to-Agent-task default story fails in the local backend-real run
- The local precheck is the earliest required browser-level gate for release work. The bundled `verify` stage is the final confirmation gate, not the first place these failures should appear.
- `scripts/demo-deploy/build-offline-bundle.sh` must run the bundle input check, the rendered-env check, and the client-public-runtime check before the first Docker image build unless an operator explicitly opts out with `SKIP_BUNDLE_INPUTS_CHECK=1`.
- `scripts/demo-deploy/build-offline-bundle.sh` may additionally run `npm run test:release:precheck` only when the operator explicitly enables `RUN_RELEASE_PRECHECK=1`.

## Bootstrap Contract

Bootstrap must be idempotent and must initialize the environment in this order:

1. Postgres schema
2. Keycloak realm, clients, and demo users
3. default workspace
4. demo project
5. demo credentials and endpoints
6. managed Agent Runner default configuration
7. Agent task runner image/runtime metadata

Bootstrap is complete only when:
- `ws_default` exists and is `ready`
- `Demo Project` exists
- both demo endpoints exist
- the preset Agent Runner exists, is ready, and is the project default
- the preset Agent Runner points at the seeded default endpoint
- Agent task runner image metadata has been recorded for diagnostics

## Runner Runtime Contract

Agent task execution has one deployment target: managed Agent Runner resolution.

- Deployments seed one ready default Agent Runner through `PRESET_AGENT_RUNNER_NAME`.
- Chat never dispatches through Agent Runners.
- The deploy line must not expose runner mode selection, manual docker runner setup, or compose runner services.
- Developer mode is a local-only runner entrypoint and is not a deployment runtime.

Task workspace access and connection info are derived from the managed Agent Runner plus runtime address truth, not from host-specific address guesses.

## Verify Contract

Verification must run in two layers.

### Layer 1: Infrastructure Readiness
- Compose services healthy
- kind cluster healthy
- JuiceFS CSI ready
- sandbox manager ready
- API ready
- Web ready
- Keycloak ready

### Layer 2: Product Usability Gates

#### Preset Seed Story
- a real public Keycloak token can access `/api/v1/me/profile`
- `Default Workspace -> Projects` opens without a transient denied state while membership data is still loading
- `dev-admin` can log in
- `ws_default` is visible
- `Demo Project` is visible
- both seeded endpoints exist
- the seeded Agent Runner exists and is default
- the seeded workspace/project path is accessible without `workspace_not_found`

#### New Workspace Story
- system admin creates and publishes a new workspace
- workspace admin logs in
- the new workspace projects page opens
- a project can be created without `workspace_not_found`
- Agent tasks run and record managed runner selection
- files and `.artifacts` are visible
- usage reflects both endpoints

Deployment is not complete unless both stories pass.

## Failure Policy
- No deployment step may require manual DB edits.
- No deployment step may require manual Keycloak console edits.
- No deployment step may require patching built `.next` files or container internals.
- No deployment step may rely on undocumented shell commands.

If a failure needs a new command, env value, or step, that change must be added to:
- this spec
- the machine manifest
- the formal deployment scripts

## Derived Documents

The following documents are derived from this spec and must not redefine deployment behavior:
- demo deployment runbook
- troubleshooting guide
- generated service env files
- offline bundle README

Current operator runbook:
- `docs/user-guides/demo-deploy-operations.md`

Current history cleanup helper:
- `scripts/demo-deploy/prune-history.sh`

If there is disagreement, this spec wins.
Related protocol data-plane contract:
- `docs/contracts/universal-proxy-integration-v1.md`
