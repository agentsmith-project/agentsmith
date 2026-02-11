# Sources Frontend Module Map (2026-02-10)

This document defines the closeout baseline and next decomposition targets for:
`src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/sources`.

## 1. Current State

- Route page is already thin:
- validates route params
- applies permission gate (`project:source:use`)
- delegates to `src/components/sources/SourcesPage.tsx`
- UI composition is already split into compound components under `src/components/sources/*`.
- Key state/behavior has been extracted into focused hooks:
- `src/lib/hooks/use-sources-url-state.ts` (URL-synced library/prefix/search/sort)
- `src/components/sources/hooks/use-source-upload-manager.ts` (upload queue, drag-drop, conflict flow)
- `src/components/sources/hooks/use-source-batch-operations.ts` (batch delete/download + retry workflow)
- Remaining complexity is still concentrated in `src/components/sources/SourcesPage.tsx` (dialog orchestration + render tree).

## 2. Module Responsibilities

- `sources/page.tsx`
- Route gate + input validation only.

- `src/components/sources/SourcesPage.tsx`
- Compound composition layer (header, toolbar, virtualized object list, dialogs, pagination).

- `src/lib/hooks/use-sources-url-state.ts`
- URL state source of truth (`library_id`, `prefix`, `search`, `sort_by`, `sort_order`).

- `src/components/sources/hooks/use-source-upload-manager.ts`
- Upload queue, progress/cancel, drag-drop target, conflict resolution.

- `src/components/sources/hooks/use-source-batch-operations.ts`
- Batch delete/download and failed-key retry dialog semantics.

- `src/components/sources/hooks/use-source-library-manager.ts`
- Library create/rename/delete dialog state and mutation orchestration.

- `src/components/sources/hooks/use-source-folder-move-manager.ts`
- Create-folder, rename/move, destination picker, and conflict-overwrite flow orchestration.

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
- Result: passed (21/21)

- Visual baseline:
- `npm run test:e2e -- --project=visual e2e/visual.spec.ts --grep "sources"`
- Result: passed (1/1)

## 5. Next Closeout Steps

1. Replace the current “file list + AIReady” UX with an **object browser** UX (MinIO-like).
2. Update frontend-backend contract per `docs/contracts/sources-object-browser-contract.md` and keep MSW handlers aligned.
3. Refactor the orchestration hook into focused hooks (names are targets, not hard requirements):
- `use-source-libraries` (list/create/rename/delete libraries)
- `use-sources-url-state` (selected library/current prefix/search/sort with URL sync)
- `use-source-objects` (list objects/prefixes, pagination token)
- `use-source-upload-manager` (upload queue, drag-drop, conflict resolution)
- `use-source-library-manager` (library lifecycle dialogs + actions)
- `use-source-folder-move-manager` (create-folder + rename/move + destination picker)
- `use-source-object-actions` (create folder, rename/move, delete, download)
4. Keep details panel productized:
- default `Overview` tab for non-technical users
- `Technical` tab for key/meta operations
- in-panel preview for image/pdf/text via existing download endpoint
5. Keep file manager interaction discoverable:
- selected-row summary in toolbar (`count + clear`)
- drag-and-drop upload target on object table area
- batch download for selected files
- up-navigation button for non-root prefixes
- upload conflict resolution dialog (overwrite vs keep-both rename)
 - upload progress strip with cancel action
 - batch-result dialog with failed key retry (delete/download)
 - continuation-token infinite pagination + virtualized list rendering (`react-virtuoso`)
 - backend-driven search/sort query for object list (no client-only filtering drift)
 - toolbar sorting controls (`sort_by` + `sort_order`) are first-class query inputs
 - selected library, folder location, and query preferences are URL-synced (`library_id`, `prefix`, `search`, `sort_by`, `sort_order`) for refresh/share reproducibility
 - URL sync implementation is centralized in `src/lib/hooks/use-sources-url-state.ts` (single source of truth)
6. Replace/refresh test baselines:
- Unit tests for each extracted hook and key components.
- E2E `e2e/sources.spec.ts` updated to the new UX and stable testids.
- Visual scenario updated (`visual --grep "sources"`).
