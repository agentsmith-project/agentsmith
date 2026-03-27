# Cluster Admin RBAC Reference v1

## Summary

This document describes the intended privilege split for the real-cluster deployment line.

- `cluster-deploy` automation uses a **namespace-only deploy kubeconfig**
- `sandbox-manager` runtime uses a **separate manager kubeconfig**
- the manager kubeconfig is the only place where the current design allows a minimal cluster-scope exception

This is a reference for cluster administrators. It is not an automation target.

## Deploy Kubeconfig

Purpose:

- run `prepare`
- run `deploy`

Scope:

- namespace: `mbos`

Required namespaced capabilities:

- deployments
- services
- endpoints
- configmaps
- secrets
- ingresses

Expected behavior:

- may create, update, patch, list, get, watch, and delete namespaced release objects in `mbos`
- must not need cluster-scope write permissions

Must not require:

- namespace create/delete
- clusterrole / clusterrolebinding
- `kube-system` access
- storage class installation
- CSI installation
- persistentvolume create/delete

## Manager Kubeconfig

Purpose:

- run sandbox-manager runtime
- create workspace binding objects for internal workloads

Scope:

- namespaced runtime operations in `mbos`
- minimal cluster-scope exception for `PersistentVolume`

Required namespaced capabilities:

- secrets
- persistentvolumeclaims
- pods
- events

Minimal cluster-scope exception:

- persistentvolumes
  - `get`
  - `list`
  - `watch`
  - `create`
  - `update`
  - `patch`
  - `delete`

Optional read-only capability if administrators want explicit runtime storage inspection:

- storageclasses
  - `get`
  - `list`

## Current Rationale

The current sandbox-manager implementation still binds workspaces through:

- `Secret`
- `PersistentVolume`
- `PersistentVolumeClaim`

Because of that, sandbox-manager still needs a minimal cluster-scope `PersistentVolume` exception.

This exception belongs to the runtime identity only. It must not be inherited by `cluster-deploy` automation.

## Operational Rule

Before running `cluster-deploy`, the cluster administrator should confirm:

- the `mbos` namespace already exists
- the ingress class already exists
- the JuiceFS-compatible storage class already exists
- the chosen node selector and toleration values are valid
- the deploy kubeconfig and manager kubeconfig are separate

`cluster-deploy` automation assumes those prerequisites are already true.
