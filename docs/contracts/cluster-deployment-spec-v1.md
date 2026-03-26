# Cluster Deployment Spec v1

## Purpose

`cluster-deploy` is the real-environment release line for AgentSmith.

It exists alongside, not instead of, the current `remote-deploy` demo line:

- `remote-deploy`
  - demo / single-host installation
  - server-local image management
  - `kind` used to simulate the internal agent execution surface
- `cluster-deploy`
  - real-environment installation
  - application services and data services still run on Docker Compose
  - internal agent execution runs on a real Kubernetes cluster
  - images are published to an online image registry
  - installation is still performed from an offline bundle on the target host

## Delivery Model

`cluster-deploy` uses a two-stage release model.

### Stage 1. Build Machine / CI

Responsibilities:

- read gitignored operator config from `.infra/cluster-deploy/`
- build required images
- push images to the configured image registry
- generate an install bundle

The bundle contains:

- compose assets
- Kubernetes manifests and templates
- env examples
- deployment scripts
- docs and checks
- release metadata and checksums

The bundle does not contain:

- real kubeconfig
- real registry credentials
- site-specific secrets
- image tar archives

### Stage 2. Target Host

Responsibilities:

- extract bundle into `/home/percy/agentsmith/cluster-deploy`
- read shared operator config from `/home/percy/agentsmith/cluster-deploy/config`
- execute:
  - `prepare`
  - `deploy`
  - `bootstrap`
  - `verify`
  - `report`

This keeps the build machine independent from the production server and the real Kubernetes cluster.

## System Boundary

### Docker Compose

The target host keeps the application services and data services on Compose:

- `postgres`
- `mongo`
- `redis`
- `minio`
- `keycloak`
- `api`
- `web`
- `universal-proxy`
- `external-runner`

### Real Kubernetes Cluster

The cluster runs only the internal execution surface:

- `sandbox-manager`
- `juicefs-csi`
- internal sandbox runner / workload pods

This boundary is intentional. Data services are not moved into Kubernetes.

## Address Model

`cluster-deploy` must not infer the "correct host IP" from a multi-homed application server.

Instead, addresses are declared explicitly per consumer role.

### Public User Access

- `PUBLIC_WEB_BASE_URL`
- `PUBLIC_API_BASE_URL`
- `PUBLIC_KEYCLOAK_BASE_URL`

Used for browser entry, auth redirects, and public-facing guides.

### Client JuiceFS Mount Access

- `CLIENT_PUBLIC_POSTGRES_HOST`
- `CLIENT_PUBLIC_POSTGRES_PORT`
- `CLIENT_PUBLIC_MINIO_ENDPOINT`

Used for UI-visible file-library mount guidance.

### Cluster-to-Compose Dependency Access

- `K8S_EXTERNAL_POSTGRES_HOST`
- `K8S_EXTERNAL_POSTGRES_PORT`
- `K8S_EXTERNAL_MINIO_HOST`
- `K8S_EXTERNAL_MINIO_PORT`

These values must be reachable from Kubernetes pods.

They are rendered into:

- `postgres-external`
- `minio-external`

via `Service` plus `EndpointSlice`.

### Application-Server-to-Manager Access

- `SANDBOX_MANAGER_INGRESS_HOST`
- `SANDBOX_MANAGER_PUBLIC_BASE_URL`

The application server reaches `sandbox-manager` through the manager Ingress.

## Manager Exposure

`cluster-deploy` uses Ingress as the default way to expose `sandbox-manager`.

Required objects:

- `Deployment`
- `Service`
- `Ingress`

`NodePort` is not the default release path for the real cluster line.

## Scheduling and Resources

Cluster defaults are fixed for the current deployment target:

- node selector:
  - `node=mbos`
- toleration:
  - `mbos:NoExecute`

Default resources for `sandbox-manager` and sandbox runner workloads:

- requests:
  - `cpu=1`
  - `memory=2Gi`
- limits:
  - `cpu=2`
  - `memory=4Gi`

These values must be part of tracked templates and rendered env, not manual post-deploy edits.

## Registry Model

All first-party images for `cluster-deploy` are published to an online registry.

Required operator config:

- `REGISTRY_HOST`
- `REGISTRY_PROJECT`
- `REGISTRY_USERNAME`
- `REGISTRY_PASSWORD`

Compose and Kubernetes must use the same image tag set for a given release.

## Operator Config

Tracked templates:

- `infra/deploy/cluster/env/site.env.example`
- `infra/deploy/cluster/env/registry.env.example`
- `infra/deploy/cluster/env/kubeconfig.example.yaml`

Gitignored operator files:

- `.infra/cluster-deploy/site.env`
- `.infra/cluster-deploy/registry.env`
- `.infra/cluster-deploy/kubeconfig`

Target-host shared config:

- `/home/percy/agentsmith/cluster-deploy/config/site.env`
- `/home/percy/agentsmith/cluster-deploy/config/registry.env`
- `/home/percy/agentsmith/cluster-deploy/config/kubeconfig`

## Lifecycle Commands

The cluster line uses its own lifecycle:

- `npm run cluster:bundle`
- `npm run cluster:prepare`
- `npm run cluster:deploy`
- `npm run cluster:bootstrap`
- `npm run cluster:verify`
- `npm run cluster:report`

These commands do not replace the current `remote-deploy` line.

## Validation Requirements

The minimum release proof for `cluster-deploy` is:

1. bundle input checks pass
2. rendered env checks pass
3. `prepare -> deploy -> bootstrap -> verify -> report` passes on the target host
4. external notebook task succeeds
5. internal notebook task succeeds
6. file-library client mount truth is correct
7. internal agent reaches external PostgreSQL and MinIO through Kubernetes external services
