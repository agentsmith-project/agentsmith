# Files Frontend Module Contract

Terminology note:
- Product name: `Files`
- Canonical route: `/files`

Applies to:
`src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/files`

## 1. Module Boundaries

- Route page
  - validates URL params
  - applies permission gate
  - renders `FilesPage`
- Composition root
  - `src/components/files/FilesPage.tsx`
  - orchestrates libraries list, object browser, details panel, dialogs
- State and behavior hooks
  - `src/lib/hooks/use-files-url-state.ts`
  - `src/components/files/hooks/use-file-library-manager.ts`
  - `src/components/files/hooks/use-file-folder-move-manager.ts`
  - `src/components/files/hooks/use-file-upload-manager.ts`
  - `src/components/files/hooks/use-file-batch-operations.ts`

## 2. Functional Contract

- Module scope is object storage management only.
- Library is the top-level grouping concept.
- Supported capabilities:
  - library create/rename/delete
  - folder navigation (prefix-based)
  - upload/download
  - rename/move
  - delete (single/batch)
  - multi-select
  - detail panel + preview + share-link
- Out of scope:
  - AIReady
  - indexing/docdb/vectordb
  - plugin processing

## 3. State Contract

- `library_id` is URL-synced source of truth.
- browse/search/sort/selection are session-scoped and in-memory.
- Switching libraries in the current session restores in-session library state.
- Refresh or leaving the module resets browse/search/sort/selection.

## 4. UX Contract

- Object browser is the primary interaction surface.
- Sorting is header-click driven (`name`, `size`, `modified_at`).
- Search is scoped to current folder.
- Multi-select is explicit:
  - `Ctrl/Cmd + click` and `Shift + click` for range
  - `Esc` exits multi-select
- Batch action row must not cause layout jump.
- Details panel uses non-technical wording (`object path`).

## 5. Backend Contract Linkage

- API and payload rules are defined in:
  - `docs/contracts/files-object-browser-contract.md`
- Frontend behavior must stay aligned with that contract.

## 6. Test Contract

- Unit tests:
  - route validation and permission checks
  - manager hooks for mutation orchestration and failure handling
- Integration/E2E:
  - MinIO-backed flows for create folder, upload, rename/move, delete, download
  - UTF-8 filename integrity
  - nested prefix correctness
  - share-link generation and copy
