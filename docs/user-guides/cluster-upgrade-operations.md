# Cluster Upgrade Operations

`cluster upgrade` is the production version-update line for an existing `cluster-deploy` install.

Use it only after the environment has already completed the normal first install flow.

## What It Changes

Upgrade updates only:

- compose `api`
- compose `web`
- compose `external-runner`
- compose `universal-proxy`
- namespaced sandbox resources in `mbos`

Upgrade does **not** update:

- `postgres`
- `mongo`
- `redis`
- `minio`
- `keycloak`
- cluster-scope prerequisites such as ingress-nginx, JuiceFS CSI, storage class, or cluster RBAC

Upgrade also does **not** run:

- `reset`
- `seed`
- `bootstrap`
- `verify`
- `report`

## Important Rule

`external-runner` keeps using the current runtime credentials from the live release.

The upgrade line copies the existing `env/runner-runtime.env` from the current release into the new one before restarting app services. It does not mint a new agent key and it does not re-bootstrap preset data.

## Required Files

Under:

- `$HOME/agentsmith/cluster-deploy/config`

the upgrade line still expects:

- `site.env`
- `registry.env`
- `kubeconfig`
- `manager-kubeconfig`
- `admin-ready.env`

`admin-ready.env` must already contain:

- `ADMIN_READY=1`

If the current install has never completed the administrator handoff, do not use the upgrade line yet.

## Commands

Run from the extracted release:

```bash
cd "$HOME/agentsmith/cluster-deploy/current"
bash scripts/cluster-deploy/upgrade.sh
```

This runs:

1. `prepare`
2. `publish-images`
3. `upgrade-app`
4. `upgrade-sandbox`
5. `upgrade-status`

You can also run the stages manually:

```bash
bash scripts/cluster-deploy/upgrade-app.sh
bash scripts/cluster-deploy/upgrade-sandbox.sh
bash scripts/cluster-deploy/upgrade-status.sh
```

## Expected Outcome

After upgrade:

- `api` is reachable
- `web` is reachable
- `universal-proxy` is running
- `external-runner` reconnects with the preserved runtime env
- `sandbox-manager` is ready in namespace `mbos`
- substrate services and existing business data remain untouched

## Operational Boundary

This line is intentionally simple:

- short downtime is allowed
- no blue/green
- no schema migration system
- no cluster-scope prerequisite reconciliation

If a release needs substrate migration or cluster-scope platform changes, handle that as a separate maintenance operation, not through this upgrade line.
