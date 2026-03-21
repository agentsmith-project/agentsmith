# Deployment Spec v1

## Summary
This document is the single source of truth for AgentSmith deployment topology, environment variables, offline bundle contents, bootstrap stages, and deployment verification.

Every deployment-facing script, env template, bundle manifest, and runbook must follow this document. If code, scripts, or env examples disagree with this spec, the implementation must be corrected. Deployments must not rely on manual fixes, container patching, ad hoc SQL, or Keycloak admin console changes.

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
- `INTERNAL_API_BASE_URL`
- `INTERNAL_KEYCLOAK_BASE_URL`

These values are used by containers talking to each other inside Compose.

### File Library Public Access Addresses
- `FILE_LIBRARY_POSTGRES_PUBLIC_HOST`
- `FILE_LIBRARY_POSTGRES_PUBLIC_PORT`
- `FILE_LIBRARY_MINIO_PUBLIC_ENDPOINT`

These values are used when generating file library metadata URLs and local mount access details for operators and end users.

They are intentionally separate from container-internal object storage/database addresses.

The API container must use the container-internal MinIO admin address:
- `MINIO_ENDPOINT=minio`
- `MINIO_PORT=9000`
- `MINIO_USE_SSL=false`

The deployment flow must not reuse public MinIO ports such as `19000` for container-internal admin traffic.

### Agent Execution Addresses
- `EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL`
- `AGENT_EXECUTION_HTTP_BASE_URL`
- `AGENT_EXECUTION_WS_BASE_URL`

These values are used by external and internal execution paths. They must be explicit in deployment env and must not fall back to `localhost` in deployed environments.

During `deploy`, the generated runtime env must rewrite all three execution addresses to the current Docker host gateway used by the active local Compose network. The HTTP and WS variants must stay aligned to the same gateway identity for the current deployment.

### Agent Workspace Mount Options
- `MBOS_AGENT_JUICEFS_MOUNT_OPTIONS`

This value controls user-space JuiceFS mount options for external runner file-library workspaces. The default deployed value should be empty so mounts prefer consistency-oriented behavior. Performance-oriented options such as `writeback_cache` must only be enabled explicitly and documented for the target environment.

### Internal Sandbox Address
- `SANDBOX_MANAGER_URL`

This is the API-to-sandbox control-plane address. It must point to the sandbox manager exposed from the local kind cluster.

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
- `EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL`
- `AGENT_EXECUTION_HTTP_BASE_URL`
- `AGENT_EXECUTION_WS_BASE_URL`
- `SANDBOX_MANAGER_URL`
- `SANDBOX_SERVICE_KEY`
- `SANDBOX_HOST_PORT`
- `MBOS_AGENT_BUILTIN_SKILLS_DIR`
- `MBOS_AGENT_JUICEFS_MOUNT_OPTIONS`
- `FILE_LIBRARY_POSTGRES_PUBLIC_HOST`
- `FILE_LIBRARY_POSTGRES_PUBLIC_PORT`
- `FILE_LIBRARY_MINIO_PUBLIC_ENDPOINT`

### Internal JuiceFS CSI
- `INTERNAL_AGENT_K8S_NAMESPACE`
- `INTERNAL_AGENT_JUICEFS_CSI_DRIVER`
- `INTERNAL_AGENT_WORKSPACE_CAPACITY`
- `INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME`
- `INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS`
- `INTERNAL_AGENT_JUICEFS_SUBDIR`
- `INTERNAL_AGENT_JUICEFS_MOUNT_SERVICE_ACCOUNT`
- `INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE`
- `INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE`
- `INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE`

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
- `MBOS_DEFAULT_WORKSPACE_ADMIN_USER_ID`
- `MBOS_DEMO_PROJECT_NAME`
- `MBOS_DEMO_CREDENTIAL_NAME`
- `MBOS_DEMO_ANTHROPIC_ENDPOINT_NAME`
- `MBOS_DEMO_OPENAI_ENDPOINT_NAME`
- `MBOS_DEMO_EXTERNAL_AGENT_NAME`
- `MBOS_DEMO_INTERNAL_AGENT_NAME`
- `GLM_APIKEY`
- `CLAUDE_URL`
- `OPENAI_URL_CODING_PLAN`
- `GLM_MODEL`

All deployment configuration keys must be declared in `env/site.env`. Generated service env files derive container-specific values such as `DATABASE_URL`, `MONGO_URL`, `KEYCLOAK_ISSUER_URL`, `MBOS_API_BASE`, `NEXT_PUBLIC_API_BASE`, and `NEXT_PUBLIC_KEYCLOAK_URL`. Deployment-specific defaults belong in `site.env`, not hidden in scripts.

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
- `jq`
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

If there is disagreement, this spec wins.
