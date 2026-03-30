# Substrate Governance And Runtime Lines v1

Status: `authoritative`  
Last updated: 2026-03-30

This document is the authoritative engineering contract for AgentSmith local runtime lines, deployment rehearsal lines, and substrate lifecycle management.

It defines exactly three runtime concepts:

- `substrate`
- `app`
- `scenario`

No additional top-level runtime abstraction is allowed in current engineering guidance.

## 1. Core model

### 1.1 `substrate`

`substrate` is the managed dependency base that AgentSmith connects to.

Current default substrate members:

- PostgreSQL
- MongoDB
- Redis
- MinIO
- Keycloak
- universal-proxy

`substrate` owns:

- start / stop
- destructive reset
- reseed of minimum required data
- connection truth generation
- health status

`substrate` does not own:

- API / Web / runner processes
- notebook demo resources
- bootstrap / verify / report workflows
- cluster admin handoff

### 1.2 `app`

`app` is the AgentSmith runtime that consumes a substrate.

Current app members may include:

- API
- Web
- external runner
- sandbox manager when a scenario needs it

`app` must consume the rendered substrate connection truth and must not invent its own dependency addresses.

### 1.3 `scenario`

`scenario` is a thin runtime line such as:

- `local-manual`
- `demo deploy`
- `cluster rehearsal`
- `cluster deploy`

`scenario` only orchestrates:

- which substrate to use
- which app components to start
- whether to run bootstrap / verify / report

`scenario` must not implement substrate lifecycle itself.

## 2. Mandatory command model

### 2.1 Substrate commands

The substrate layer must expose exactly these lifecycle actions:

- `up`
- `down`
- `reset`
- `reseed`
- `status`

Canonical shell entrypoints:

- `scripts/substrate/up.sh`
- `scripts/substrate/down.sh`
- `scripts/substrate/reset.sh`
- `scripts/substrate/reseed.sh`
- `scripts/substrate/status.sh`

### 2.2 Action meanings

`up`

- starts substrate runtime
- writes current connection truth
- does not create scenario-specific business resources

`down`

- stops substrate runtime
- preserves substrate data

`reset`

- stops substrate runtime
- clears substrate data and substrate-managed runtime state
- is destructive

`reseed`

- rebuilds minimum required data on a reachable substrate
- must be idempotent

`status`

- reports substrate runtime and connection truth status

## 3. Connection truth contract

Every substrate must render exactly one authoritative connection file:

- `artifacts/runtime/substrate/<name>/connection.env`

This file is the only supported source of dependency truth for `app`.

At minimum it must include:

- `DATABASE_URL`
- `MONGO_URL`
- `MONGO_DB_NAME`
- `REDIS_URL`
- `MINIO_ENDPOINT`
- `MINIO_PORT`
- `MINIO_USE_SSL`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET`
- `KEYCLOAK_BASE_URL`
- `KEYCLOAK_REALM`
- `KEYCLOAK_CLIENT_ID`
- `KEYCLOAK_ISSUER_URL`
- `MBOS_UNIVERSAL_PROXY_BASE_URL`

Rules:

- `app` must read this file
- `scenario` must not reconstruct these values manually
- future substrate implementations may change, but `connection.env` remains the stable app contract

## 4. Seed contract

`reseed` must be independent from `reset`.

`reseed` must ensure:

- PostgreSQL schema
- pgvector extension
- MinIO bucket
- Keycloak realm and required users/clients
- default workspace truth
- current preset defaults required for minimum manual testing

`reseed` must not create:

- notebook demo projects
- external agent demo resources
- scenario-specific bootstrap artifacts

## 5. Scenario isolation rule

On one host, current engineering only supports one active scenario at a time.

This is a deliberate governance rule to reduce:

- port conflicts
- docker volume conflicts
- kind or cluster rehearsal contamination
- hidden state reuse
- developer cognitive load

Scenario commands must fail fast if another scenario is already marked active.

## 6. Runtime-line rules

### 6.1 `local-manual`

`local-manual` is the current recommended real local manual-test line.

It must:

- call substrate lifecycle commands
- start app processes against substrate connection truth
- optionally seed notebook demo resources

It must not:

- directly manage dependency docker services
- hide substrate reuse behind long-lived env switches

### 6.2 `demo deploy`

`demo deploy` remains the demo / single-host release line.

Its compose-based substrate must be governed by the substrate layer.

Its scenario-specific logic may still manage:

- local kind cluster
- sandbox simulation
- deploy/bootstrap/verify/report flow

### 6.3 `cluster rehearsal`

`cluster rehearsal` must be a first-class scenario, not an informal local convention.

Its compose-based substrate must also be governed by the substrate layer.

### 6.4 `cluster deploy`

`cluster deploy` remains the real-cluster release line.

Its target-host compose substrate must be governed by the substrate layer.

It may still own:

- registry publishing
- admin handoff
- cluster prerequisite installation
- namespaced sandbox deployment
- bootstrap / verify / report

## 7. Explicit prohibitions

The following are forbidden:

- a scenario implementing its own substrate lifecycle
- app startup scripts inventing dependency connection values outside `connection.env`
- using `reset` when the required action is `reseed`
- keeping long-lived hidden substrate reuse switches such as environment toggles that bypass lifecycle control
- default support for multiple active scenarios on one machine
- adding a second substrate management path outside `scripts/substrate/`

## 8. Implementation baseline

Current implementation baseline for this contract:

- compose-managed local substrate is the first complete implementation
- future `external` or `k8s` substrate variants may be added later
- those variants must still follow the same command meanings and `connection.env` contract

If code, scripts, or runbooks disagree with this document, the implementation must be corrected to follow this document.
