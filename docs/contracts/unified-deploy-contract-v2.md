# Unified Deploy Contract v2

Status: `target_v2_contract` / `not_current_runtime_truth`
Owner: Product + Engineering
Last updated: 2026-05-07

## Authority Boundary

This document defines the target deployment contract for the unified AgentSmith
deploy milestone. It is a contract-first implementation target, not current
runtime truth.

Current-v1 active deployment truth remains in these contracts until scripts,
manifests, gates, runbooks, and release evidence switch to this v2 model:

- `docs/contracts/deployment-spec-v1.md`
- `docs/contracts/cluster-deployment-spec-v1.md`
- `docs/contracts/substrate-governance-and-runtime-lines-v1.md`
- `docs/contracts/address-truth-and-release-governance-v1.md`
- `docs/contracts/universal-proxy-integration-v1.md`

This v2 target must not be used to rewrite current-v1 specs as if the target
topology is already implemented. Current-v1 specs may keep `demo-deploy`,
`cluster-deploy`, Compose app services, and current universal-proxy placement
while they remain active runtime truth.

This contract becomes current only after:

- unified deploy scripts and manifests implement the model below;
- focused gates and evidence prove both target profiles;
- contracts README and `docs/CURRENT_BASELINE.md` route readers to v2 as active
  truth;
- old v1 deployment contracts are marked `superseded` or `historical`.

## Product Model

AgentSmith has one deployment model:

- user-facing object: `AgentSmith deploy`;
- target profiles: `local-kind` and `existing-cluster`;
- one app topology across both profiles;
- one release report that separates substrate status, app rollout status,
  ingress status, product bootstrap, and verification evidence.

Profiles describe environment preparation details. They are not separate
product capabilities, release lines, or UI/IA objects.

## Target Runtime Topology

### Docker-Only Substrate Module

The target supported substrate implementation is Docker-only. It runs outside
Kubernetes and contains only dependency services:

- PostgreSQL
- MongoDB
- Redis
- MinIO
- Keycloak

The substrate module owns:

- `up`, `down`, `reset`, `reseed`, and `status`;
- Docker dependency lifecycle;
- destructive dependency reset;
- dependency health;
- dependency readiness reseed;
- one authoritative connection truth file consumed by app deployment.

The substrate module does not own:

- AgentSmith `web`, `api`, `llmup`, sandbox-manager, or runner workloads;
- Kubernetes app manifests;
- product bootstrap for system workspace records, workspaces, projects,
  endpoints, Agent Runners, audit, or usage;
- release verify/report workflows.

Target substrate reseed prepares dependency readiness only. It may prepare
identity-service prerequisites such as Keycloak realm/client readiness when that
is part of the substrate identity contract, but it must not create AgentSmith
product state. Product bootstrap belongs to `AgentSmith deploy`.

### Keycloak Boundary

Keycloak is substrate.

- The supported path runs Keycloak in the Docker substrate module.
- AgentSmith app pods consume Keycloak as an external identity service.
- Keycloak must not be deployed as an AgentSmith app pod in this milestone.
- The app deploy must not silently mutate Keycloak realm, client, hostname,
  redirect, issuer, or TLS settings.

### AgentSmith App In Kubernetes

The AgentSmith app runs in Kubernetes.

Target app components:

- `web`
- `api`
- `llmup`
- sandbox-manager
- managed Agent task runner deployment configuration and runtime support
- Kubernetes `Deployment`, `Service`, `Ingress`, `ConfigMap`, `Secret`,
  service account, role, and role binding resources required by those
  components

`api` is fixed to `replicas=1`. There is no `API_REPLICAS` user/operator setting
in this milestone, and autoscalers targeting `api` are forbidden.

### llmup Boundary

`llmup` is app-managed in this target contract.

App-managed means deployment ownership:

- `llmup` is deployed as an AgentSmith app Kubernetes workload;
- API calls `llmup` through an internal Kubernetes service;
- app `Secret` / `ConfigMap` rendering owns llmup admin/config values.

App-managed does not mean AgentSmith owns llmup source code, source builds, or
model-provider feature expansion. A pinned external llmup image/version may
remain a release input.

Existing env/protocol names such as `MBOS_UNIVERSAL_PROXY_BASE_URL` may remain
for API compatibility, but the rendered target value points to the internal
app-owned `llmup` service. Substrate connection truth must not contain llmup or
universal-proxy service addresses in the v2 target model.

## Profiles

### `local-kind`

`local-kind` is the local rehearsal profile.

It uses:

- Docker-only substrate;
- local kind for the AgentSmith app Kubernetes namespace;
- the same app topology as `existing-cluster`;
- explicit substrate-to-kind reachability rendered by deploy configuration.

It replaces `demo-deploy` as the target user-facing local deploy profile only
after implementation evidence switches to v2.

### `existing-cluster`

`existing-cluster` is the real Kubernetes profile.

It uses:

- an operator-provided namespace and deploy kubeconfig;
- the same Docker substrate connection truth schema;
- the same AgentSmith app topology as `local-kind`;
- operator-provided ingress, registry, storage, DNS, and certificate
  prerequisites.

This profile is not a BYO-substrate product capability. Operators may provide
connection values that conform to the Docker substrate truth schema only as the
declared substrate handoff for app deployment. The milestone does not introduce
a second substrate provider abstraction, a managed cloud substrate, or a
Kubernetes substrate implementation.

Normal `existing-cluster` deployment must not require cluster-admin permission.
Namespace creation, IngressClass installation, StorageClass / CSI installation,
cluster-wide RBAC, DNS, and certificate infrastructure remain administrator
prerequisites unless a later contract explicitly approves a separate full-auto
cluster-prerequisite model.

## Ingress And Routing

The target ingress model exposes AgentSmith product access through one public
entry strategy.

Required route ownership:

- `/` or the configured web host routes to `web`;
- `/api/v1` routes to `api`;
- runner and terminal WebSocket paths under `/api/v1` route to `api`;
- `/api/public` routes to `web`;
- `/api/system` routes to `web`;
- `llmup` is internal by default and is not exposed publicly.

An independent API host may be used instead of path routing when an operator
chooses host-based separation, but route ownership stays the same.

Keycloak may be exposed through the same ingress boundary only when the
substrate Keycloak public issuer requires it and deploy configuration explicitly
declares that ownership. App templates must not infer Keycloak public hostname,
issuer, redirects, TLS, or realm/client settings.

Ingress acceptance must probe:

- `GET /api/public/workspaces` reaches `web`;
- authenticated `GET /api/v1/me/profile` reaches `api`;
- runner WebSocket upgrade under `/api/v1/agent-execution/ws` reaches `api`.

## Address And Configuration Truth

Operators edit one deploy configuration source. Generated env files, Kubernetes
manifests, `ConfigMap`s, and `Secret`s are not operator-editable truth.

Address truth must be separated by consumer role:

- public browser access;
- API internal service access;
- Kubernetes workload to substrate access;
- Keycloak public issuer / internal fetch access;
- client-visible file-library object access / URL access;
- runner-visible execution access.

Rules:

- app pods consume generated Kubernetes config and secret values;
- app deployment consumes substrate connection truth and must not reconstruct
  dependency addresses from Docker bridge IPs, kind gateway IPs, host guesses, or
  hand-edited manifests;
- public URLs must not be reused for container-internal or Kubernetes-internal
  dependency access unless the contract explicitly says so;
- deploy fails before rollout when a required address cannot be rendered or
  verified.

Substrate-to-Kubernetes bindings must cover PostgreSQL, MongoDB, Redis, MinIO,
and Keycloak through explicit service/endpoint bindings or verified DNS
semantics. Selectorless `Service` plus `EndpointSlice` / `Endpoints` is the
default target for port-specific health and diagnostics.

For the Docker substrate binding, `SUBSTRATE_*_PORT` in the substrate truth is
the Docker/external target port used by the `EndpointSlice`. The Kubernetes
`Service` port remains the dependency native port: PostgreSQL `5432`, MongoDB
`27017`, Redis `6379`, MinIO `9000`, and Keycloak `8080`. App `ConfigMap` /
`Secret` values and internal JuiceFS mount overrides consume the Service/native
ports; browser-facing Keycloak base and issuer values continue to come from the
public Keycloak truth.

## API Single-Replica Boundary

`api replicas=1` is a hard milestone boundary.

Reasons:

- runner WebSocket ownership is currently API-process-local;
- live Agent task dispatch and cancel handlers are API-process-local;
- terminal live sessions and replay rings are API-process-local;
- task SSE fanout is API-process-local;
- sticky browser sessions do not solve runner socket ownership because browser
  and runner are different clients.

Required guards:

- templates render `api` Deployment `spec.replicas: 1`;
- render tests reject `api replicas > 1`;
- live deploy checks prove the applied `api` Deployment remains at one replica;
- HPA/KEDA or any autoscaler targeting `api` is forbidden;
- no execution-gateway resource, env var, route, or user-facing concept is
  introduced.

Future multi-replica API support requires a separate architecture milestone.

## Non-Goals

This v2 target does not include:

- execution-gateway;
- API horizontal scaling or high availability;
- Kubernetes deployment of PostgreSQL, MongoDB, Redis, MinIO, or Keycloak;
- Keycloak operator or cloud IdP provisioning automation;
- BYO-substrate provider abstraction;
- llmup source build or model-provider feature expansion;
- Traefik adoption or ingress-controller abstraction;
- runner product model redesign;
- removal of current-v1 `demo-deploy` / `cluster-deploy` docs before v2
  implementation evidence exists.

## Completion Evidence Contract

This section is target-v2 completion criteria only. It does not make this file
current runtime truth.

Milestone completion evidence must include machine-readable reports that
separate these sections:

- substrate status and redacted substrate truth fingerprint;
- rendered app manifest fingerprint and resource summary;
- app rollout status for `web`, `api`, `llmup`, and sandbox-manager;
- ingress route probes for `/api/public/workspaces`, `/api/v1/me/profile`, and
  `/api/v1/agent-execution/ws`;
- llmup config/health proof, including app-owned config, app-owned secret
  consumption, `/health` readiness/liveness, and rollout status;
- product verification matrix.

The existing-cluster smoke producer is required evidence for the
`existing-cluster` profile, but it is not sufficient product verification. Route
smoke must not be reported as passed product flow evidence.

The product verification matrix is passed only when focused evidence exists for
all of these flows:

| Product flow | Required evidence input |
| --- | --- |
| login/profile | Authenticated login/profile backend-real or e2e evidence |
| workspace/project | Workspace/project backend-real or e2e evidence |
| Chat via llmup | Evidence proving API to llmup to provider path |
| Agent task managed runner | Managed runner Agent task backend-real evidence |
| Files | Object storage and file-library backend-real evidence |
| audit | Audit evidence tied to key deploy/product actions |
| usage | Usage evidence tied to key deploy/product actions |

If any product flow is not backed by focused evidence, the unified deploy
verification report must mark that flow as required but not passed.

## Transition Rules

During migration:

- current-v1 contracts remain active truth with explicit boundary notes;
- target-v2 docs may define the destination topology;
- target-v2 docs must not require current-v1 docs to remove `demo-deploy`,
  `cluster-deploy`, `simple`, `full`, `semi-auto`, `full-auto`, Compose app
  services, or current universal-proxy placement while those scripts/manifests
  remain active;
- legacy deployment terms may appear only in current-v1 specs, migration
  mappings, negative checks, cleanup evidence, script names during migration, or
  historical docs.

Milestone closure must switch the contracts index and current-baseline routing
before this file is treated as current runtime truth.
