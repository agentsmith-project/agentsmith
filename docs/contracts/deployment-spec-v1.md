# Deployment Spec v1

## Summary
This document is the single source of truth for AgentSmith deployment topology, environment variables, offline bundle contents, bootstrap stages, and deployment verification.

Every deployment-facing script, env template, bundle manifest, and runbook must follow this document. If code, scripts, or env examples disagree with this spec, the implementation must be corrected. Deployments must not rely on manual fixes, container patching, ad hoc SQL, or Keycloak admin console changes.

This specification defines the required deployment contract. The higher-level guidance for address truth, config ownership, release gates, and testing responsibilities is documented in:

- `docs/contracts/address-truth-and-release-governance-v1.md`

That governance document does not override this spec. It explains how development, precheck, packaging, deployment, and verify must work together so this spec remains true in practice.

## Deployment Model

### Topology
- Host services run with Docker Compose.
- Internal agent workloads run in a local `kind` Kubernetes cluster.
- JuiceFS CSI is the only internal workspace persistence model.

### Compose Services
- `postgres`
- `mongo`
- `redis`
- `minio`
- `keycloak`
- `api`
- `web`
- `external-runner`

### kind Services
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

### Agent Execution Addresses
- These addresses are runtime-derived, not operator-provided.
- External runner execution uses a runner-visible host alias derived by the deployment environment.
- Internal agent execution uses stable Kubernetes service names for external dependencies.
- The deployment/bootstrap layer is responsible for binding those service names to the actual external PostgreSQL and MinIO targets.
- The HTTP and WS variants must stay aligned to the same resolved host identity for the current deployment.
- The deployment flow must fail fast if runtime execution hosts cannot be resolved.

### Agent Workspace Mount Options
- `MBOS_AGENT_JUICEFS_MOUNT_OPTIONS`

This value controls user-space JuiceFS mount options for external runner file-library workspaces. The default deployed value should be empty so mounts prefer consistency-oriented behavior. Performance-oriented options such as `writeback_cache` must only be enabled explicitly and documented for the target environment.

### Internal Sandbox Address
- `SANDBOX_HOST_PORT`

The operator provides the exposed host port only. The runtime sandbox manager URL is derived by the deployment environment and must not be edited directly.

## Shared Persistent Truth

### Workspace Registry
- System workspace configuration must be stored in shared Mongo-backed persistence.
- `web` and `api` must read the same workspace registry data.
- In deployment mode, system workspace persistence must fail fast if shared Mongo configuration is missing.
- Silent in-memory fallback is only allowed in explicit test mode.

### Workspace Availability Contract
A workspace may be marked `ready` only when:
- the system management record exists
- the backend workspace registration exists
- workspace-scoped collections are materialized
- project/files/notebook APIs can resolve the workspace

Publishing a workspace must complete the full backend initialization path before writing `ready`.

## Required Environment Variables

Deployment configuration has a single editable source:
- `env/site.env`

Service-specific env files are generated from `site.env` by the formal render step. Operators must not edit generated service env files directly.

Preset workspace admin and project creator identities are selected by stable username/email and resolved to the current Keycloak `sub` during bootstrap. Deployment inputs must not contain fixed user UUIDs.

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
- `HOST_LOCAL_POSTGRES_HOST`
- `HOST_LOCAL_POSTGRES_PORT`
- `HOST_LOCAL_MINIO_ENDPOINT`
- `CLIENT_PUBLIC_POSTGRES_HOST`
- `CLIENT_PUBLIC_POSTGRES_PORT`
- `CLIENT_PUBLIC_MINIO_ENDPOINT`
- `SANDBOX_SERVICE_KEY`
- `SANDBOX_HOST_PORT`
- `MBOS_AGENT_BUILTIN_SKILLS_DIR`
- `MBOS_AGENT_JUICEFS_MOUNT_OPTIONS`

### Internal JuiceFS CSI
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
- `MBOS_DEMO_PROJECT_NAME`
- `MBOS_DEMO_CREDENTIAL_NAME`
- `MBOS_DEMO_ANTHROPIC_ENDPOINT_NAME`
- `MBOS_DEMO_OPENAI_ENDPOINT_NAME`
- `MBOS_DEMO_EXTERNAL_AGENT_NAME`
- `MBOS_DEMO_INTERNAL_AGENT_NAME`
- `DEPLOY_ENDPOINT_API_KEY`
- `DEPLOY_ANTHROPIC_BASE_URL`
- `DEPLOY_OPENAI_BASE_URL`
- `DEPLOY_ENDPOINT_MODEL`

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
- checksums
- this deployment spec
- the machine-readable deployment manifest

The bundle build must always create a fresh directory for the current `release_id`. It must not reuse an existing bundle directory, and it must not carry forward historical image tar files from earlier local experiments.

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
- external runner image
- deployment verify runner image
- sandbox manager image
- kind node image
- JuiceFS CSI images
- CSI sidecar images

The bundle build must fail if any required file, tool, image, or manifest reference is missing.

### Verify Execution Contract
- Deployment verification must run from a bundled verify image, not from ad hoc host source trees.
- The verify image must include the Playwright integration configuration and all files needed for the release user story.
- The verify image must be able to:
  - reach the deployed Web/API/Keycloak endpoints over host networking
  - use the host Docker daemon to start the external runner test container
  - use `juicefs` locally to observe mounted file library contents
- Deployment verification must not assume the target host already has repo source code, Node dependencies, or Playwright installed.

### Local Precheck Contract
- Before building release images or an offline bundle, developers must run `npm run test:release:precheck`.
- Before building release images or an offline bundle, developers must also run `npm run test:bundle:inputs`.
- Before building release images or an offline bundle, developers must also run `npm run test:rendered-env`.
- Before building release images or an offline bundle, developers must also run `npm run test:client-public-runtime`.
- Developers running an external runner directly from source must use `npm run agent:external:dev` with the same `site.env` schema instead of ad hoc env exports.
- The local precheck must use locally started Web/API services and real Keycloak dependencies instead of a release bundle.
- The local precheck must fail fast if:
  - the system administrator login flow cannot reach `/system/workspaces`
  - the public workspace list, workspace detail, and workspace login page disagree about the workspace identity provider truth
  - a public Keycloak token cannot access `/api/v1/me/profile`
  - `Default Workspace -> Projects` shows a denied state before membership data has finished loading
  - a newly published workspace cannot be opened by its admin and queried through `/api/v1/workspaces/{id}/projects`
  - workspace settings cannot resolve project creator directory search results from the published workspace identity provider
  - the system-to-notebook default story fails in the local real lane
- The local precheck is the earliest required browser-level gate for release work. The bundled `verify` stage is the final confirmation gate, not the first place these failures should appear.
- `scripts/remote-deploy/build-offline-bundle.sh` must run the bundle input check, the rendered-env check, the client-public-runtime check, and the local precheck before the first Docker image build unless an operator explicitly opts out with `SKIP_BUNDLE_INPUTS_CHECK=1` or `SKIP_RELEASE_PRECHECK=1`.

## Bootstrap Contract

Bootstrap must be idempotent and must initialize the environment in this order:

1. Postgres schema
2. Keycloak realm, clients, and demo users
3. default workspace
4. demo project
5. demo credentials and endpoints
6. external and internal agents
7. preset external runner runtime credentials

Bootstrap is complete only when:
- `ws_default` exists and is `ready`
- `Demo Project` exists
- both demo endpoints exist
- both demo agents exist
- preset external agent key and websocket URL have been generated into `env/runner-runtime.env`
- the compose `external-runner` service has connected successfully

## Runner Runtime Contract

Agent mode and runner runtime are separate truths.

- `external` agents may run as:
  - `dev_direct`
  - `docker_manual`
  - `compose_managed`
- `internal` agents run as:
  - `k8s_internal`

The deployment seed must create the preset external agent with `runner_runtime=compose_managed`.

Except for `dev_direct`, every runner mode must use the same runner image. Different behavior must come from runtime env and runtime access contracts, not from image forks.

Task workspace access and connection info must branch on `runner_runtime`, not on host-specific address guesses.

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
- both seeded agents exist
- the seeded workspace/project path is accessible without `workspace_not_found`

#### New Workspace Story
- system admin creates and publishes a new workspace
- workspace admin logs in
- the new workspace projects page opens
- a project can be created without `workspace_not_found`
- external and internal notebook tasks run
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
- remote deployment runbook
- troubleshooting guide
- generated service env files
- offline bundle README

Current operator runbook:
- `docs/user-guides/remote-deploy-operations.md`

Current history cleanup helper:
- `scripts/remote-deploy/prune-history.sh`

If there is disagreement, this spec wins.
Related protocol data-plane contract:
- `docs/contracts/universal-proxy-integration-v1.md`
