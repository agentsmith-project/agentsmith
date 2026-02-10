# Endpoints Frontend Module Map (2026-02-10)

This document defines the closeout baseline and decomposition plan for:
`src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/endpoints/page.tsx`.

## 1. Current State

- The route currently centralizes:
- route param resolution and permission gates
- query/mutation wiring
- table column/action definitions
- import/export payload UX
- create/edit/delete dialogs and status toggling
- Current implementation works, but page-level responsibility is too broad.

## 2. Target Module Boundaries

- `page.tsx`
- Keep only route param validation, permission gates, and top-level composition.

- `src/lib/endpoints/use-endpoints-data.ts`
- Own list query and loading/error data model.

- `src/lib/endpoints/use-endpoints-mutations.ts`
- Own create/update/delete/import mutations and query invalidation.

- `src/lib/endpoints/use-endpoints-table-columns.tsx`
- Own table column factory and row action binding.

- `src/components/endpoints/EndpointsPage.tsx`
- Presentational composition for toolbar + table + dialogs.

- `src/components/endpoints/ImportEndpointsDialog.tsx`
- Isolate import payload parse/validation/submit UX.

## 3. Guardrails

- Business logic and side effects go to hooks, not page component.
- Keep permission checks explicit:
- read: `project:endpoint:use` or `project:endpoint:manage`
- mutate: `project:endpoint:manage`
- No compatibility fallback flags.
- Fail fast on invalid payload and invalid route params.
- Preserve stable test IDs for e2e selectors.

## 4. Verification Baseline (Completed)

- Unit route baseline:
- `npm test -- 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/endpoints/__tests__/page.test.tsx'`
- Result: passed (4/4)

- E2E behavior baseline:
- `npm run test:e2e -- e2e/endpoints.spec.ts --project=chromium --workers=1`
- Result: passed (10/10)

## 5. Next Closeout Steps

1. Extract `EndpointsPage` presentational component from route page.
2. Move mutation/query orchestration to `src/lib/endpoints/*` hooks.
3. Extract table columns into dedicated module with typed callbacks.
4. Add focused hook unit tests for import/update/delete flows.
5. Keep `e2e/endpoints.spec.ts` green and add one visual snapshot test for endpoints page.
