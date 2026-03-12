# Model Catalog and Project Pricing Contract

## Purpose

Define the authoritative contract for model/provider catalog lifecycle in AgentSmith.

This contract replaces development-time-only sync as the primary operating mode.

## Scope

- Model/provider catalog ingestion from `https://models.dev/api.json`
- Cold-start initialization from in-repo seed snapshot when catalog storage is empty
- Catalog versioning, activation, rollback, and auditability
- Endpoint CRUD dependency on catalog data for provider/model selection

## Non-Scope

- Billing settlement logic
- Dynamic per-tenant custom pricing formulas
- Non-LLM provider asset governance

## Source of Truth

1. Active catalog version in Mongo is the source of truth.
2. Seed snapshot in repo is bootstrap-only truth when DB is empty.
3. Frontend must not directly consume `models.dev` or local generated catalog JSON as authority.

## External Schema Baseline

Upstream reference: `anomalyco/models.dev` (`packages/core/src/schema.ts`).

Required compatibility assumptions:

- Top-level payload shape is `Record<providerId, Provider>`.
- `Provider.models` shape is `Record<modelId, Model>`.
- Model cost fields may be partial and include extended keys (`reasoning`, `cache_read`, `cache_write`, `input_audio`, `output_audio`, `context_over_200k`).
- Date fields use `YYYY-MM` or `YYYY-MM-DD`.
- Unknown additive fields from upstream must not break ingestion.

## Persistence Contract

Required collections:

- `model_catalog_providers`
- `model_catalog_models`
- `model_catalog_versions`
- `model_catalog_sync_jobs`
- `model_catalog_metadata`

Core invariants:

- One and only one active version at a time.
- `provider_id + model_id` unique within a version.
- Version activation is atomic (no partially visible state).
- All sync/activation/rollback actions are auditable.

## Cold-Start Initialization Contract

On service startup:

1. Check whether model catalog is empty.
2. If empty, import repo seed snapshot (`seed/models-dev.api.seed.json`) through the same validation and normalization pipeline used by remote sync.
3. Activate imported seed version.
4. Record initialization event in `model_catalog_sync_jobs` with source `seed_bootstrap`.

Failure behavior:

- Service must remain alive.
- Admin surfaces must expose `catalog_uninitialized` status.
- Endpoint provider/model panel must be blocked with actionable error until catalog becomes available.

## Model Catalog Sync Contract

Admin-triggered sync workflow:

1. Fetch remote payload.
2. Validate against internal normalized schema compatible with upstream baseline.
3. Normalize records (provider/model flattening, capability derivation, pricing normalization).
4. Persist as staged version.
5. Produce diff summary against active version.
6. Activate explicitly (or keep staged pending review by policy).

Hard requirements:

- No direct overwrite of active version.
- Idempotent job execution by request token.
- Retry-safe writes.

## Endpoint CRUD Integration Contract

Endpoint create/update flows must:

- Read provider/model options from model catalog APIs only.
- Persist selected `provider_id`, `model_id`, and declared compatibility interface.
- Display model limits/capabilities/pricing using catalog data.
- Render "price unavailable" when source has no pricing, never default to zero.

Custom endpoint rules:

- Custom endpoint remains allowed.
- Custom endpoint must declare compatibility interface explicitly.
- If custom endpoint model matches catalog entry, system may auto-hydrate metadata but must keep provenance.

## Model Config API Contract (Required)

- `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/model-catalog/providers`
- `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/model-catalog/models`
- `POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/model-catalog/sync`

Contract alignment checks:

- `docs/contracts/specs/openapi.json` must include all three paths.
- `docs/contracts/specs/openapi-route-kind-map.json` must map all three route kinds.
- `npm run contracts:check-openapi` must pass before merge.

Permission boundary:

- Catalog sync: `project:manage`
- Catalog read for endpoint forms: existing endpoint read/manage permissions

## Governance Evidence Contract

Each catalog sync must emit:

- source URL and fetch checksum/hash
- parsed provider/model counts
- validation errors/warnings
- diff summary (added/removed/changed models and pricing changes)
- operator identity and timestamps

Contract requirement:

- Catalog-related evidence artifacts must include latest successful catalog sync evidence or explicit waiver.

## Testing Contract

Minimum required checks:

- Type/contract: schema validation + API contract checks
- Unit: normalizer, capability inference, pricing mapping, empty/partial field handling
- Integration: cold-start bootstrap, remote sync success/failure, activate/rollback atomicity
- E2E/smoke: admin sync -> activate -> endpoint create flow with new catalog data
- Regression: catalog unavailable and degraded modes

## Migration Rule

Temporary workflow (`npm run models:sync-catalog` + static catalog JSON) is transitional and must not be treated as authoritative once model catalog APIs are enabled.
