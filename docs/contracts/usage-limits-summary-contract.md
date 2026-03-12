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
4. It must preserve a low-cognitive personal view: per-endpoint, per-window visibility first.
5. It must not require frontend to synthesize a cross-endpoint total because `requests` and `usd` are not safely aggregatable into a single personal planning signal.

## Endpoint

- `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/limits/summary`

## Response Contract

### Final shape (single source of truth)

Top-level fields:

1. `endpoints: EndpointLimitSummary[]`
2. `project_summary?: ProjectLimitSummary`

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

`ProjectLimitSummary` (optional, backend-owned only):

1. `project_used: number`
2. `project_max: number`
3. `project_remaining: number`
4. `project_usage_pct: number`

Constraints:

1. Frontend must not derive `project_summary` by summing endpoint rows across mixed metrics.
2. If backend cannot provide a semantically valid project summary, it should omit this field.
3. Frontend primary rendering must remain useful without `project_summary`.

## FE Rendering Contract

Usage limits area must render:

1. endpoint-grouped cards (one card per endpoint);
2. two fixed groups inside each card:
   - `rate limit`
   - `spending limit`
3. per-group window rows (`minute`/`5h`/`day`/`current`);
4. direct consumption signals for the current user (`used` / `max` / `remaining` / `usage_pct`);
5. no admin-only audit/runtime troubleshooting controls.
6. no frontend-generated cross-endpoint aggregate progress bar as a required element.

## Source of Truth

1. `GET /limits/summary` is the canonical data source for Usage limit visibility.
2. Resource policy is a governance/configuration surface, not the primary user-facing source of consumption truth.
3. Any temporary fallback from resource policy must be treated as diagnostic/configuration projection only, not as live remaining capacity.

## Non-goals

1. No new `quota` terminology.
2. No workspace-level governance summary.
3. No release/devops orchestration semantics.
4. No cross-endpoint "overall remaining limit" synthesized in frontend.
