# Usage / Audit / Runtime MVP Release Checklist

Last updated: 2026-03-08  
Owner: Frontend

## 1. Scope Gate (must pass)

1. `usage` remains personal usage only (no admin troubleshooting actions).
2. `audit` remains admin-wide investigation and governance entry.
3. `runtime` remains technical observability/diagnostics (not user usage home).
4. Resource governance terminology uses only `rate limit` and `spending limit`.

## 2. Contract Gate (must pass)

Run:

```bash
npm run contracts:check
npm run contracts:check-openapi
npm run openapi:check-generated
```

Expected:

1. No permission gate regressions.
2. OpenAPI coverage/breaking checks pass.
3. Generated API types are in sync.

## 3. Quality Gate (must pass)

Run:

```bash
npm run lint
npx tsc --noEmit
npm test -- --run \
  src/lib/constants/__tests__/usage-i18n-boundary.test.ts \
  src/lib/constants/__tests__/limit-terminology-boundary.test.ts \
  src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/__tests__/page.test.tsx \
  src/lib/api/__tests__/governance-explainability-api.test.ts \
  src/lib/hooks/__tests__/use-governance-explainability.test.tsx \
  src/lib/hooks/__tests__/use-files-list.test.tsx \
  src/lib/audit/__tests__/audit-standardization.test.ts
```

Expected:

1. Lint/type/test all green.
2. No `quota` reintroduction in core source.

## 4. E2E Gate (must pass)

Run:

```bash
npm run test:e2e
```

Expected:

1. Smoke/chromium functional cases pass (default CI release gate).
2. Visual cases are either:
   - baseline exists and diff within threshold, or
   - approved baseline refresh is completed in the same PR.

## 5. Visual Baseline Handling

If visual fails because baseline is missing or intentionally changed:

1. Regenerate approved screenshots.
   ```bash
   npm run test:e2e:lane:mock:visual:update
   ```
2. Review `audit` and `usage` full-page outputs for low-cognitive readability and role separation.
3. Commit updated snapshots with explicit note:
   - `visual baseline update: usage/audit/notebook`.

## 6. Release Notes (required)

Include:

1. Naming migration summary (`quota` -> `rate limit` / `spending limit`).
2. Usage/Audit/Runtime boundary confirmation.
3. Any known non-blocking risks (if visual baseline intentionally deferred).
