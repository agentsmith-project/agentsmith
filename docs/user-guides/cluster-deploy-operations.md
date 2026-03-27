# Cluster Deploy Operations

## Purpose

`cluster-deploy` is the real-cluster release line.

Use it when:

- the target host runs application services with Docker Compose
- internal agent execution runs on a real Kubernetes cluster
- the cluster administrator has already completed the prerequisites in:
  - [cluster-admin-runbook.md](/home/percy/works/mbos-v1/agentsmith/docs/user-guides/cluster-admin-runbook.md)

Do not use it to replace the current demo deployment line.

## Authority Boundary

`cluster-deploy` automation is limited to:

- application-server local runtime
- namespaced Kubernetes resources in `mbos`

It must not:

- create or delete namespaces
- install JuiceFS CSI
- modify `kube-system`
- create cluster-wide RBAC
- create or delete cluster-scope storage objects

## Local Operator Files

The build machine stores real operator config in gitignored files:

- `.infra/cluster-deploy/site.env`
- `.infra/cluster-deploy/registry.env`
- `.infra/cluster-deploy/kubeconfig`
- `.infra/cluster-deploy/manager-kubeconfig`

Tracked examples live under:

- `infra/deploy/cluster/env/`

## Target Host Layout

Target root:

- `$HOME/agentsmith/cluster-deploy`

Shared operator config:

- `$HOME/agentsmith/cluster-deploy/config/site.env`
- `$HOME/agentsmith/cluster-deploy/config/registry.env`
- `$HOME/agentsmith/cluster-deploy/config/kubeconfig`
- `$HOME/agentsmith/cluster-deploy/config/manager-kubeconfig`

Release lifecycle paths:

- uploads:
  - `$HOME/agentsmith/cluster-deploy/uploads`
- releases:
  - `$HOME/agentsmith/cluster-deploy/releases`
- state:
  - `$HOME/agentsmith/cluster-deploy/state`
- logs:
  - `$HOME/agentsmith/cluster-deploy/logs`
- reports:
  - `$HOME/agentsmith/cluster-deploy/reports`

## Standard Flow

### 1. Build bundle on the build machine

```bash
npm run cluster:bundle
```

This step:

- validates bundle inputs
- builds first-party images
- packages offline image archives
- packages compose assets, scripts, manifests, docs, source trees, and release metadata

### 2. Copy bundle through the transfer host

Current required transfer flow:

1. upload from the build machine to `pullot`
2. log in to the real target host
3. pull the file from `pullot` with `scp`

Example:

```bash
scp -P 12220 ~/agentsmith/cluster-deploy/uploads/agentsmith-<release-id>.tar.gz percy@pullot.com:/home/percy/xfer/agentsmith/
ssh <target-host>
mkdir -p "$HOME/agentsmith/cluster-deploy/uploads"
scp -P 12220 percy@pullot.com:/home/percy/xfer/agentsmith/agentsmith-<release-id>.tar.gz "$HOME/agentsmith/cluster-deploy/uploads/"
```

### 3. Extract on the target host

```bash
cd "$HOME/agentsmith/cluster-deploy/uploads"
mkdir -p "$HOME/agentsmith/cluster-deploy/releases"
mkdir -p "$HOME/agentsmith/cluster-deploy/releases/agentsmith-<release-id>"
tar -xzf agentsmith-<release-id>.tar.gz \
  -C "$HOME/agentsmith/cluster-deploy/releases/agentsmith-<release-id>" \
  --strip-components=1
```

### 4. Point `current` to the extracted release

```bash
ln -sfn "$HOME/agentsmith/cluster-deploy/releases/agentsmith-<release-id>" "$HOME/agentsmith/cluster-deploy/current"
```

### 5. Run lifecycle commands

```bash
cd "$HOME/agentsmith/cluster-deploy/current"
bash scripts/cluster-deploy/prepare.sh
bash scripts/cluster-deploy/deploy.sh
bash scripts/cluster-deploy/bootstrap.sh
bash scripts/cluster-deploy/verify.sh
bash scripts/cluster-deploy/report.sh
```

## Kubeconfig Roles

### Deploy kubeconfig

`config/kubeconfig` is used by:

- `prepare.sh`
- `deploy.sh`

It should be namespace-scoped to `mbos`.

### Manager kubeconfig

`config/manager-kubeconfig` is mounted into sandbox-manager.

It should allow:

- namespaced workspace runtime operations in `mbos`
- the smallest cluster-scope `PersistentVolume` permissions required by the current manager storage model

Do not reuse the deploy kubeconfig for manager runtime.

## Kubernetes Expectations

Before automation runs, the cluster must already provide:

- the `mbos` namespace
- a reachable Kubernetes API
- an ingress controller
- a preinstalled JuiceFS-compatible storage class
- node label / taint values matching:
  - `SANDBOX_MANAGER_NODE_SELECTOR_JSON`
  - `SANDBOX_MANAGER_TOLERATIONS_JSON`
  - `INTERNAL_AGENT_WORKLOAD_NODE_SELECTOR_JSON`
  - `INTERNAL_AGENT_WORKLOAD_TOLERATIONS_JSON`

If these are missing, `prepare.sh` must fail fast.

`prepare.sh` does not perform cluster-scope discovery for those prerequisites. It assumes the administrator has already completed and validated them.

## External Dependency Model

Pods do not guess the application-server IP.

Instead, the deployment renders:

- `postgres-external`
- `minio-external`

as namespaced `Service + Endpoints`, and internal agent workloads access those service names.

## Cleanup

`reset.sh` is not part of the formal production release flow.

If used manually, it only clears:

- Compose runtime
- local state
- local logs
- local reports

It does not delete namespaces or other Kubernetes resources.

To prune old uploads, releases, and reports:

```bash
cd "$HOME/agentsmith/cluster-deploy/current"
bash scripts/cluster-deploy/prune-history.sh
```

## Offline Rule

The target host does not build images.

It only:

- extracts the offline bundle
- loads bundled image archives
- pushes bundled registry-tagged images to the configured registry
- starts Compose services
- applies namespaced Kubernetes manifests
