# Cluster Deployment Spec v1

## Purpose

`cluster-deploy` is the real-environment release line for AgentSmith.

It exists alongside, not instead of, the current `demo-deploy` demo line:

- `demo-deploy`
  - demo / single-host installation
  - server-local image management
  - `kind` used to simulate the internal agent execution surface
- `cluster-deploy`
  - real-environment installation
  - application services and data services still run on Docker Compose
  - internal agent execution runs on a real Kubernetes cluster
  - installation is still performed from an offline bundle on the target host

## Delivery Model

`cluster-deploy` uses a two-stage release model.

### Stage 1. Build Machine / CI

Responsibilities:

- read gitignored local operator config only as bundle inputs
- build required first-party images on the build machine
- generate an install bundle that contains offline image archives

The build machine does not need direct access to the target server or the real cluster.

### Stage 2. Target Host

Responsibilities:

- extract bundle into `$HOME/agentsmith/cluster-deploy`
- read shared operator config from `$HOME/agentsmith/cluster-deploy/config`
- load bundled images into the target-host Docker daemon
- push bundled registry-tagged images to the configured registry
- run namespace-only release automation:
  - `prepare`
  - `deploy`
  - `bootstrap`
  - `verify`
  - `report`

The current transfer policy is:

1. build machine uploads the bundle to `pullot`
2. target host logs in and pulls the bundle from `pullot`

The build machine does not upload directly to the target host.

## Authority Boundary

`cluster-deploy` is a **namespace-only** application release line.

It may manage only:

- application-server local runtime
- namespaced Kubernetes resources in `mbos`

It must not:

- create or delete namespaces
- install JuiceFS CSI
- modify `kube-system`
- create cluster-wide RBAC
- create or delete cluster-scope storage objects
- perform cluster-scope discovery checks as part of deploy automation

All cluster-scope preparation belongs to the separate administrator runbook:

- [cluster-admin-runbook.md](/home/percy/works/mbos-v1/agentsmith/docs/user-guides/cluster-admin-runbook.md)

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
- internal sandbox runner / workload pods
- namespaced external dependency service abstractions

JuiceFS CSI and storage-class preparation are **preinstalled cluster capabilities**, not part of deploy automation.

## Kubernetes Permission Model

### Deploy kubeconfig

The deploy kubeconfig is namespace-scoped to `mbos` and is used by:

- `prepare.sh`
- `deploy.sh`

It must be able to create namespaced resources such as:

- deployments
- services
- endpoints
- configmaps
- secrets
- ingresses

It must not require cluster-admin permissions.

It also must not depend on cluster-scope discovery as part of normal automation. Checks for ingress class, storage class, and node placement belong to the administrator runbook.

### Manager kubeconfig

The manager runtime uses a separate kubeconfig mounted into sandbox-manager.

This kubeconfig may have a **minimal cluster-scope exception** for the current workspace-binding model:

- namespaced access in `mbos`
- minimal `PersistentVolume` permissions

This exception exists because the current manager implementation still binds workspaces through:

- `Secret`
- `PersistentVolume`
- `PersistentVolumeClaim`

That storage model is intentionally kept unchanged in this phase to minimize implementation risk.

Detailed privilege guidance lives in:

- `docs/contracts/cluster-admin-rbac-reference-v1.md`

## Address Model

`cluster-deploy` must not infer the "correct host IP" from a multi-homed application server.

Instead, addresses are declared explicitly per consumer role.

### Public User Access

- `PUBLIC_WEB_BASE_URL`
- `PUBLIC_API_BASE_URL`
- `PUBLIC_KEYCLOAK_BASE_URL`

### Client JuiceFS Mount Access

- `CLIENT_PUBLIC_POSTGRES_HOST`
- `CLIENT_PUBLIC_POSTGRES_PORT`
- `CLIENT_PUBLIC_MINIO_ENDPOINT`

### Cluster-to-Compose Dependency Access

- `K8S_EXTERNAL_POSTGRES_HOST`
- `K8S_EXTERNAL_POSTGRES_PORT`
- `K8S_EXTERNAL_MINIO_HOST`
- `K8S_EXTERNAL_MINIO_PORT`

These values are rendered into:

- `postgres-external`
- `minio-external`

using namespaced `Service + Endpoints`.

### Application-Server-to-Manager Access

- `SANDBOX_MANAGER_INGRESS_CLASS_NAME`
- `SANDBOX_MANAGER_INGRESS_HOST`
- `SANDBOX_MANAGER_PUBLIC_BASE_URL`

The application server reaches `sandbox-manager` through the namespaced manager Ingress.

## Scheduling and Resources

Cluster defaults are fixed by rendered env:

- node selector JSON for sandbox-manager
- tolerations JSON for sandbox-manager
- node selector JSON for internal workloads
- tolerations JSON for internal workloads

Default resources for `sandbox-manager` and sandbox runner workloads:

- requests:
  - `cpu=1`
  - `memory=2Gi`
- limits:
  - `cpu=2`
  - `memory=4Gi`

These values must be part of tracked templates and rendered env, not manual post-deploy edits.

## Registry Model

Required operator config:

- `REGISTRY_HOST`
- `REGISTRY_PROJECT`
- `REGISTRY_USERNAME`
- `REGISTRY_PASSWORD`

Optional operator config:

- `APP_NODE_BASE_IMAGE`
- `RUNNER_NODE_BASE_IMAGE`
- `VERIFY_PLAYWRIGHT_BASE_IMAGE`
- `VERIFY_DOCKER_CLI_IMAGE`
- `SANDBOX_GO_BASE_IMAGE`
- `SANDBOX_RUNTIME_BASE_IMAGE`
- `UNIVERSAL_PROXY_RUST_BASE_IMAGE`
- `UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE`

The target host does not build images.
It only loads the offline bundle, pushes bundled registry-tagged images, and deploys the application and manager.

## Operator Config

Tracked templates:

- `infra/deploy/cluster/env/site.env.example`
- `infra/deploy/cluster/env/registry.env.example`
- `infra/deploy/cluster/env/kubeconfig.example.yaml`
- `infra/deploy/cluster/env/manager-kubeconfig.example.yaml`

Gitignored operator files:

- `.infra/cluster-deploy/site.env`
- `.infra/cluster-deploy/registry.env`
- `.infra/cluster-deploy/kubeconfig`
- `.infra/cluster-deploy/manager-kubeconfig`

Target-host shared config:

- `$HOME/agentsmith/cluster-deploy/config/site.env`
- `$HOME/agentsmith/cluster-deploy/config/registry.env`
- `$HOME/agentsmith/cluster-deploy/config/kubeconfig`
- `$HOME/agentsmith/cluster-deploy/config/manager-kubeconfig`

## Administrator Prerequisites

Before `cluster-deploy` runs, a cluster administrator must already have completed:

- namespace preparation
- ingress preparation
- JuiceFS CSI installation
- storage class preparation
- node selector and toleration validation
- deploy kubeconfig handoff
- manager-kubeconfig handoff

These are not part of deploy automation. They are documented in:

- `docs/user-guides/cluster-admin-runbook.md`
- `docs/contracts/cluster-admin-rbac-reference-v1.md`

## Lifecycle Commands

The cluster line uses its own lifecycle:

- `npm run cluster:bundle`
- `npm run cluster:prepare`
- `npm run cluster:deploy`
- `npm run cluster:bootstrap`
- `npm run cluster:verify`
- `npm run cluster:report`

`reset` is not part of the formal production release flow.

## Validation Requirements

The minimum release proof for `cluster-deploy` is:

1. bundle input checks pass
2. rendered env checks pass
3. cluster admin prerequisites are already complete
4. `prepare -> deploy -> bootstrap -> verify -> report` passes on the target host
5. external and internal notebook flows succeed
