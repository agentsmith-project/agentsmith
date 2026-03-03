# Endpoints Runtime Catalog Refactor Plan (No Schedule)

## Objective

Refactor endpoint provider/model management from development-time static catalog to runtime-governed catalog, with cold-start seed initialization and admin-controlled sync lifecycle.

## Product Features and Requirements

## A. Runtime Catalog Management

1. Admin can trigger catalog sync from `https://models.dev/api.json`.
2. System stores synced result in Mongo as versioned data.
3. Admin can inspect sync jobs, diffs, and validation outcomes.
4. Admin can activate a staged version and rollback to prior version.
5. System shows current active catalog version and data health.

## B. Cold-Start Bootstrap

1. Repo includes one seed snapshot of latest known API DB for development bootstrap.
2. On startup, if runtime catalog is empty, system imports seed automatically.
3. Bootstrap import uses same validation/normalization/activation pipeline as remote sync.
4. Bootstrap result is auditable and visible in admin job list.

## C. Endpoint CRUD Experience

1. Provider/model pickers use runtime catalog APIs as the only source.
2. UI shows model context window, max output, capability tags, and pricing details.
3. Missing pricing is shown explicitly as unavailable.
4. Endpoint records store provider/model identity and declared compatibility interface.
5. Custom endpoint remains supported with explicit protocol declaration.

## D. Governance and Operational Control

1. Sync/activate/rollback actions are permission-gated and audited.
2. Activation is atomic and recoverable.
3. Catalog failure modes are surfaced to admin and block unsafe endpoint creation paths.
4. Release evidence includes latest sync/activation state.

## Technical Route

## 1. Data Layer

Introduce versioned catalog collections:

- `model_catalog_providers`
- `model_catalog_models`
- `model_catalog_versions`
- `model_catalog_sync_jobs`
- `model_catalog_metadata`

Technical requirements:

- version-aware indexes
- provider/model identity uniqueness by version
- active version pointer
- safe transaction boundary or equivalent atomic switch strategy

## 2. Ingestion Pipeline

Pipeline stages:

1. fetch
2. validate
3. normalize
4. stage
5. diff
6. activate (explicit)

Validation/normalization requirements:

- tolerate additive upstream fields
- enforce required core fields for endpoint UI and routing
- normalize dates/cost/limit/capabilities into internal shape

## 3. API Layer

Add admin and consumer APIs:

- admin sync/version/job lifecycle
- provider/model query endpoints for endpoint form

Contract requirements:

- stable error codes
- idempotency key support for sync trigger
- pagination/filtering for model list

## 4. Frontend Layer

Endpoint module changes:

- replace static `provider-catalog` authority with runtime query hooks
- provider/model selector uses active catalog version
- pricing/capability/context display from runtime catalog fields
- proper loading/empty/degraded states and i18n coverage

Admin console additions:

- catalog sync actions
- job timeline and diff view
- version activation and rollback controls

## 5. Governance and Observability

Required telemetry:

- sync duration
- fetch/parse/validation failure rates
- activated version id changes
- endpoint creation blocked by catalog state

Required audit facts:

- who triggered sync
- what changed
- when version switched

## 6. Compatibility and Migration

Migration strategy:

1. keep legacy static assets as fallback seed source during transition
2. enable runtime catalog APIs
3. switch endpoint CRUD readers to runtime APIs
4. deprecate development-time sync dependency from normal operations

Compatibility guardrails:

- preserve existing endpoint protocol fields
- do not break existing endpoint records lacking catalog linkage
- backfill metadata opportunistically and safely

## Verification Requirements

## Contract/Type

- ingestion schema guards
- admin API contract coverage

## Unit

- normalizer and diff engine
- cost/limit/capability parsing
- seed bootstrap decision logic

## Integration

- empty DB bootstrap import
- remote sync success/failure
- activate/rollback data consistency

## E2E/Smoke

- admin sync and activate flow
- endpoint creation from refreshed catalog
- degraded catalog behavior and user messaging

## Deliverables

1. Runtime catalog governance contract updates in `docs/contracts/`.
2. API contract additions in OpenAPI and generated type sync.
3. Endpoint CRUD UI integration against runtime catalog APIs.
4. Admin catalog management UI and evidence outputs.
5. Test suites and release gate checklist updates.
