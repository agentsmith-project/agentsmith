# Cluster Admin Runbook

Use this runbook only from the handoff directory on the target server.

What you need in the same directory:
- `CHECKLIST.md`
- `site.env.todo`
- `examples/*.yaml`
- `scripts/*.sh`

Your goal is simple:
1. make sure the `mbos` namespace and cluster prerequisites exist
2. apply the example YAML after filling real values
3. hand back the four config files
4. set `ADMIN_READY=1`

`cluster-deploy` automation does not do cluster-scope setup. It waits for you to finish this handoff first.

## Before You Start

You should already know or be able to confirm:
- the target namespace is `mbos`
- JuiceFS CSI is installed in the cluster
- the storage class name to use for AgentSmith
- the manager ingress host/base URL
- the host/IP that cluster pods should use to reach the application server
- the public browser/client addresses

You will hand these back to the deployment operator in:
- `config/site.env`
- `config/registry.env`
- `config/kubeconfig`
- `config/manager-kubeconfig`

## Step 1. Confirm Namespace And JuiceFS CSI

Run:

```bash
kubectl get namespace mbos >/dev/null 2>&1 || kubectl create namespace mbos
kubectl get namespace mbos
kubectl get csidriver csi.juicefs.com
kubectl get pods -A | grep juicefs
```

If JuiceFS CSI is not ready, stop here and finish your normal cluster-side CSI installation first.

Suggested mirrored images:
- `imotion-cn-beijing.cr.volces.com/mbos/thirdparty-juicedata-juicefs-csi-driver:v0.31.3`
- `imotion-cn-beijing.cr.volces.com/mbos/thirdparty-juicedata-csi-dashboard:v0.31.3`
- `imotion-cn-beijing.cr.volces.com/mbos/thirdparty-juicedata-mount:ce-v1.3.1`

## Step 2. Edit And Apply The Example Files

Files to edit:
- `examples/juicefs-csi-secret.example.yaml`
- `examples/juicefs-storageclass.example.yaml`
- `examples/deploy-role.example.yaml`
- `examples/manager-role.example.yaml`
- `examples/manager-pv-clusterrole.example.yaml`
- `site.env.todo`

You can apply them with the helper scripts:

```bash
bash scripts/apply-juicefs-prereqs.sh
bash scripts/apply-deploy-rbac.sh
bash scripts/apply-manager-rbac.sh
```

Or apply the YAML one by one with `kubectl apply -f ...`.

## Step 3. Prepare The Two Kubeconfigs

You need two separate kubeconfigs:

### `config/kubeconfig`
For deploy automation only. It should be namespace-scoped to `mbos` and able to manage:
- deployments
- services
- endpoints
- configmaps
- secrets
- ingresses

### `config/manager-kubeconfig`
For sandbox-manager runtime. It should have:
- `mbos` namespace access for:
  - secrets
  - persistentvolumeclaims
  - pods
  - events
- the smallest cluster-scope exception for:
  - `persistentvolumes`
    - `get`
    - `list`
    - `watch`
    - `create`
    - `update`
    - `patch`
    - `delete`

Do not reuse the deploy kubeconfig for manager runtime.

## Step 4. Finalize `site.env.todo`

Fill or confirm these groups:

### Public browser addresses
- `PUBLIC_WEB_BASE_URL`
- `PUBLIC_API_BASE_URL`
- `PUBLIC_KEYCLOAK_BASE_URL`

### Client JuiceFS addresses
- `CLIENT_PUBLIC_POSTGRES_HOST`
- `CLIENT_PUBLIC_POSTGRES_PORT`
- `CLIENT_PUBLIC_MINIO_ENDPOINT`

### Cluster-to-host addresses
- `K8S_EXTERNAL_POSTGRES_HOST`
- `K8S_EXTERNAL_POSTGRES_PORT`
- `K8S_EXTERNAL_MINIO_HOST`
- `K8S_EXTERNAL_MINIO_PORT`

### Manager ingress
- `SANDBOX_MANAGER_INGRESS_CLASS_NAME`
- `SANDBOX_MANAGER_INGRESS_HOST`
- `SANDBOX_MANAGER_PUBLIC_BASE_URL`

### Storage and scheduling
- `INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME`
- `SANDBOX_MANAGER_NODE_SELECTOR_JSON`
- `SANDBOX_MANAGER_TOLERATIONS_JSON`
- `INTERNAL_AGENT_WORKLOAD_NODE_SELECTOR_JSON`
- `INTERNAL_AGENT_WORKLOAD_TOLERATIONS_JSON`

How to confirm them:
- public URLs: from the real browser/API entrypoints
- client JuiceFS addresses: from a real client machine that must mount
- cluster-to-host addresses: from cluster-side connectivity tests
- manager ingress values: from your ingress design
- storage class: from `kubectl get storageclass`
- selector/tolerations: from the nodes you expect to run manager and sandbox pods

Useful checks:

```bash
kubectl get storageclass
kubectl get ingressclass
```

## Step 5. Hand Back The Files

Place these final files under the deploy config directory:
- `config/site.env`
- `config/registry.env`
- `config/kubeconfig`
- `config/manager-kubeconfig`

## Step 6. Run Final Verification

Run:

```bash
bash scripts/final-verification.sh
```

This check validates the delivered files under `config/`, not just your current shell identity.

If everything is ready, set:

```bash
ADMIN_READY=1
ADMIN_CHECKED_AT=<timestamp>
```

in:

- `config/admin-ready.env`

The deployment operator can then continue with:
- `deploy-sandbox`
- `bootstrap`
- `verify`
- `report`
