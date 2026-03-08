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

### Final shape (single source of truth)

Top-level fields:

1. `endpoints: EndpointLimitSummary[]`
2. `project_summary: ProjectLimitSummary`

`EndpointLimitSummary`:

1. `endpoint_id: string`
2. `endpoint_name: string`
3. `limits: LimitRuleSnapshot[]`

`LimitRuleSnapshot`:

1. `kind: "rate_limit" | "spending_limit"`
2. `window: "minute" | "5h" | "day" | "current"`
3. `metric: "requests" | "usd"`
4. `policy_key: string`
5. `used: number`
6. `max: number`
7. `remaining: number`
8. `usage_pct: number`
9. `reset_at: string (date-time)`

`ProjectLimitSummary`:

1. `project_used: number`
2. `project_max: number`
3. `project_remaining: number`
4. `project_usage_pct: number`

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
