# AgentSmith Deploy And Docker Substrate Milestone Plan

Status: `historical_reference`
Owner: Product + Engineering
Last updated: 2026-05-27

Historical/reference notice: this file records the earlier Docker substrate and
unified-deploy diagnostic implementation. It is not the current active
deployment plan. Current release/deploy truth is
`docs/contracts/unified-deploy-contract.md` plus
`docs/engineering/release-kit-and-runner-repo-split-kiss-plan-v1.md`.
`local-kind` and `existing-cluster` in this file are pre-GA diagnostic entry
names only; they are not release targets, not operator-facing choices, and not
`release:ready` deployment conclusions.

## Purpose

AgentSmith uses one deployment model: `AgentSmith deploy`.

At the time of this milestone implementation, AgentSmith exposed two
diagnostic entry names:

- `local-kind`: Docker substrate plus local kind for AgentSmith app workloads.
- `existing-cluster`: operator-provided Kubernetes namespace and prerequisites,
  consuming the same declared substrate truth shape.

Those names are now historical/pre-GA diagnostic entry names. The current
formal release model is `online` / `airgap` × `use_existing` /
`install_substrates`, represented internally as `target_cluster` /
`substrate_source` / `distribution`.

## Product Decisions

1. The substrate module is a Docker-only dependency module.
   - It runs PostgreSQL, MongoDB, Redis, MinIO, and Keycloak.
   - It owns dependency lifecycle, health, destructive reset, readiness reseed,
     and substrate connection truth.
   - It does not own AgentSmith app workloads, Kubernetes app manifests,
     product bootstrap, release verification, or release reports.

2. Keycloak is substrate.
   - AgentSmith app pods consume Keycloak as an external identity service.
   - App deployment must not silently mutate Keycloak realm, client, hostname,
     redirect, issuer, or TLS settings.

3. AgentSmith app workloads run in Kubernetes.
   - App components are `web`, `api`, `llmup`, the ASBCP image-provided
     internal task execution service, managed runner deployment configuration,
     and required Kubernetes resources.
   - App components consume generated configuration from the deployment system
     and must not invent dependency addresses.

4. `llmup` is app-managed.
   - API calls `llmup` through an internal Kubernetes service.
   - App `Secret` and `ConfigMap` rendering own llmup admin/config values.
   - App-managed is deployment ownership only; it is not source-code ownership
     or provider feature expansion.

5. API horizontal scaling is out of scope.
   - `api replicas=1` is a hard current boundary.
   - The current live execution paths are API-process-local.
   - Multi-replica API support requires a separate architecture plan.

## Runtime Shape

### Substrate

Supported lifecycle commands:

- `up`
- `down`
- `reset`
- `reseed`
- `status`

The current substrate truth is consumed by app render and rollout checks. It is
the only source for dependency connection values.

### App

The app deployment renders Kubernetes resources for:

- `web`
- `api`
- `llmup`
- ASBCP image-provided internal task execution service
- managed runner workload support
- required service accounts, roles, services, ingress, config maps, and secrets

Ingress routes `/api/v1` and runner/terminal WebSocket paths to `api`.
`/api/public` and `/api/system` route to `web`. `llmup` is internal by default.

## Historical Diagnostic Commands

Daily development and manual testing use host runtime:

```bash
make local-real-up
make local-real-status
make local-real-down
make local-real-reset
```

These commands are retained here as historical/focused diagnostic evidence
names. They are not formal release targets and do not produce an AgentSmith
deployment/package/operator verdict:

```bash
npm run test:unified-deploy:substrate-boundary
npm run test:unified-deploy:render
npm run test:unified-deploy:manifest
npm run test:unified-deploy:api-single-replica
npm run test:unified-deploy:address-truth
npm run test:unified-deploy:k8s-dry-run
npm run test:unified-deploy:local-kind:images
npm run test:unified-deploy:local-kind
npm run test:unified-deploy:product-flows -- --flow=workspace_project --flow=files --flow=agent_task_managed_runner
```

Release-oriented verification uses:

```bash
npm run release:ready
npm run release:status
```

## Acceptance Criteria

- Current docs point to `docs/contracts/unified-deploy-contract.md`.
- Public command surfaces expose one deploy model and unified deploy checks.
- Historical transition wording superseded by the current boundary: unified
  deploy lanes are transition-only focused diagnostics / 过渡期专项诊断 and are not used by the
  AgentSmith release campaign verdict.
- Substrate evidence validates Docker substrate lifecycle and truth shape.
- App rollout evidence validates local kind images, app deployment, ingress, and
  API single-replica enforcement.
- Product proof includes focused workspace/project, Files, and managed runner
  Agent task flows.
- No execution-gateway, Kubernetes substrate, API horizontal scaling, or
  Keycloak app pod is introduced.

## Verification Scope

Use focused validation for development slices. Run heavier release verification
only at stage closure or when a change crosses contracts, release campaign
composition, runtime topology, or deployment evidence ownership.
