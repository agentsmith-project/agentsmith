# Unified Deploy Operations

Status: `current`

This guide is the current pre-GA AgentSmith focused deploy diagnostics / 过渡期专项诊断 entrypoint. `npm run product:ready` is the AgentSmith product readiness / local complete / current product gate: product evidence, full visual, backend-real release, and terminal aggregate evidence. It is not a future deployment, package, or operator release verdict. `npm run release:ready` / `npm run release:status` remain deprecated transition aliases only; they do not give deployment, package, or operator verdicts. Unified deploy, local-kind, and existing-cluster commands are focused diagnostics. Product-flow has two surfaces: `npm run test:unified-deploy:product-flows` is a focused aggregate diagnostic, while `npm run lane:unified-deploy:product-flows` is the AgentSmith-owned canonical post-deploy product smoke report producer for release-kit `--ga-release` input. Neither surface is part of default `product:ready` / release-full. After the release-kit functional repo is ready, release-kit owns deployment, package, and operator runbook verdicts through repo-local gate and evidence. AgentSmith retains product readiness, images/release contract, local full test, and thin adapter.

The formal release model is not the command names in this guide. Release-kit
operator-facing language is `online` / `airgap` × `use_existing` /
`kit_provided`; internal machine artifacts use `target_cluster` /
`substrate_source` / `distribution`. `kit_provided` means kit-supplied
substrate pack, truth, routability, and materiality validation, not installing
substrates. `install_substrates` is only future / fail-fast language for a real
installer path; it requires an independent installer producer and explicit
installer confirmation flag.

This guide still exposes two pre-GA diagnostic entry names:

- `local-kind`: local diagnostic rehearsal on a developer machine, with Docker
  substrate services and a local kind app cluster.
- `existing-cluster`: transition-only route/app wiring smoke against an
  operator-owned Kubernetes cluster plus declared substrate connection truth.

They are not release targets, not long-term operator choices, and not
`product:ready` deployment conclusions. `release:ready` is only a deprecated
transition alias for product readiness.

## Current vs P0 Handoff Boundary

The Docker-only local-kind unified deploy path is the current pre-GA diagnostic baseline, not a long-term deployment truth.
`external_declared` in P0 is schema, fixture, validator, and evidence boundary
only. It does not mean P2/P3 completed real Kubernetes, cloud, or airgap
handoff support.

For this guide, `existing-cluster` smoke proves pre-GA diagnostic deployment
wiring, routing smoke, and handoff evidence for an operator-owned cluster. It is
not part of the AgentSmith product gate. Product flows still come from
AgentSmith focused evidence, and release-kit repo checks require the explicit
source-boundary handoff described in the split plan.

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

### Local Diagnostic Deploy

```bash
npm run test:unified-deploy:local-kind:images
npm run test:unified-deploy:local-kind
```

### Focused Product Proof

For a focused aggregate diagnostic, let the product-flow checker use its default flow list:

```bash
npm run test:unified-deploy:product-flows -- \
  --agent-task-polls=30 \
  --agent-task-poll-interval-ms=2000
```

This focused command proves the deployed product smoke matrix for diagnosis:

- login/profile access;
- a project can be created;
- `provider_neutral_endpoint` / provider-neutral Endpoint can complete through the endpoint gateway;
- a managed runner task can complete through the selected endpoint;
- a file library can become ready;
- a file can be uploaded, listed, and downloaded;
- audit evidence is visible for key actions;
- usage evidence is visible for key actions.

It does not produce the release-kit canonical post-deploy product smoke report and does not run full release verification.

For the AgentSmith-owned canonical post-deploy product smoke report, run the lane producer after the deployment path is available:

```bash
UNIFIED_DEPLOY_RELEASE_CONTRACT=<downloaded-agentsmith-release-contract.json> \
UNIFIED_DEPLOY_RELEASE_SITE_ENV=<site-env-for-deployed-target> \
UNIFIED_DEPLOY_RELEASE_ROOT_DIR=<ga-smoke-evidence-root> \
npm run lane:unified-deploy:product-flows
```

`AGENTSMITH_RELEASE_CONTRACT_PATH` may be used instead of `UNIFIED_DEPLOY_RELEASE_CONTRACT`. The release contract must point to the downloaded `agentsmith-release-contract.json`. `UNIFIED_DEPLOY_RELEASE_SITE_ENV` selects the deployed target site env, and `UNIFIED_DEPLOY_RELEASE_ROOT_DIR` selects the evidence root.

The file to pass to release-kit `--ga-release` is:

```text
<ga-smoke-evidence-root>/post-deploy-product-smoke/post-deploy-product-smoke-report.json
```

This lane first runs the focused aggregate diagnostic, then binds the result to the release contract and writes the canonical `agentsmith-post-deploy-product-smoke` report. It is not a default `product:ready` / release-full step.

### Existing Cluster Smoke

`existing-cluster` smoke proves the current pre-GA diagnostic app deploy wiring, rollout, and routing smoke for the real-cluster diagnostic entry. It is transition-only focused diagnostic evidence / 过渡期专项诊断 only: online/airgap deploy execution and operator runbooks belong to release-kit, and this smoke is not part of the AgentSmith product gate.

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

When `UNIFIED_DEPLOY_RELEASE_ROOT_DIR=<ga-smoke-evidence-root>` is set for `npm run lane:unified-deploy:product-flows`, the canonical post-deploy product smoke report is written under:

```text
<ga-smoke-evidence-root>/post-deploy-product-smoke/post-deploy-product-smoke-report.json
```

Focused evidence is valid for its named scope only. It is not part of the current AgentSmith product gate; deploy/package/operator verdict ownership belongs to release-kit repo-local gate/evidence, with no AgentSmith release campaign consumption implied.
