# Cluster Admin Runbook

## Purpose

This runbook covers the **cluster-scope prerequisites** for `cluster-deploy`.

It must be completed **before** the namespace-only AgentSmith deployment automation runs.

`cluster-deploy` itself must not:

- create or delete namespaces
- install JuiceFS CSI
- modify `kube-system`
- create cluster-wide RBAC
- create or delete cluster-scope storage objects

## Deliverables

The cluster administrator must hand over these inputs to the application deployment operator:

- an existing `mbos` namespace
- a namespace-scoped deploy kubeconfig for `mbos`
- a separate `manager-kubeconfig`
- a preinstalled JuiceFS-compatible storage class name
- a reachable manager ingress host and base URL
- node selector and toleration values that match the target cluster

The application deployment operator must not continue until all of these handoff items exist.

Ready-to-edit example files live under:

- `infra/deploy/cluster/admin-examples/`

These examples are not applied by automation. They exist to lower the administrator's editing cost.

## 1. Prepare Namespace

Create and govern the target namespace outside AgentSmith automation:

- namespace: `mbos`
- any quota / policy / limit-range decisions
- any required image pull network policy or egress policy

The AgentSmith deploy kubeconfig will assume the namespace already exists.

Recommended baseline:

```bash
kubectl get namespace mbos >/dev/null 2>&1 || kubectl create namespace mbos
kubectl get namespace mbos
```

## 2. Install and Validate JuiceFS CSI

Install JuiceFS CSI using your cluster-standard process.

If you do not already have a platform-standard JuiceFS installation process, use this minimum operator model:

1. install JuiceFS CSI with cluster-admin tooling
2. use mirrored images from your registry
3. create the namespace secret and storage class consumed by AgentSmith

Suggested mirrored images:

- `imotion-cn-beijing.cr.volces.com/mbos/thirdparty-juicedata-juicefs-csi-driver:v0.31.3`
- `imotion-cn-beijing.cr.volces.com/mbos/thirdparty-juicedata-csi-dashboard:v0.31.3`
- `imotion-cn-beijing.cr.volces.com/mbos/thirdparty-juicedata-mount:ce-v1.3.1`

Minimum administrator workflow:

1. install JuiceFS CSI using your cluster-standard manifest or Helm chart
2. override the CSI controller / node / dashboard / mount images to your mirrored registry images
3. wait until controller and node components are healthy
4. create the `mbos` namespace secret:
   - `infra/deploy/cluster/admin-examples/juicefs-csi-secret.example.yaml`
5. create the storage class:
   - `infra/deploy/cluster/admin-examples/juicefs-storageclass.example.yaml`

Recommended apply commands:

```bash
kubectl apply -f infra/deploy/cluster/admin-examples/juicefs-csi-secret.example.yaml
kubectl apply -f infra/deploy/cluster/admin-examples/juicefs-storageclass.example.yaml
```

Validate:

- controller and node components are healthy
- the cluster exposes a usable storage class
- the storage class supports the JuiceFS mount flow required by sandbox-manager

Record the storage class name and provide it to AgentSmith as:

- `INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME`

`cluster-deploy` consumes this storage class. It does not install CSI.

Also confirm, outside AgentSmith automation:

- the chosen ingress class exists and is healthy
- the chosen storage class exists and is healthy
- the recorded node selector / toleration values actually match runnable nodes

These are administrator-side checks. `cluster-deploy` no longer performs cluster-scope discovery for them.

Recommended checks:

```bash
kubectl get csidriver csi.juicefs.com
kubectl get pods -A | grep juicefs
kubectl get secret -n mbos juicefs-csi-secret
kubectl get storageclass juicefs-sc
```

## 3. Prepare Manager Runtime Permissions

Create a **separate** kubeconfig for sandbox-manager.

This kubeconfig should have:

- namespaced permissions in `mbos` for:
  - secrets
  - persistentvolumeclaims
  - pods
  - events
- the smallest cluster-scope `PersistentVolume` permissions needed by the current workspace binding model:
  - `get`
  - `list`
  - `watch`
  - `create`
  - `update`
  - `patch`
  - `delete`

Optional read-only access:

- `storageclasses`
  - `get`
  - `list`

This kubeconfig is mounted into sandbox-manager as:

- `config/manager-kubeconfig`

Do not reuse the deploy kubeconfig for manager runtime.

Recommended example files:

- `infra/deploy/cluster/admin-examples/manager-role.example.yaml`
- `infra/deploy/cluster/admin-examples/manager-pv-clusterrole.example.yaml`

Administrator workflow:

1. edit the example YAMLs if your namespace or service account names differ
2. apply them
3. mint a kubeconfig for the `agentsmith-manager` identity
4. hand that kubeconfig to the deployment operator as:
   - `config/manager-kubeconfig`

Recommended apply commands:

```bash
kubectl apply -f infra/deploy/cluster/admin-examples/manager-role.example.yaml
kubectl apply -f infra/deploy/cluster/admin-examples/manager-pv-clusterrole.example.yaml
```

Minimum RBAC shape:

- namespaced role in `mbos`
  - `secrets`
  - `persistentvolumeclaims`
  - `pods`
  - `events`
- cluster-scope exception only for:
  - `persistentvolumes`
    - `get`
    - `list`
    - `watch`
    - `create`
    - `update`
    - `patch`
    - `delete`

## 4. Prepare Deploy Kubeconfig

Create a separate deploy kubeconfig that is limited to namespace-only release actions in `mbos`.

Minimum namespaced create/update/apply access:

- deployments
- services
- endpoints
- configmaps
- secrets
- ingresses

Recommended read-only access:
- namespace

This kubeconfig is used by `prepare.sh` and `deploy.sh`.

Recommended example file:

- `infra/deploy/cluster/admin-examples/deploy-role.example.yaml`

Administrator workflow:

1. edit the example YAML if your namespace or service account names differ
2. apply it
3. mint a kubeconfig for the `agentsmith-deploy` identity
4. hand that kubeconfig to the deployment operator as:
   - `config/kubeconfig`

Recommended apply command:

```bash
kubectl apply -f infra/deploy/cluster/admin-examples/deploy-role.example.yaml
```

Minimum RBAC shape:

- namespaced role in `mbos`
  - `deployments`
  - `services`
  - `endpoints`
  - `configmaps`
  - `secrets`
  - `ingresses`

This identity must not need cluster-scope write permissions.

## 5. Prepare Manager Ingress

Make sure the cluster already has:

- a working ingress controller

Provide:

- `SANDBOX_MANAGER_INGRESS_CLASS_NAME`
- `SANDBOX_MANAGER_INGRESS_HOST`
- `SANDBOX_MANAGER_PUBLIC_BASE_URL`

The AgentSmith deployment will create the namespaced manager `Ingress`, `Service`, and `Deployment` only.

Recommended checks:

```bash
kubectl get ingressclass
```

## 6. Prepare Node Placement

Choose the node selector and toleration values for:

- sandbox-manager
- internal sandbox runner workloads

These values must match real cluster node labels and taints.

Record and pass them through:

- `SANDBOX_MANAGER_NODE_SELECTOR_JSON`
- `SANDBOX_MANAGER_TOLERATIONS_JSON`
- `INTERNAL_AGENT_WORKLOAD_NODE_SELECTOR_JSON`
- `INTERNAL_AGENT_WORKLOAD_TOLERATIONS_JSON`

For the current production target, the expected baseline is:

- selector: `{\"node\":\"mbos\"}`
- toleration: `[{\"key\":\"mbos\",\"operator\":\"Exists\",\"effect\":\"NoExecute\"}]`

## 7. Handoff Files

The application deployment operator must receive:

- `config/kubeconfig`
- `config/manager-kubeconfig`
- `config/site.env`
- `config/registry.env`

For the current target, `site.env` should at least include:

- `SANDBOX_MANAGER_INGRESS_CLASS_NAME`
- `SANDBOX_MANAGER_INGRESS_HOST`
- `SANDBOX_MANAGER_PUBLIC_BASE_URL`
- `INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME`
- `K8S_EXTERNAL_POSTGRES_HOST`
- `K8S_EXTERNAL_POSTGRES_PORT`
- `K8S_EXTERNAL_MINIO_HOST`
- `K8S_EXTERNAL_MINIO_PORT`
- `SANDBOX_MANAGER_NODE_SELECTOR_JSON`
- `SANDBOX_MANAGER_TOLERATIONS_JSON`
- `INTERNAL_AGENT_WORKLOAD_NODE_SELECTOR_JSON`
- `INTERNAL_AGENT_WORKLOAD_TOLERATIONS_JSON`

### How To Fill `site.env`

Fill only the values that describe real site truth. The rest can stay close to the example template.

#### Public browser addresses

- `PUBLIC_WEB_BASE_URL`
- `PUBLIC_API_BASE_URL`
- `PUBLIC_KEYCLOAK_BASE_URL`

Source of truth:

- the real browser entry URLs after your reverse proxy / domain setup

How to confirm:

```bash
curl -I https://<web-host>
curl -I https://<api-host-or-path>
curl -I https://<keycloak-host-or-path>
```

#### Client JuiceFS mount addresses

- `CLIENT_PUBLIC_POSTGRES_HOST`
- `CLIENT_PUBLIC_POSTGRES_PORT`
- `CLIENT_PUBLIC_MINIO_ENDPOINT`

Source of truth:

- the address a human user can reach from their own machine

How to confirm:

```bash
nc -vz <client-postgres-host> <client-postgres-port>
curl -I <client-minio-endpoint>
```

#### Cluster-to-host dependency addresses

- `K8S_EXTERNAL_POSTGRES_HOST`
- `K8S_EXTERNAL_POSTGRES_PORT`
- `K8S_EXTERNAL_MINIO_HOST`
- `K8S_EXTERNAL_MINIO_PORT`

Source of truth:

- the address reachable from pods in the cluster back to the application host

How to confirm:

```bash
kubectl -n mbos run netcheck --rm -it --image=alpine:3.20 -- sh
apk add --no-cache curl busybox-extras
nc -vz <k8s-external-postgres-host> <k8s-external-postgres-port>
nc -vz <k8s-external-minio-host> <k8s-external-minio-port>
```

#### Manager ingress

- `SANDBOX_MANAGER_INGRESS_CLASS_NAME`
- `SANDBOX_MANAGER_INGRESS_HOST`
- `SANDBOX_MANAGER_PUBLIC_BASE_URL`

Source of truth:

- the real ingress host and class you chose for sandbox-manager

How to confirm:

```bash
kubectl get ingressclass
```

#### Storage class and scheduling

- `INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME`
- `SANDBOX_MANAGER_NODE_SELECTOR_JSON`
- `SANDBOX_MANAGER_TOLERATIONS_JSON`
- `INTERNAL_AGENT_WORKLOAD_NODE_SELECTOR_JSON`
- `INTERNAL_AGENT_WORKLOAD_TOLERATIONS_JSON`

Source of truth:

- the preinstalled JuiceFS storage class
- the actual cluster node labels and taints you selected

These are copied into:

- `$HOME/agentsmith/cluster-deploy/config/`

## Final Check

Before allowing `cluster-deploy` automation to run, verify:

- `mbos` namespace exists
- deploy kubeconfig can write namespaced release objects in `mbos`
- manager kubeconfig can manage namespaced workspace objects and cluster-scope PVs
- ingress class / JuiceFS storage class / node selector and toleration checks are already completed by the administrator

Recommended final handoff checks:

```bash
kubectl get namespace mbos
kubectl get storageclass juicefs-sc
kubectl get secret -n mbos juicefs-csi-secret
test -f config/kubeconfig
test -f config/manager-kubeconfig
```

## Final Verification Commands

The cluster administrator can use this final check block before handing the environment to the application deployment operator:

```bash
kubectl get namespace mbos
kubectl get csidriver csi.juicefs.com
kubectl get storageclass juicefs-sc
kubectl get secret -n mbos juicefs-csi-secret
kubectl get ingressclass
kubectl auth can-i create deployments -n mbos --as=system:serviceaccount:mbos:agentsmith-deploy
kubectl auth can-i create secrets -n mbos --as=system:serviceaccount:mbos:agentsmith-manager
kubectl auth can-i create persistentvolumes --as=system:serviceaccount:mbos:agentsmith-manager
```

The environment is ready to hand over only when:

- the namespace exists
- JuiceFS CSI is present
- the storage class exists
- the JuiceFS secret exists in `mbos`
- ingress class exists
- the deploy identity can write namespaced release objects in `mbos`
- the manager identity can write namespaced runtime objects in `mbos`
- the manager identity has the minimal cluster-scope `PersistentVolume` exception

After these are true, the application deployment operator can run:

- `prepare`
- `deploy`
- `bootstrap`
- `verify`
- `report`
