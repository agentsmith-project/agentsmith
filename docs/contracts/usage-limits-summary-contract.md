# Usage Limits Summary Contract (MVP)

Last updated: 2026-03-08  
Owner: Frontend + Backend

## Purpose

Define the contract between backend `GET /limits/summary` and frontend `Usage` page rendering for endpoint-scoped limit visibility.

## Scope

1. Project-scoped usage only (`workspace + project`).
2. Resource scope in MVP: `endpoint` only for governance semantics.
3. UI target: low-cognitive personal usage view (not admin audit/troubleshooting).

## Product Boundary

1. This contract is for usage evidence projection only.
2. It does not introduce new governance objects.
3. It does not introduce workspace/global aggregation semantics.

## Endpoint

- `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/limits/summary`

## Response Contract

### Preferred shape (target)

`endpoints[]` should provide one row per endpoint + limit dimension:

1. `resource_id: string`
2. `resource_name: string`
3. `resource_type: "endpoint"`
4. `limit_used: number`
5. `limit_total` (or `limit_limit` for compatibility): number
6. `limit_unit: "requests" | "tokens" | "bytes" | "files"`
7. `percentage_used: number`
8. `limit_reset_at: string (date-time)`
9. `limit_kind: "rate_limit" | "spending_limit"` (recommended)
10. `window_key: "minute" | "5h" | "day" | "current"` (recommended)
11. `limit_key: string` (recommended, e.g. `endpoint.requests_per_minute`)

Top-level aggregate fields:

1. `total_limit_used: number`
2. `total_limit` (or `total_limit_limit` for compatibility): number

### Compatibility fallback (current tolerated)

If backend returns only aggregated endpoint rows without `limit_kind/window_key/limit_key`, FE must:

1. render per-endpoint cards anyway;
2. map row to `window_key = current`;
3. infer `limit_kind` conservatively from available fields (prefer explicit backend fields once available).

## FE Rendering Contract

Usage limits area must render:

1. endpoint-grouped cards (one card per endpoint);
2. two fixed groups inside each card:
   - `rate limit`
   - `spending limit`
3. per-group window rows (`minute`/`5h`/`day`/`current`);
4. no admin-only audit/runtime troubleshooting controls.

## Non-goals

1. No new `quota` terminology.
2. No workspace-level governance summary.
3. No release/devops orchestration semantics.

