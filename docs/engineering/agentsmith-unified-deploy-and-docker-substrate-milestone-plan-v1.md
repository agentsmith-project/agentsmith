# AgentSmith Unified Deploy and Docker Substrate Milestone Plan v1

Status: `handoff_plan_ready`
Owner: Product + Engineering
Last updated: 2026-05-07

Status flow:

- `draft_for_review`: discussion and review artifact only.
- `handoff_plan_ready`: approved implementation target; still not current
  runtime truth until implementation evidence updates the contracts.

This document is the target milestone plan for simplifying AgentSmith deployment.
It is planning evidence, not current implementation truth. Until the
implementation updates the scripts, manifests, gates, runbooks, release evidence,
contracts README, and `docs/CURRENT_BASELINE.md` routing, the current runtime
authority remains the current-v1 contracts:

- `docs/contracts/deployment-spec-v1.md`
- `docs/contracts/cluster-deployment-spec-v1.md`
- `docs/contracts/substrate-governance-and-runtime-lines-v1.md`
- `docs/contracts/address-truth-and-release-governance-v1.md`
- `docs/contracts/universal-proxy-integration-v1.md`

Slice 0 adds the target-only contract:

- `docs/contracts/unified-deploy-contract-v2.md`

That file is `target_v2_contract` / `not_current_runtime_truth`. It guides
implementation and review but does not override current-v1 active truth.

AgentSmith is pre-GA. This milestone intentionally removes old deployment
mental models when they add operator or developer complexity. Do not preserve
`demo-deploy` / `cluster-deploy` compatibility as a product goal if it blocks the
target model. This is a milestone-closure target, not a Slice 0 instruction to
delete or rewrite current-v1 docs while their scripts and gates still own active
runtime behavior.

## Purpose

Users should understand one deployment model:

- start or connect the dependency base;
- deploy AgentSmith app components into Kubernetes;
- access AgentSmith through the configured ingress;
- verify product workflows through one release report.

The deployment model should not ask users to choose between demo, cluster,
simple, full, semi-auto, or full-auto as product concepts. Those differences are
environment preparation details owned by deploy profiles and runbooks.

This milestone has a deliberately narrow technical target:

- keep the substrate module as an independent Docker-only module;
- deploy AgentSmith app components to Kubernetes;
- keep `api` at `replicas=1`;
- do not introduce an execution-gateway;
- keep Keycloak outside the AgentSmith app workload;
- treat `llmup` as an AgentSmith app component, not as substrate.

## Product Decisions

1. AgentSmith has one deploy model.
   - The user-facing deployment object is `AgentSmith deploy`.
   - `local-kind` and `existing-cluster` are profiles of the same deploy model.
   - They are not separate product capabilities or release lines.

2. The substrate module is a separate dependency module.
   - The target supported substrate implementation is Docker-only.
   - It owns dependency lifecycle, health, dependency readiness reseed,
     destructive reset, and connection truth generation.
   - It does not own AgentSmith product bootstrap such as system workspace
     records, workspaces, projects, endpoints, Agent Runners, audit, or usage.
   - It does not deploy AgentSmith app workloads.

3. Keycloak is substrate.
   - The Docker substrate module runs Keycloak for the supported substrate path.
   - Existing-cluster deploy consumes the Keycloak endpoint rendered from the
     same Docker substrate connection truth schema.
   - AgentSmith app consumes Keycloak as an external identity service.
   - Keycloak must not be deployed as an AgentSmith app pod in this milestone.

4. AgentSmith app runs in Kubernetes.
   - App components include `web`, `api`, `llmup`, sandbox-manager, managed
     runner deployment configuration, and required Kubernetes resources.
   - App components consume substrate connection truth and must not invent
     dependency addresses.

5. `llmup` is app-managed.
   - Existing universal-proxy / llmup runtime references must move out of the
     target substrate model.
   - The API should call `llmup` through an internal Kubernetes service.
   - Existing protocol/env names such as `MBOS_UNIVERSAL_PROXY_BASE_URL` may
     remain as API configuration, but the rendered value points to the app-owned
     `llmup` service.
   - llmup admin/config secrets belong to app `Secret` / `ConfigMap`, not to the
     substrate connection truth.
   - `llmup` can keep a version/image lock, but deployment ownership belongs to
     AgentSmith app.
   - App-managed is a deployment ownership statement only. It is not a source
     ownership, source build, or model-provider feature target.

6. API horizontal scaling is not in this milestone.
   - `api replicas=1` is a hard boundary.
   - This avoids introducing execution-gateway, distributed terminal routing,
     cross-pod SSE fanout, or runner socket ownership routing in the same
     milestone.
   - Web may later scale independently, but API multi-replica support is a
     separate architecture milestone.

## Product Objects

### AgentSmith Deploy

The single operator-facing deployment workflow.

It owns:

- rendering deploy configuration;
- publishing or selecting images;
- applying app Kubernetes resources;
- registering substrate connection truth for app pods;
- bootstrapping AgentSmith product data;
- verifying and reporting release evidence.

It does not own:

- database or identity platform product design;
- substrate backups or cloud provisioning;
- multi-API high availability;
- customer cluster policy administration beyond documented prerequisites.

### Substrate Module

The dependency base AgentSmith connects to.

Target milestone substrate members:

- PostgreSQL
- MongoDB
- Redis
- MinIO
- Keycloak

Substrate outputs:

- one authoritative connection truth file;
- health status;
- dependency seed/reseed status;
- values needed to render Kubernetes `Secret`, `ConfigMap`, and external
  service bindings for app pods.

Substrate does not include:

- API
- Web
- llmup / universal-proxy
- sandbox-manager
- managed runner workload or runtime configuration
- bootstrap / verify / report workflows
- product bootstrap data such as system workspaces, projects, endpoints,
  managed runner records, audit, or usage

### AgentSmith App

The Kubernetes workload set that implements the product.

Target milestone app components:

- `web`
- `api`
- `llmup`
- sandbox-manager and internal sandbox execution resources
- deployment default managed runner configuration and runtime support
- Kubernetes `Deployment`, `Service`, `Ingress`, `ConfigMap`, `Secret`, and
  service account resources required by those components

The app consumes substrate truth. It must not reconstruct substrate addresses
from Docker bridge IPs, kind gateway IPs, host guesses, or generated manifests
edited by hand.

### Deploy Profile

A profile expresses environment preparation details.

Target profiles:

- `local-kind`: local rehearsal profile; prepares or uses local
  Docker substrate and local kind; deploys the same AgentSmith app topology.
- `existing-cluster`: real Kubernetes profile; consumes substrate connection
  truth and deploys the same AgentSmith app topology to a provided namespace.

Profiles may differ in kubeconfig, registry, public URL, ingress class, storage
class, and substrate reachability. They must not change the product model.

## Current Authority And Target Delta

| Area | Current authority | Current state | Target delta |
| --- | --- | --- | --- |
| Demo deploy | `docs/contracts/deployment-spec-v1.md` | Compose app + Docker substrate, optional local kind sandbox. | No longer a separate product deployment line after this milestone lands. |
| Cluster deploy | `docs/contracts/cluster-deployment-spec-v1.md` | Compose app/data on target host; K8s only for sandbox execution surface. | K8s-native app deployment with Docker-only substrate dependency module. |
| Substrate | `docs/contracts/substrate-governance-and-runtime-lines-v1.md` | Includes universal-proxy in substrate members. | Substrate contains dependency base only; llmup moves to app. |
| llmup / universal-proxy | Cluster spec and substrate scripts | Treated as Compose/substrate-side service. | App-managed Kubernetes service consumed internally by API. |
| API replicas | Current runner/task/terminal implementation | Live execution state is API-process-local. | Template and gates require `api replicas=1`; multi-replica is future work. |
| Ingress and address truth | `docs/contracts/address-truth-and-release-governance-v1.md` plus cluster sandbox ingress | User-facing app ingress is not yet unified. | Web/API/auth exposure is configured through one ingress entry strategy. |
| Universal proxy contract | `docs/contracts/universal-proxy-integration-v1.md` | Universal-proxy is wired as a substrate/Compose service in current deployment lines. | Protocol/env compatibility may remain; deployment ownership moves to app-managed `llmup`. |

This milestone should later produce a new deployment contract, or upgrade the
existing deployment contracts, after implementation evidence exists. Until then,
old contracts should not be edited to claim the target topology is already true.

## V1 Name To Target Disposition

| Current v1 name | Target disposition |
| --- | --- |
| `demo-deploy` | Historical/current-v1 line during migration. Target user docs replace it with the `local-kind` profile. |
| `cluster-deploy` | Historical/current-v1 line during migration. Target user docs replace it with unified deploy using the `existing-cluster` profile. |
| `DEMO_DEPLOY_MODE=simple/full` | Removed as a user-facing product mode. Any remaining implementation branch must be transitional cleanup evidence only. |
| `CLUSTER_DEPLOY_MODE=semi-auto/full-auto` | Reframed as prerequisite/handoff handling, not a product deployment type. |
| Compose `api` / `web` app stage | Removed from the target app path. Target app stage is Kubernetes-native. |
| Compose `universal-proxy` substrate service | Removed from the target substrate path. Target app path deploys `llmup` in Kubernetes. |
| `demo:*` / `cluster:*` scripts | May exist temporarily as owner adapters while migration is underway. They must not remain the final user-facing deploy entrypoints. |

Legacy deployment terms may appear only in migration mappings, current-v1
references, negative checks, cleanup evidence, or historical docs. New user
guides and target contracts must use `AgentSmith deploy`, `local-kind`, and
`existing-cluster`.

## V1 To Target Ownership Mapping

| V1 item | Target ownership |
| --- | --- |
| `MBOS_UNIVERSAL_PROXY_BASE_URL` | May remain as the API protocol/env key; rendered by app config to the internal `llmup` service. |
| `COMPOSE_INTERNAL_UNIVERSAL_PROXY_BASE_URL` | V1 Compose-only implementation detail; removed from the target K8s app path. |
| Substrate `connection.env` universal-proxy values | Removed from target substrate truth. App render owns llmup service config. |
| Compose `universal-proxy` service | Replaced by app-managed K8s `llmup` Deployment and Service. |
| `KEYCLOAK_*` connection truth | Remains substrate identity-service truth consumed by app config. |
| Keycloak realm/client bootstrap | May remain identity-service readiness owned by substrate seed/reseed or an explicit identity bootstrap contract, never by app pod rollout side effects. AgentSmith product bootstrap is owned by `AgentSmith deploy`. |
| `PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_API_BASE` | Must point to the `/api/v1` backend API entry, not to Web-owned `/api/public` routes. |

## Target Runtime Topology

### Docker Substrate

The substrate module runs outside Kubernetes for this milestone.

It provides:

- PostgreSQL for relational state and file-library metadata;
- MongoDB for shared product/system state;
- Redis for shared cache, leases, tickets, and runtime coordination where
  already required;
- MinIO for object storage;
- Keycloak as the substrate identity service consumed by AgentSmith app.

It writes the connection truth consumed by app deployment. For local-kind, that
truth must be routable from Kubernetes pods without asking users to hand-enter
Docker internals. For existing-cluster, deploy consumes declared substrate
handoff values that conform to the Docker substrate connection truth schema.
This is not a new BYO-substrate product capability, a second substrate provider
abstraction, or a Kubernetes substrate implementation in this milestone.

### Kubernetes App

The app namespace contains:

- `web` deployment and service;
- `api` deployment and service, fixed to `replicas=1`;
- `llmup` deployment and service;
- sandbox-manager deployment and service;
- Kubernetes resources for external substrate service registration;
- config and secret resources generated from deploy configuration and
  substrate truth;
- ingress resources for user/browser and external runner access.

Runner and terminal access use the existing API/runner protocol path in this
milestone. Do not add execution-gateway routing, new runner product concepts, or
cross-API-pod session ownership.

### Ingress

The target ingress model should let HTTP clients use one public entry point for
AgentSmith product access.

Recommended routes:

- `/` or the configured web host routes to `web`;
- `/api/v1` and existing runner/terminal WebSocket paths under `/api/v1` route
  to `api`;
- `/api/public` and `/api/system` stay with `web` unless a future contract
  explicitly moves those Next.js routes;
- an independent API host may be used instead of path routing when an operator
  prefers host-based separation;
- Keycloak exposure through the same ingress boundary is allowed only when the
  substrate Keycloak public issuer requires it. The app deploy must not silently
  own Keycloak realm, hostname, TLS, or redirect configuration.
- `llmup` is not public by default and should be called by `api` through an
  internal service.

The milestone should keep the ingress controller choice conservative. Existing
ingress-nginx usage is enough; do not introduce Traefik unless a later operator
requirement demands a provider adapter.

Ingress acceptance must explicitly probe three entrypoints:

- `GET /api/public/workspaces` reaches `web`;
- authenticated `GET /api/v1/me/profile` reaches `api`;
- runner WebSocket upgrade under `/api/v1/agent-execution/ws` reaches `api`.

## Address And Configuration Truth

The deployment model must keep address truth separated by consumer role.

Required roles:

- public browser access;
- API internal service access;
- Kubernetes workload to substrate access;
- Keycloak public issuer / internal fetch access;
- client-visible file-library object access / URL access;
- runner-visible execution access.

Rules:

- Operators edit one deploy config source, not generated env files or manifests.
- App pods consume generated `ConfigMap` and `Secret` values.
- Kubernetes workload dependency access uses rendered service names or explicit
  external service bindings.
- Public URLs must not be reused for container-internal or Kubernetes-internal
  dependency access unless the contract explicitly says so.
- Docker bridge IPs, kind gateway IPs, and host-local convenience addresses are
  implementation details, not operator-facing product inputs.
- Deploy should fail fast when a required address cannot be rendered or verified.

Identity provider truth:

- Keycloak public issuer, redirect URI, and browser login base are substrate
  identity-service truth.
- API internal JWKS/fetch base is app configuration derived from substrate truth.
- If the same ingress exposes substrate Keycloak, the deploy config must declare
  that ownership explicitly; app templates must not infer or mutate Keycloak
  realm/client/hostname settings.

Substrate-to-Kubernetes bindings must cover every app dependency:

| Dependency | Target K8s binding |
| --- | --- |
| PostgreSQL | Service plus EndpointSlice/Endpoints and secret-backed connection string |
| MongoDB | Service plus EndpointSlice/Endpoints and secret-backed connection string |
| Redis | Service plus EndpointSlice/Endpoints and secret-backed connection string |
| MinIO | Service plus EndpointSlice/Endpoints and secret-backed access credentials |
| Keycloak | Service plus EndpointSlice/Endpoints or declared issuer/fetch URLs |

ExternalName may be used only when DNS semantics are explicitly verified for the
dependency. The default target should prefer selectorless Service plus
EndpointSlice/Endpoints for port-specific health and diagnostics.

## Kubernetes Authority Boundary

The target deploy model must preserve the useful permission separation from the
current cluster line.

- Existing-cluster profile must not require cluster-admin permissions for normal
  namespaced app deployment.
- Namespace creation, IngressClass installation, StorageClass / CSI installation,
  cluster-wide RBAC, and certificate/DNS infrastructure remain administrator
  prerequisites unless a future full-auto contract is explicitly approved.
- Deploy kubeconfig owns namespaced app resources such as Deployments, Services,
  ConfigMaps, Secrets, Ingresses, Jobs, ServiceAccounts, Roles, and RoleBindings.
- Sandbox-manager keeps only the minimal runtime permissions required by the
  current workspace storage model. Any PersistentVolume exception must remain
  explicit and justified in the contract.
- Image pull secrets and service accounts are generated or referenced by deploy
  configuration; app pods must not rely on default cluster-global credentials.

## API Single-Replica Boundary

This milestone keeps `api` single-replica by design.

Reasons:

- runner WebSocket ownership is currently local to the API process;
- live task dispatch and cancel handlers are local to the execution-owning API
  process;
- terminal live sessions and replay rings are local to the API process;
- task SSE fanout is local to the API process;
- sticky browser sessions do not solve runner socket ownership because the
  browser and runner are different clients.

Implementation requirements:

- app Kubernetes templates explicitly set `spec.replicas: 1` for `api`;
- there is no user/operator `API_REPLICAS` setting in this milestone;
- rendered manifests and gates reject `api replicas > 1`;
- HPA/KEDA or any autoscaler targeting `api` is forbidden;
- live deploy gates check the applied `api` Deployment remains at one replica;
- negative render tests prove `replicas: 2` fails before deployment;
- runbooks say API horizontal scaling is unsupported in this milestone;
- no `execution-gateway` resource, env var, route, or user-facing concept is
  introduced;
- future multi-replica support must be a separate architecture milestone.

## User And Operator Flow

1. Prepare substrate.
   - Use the Docker-only substrate module.
   - For existing-cluster, provide the declared substrate handoff values that
     conform to the same Docker substrate connection truth schema.
   - Do not introduce a second substrate provider abstraction, a generic
     BYO-substrate capability, or Kubernetes-hosted substrate in this milestone.
   - Confirm health and seed/reseed status.
   - Confirm Keycloak realm/client/user readiness when using substrate Keycloak.

2. Prepare deploy config.
   - Set namespace, kubeconfig, registry, ingress, public base URLs, storage,
     model endpoint defaults, and admin/bootstrap identities.
   - Do not edit generated app env files or Kubernetes manifests.

3. Publish app images.
   - Publish first-party app images.
   - Include the pinned llmup image in the app release evidence.
   - Include sandbox and managed runner images required for Agent task execution.

4. Deploy AgentSmith app to Kubernetes.
   - Apply app resources.
   - Register substrate access for app pods.
   - Wait for app rollouts.

5. Bootstrap product state.
   - Initialize system management state.
   - Initialize default workspace/project as required by the deploy profile.
   - Seed endpoint/model defaults through the product governance path.
   - Seed the deployment default managed runner.

6. Verify and report.
   - Verify login and profile APIs through ingress.
   - Verify Web-owned `/api/public/workspaces` remains routed to `web`.
   - Verify backend `/api/v1/me/profile` routes to `api`.
   - Verify agent runner WebSocket upgrade works through the configured
     `/api/v1` runner path.
   - Verify project/workspace access.
   - Verify Chat through API to llmup to provider.
   - Verify Agent task execution with the deployment default managed runner.
   - Verify Files object storage and file-library correctness.
   - Verify audit/usage evidence for key actions.
   - Produce a report with concrete URLs, component status, and evidence paths.

## Milestone Slices

This plan is one target model, not one oversized implementation PR. Implementation
must split the work into small reviewable changes while preserving the final
single-deploy outcome:

- Phase A: contract and vocabulary alignment, including compatibility notes and
  negative checks for old terms.
- Phase B: local-kind K8s app MVP against Docker substrate, proving the target
  topology locally.
- Phase C: existing-cluster cutover, runbook alignment, release evidence, and
  retirement or demotion of old user-facing deploy commands.

Old `demo:*` / `cluster:*` commands may be temporary adapters during the phases.
They are not part of final product acceptance.

### Slice 0. Contract And Vocabulary Alignment

Deliverables:

- add `docs/contracts/unified-deploy-contract-v2.md` as
  `target_v2_contract` / `not_current_runtime_truth`;
- add boundary notes to old v1 deployment/runtime/address/proxy contracts only;
- do not rewrite old v1 contract bodies to remove `demo-deploy`,
  `cluster-deploy`, current deployment modes, Compose app/data services, or
  current universal-proxy placement;
- update `docs/contracts/README.md` with current-v1 vs target-v2 deployment
  sections so there is no double truth;
- update `docs/contracts/product-terminology.md` with target deploy vocabulary,
  legacy deploy-term allowlist, and the relationship to
  `docs/CURRENT_BASELINE.md`;
- define `AgentSmith deploy`, `substrate module`, `AgentSmith app`, and
  `deploy profile`;
- remove llmup from the target substrate model;
- clarify that app-managed llmup means deployment ownership only, not source or
  build ownership;
- clarify that target substrate reseed owns dependency readiness, not
  AgentSmith product bootstrap;
- clarify again that existing-cluster is not a BYO-substrate product capability;
- record API single-replica as a hard milestone boundary;
- add v1-name to target-disposition mapping and legacy-term rules.

Acceptance:

- target-v2 docs no longer present demo/cluster as future product concepts;
- current-v1 docs remain allowed to describe demo/cluster as active current-v1
  runtime truth until scripts/manifests/gates/evidence switch;
- contracts clearly distinguish current v1 reality from target v2 topology;
- `docs/contracts/README.md`, `docs/contracts/product-terminology.md`, and this
  plan explain how they relate to `docs/CURRENT_BASELINE.md`;
- no plan or contract implies execution-gateway work in this milestone;
- old deployment names appear only in migration mapping, current-v1 references,
  negative checks, cleanup evidence, script names during migration, or
  historical evidence.

### Slice 1. Docker-Only Substrate Boundary

Deliverables:

- substrate lifecycle remains `up`, `down`, `reset`, `reseed`, `status`;
- substrate Docker services are limited to PostgreSQL, MongoDB, Redis, MinIO,
  Keycloak, and required init helpers;
- substrate produces connection truth for app deployment;
- substrate-to-Kubernetes external service and secret/config rendering is
  defined for PostgreSQL, MongoDB, Redis, MinIO, and Keycloak.

Acceptance:

- llmup / universal-proxy is no longer started as substrate in the target path;
- app deployment can consume substrate truth without reconstructing dependency
  addresses;
- local-kind and existing-cluster use the same substrate truth contract.

### Slice 2. Kubernetes App Topology

Deliverables:

- K8s templates/manifests for `web`, `api`, `llmup`, and sandbox-manager;
- `api replicas=1` is fixed in templates and checked by gate;
- app services use internal Kubernetes DNS names;
- llmup health/config is part of app rollout evidence;
- `MBOS_UNIVERSAL_PROXY_BASE_URL` or its successor env points to the app-owned
  `llmup` service, with app-owned secret/config sources.

Acceptance:

- app no longer depends on Compose for API/Web/llmup in the target path;
- API calls llmup through internal service config;
- rollout status verifies all app components.

### Slice 3. Unified Ingress And Address Truth

Deliverables:

- public ingress routes for Web and `/api/v1` API paths, with `/api/public` and
  `/api/system` preserved for Web-owned routes;
- optional substrate Keycloak exposure with explicit issuer/redirect ownership;
- internal service routes for API to llmup and API to sandbox-manager;
- address rendering checks for public, app-internal, workload-to-substrate, and
  client-visible file-library access.

Acceptance:

- browser users access AgentSmith from the configured public base URL;
- API public routes and Web routes agree on auth/callback configuration;
- `/api/public/workspaces`, `/api/v1/me/profile`, and runner WebSocket upgrade
  probes pass through ingress;
- Keycloak issuer and JWKS/internal fetch URLs are validated for the chosen
  profile;
- deploy fails before rollout when required addresses are inconsistent.

### Slice 4. Bootstrap, Verify, And Report

Deliverables:

- bootstrap runs against the K8s app path;
- default managed runner seed uses deployment configuration, not project UI
  mutable state;
- verify covers login, workspace/project, Chat via llmup, Agent task, Files,
  audit, and usage;
- report distinguishes substrate status from app rollout status.

Acceptance:

- local-kind profile proves the same product flows as existing-cluster smoke;
- evidence is machine-readable enough for gates;
- verify is not reduced to component health checks.

### Slice 5. Runbook And Gate Cleanup

Deliverables:

- update user guides and runbooks to point at the unified deploy model;
- keep old v1 runbooks only as current/legacy references until implementation
  is complete;
- update governance manifests, rehearsal adapters, and release campaign naming;
- add checks preventing API multi-replica or execution-gateway drift.

Acceptance:

- deploy-facing docs no longer require users to understand demo vs cluster as
  product modes;
- local-kind and existing-cluster are documented as profiles;
- gates catch target-model regressions.

Implementation may keep old scripts as temporary adapters while a slice is in
progress. Milestone closure must remove them from user-facing docs or mark them
as historical/current-v1 maintenance entrypoints only.

## Non-Goals And Stop Lines

This milestone must not include:

- execution-gateway;
- API horizontal scaling or `api replicas > 1`;
- API high availability, zero-downtime upgrades, blue/green, canary, autoscaling,
  or cross-pod terminal/session recovery;
- K8s deployment of PostgreSQL, MongoDB, Redis, MinIO, or Keycloak;
- Keycloak operator or cloud IdP provisioning automation;
- substrate backup/restore platform;
- Traefik adoption or ingress-controller abstraction work;
- runner product model redesign;
- managed runner frontend configuration redesign;
- llmup source build or model-provider feature expansion;
- new DevOps platform UI;
- preservation of old demo/cluster command names as a user-facing product goal.

## Documentation To Align During Implementation

Implementation must update or supersede:

- `docs/contracts/deployment-spec-v1.md`
- `docs/contracts/cluster-deployment-spec-v1.md`
- `docs/contracts/substrate-governance-and-runtime-lines-v1.md`
- `docs/contracts/address-truth-and-release-governance-v1.md`
- `docs/contracts/universal-proxy-integration-v1.md`
- `docs/user-guides/demo-deploy-operations.md`
- `docs/user-guides/cluster-deploy-operations.md`
- `docs/user-guides/cluster-upgrade-operations.md`
- `docs/user-guides/runtime-lines-matrix.md`
- `README-demo-deploy.md`
- deployment bundle manifests under `infra/deploy/`
- governance runtime-line manifests and release verification campaign docs

Slice 0 documentation scope is deliberately narrower:

- create the target-v2 unified deploy contract;
- add current-v1 boundary notes to the old v1 contracts;
- update contracts README and product terminology so readers understand
  current-v1 vs target-v2 and the relationship to `docs/CURRENT_BASELINE.md`;
- do not require current-v1 docs to remove demo/cluster concepts while their
  scripts, manifests, gates, and evidence still own active behavior.

Historical/current-v1 docs should not be edited to claim target behavior before
scripts, manifests, gates, and evidence support it. During migration, add
explicit `current v1` / `target v2` relationship notes.

Milestone closure disposition:

- create or update the unified deploy contract as the active deployment truth;
- mark old demo/cluster deployment specs as `superseded` or `historical` when
  their scripts and gates no longer own active behavior;
- remove old demo/cluster runbooks from current user-guide indexes, or label them
  as current-v1 maintenance references only;
- ensure release verification and runtime-line manifests no longer list
  demo/cluster as active target deployment products.

## Test And Gate Plan

Planning-only changes do not require deployment rehearsal or heavy gates.

Implementation slices should use progressive validation:

- contract and generated artifact checks for contract changes;
- focused render-env and manifest checks for deployment config changes;
- implementation must add producer `npm run test:unified-deploy:render` for config and
  substrate-to-app truth rendering;
- implementation must add producer `npm run test:unified-deploy:manifest` for K8s manifest
  structure and server-side dry-run validation;
- implementation must add producer `npm run test:unified-deploy:api-single-replica` for template,
  negative render, and live replica guards;
- implementation must add producer `npm run test:unified-deploy:local-kind` for local-kind app
  rollout evidence;
- implementation must add producer `npm run test:unified-deploy:existing-cluster-smoke` for
  existing-cluster smoke evidence;
- `kubectl apply --dry-run=server` or equivalent server-side validation for
  Kubernetes templates when a cluster is available;
- local-kind focused rollout for app topology changes;
- focused backend-real smoke for auth, Chat, Agent task, Files, audit, and usage
  paths touched by the slice;
- final release evidence only at milestone closure.

Heavy gates such as full visual catalog, full release rehearsal, and
`npm run release:ready` should be reserved for milestone closure or
deployment-critical integration changes, not every small slice.

Minimum final evidence:

- unified deploy contract checks pass;
- substrate Docker lifecycle and connection truth checks pass;
- K8s app manifests render and validate;
- `api replicas=1` guard passes;
- local-kind profile deploys app against Docker substrate;
- existing-cluster smoke deploys app against values conforming to the Docker
  substrate connection truth schema;
- ingress login works;
- Chat uses API to llmup to provider path;
- Agent task managed runner story passes;
- Files correctness passes;
- audit/usage evidence is present;
- release report records substrate, app, ingress, and verification evidence.

Each unified deploy producer should emit machine-readable evidence with at least:

- profile name;
- rendered config fingerprint;
- substrate truth fingerprint with secrets redacted;
- manifest/resource summary;
- pass/fail status;
- log and report paths.

## Handoff Acceptance Criteria

This plan is ready for implementation handoff when:

- product and engineering agree there is one deploy model;
- Docker-only substrate is defined as independent dependency base;
- Keycloak is substrate, not app;
- llmup is app-managed Kubernetes component;
- API single-replica boundary is explicit and testable;
- execution-gateway and API multi-replica are excluded;
- local-kind is a deploy profile, not a second deployment product;
- historical docs have a clear migration relationship and do not silently become
  target truth;
- acceptance criteria are concrete enough for TDD and focused gates.
