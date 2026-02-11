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

## 2.1 Scope Update (Effective Immediately)

The Sources module is being reworked to be a MinIO Console-like object browser and file manager:

- **Libraries** remain the primary grouping concept in the UI.
- Backend storage uses a shared MinIO/S3 bucket, and each library maps to a stable `object_prefix`.
- The UI must support folders (prefixes), breadcrumb navigation, upload/download, create folder, rename/move, delete, multi-select, and a details panel.

Out of scope for this phase:

- **AIReady** / indexing / docdb / vectordb processing.
- Any "plugin processing" logic. That will be introduced later behind a finalized plugin contract.

Contract source of truth for this rewrite:

- `docs/contracts/sources-object-browser-contract.md`

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

1. Replace the current “file list + AIReady” UX with an **object browser** UX (MinIO-like).
2. Update frontend-backend contract per `docs/contracts/sources-object-browser-contract.md` and keep MSW handlers aligned.
3. Refactor the orchestration hook into focused hooks (names are targets, not hard requirements):
- `use-source-libraries` (list/create/rename/delete libraries)
- `use-source-browser-state` (selected library, current prefix, view mode, selection)
- `use-source-objects` (list objects/prefixes, pagination token)
- `use-source-object-actions` (upload, create folder, rename/move, delete, download)
4. Replace/refresh test baselines:
- Unit tests for each extracted hook and key components.
- E2E `e2e/sources.spec.ts` updated to the new UX and stable testids.
- Visual scenario updated (`visual --grep "sources"`).
