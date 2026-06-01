# Unified Deploy Contract

Status: `current_deploy_contract`
Owner: Product + Engineering
Last updated: 2026-05-31

## Authority

This document is the current deployment contract for AgentSmith. It defines the
deployment topology, deployment vocabulary, address truth, and release evidence
shape used by the current development line.

AgentSmith has one deployment model: `AgentSmith deploy`. In the pre-GA split,
AgentSmith owns only its product image closure, managed runner image adoption
truth, local complete test evidence, and handoff readiness inputs. AgentSmith
does not produce a deployment/package/operator release verdict.

The formal release contract vocabulary is three machine axes:

- `target_cluster`
- `substrate_source`
- `distribution`

Operator-facing release language is simpler and must stay at the four-quadrant
level:

| Operator selection | Internal machine values |
| --- | --- |
| `online` + `use_existing` | `target_cluster=existing_kubernetes`, `substrate_source=external_declared`, `distribution=online` |
| `online` + `kit_provided` | `target_cluster=existing_kubernetes`, `substrate_source=kit_installed`, `distribution=online` |
| `airgap` + `use_existing` | `target_cluster=existing_kubernetes`, `substrate_source=external_declared`, `distribution=airgap` |
| `airgap` + `kit_provided` | `target_cluster=existing_kubernetes`, `substrate_source=kit_installed`, `distribution=airgap` |

Pre-GA diagnostic names such as `local-kind` and `existing-cluster` are not
authoritative release axes. They can appear only as temporary AgentSmith
diagnostic entry names or migration references, and must map into the machine
axes above before release-kit evidence or handoff artifacts are produced.

## Formal Release Model And P0 Handoff Boundary

Current Docker-only local-kind unified deploy remains only the current
AgentSmith pre-GA/local diagnostic rehearsal baseline, not a formal release
target and not long-term deployment truth. `external_declared` in P0 is schema,
fixture, validator, and evidence boundary only. It does not mean P2/P3 completed
real Kubernetes, cloud, or airgap handoff support.

The current `local-kind`, `existing-cluster`, and product-flow deploy evidence
chain is transition-only focused diagnostic evidence / 过渡期专项诊断 only.
AgentSmith `npm run product:ready` is the human product-side readiness and
handoff input check; read-only inspection uses `npm run product:status`. It does
not execute or require this deploy evidence chain. `npm run release:ready` /
`npm run release:status` remain deprecated transition aliases only.
Deployment/package/operator release verdict ownership belongs to release-kit
repo-local gates and evidence.

Release-kit handoff plans must use operator-facing language for the deployment
choice: `online` / `airgap` distribution against both substrate strategies:

- `use_existing`: connect to operator-provided substrates or cloud interfaces
  such as PostgreSQL/pgvector, MongoDB, Redis, S3-compatible storage, and
  Keycloak/OIDC.
- `kit_provided`: the release-kit-supplied minimal/adjacent substrate pack,
  connection truth, routability proof, and materiality validation. It does not
  install substrates.

The corresponding internal machine values are `distribution=online|airgap` and
`substrate_source=external_declared|kit_installed`. These machine values are for
release contract / evidence validation, not a second operator vocabulary.

`kit_provided` does not mean AgentSmith or release-kit installs substrates, does
not move substrate lifecycle into the AgentSmith product repo, does not create a
cloud provider matrix, and does not imply cloud cluster/database/bucket/IAM/network
provisioning. It is the current release-kit provided validation path for a
minimal adjacent substrate pack plus connection truth, pod-routability proof, and
materiality proof. A real `install_substrates` path is a future capability and
requires a separate release-kit installer producer plus an explicit installer
confirmation flag.

`kind` is only an optional local substrate/rehearsal option. It is not a formal
release target, not the production default, and cannot replace existing
Kubernetes/cloud or airgap evidence.

Because the project is still pre-GA, old profile vocabulary is not a long-term
formal path. The only temporary mapping owner is the AgentSmith release-boundary
adapter, the deletion trigger is P2/P6 removal or hiding of these active
diagnostic workflows after release-kit repo-local gates own deployment verdicts,
and evidence is `contracts:check-unified-deploy-vocabulary` plus
`contracts:check-current-verification-campaigns` proving mixed vocabulary and
synonym drift fail fast.

## Runtime Topology

### Docker Substrate

The current AgentSmith-owned diagnostic substrate implementation is
Docker-only. It runs outside Kubernetes and contains dependency services only:

- PostgreSQL
- MongoDB
- Redis
- MinIO
- Keycloak

The diagnostic substrate module owns dependency lifecycle, destructive reset,
dependency health, dependency readiness reseed, and one authoritative substrate
connection truth file consumed by app deployment diagnostics.

The substrate module does not own AgentSmith `web`, `api`, `llmup`, the
internal sandbox execution service (ASBCP), runner workloads, Kubernetes app manifests, product bootstrap,
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
- internal sandbox execution service (`agentsmith-sandbox-control-plane`, ASBCP)
- managed Agent task runner deployment configuration and runtime support
- Kubernetes `Deployment`, `Service`, `Ingress`, `ConfigMap`, `Secret`,
  service account, role, and role binding resources required by those components

ASBCP is a deployment/internal backend dependency, not a product-facing route,
system management surface, or browser-visible concept. ASBCP URL/key values are
server/deploy/internal-gate only and must not be rendered as `NEXT_PUBLIC_*`,
browser bundle values, UI messages, i18n keys, or user-guide troubleshooting
steps.

### ASBCP Consumer And Adoption

ASBCP adoption in AgentSmith is image consumption only; ASBCP release, API
schema, and provider operations remain ASBCP-repo-owned.

`infra/deploy/shared/asbcp-image.lock` is the AgentSmith input. It contains
`asbcp_version`, `asbcp_source_image`, `asbcp_release_url`, and
`asbcp_commit_sha`. The version, image tag, release URL tag, and commit SHA must
match the same ASBCP release, and `asbcp_source_image` must include an immutable
`@sha256` digest.

During release adoption, compare the ASBCP GitHub Release asset
`asbcp-final-manifest.json` with the lock: version/tag, source image digest,
release URL tag, and commit SHA must match. ASBCP API contract version truth
lives in that manifest, not in the AgentSmith lock.

Formal CI evidence is produced by the Release Contract Artifact workflow. That
workflow reads `infra/deploy/shared/asbcp-image.lock`, resolves the pinned ASBCP
GitHub release, downloads the release asset `asbcp-final-manifest.json`,
compares the GitHub asset digest with the downloaded file SHA256 when GitHub
provides one, runs the explicit ASBCP adoption checker against the downloaded
manifest, and uploads
`asbcp-final-manifest-source.json` as a source receipt beside the release
contract artifact. The receipt records release/asset metadata, downloaded
SHA256, and checker result; the full ASBCP final manifest is not embedded in the
AgentSmith release contract schema.

Default `npm run contracts:check` remains network-free. It runs only
`npm run contracts:check-asbcp-image-only` for ASBCP lock shape and terminology
guarding; it does not call GitHub and does not prove final manifest adoption.
Offline or airgap adoption must use a predownloaded
`asbcp-final-manifest.json` with the explicit adoption checker command below, or
consume the CI-produced source receipt.

Lock update/adoption procedure:

- Download the target release asset `asbcp-final-manifest.json`.
- Update `infra/deploy/shared/asbcp-image.lock` from the release tag, digest,
  release URL, and commit; do not add API contract version to the lock.
- Run `ASBCP_FINAL_MANIFEST=<downloaded-asbcp-final-manifest.json> npm run contracts:check-asbcp-adoption`, or
  `npm run contracts:check-asbcp-manifest-lock -- --manifest <downloaded-asbcp-final-manifest.json>`.
- Keep downloaded manifests as local evidence inputs when useful, but do not
  treat checked-in fixtures as release adoption proof. The adoption gate must
  read the authoritative downloaded release manifest.
- A lock-only adoption change fails the explicit adoption gate when it does not
  provide an authoritative manifest input or equivalent CI evidence that ran the
  same check. The image-only shape guard can still pass for ordinary lock
  syntax; it is not release adoption proof.
- `infra/deploy/unified/env/site.env.example` intentionally keeps a blank
  `ASBCP_SERVICE_KEY=` entry so offline render can generate or inject a secret.
  The tracked example must not contain a real or placeholder secret value.

Minimal focused diagnostics after a lock/adoption change are:

- `npm run contracts:check-asbcp-image-only`
- `ASBCP_FINAL_MANIFEST=<downloaded-asbcp-final-manifest.json> npm run contracts:check-asbcp-adoption`
- `npm run test:unified-deploy:local-kind:images:unit`
- `npm run test:unified-deploy:render` for the static template contract
- `npm run test:unified-deploy:render -- --profile=local-kind --site-env=<generated-local-kind-site-env>` when proving local-kind image adoption against generated digest refs
- `npm run test:unified-deploy:render -- --profile=existing-cluster --site-env=<generated-existing-cluster-site-env>` when proving existing-cluster image adoption against generated digest refs
- `npm run test:unified-deploy:address-truth`

The `local-kind` / `existing-cluster` names in these commands are pre-GA
diagnostic entry names only. They do not define release-kit handoff authority;
formal artifacts must use `target_cluster` / `substrate_source` / `distribution`.

Ordinary lock adoption does not require rerunning the Agent task/workload main
chain.

If the backend-real/local-real launcher path changes, also prove launcher image
identity against the same locked digest before using Agent task runtime smoke as
behavioral evidence. Stage rehearsal or release signing may additionally run
the heavier runtime path.

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
while API still consumes those names, but rendered app configuration points to
the internal app-managed `llmup` service. Substrate connection truth must not
contain llmup service addresses.

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

## Release Kit Handoff

AgentSmith release contract output is the handoff from product build truth to
release-kit deploy execution. The handoff is not a release verdict. It contains
AgentSmith product image truth, managed runner image truth, dynamic image
closure through `deploy_image_inventory`, local complete / product-side
readiness evidence pointers, and template package truth.

The release contract must include `deploy_template_digest` and the required
`deploy_template_package` field. The package records the deploy template package
URI, package sha256, manifest sha256, machine-readable `required_image_ids`, and
provenance. Active image truth is the dynamic image closure:
`deploy_template_package.required_image_ids` must be an exact subset of image
IDs present in `deploy_image_inventory` and must cover rendered template image
references. Fixed six-image or seven-image lists are historical slice evidence,
not current contract truth.

Release kit reads the release contract, `deploy_template_package`, generated
artifacts, and operator inputs. It must not infer AgentSmith product source
paths, import product packages, or create a second image inventory.

Release kit owns online/airgap publishing, release package tests, deploy gates,
operator runbooks, and the deployment/package/operator verdict. For both
`online` and `airgap`, release-kit gates must cover both substrate strategies,
`use_existing` and `kit_provided`. Each release run must explicitly select
the intended strategy; neither strategy may silently fall back to Docker-only
local diagnostics.

In machine artifacts this selection is represented only by
`target_cluster` / `substrate_source` / `distribution`. Pre-GA names such as
`local-kind` and `existing-cluster` are not formal authority for release-kit
handoff or deployment evidence.

## Completion Evidence

Deploy diagnostic evidence separates these sections:

- substrate status and redacted substrate truth fingerprint;
- rendered app manifest fingerprint and resource summary;
- app rollout status for `web`, `api`, `llmup`, and the internal sandbox execution service (ASBCP);
- ingress route probes for `/api/public/workspaces`, `/api/v1/me/profile`, and
  `/api/v1/agent-execution/ws`;
- llmup config/health proof, including app-owned config, app-owned secret
  consumption, `/health` readiness/liveness, and rollout status;
- product verification matrix.

The pre-GA `existing-cluster` smoke producer proves diagnostic routing and
rollout ownership only. It is not a formal release target and is not sufficient
product verification.

The current deploy diagnostic product proof is passed only when focused
evidence exists for the canonical seven-flow deployed product smoke matrix. It
remains a transition-only focused diagnostic and is not a formal release,
deploy, package, or operator verdict.

| Product flow | Required evidence input |
| --- | --- |
| login/profile | Authenticated login/profile backend-real or e2e evidence |
| workspace/project | Workspace/project backend-real or e2e evidence |
| Chat via llmup | Chat backend-real evidence proving API -> llmup -> provider path |
| Agent task managed runner | Managed runner Agent task backend-real evidence |
| Files | Object storage and file-library backend-real evidence |
| audit | Audit evidence tied to deploy/product actions |
| usage | Usage evidence tied to deploy/product actions |

The product-flow aggregate must also bind each required flow to its focused
evidence file through `flow_evidence_paths`; counting arbitrary JSON files is
not deploy diagnostic evidence.

These flows are deploy diagnostic product smoke evidence only. They do not make
unified deploy a product readiness entrypoint or release target.

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
