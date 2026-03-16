# Files Frontend Module Contract

Terminology note:
- Product name: `Files`
- Canonical route: `/files`
- Top-level resource: `file library`

Applies to:
`src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/files`

## 1. Module Boundaries

- Route page
  - validates URL params
  - applies permission gate
  - renders `FilesPage`
- Composition root
  - `src/components/files/FilesPage.tsx`
  - orchestrates file library list, browser surface, details panel, dialogs
- State and behavior hooks
  - URL state
  - file library CRUD
  - file entry browsing and mutation
  - local mount instructions and credential exchange

## 2. Functional Contract

- Module scope is file library management and file browsing.
- A file library is a project-scoped JuiceFS filesystem.
- Supported capabilities:
  - file library create/update/delete
  - browse directories and files
  - upload/download
  - rename/move
  - delete (single/batch)
  - multi-select
  - view file library runtime status
  - reveal local mount instructions
  - request storage credential exchange
- Out of scope:
  - docdb/vectordb workflows
  - plugin processing
  - backend credential rotation

## 3. State Contract

- `file_library_id` is the URL-synced source of truth.
- browse/search/sort/selection are session-scoped and in-memory.
- switching libraries in the current session restores in-session file browser state.
- refresh or leaving the module resets browser-local state.
- file library runtime state (`creating`, `ready`, `degraded`, `failed`, `deleting`) is backend-owned truth.

## 4. UX Contract

- File library list is the entry surface.
- File browser is the primary interaction surface once a library is selected.
- Sorting is header-click driven (`name`, `size`, `modified_at`).
- Search is scoped to the current folder.
- Multi-select is explicit:
  - `Ctrl/Cmd + click` and `Shift + click` for range
  - `Esc` exits multi-select
- Batch action row must not cause layout jump.
- The module must expose a clear mount panel for Linux/macOS/Windows local mount commands.

## 5. Backend Contract Linkage

- Architecture and runtime truth:
  - `docs/contracts/juicefs-file-libraries-architecture.md`
- The frontend must align with `file-libraries` APIs and credential exchange.

## 6. Test Contract

- Unit tests:
  - route validation and permission checks
  - file library CRUD orchestration
  - credential exchange panel behavior
- Integration/E2E:
  - file library create/delete lifecycle
  - browse/upload/rename/move/delete/download
  - UTF-8 filename integrity
  - nested directory correctness
  - degraded/failed runtime state handling
