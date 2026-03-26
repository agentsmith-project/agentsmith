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

- `/home/percy/agentsmith/cluster-deploy`

Shared operator config:

- `/home/percy/agentsmith/cluster-deploy/config/site.env`
- `/home/percy/agentsmith/cluster-deploy/config/registry.env`
- `/home/percy/agentsmith/cluster-deploy/config/kubeconfig`

Release lifecycle paths:

- uploads:
  - `/home/percy/agentsmith/cluster-deploy/uploads`
- releases:
  - `/home/percy/agentsmith/cluster-deploy/releases`
- state:
  - `/home/percy/agentsmith/cluster-deploy/state`
- logs:
  - `/home/percy/agentsmith/cluster-deploy/logs`
- reports:
  - `/home/percy/agentsmith/cluster-deploy/reports`

## Standard Flow

### 1. Build bundle on the build machine

```bash
npm run cluster:bundle
```

This step:

- builds first-party images
- pushes them to the configured registry
- generates an install bundle

### 2. Copy bundle to the target host

Example:

```bash
scp ~/agentsmith/cluster-deploy/uploads/agentsmith-<release-id>.tar.gz <host>:/home/percy/agentsmith/cluster-deploy/uploads/
```

### 3. Extract on the target host

```bash
cd /home/percy/agentsmith/cluster-deploy/uploads
tar -xzf agentsmith-<release-id>.tar.gz -C /home/percy/agentsmith/cluster-deploy/releases
```

### 4. Point `current` to the extracted release

```bash
ln -sfn /home/percy/agentsmith/cluster-deploy/releases/agentsmith-<release-id> /home/percy/agentsmith/cluster-deploy/current
```

### 5. Run lifecycle commands

```bash
cd /home/percy/agentsmith/cluster-deploy/current
bash scripts/prepare.sh
bash scripts/deploy.sh
bash scripts/bootstrap.sh
bash scripts/verify.sh
bash scripts/report.sh
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
- a node labeled `node=mbos`
- a node taint `mbos:NoExecute`

The deployment line assumes:

- sandbox-manager and sandbox runner requests: `1 CPU / 2Gi`
- sandbox-manager and sandbox runner limits: `2 CPU / 4Gi`

## External Dependency Model

Pods do not guess the application-server IP.

Instead, the deployment renders:

- `postgres-external`
- `minio-external`

as `Service + EndpointSlice`, and internal agent workloads access those service names.

## Cleanup

To clear the current release state on the target host:

```bash
cd /home/percy/agentsmith/cluster-deploy/current
bash scripts/reset.sh
```

To prune old uploads, releases, and reports:

```bash
cd /home/percy/agentsmith/cluster-deploy/current
bash scripts/prune-history.sh
```
