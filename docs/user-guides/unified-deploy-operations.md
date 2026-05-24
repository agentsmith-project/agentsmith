# Unified Deploy Operations

Status: `current`

This guide is the current AgentSmith transitional deploy diagnostics entrypoint. Current AgentSmith release readiness is product readiness plus full visual, backend-real release, and terminal aggregate evidence; unified deploy, local-kind, existing-cluster, and product-flow deploy commands are legacy/focused diagnostics and are not part of the AgentSmith release verdict. After the release-kit functional repo is ready, release-kit owns future deployment, package, and operator runbook release verdict through repo-local gate and evidence. AgentSmith retains product readiness, images/release contract, local full test, and thin adapter.

AgentSmith now has one deployment model with two profiles:

- `local-kind`: runs the same Kubernetes app topology on a developer machine, with Docker substrate services.
- `existing-cluster`: applies the same app topology to an operator-owned Kubernetes cluster, consuming declared substrate connection truth.

## Current vs P0 Handoff Boundary

Current Docker-only local-kind unified deploy remains the current mainline.
`external_declared` in P0 is schema, fixture, validator, and evidence boundary
only. It does not mean P2/P3 completed real Kubernetes, cloud, or airgap
handoff support.

For this guide, `existing-cluster` smoke proves current deployment wiring,
routing smoke, and handoff evidence for an operator-owned cluster. It is not a
long-term release-kit ownership statement. Product flows still come from
AgentSmith focused evidence, and real release-kit repo checks require the
explicit source-boundary handoff described in the split plan.

## Runtime Shape

- AgentSmith app components run in Kubernetes: Web, API, llmup, the internal task execution service, and managed runner workloads.
- API replicas are intentionally fixed at `1` in this milestone.
- PostgreSQL, MongoDB, Redis, MinIO, and Keycloak are substrate services. The current substrate module is Docker-only.
- Keycloak is a substrate dependency, not an app pod.
- Ingress exposes the app through one HTTP entrypoint.
- Product verification must use focused product flows; route smoke alone is not product proof.
- Operator adoption details for pinned internal component images live in the
  [Unified Deploy Contract](../contracts/unified-deploy-contract.md).

## Developer Machine Versus Deploy

Development still supports direct host runtime through `local-real`:

```bash
make local-real-up
make local-real-status
make local-real-down
make local-real-reset
```

Use this for daily development, debugging, and manual UI testing. It starts host API/Web/runner processes and the local development substrate.

Unified deploy uses its own Docker substrate truth and a Kubernetes app. Because both lines use the same default substrate ports, run them serially:

```bash
make local-real-down
npx tsx scripts/unified-deploy/substrate-lifecycle.ts reset
```

To return to host development:

```bash
npx tsx scripts/unified-deploy/substrate-lifecycle.ts down
make local-real-reset
```

## Minimal Verification Slices

Use the smallest slice that proves the layer you changed.

### Substrate

```bash
npm run test:unified-deploy:substrate-boundary
npx tsx scripts/unified-deploy/substrate-lifecycle.ts reset
```

### Static Release Checks

```bash
npm run test:unified-deploy:render
npm run test:unified-deploy:manifest
npm run test:unified-deploy:api-single-replica
npm run test:unified-deploy:address-truth
npm run test:unified-deploy:k8s-dry-run
```

### Local Kubernetes Deploy

```bash
npm run test:unified-deploy:local-kind:images
npm run test:unified-deploy:local-kind
```

### Focused Product Proof

For the minimal app behavior proof, run only project setup, file library, and managed runner task:

```bash
npm run test:unified-deploy:product-flows -- \
  --flow=workspace_project \
  --flow=files \
  --flow=agent_task_managed_runner \
  --agent-task-polls=30 \
  --agent-task-poll-interval-ms=2000
```

This proves:

- a project can be created;
- a file library can become ready;
- a file can be uploaded, listed, and downloaded;
- a managed runner task can complete through the selected endpoint.

It does not run chat, audit, usage, or full release verification.

### Existing Cluster Smoke

`existing-cluster` smoke proves the current app deploy wiring, rollout, and routing smoke for the real-cluster profile. It is legacy/focused diagnostic evidence only: future online/airgap deploy execution and operator runbooks belong to release-kit, and this smoke is not part of the AgentSmith release verdict.

```bash
npm run test:unified-deploy:existing-cluster-smoke -- \
  --site-env=<existing-cluster-site-env> \
  --substrate-truth=infra/deploy/unified/substrate/connection.env \
  --public-base-url=<public-base-url>
```

## Cleanup

For a clean rerun on a developer machine:

```bash
make local-real-down
kubectl --context kind-agentsmith delete namespace agentsmith --ignore-not-found=true
kubectl --context kind-agentsmith delete namespace agentsmith-sandbox --ignore-not-found=true
npx tsx scripts/unified-deploy/substrate-lifecycle.ts reset
```

If file-library PVs remain from local tests, remove only the test file-library PVs in the local kind cluster before rerunning deploy verification.

## Evidence

Unified deploy producers write evidence under:

```text
artifacts/unified-deploy/
```

Focused evidence is valid for its named scope only. It is not part of the current AgentSmith release verdict unless a future release campaign explicitly consumes it.
