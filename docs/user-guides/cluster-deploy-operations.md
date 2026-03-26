# Cluster Deploy Operations

## Purpose

`cluster-deploy` is the real-cluster release line.

Use it when:

- the target host runs application services with Docker Compose
- internal agent execution must run on a real Kubernetes cluster
- images are pulled from an online image registry

Do not use it to replace the current demo deployment line. `remote-deploy` remains the demo/server-local release path.

## Local Operator Files

The build machine stores real operator config in gitignored files:

- `.infra/cluster-deploy/site.env`
- `.infra/cluster-deploy/registry.env`
- `.infra/cluster-deploy/kubeconfig`

Tracked examples live under:

- `infra/deploy/cluster/env/`

## Target Host Layout

Target root:

- `$HOME/agentsmith/cluster-deploy`

Shared operator config:

- `$HOME/agentsmith/cluster-deploy/config/site.env`
- `$HOME/agentsmith/cluster-deploy/config/registry.env`
- `$HOME/agentsmith/cluster-deploy/config/kubeconfig`

`registry.env` may also override the base image sources used during build-machine image builds when Docker Hub or MCR is not directly reachable.

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
- builds first-party images and packages them into the offline bundle
- packages compose assets, scripts, manifests, docs, source trees, and offline image archives
- generates an install bundle that already contains the resolved image refs

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

Do not upload directly from the build machine to the target host unless the transfer policy changes.

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

## Address Model

The cluster line uses explicit address roles.

### Public user access

- `PUBLIC_WEB_BASE_URL`
- `PUBLIC_API_BASE_URL`
- `PUBLIC_KEYCLOAK_BASE_URL`

### Client JuiceFS mount access

- `CLIENT_PUBLIC_POSTGRES_HOST`
- `CLIENT_PUBLIC_POSTGRES_PORT`
- `CLIENT_PUBLIC_MINIO_ENDPOINT`

### Cluster-to-compose dependency access

- `K8S_EXTERNAL_POSTGRES_HOST`
- `K8S_EXTERNAL_POSTGRES_PORT`
- `K8S_EXTERNAL_MINIO_HOST`
- `K8S_EXTERNAL_MINIO_PORT`

### Manager ingress access

- `SANDBOX_MANAGER_INGRESS_HOST`
- `SANDBOX_MANAGER_PUBLIC_BASE_URL`

## Kubernetes Expectations

The target cluster must provide:

- reachable Kubernetes API
- an Ingress controller
- at least one node that matches the configured `SANDBOX_MANAGER_NODE_SELECTOR_JSON`
- at least one node that matches the configured `INTERNAL_AGENT_WORKLOAD_NODE_SELECTOR_JSON`
- `NoExecute` taints on those matched nodes must be tolerated by the configured tolerations
- cluster-scope `PersistentVolume` creation permission for the deploy kubeconfig
- and either:
  - enough cluster-scope permission to install JuiceFS CSI
  - or a preinstalled storage class configured in `INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME`

The deployment line assumes:

- sandbox-manager and sandbox runner requests: `1 CPU / 2Gi`
- sandbox-manager and sandbox runner limits: `2 CPU / 4Gi`

## External Dependency Model

Pods do not guess the application-server IP.

Instead, the deployment renders:

- `postgres-external`
- `minio-external`

as `Service + Endpoints`, and internal agent workloads access those service names.

## Cleanup

To clear the current release state on the target host:

```bash
cd "$HOME/agentsmith/cluster-deploy/current"
bash scripts/cluster-deploy/reset.sh
```

To prune old uploads, releases, and reports:

```bash
cd "$HOME/agentsmith/cluster-deploy/current"
bash scripts/cluster-deploy/prune-history.sh
```

## Offline Rule

The target host does not build images.
It loads the offline image archives from the bundle, pushes the bundled registry-tagged images, and then deploys the application and cluster components.

It only:

- extracts the offline bundle
- loads bundled image archives
- pushes bundled registry-tagged images to the configured registry
- starts Compose services
- applies Kubernetes manifests
