# Sources Frontend Module Map (2026-02-10)

This document defines the closeout baseline and next decomposition targets for:
`src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/sources`.

## 1. Current State

- Route page is already thin:
- validates route params
- applies permission gate (`project:source:use`)
- delegates to `src/components/sources/SourcesPage.tsx`
- UI composition is already split into compound components under `src/components/sources/*`.
- Primary remaining complexity is concentrated in:
- `src/lib/hooks/use-sources-list.ts` (large orchestration hook, ~400+ LOC).

## 2. Module Responsibilities

- `sources/page.tsx`
- Route gate + input validation only.

- `src/components/sources/SourcesPage.tsx`
- Compound composition layer (header, toolbar, table, dialogs, pagination).

- `src/components/sources/SourcesContext.tsx`
- Context boundary for page subcomponents.

- `src/lib/hooks/use-sources-list.ts`
- Business orchestration (query params, selection state, upload/delete/batch actions, quota checks).

## 3. Guardrails

- Keep route page thin; do not move business logic back into route.
- Keep business side effects in hooks.
- Keep permission checks explicit and fail-fast.
- Maintain stable `data-testid` contract used by `e2e/sources.spec.ts`.
- No temporary fallback flags.

## 4. Verification Baseline (Completed)

- Route unit baseline:
- `npm test -- 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/sources/__tests__/page.test.tsx'`
- Result: passed (3/3)

- E2E behavior baseline:
- `npm run test:e2e -- e2e/sources.spec.ts --project=chromium --workers=1`
- Result: passed (15/15)

- Visual baseline:
- `npm run test:e2e -- --project=visual e2e/visual.spec.ts --grep "sources"`
- Result: passed (1/1)

## 5. Next Closeout Steps

1. Split `use-sources-list.ts` into focused hooks:
- `use-sources-query-state`
- `use-sources-upload-actions`
- `use-sources-batch-actions`
- `use-sources-library-actions`
2. Add focused hook tests for each extracted hook.
3. Keep `SourcesPage.tsx` as composition-only view layer.
4. Keep `e2e/sources.spec.ts` and visual source page scenario green after each step.
