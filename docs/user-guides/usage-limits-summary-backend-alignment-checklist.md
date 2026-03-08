# Usage Limits Summary Backend Alignment Checklist

Last updated: 2026-03-08  
Owner: Frontend + Backend

## Purpose

Provide an executable alignment path from `usage-limits-summary-contract.md` to backend implementation and release verification.

## Preconditions

1. Read contract: `docs/contracts/usage-limits-summary-contract.md`.
2. Confirm MVP scope: project-level endpoint governance only.
3. Confirm terminology: only `rate limit` / `spending limit`.

## Step 1: API Schema Alignment

Target endpoint:

- `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/limits/summary`

Required payload support:

1. endpoint rows expose `limit_total` or `limit_limit`.
2. aggregate exposes `total_limit` or `total_limit_limit`.
3. preferred fields exposed for matrix rendering:
   - `limit_kind: rate_limit | spending_limit`
   - `window_key: minute | 5h | day | current`
   - `limit_key` (policy key traceability)

## Step 2: Backend Logic Alignment

1. Build endpoint rows by effective policy windows and current usage counters.
2. Emit one row per endpoint + limit dimension (not only one aggregated row per endpoint).
3. Keep compatibility fields for old FE consumers during transition.

## Step 3: OpenAPI & Generated Types

Run:

```bash
npm run contracts:check-openapi
npm run openapi:check-generated
```

Expected:

1. `LimitOverview` / `LimitSummary` schema reflects fields above.
2. No breaking change without allowlist update.

## Step 4: Mock & Fixture Alignment

1. Update MSW or fixture payload to include:
   - at least one endpoint with `rate_limit` rows (`minute`, `day`)
   - at least one endpoint with `spending_limit` row (`day`)
2. Keep one compatibility fixture without `limit_kind/window_key` to verify FE fallback.

## Step 5: Frontend Rendering Verification

Verify Usage page behavior:

1. endpoint-grouped cards render correctly.
2. each endpoint shows `rate limit` and `spending limit` sections.
3. window rows render in order: `minute` -> `5h` -> `day` -> `current`.
4. fallback payload renders `current` row without crashing.

## Step 6: Test & Release Gates

Run:

```bash
npm run lint
npx tsc --noEmit
npm test -- --run \
  src/components/audit-usage/__tests__/UsagePage.test.tsx \
  src/lib/api/__tests__/audit-usage-api.test.ts
```

Optional visual confirmation:

```bash
npm run test:e2e:lane:mock:visual:update
```

## Definition of Done

1. Contract + OpenAPI + FE rendering are mutually consistent.
2. Usage remains low-cognitive personal view (no admin troubleshooting actions).
3. No `quota` naming in UI/contracts for this path.
