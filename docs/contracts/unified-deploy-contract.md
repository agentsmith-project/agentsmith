# Unified Deploy Contract

Status: `current_deploy_contract`
Owner: Product + Engineering
Last updated: 2026-05-07

## Authority

This document is the current deployment contract for AgentSmith. It defines the
deployment topology, deployment vocabulary, address truth, and release evidence
shape used by the current development line.

AgentSmith has one deployment model: `AgentSmith deploy`.

Deployment profiles describe environment preparation only:

- `local-kind`: Docker substrate plus a local kind cluster for app workloads.
- `existing-cluster`: operator-provided Kubernetes namespace and prerequisites,
  consuming the same declared substrate truth shape.

Profiles are not separate products, release lines, or UI objects.

## Runtime Topology

### Docker Substrate

The supported substrate implementation is Docker-only. It runs outside
Kubernetes and contains dependency services only:

- PostgreSQL
- MongoDB
- Redis
- MinIO
- Keycloak

The substrate module owns dependency lifecycle, destructive reset, dependency
health, dependency readiness reseed, and one authoritative substrate connection
truth file consumed by app deployment.

The substrate module does not own AgentSmith `web`, `api`, `llmup`,
sandbox-manager, runner workloads, Kubernetes app manifests, product bootstrap,
release verification, or release reports.

### Keycloak

Keycloak is substrate.

- The supported path runs Keycloak in the Docker substrate module.
- AgentSmith app pods consume Keycloak as an external identity service.
- App deployment must not silently mutate Keycloak realm, client, hostname,
  redirect, issuer, or TLS settings.

### AgentSmith App

The AgentSmith app runs in Kubernetes.

App components are:

- `web`
- `api`
- `llmup`
- sandbox-manager
- managed Agent task runner deployment configuration and runtime support
- Kubernetes `Deployment`, `Service`, `Ingress`, `ConfigMap`, `Secret`,
  service account, role, and role binding resources required by those components

`api` is fixed to `replicas=1`. There is no API replica operator setting, and
autoscalers targeting `api` are forbidden.

### llmup

`llmup` is app-managed.

App-managed means deployment ownership:

- `llmup` is deployed as an AgentSmith app Kubernetes workload.
- API calls `llmup` through an internal Kubernetes service.
- app `Secret` and `ConfigMap` rendering own llmup admin/config values.

App-managed does not mean AgentSmith owns llmup source code, source builds, or
model-provider feature expansion. A pinned external llmup image/version may
remain a release input.

Existing protocol/env names such as `MBOS_UNIVERSAL_PROXY_BASE_URL` may remain
for API compatibility, but rendered app configuration points to the internal
app-managed `llmup` service. Substrate connection truth must not contain llmup
service addresses.

## Ingress And Routing

The ingress model exposes AgentSmith through one public entry strategy.

Required route ownership:

- `/` or the configured web host routes to `web`.
- `/api/v1` routes to `api`.
- runner and terminal WebSocket paths under `/api/v1` route to `api`.
- `/api/public` routes to `web`.
- `/api/system` routes to `web`.
- `llmup` is internal by default and is not exposed publicly.

An independent API host may be used instead of path routing when an operator
chooses host-based separation, but route ownership stays the same.

Keycloak may be exposed through the same ingress boundary only when the
substrate Keycloak public issuer requires it and deploy configuration explicitly
declares that ownership. App templates must not infer Keycloak public hostname,
issuer, redirects, TLS, or realm/client settings.

Ingress acceptance must probe:

- `GET /api/public/workspaces` reaches `web`.
- authenticated `GET /api/v1/me/profile` reaches `api`.
- runner WebSocket upgrade under `/api/v1/agent-execution/ws` reaches `api`.

## Address And Configuration Truth

Operators edit one deploy configuration source. Generated env files, Kubernetes
manifests, `ConfigMap`s, and `Secret`s are not operator-editable truth.

Address truth is separated by consumer role:

- public browser access
- API internal service access
- Kubernetes workload to substrate access
- Keycloak public issuer and internal fetch access
- client-visible file-library object access and URL access
- runner-visible execution access

Rules:

- app pods consume generated Kubernetes config and secret values;
- app deployment consumes substrate connection truth and must not reconstruct
  dependency addresses from Docker bridge IPs, kind gateway IPs, host guesses, or
  hand-edited manifests;
- public URLs must not be reused for container-internal or Kubernetes-internal
  dependency access unless this contract explicitly says so;
- deploy fails before rollout when a required address cannot be rendered or
  verified.

Substrate-to-Kubernetes bindings cover PostgreSQL, MongoDB, Redis, MinIO, and
Keycloak through explicit service/endpoint bindings or verified DNS semantics.
Selectorless `Service` plus `EndpointSlice` / `Endpoints` is the default for
port-specific health and diagnostics.

AFSCP deployment owns only the AFSCP image, Service, worker, and export gateway
surface. Internal storage-engine binaries such as JVS are packaged and verified
by the AFSCP image/release; AgentSmith deploy manifests must not configure their
paths, hashes, working directories, or runtime control settings.

For Docker substrate binding, `SUBSTRATE_*_PORT` in substrate truth is the
Docker/external target port used by the `EndpointSlice`. The Kubernetes
`Service` port remains the dependency native port: PostgreSQL `5432`, MongoDB
`27017`, Redis `6379`, MinIO `9000`, and Keycloak `8080`.

## API Single-Replica Boundary

`api replicas=1` is a hard current boundary because these live execution paths
are API-process-local:

- runner WebSocket ownership;
- live Agent task dispatch and cancel handlers;
- terminal live sessions and replay rings;
- task SSE fanout.

Required guards:

- templates render `api` Deployment `spec.replicas: 1`;
- render tests reject `api replicas > 1`;
- live deploy checks prove the applied `api` Deployment remains at one replica;
- HPA/KEDA or any autoscaler targeting `api` is forbidden;
- no execution-gateway resource, env var, route, or user-facing concept is
  introduced.

Multi-replica API support requires a separate architecture plan.

## Completion Evidence

Release evidence separates these sections:

- substrate status and redacted substrate truth fingerprint;
- rendered app manifest fingerprint and resource summary;
- app rollout status for `web`, `api`, `llmup`, and sandbox-manager;
- ingress route probes for `/api/public/workspaces`, `/api/v1/me/profile`, and
  `/api/v1/agent-execution/ws`;
- llmup config/health proof, including app-owned config, app-owned secret
  consumption, `/health` readiness/liveness, and rollout status;
- product verification matrix.

The `existing-cluster` smoke producer proves profile routing and rollout
ownership only. It is not sufficient product verification.

The current release deploy product proof is passed only when focused evidence
exists for these required flows:

| Product flow | Required evidence input |
| --- | --- |
| workspace/project | Workspace/project backend-real or e2e evidence |
| Agent task managed runner | Managed runner Agent task backend-real evidence |
| Files | Object storage and file-library backend-real evidence |

The product-flow aggregate must also bind each required flow to its focused
evidence file through `flow_evidence_paths`; counting arbitrary JSON files is
not release evidence.

`login/profile`, Chat via llmup, audit, and usage remain product diagnostics
covered by their own verification surfaces. They are not part of the current
minimal unified deploy release proof unless the release scope explicitly changes
the required product-flow set.

## Out Of Scope

The current deployment contract does not include:

- no execution-gateway;
- API horizontal scaling or high availability;
- Kubernetes deployment of PostgreSQL, MongoDB, Redis, MinIO, or Keycloak;
- Keycloak operator or cloud IdP provisioning automation;
- BYO-substrate provider abstraction;
- llmup source build or model-provider feature expansion;
- Traefik adoption or ingress-controller abstraction;
- runner product model redesign.
