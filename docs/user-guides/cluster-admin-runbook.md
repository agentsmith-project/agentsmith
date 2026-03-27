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

## 1. Prepare Namespace

Create and govern the target namespace outside AgentSmith automation:

- namespace: `mbos`
- any quota / policy / limit-range decisions
- any required image pull network policy or egress policy

The AgentSmith deploy kubeconfig will assume the namespace already exists.

## 2. Install and Validate JuiceFS CSI

Install JuiceFS CSI using your cluster-standard process.

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

See the detailed privilege reference:

- [cluster-admin-rbac-reference-v1.md](/home/percy/works/mbos-v1/agentsmith/docs/contracts/cluster-admin-rbac-reference-v1.md)

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

## 5. Prepare Manager Ingress

Make sure the cluster already has:

- a working ingress controller

Provide:

- `SANDBOX_MANAGER_INGRESS_CLASS_NAME`
- `SANDBOX_MANAGER_INGRESS_HOST`
- `SANDBOX_MANAGER_PUBLIC_BASE_URL`

The AgentSmith deployment will create the namespaced manager `Ingress`, `Service`, and `Deployment` only.

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

## 7. Handoff Files

The application deployment operator must receive:

- `config/kubeconfig`
- `config/manager-kubeconfig`
- `config/site.env`
- `config/registry.env`

These are copied into:

- `$HOME/agentsmith/cluster-deploy/config/`

## Final Check

Before allowing `cluster-deploy` automation to run, verify:

- `mbos` namespace exists
- deploy kubeconfig can write namespaced release objects in `mbos`
- manager kubeconfig can manage namespaced workspace objects and cluster-scope PVs
- ingress class / JuiceFS storage class / node selector and toleration checks are already completed by the administrator

After these are true, the application deployment operator can run:

- `prepare`
- `deploy`
- `bootstrap`
- `verify`
- `report`
