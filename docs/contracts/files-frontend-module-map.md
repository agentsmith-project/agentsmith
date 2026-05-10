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
  - File states: save points, restore preview/run/cancel, and task file template publication
  - connector routes remain disabled and are not shown as product actions

## 2. Functional Contract

- Module scope is file library management and file browsing.
- A file library is a project-scoped resource for task workspace files.
- Supported capabilities:
  - file library create/update/delete
  - browse directories and files
  - upload/download
  - rename/move
  - delete (single/batch)
  - multi-select
  - view file library storage readiness using product-safe status fields
  - create save points for the whole task workspace file set
  - preview, cancel, and run restore operations against a save point
  - publish/unpublish/delete task file templates from the current task workspace file set
- Out of scope:
  - docdb/vectordb workflows
  - plugin processing
  - backend credential rotation
  - browser-visible local connector setup
  - file-level policy or independent task/chat quota controls

## 3. State Contract

- `file_library_id` is the URL-synced source of truth.
- browse/search/sort/selection are session-scoped and in-memory.
- switching libraries in the current session restores in-session file browser state.
- refresh or leaving the module resets browser-local state.
- file library runtime state (`creating`, `ready`, `degraded`, `failed`, `deleting`) is backend-owned truth.
- file library task workspace attachment state is backend-owned truth on the `FileLibrary` DTO.
- Implementation detail: the current DTO field names are:
  - `task_home_binding_status: unbound | bound`
  - `bound_task_visible` controls whether task summary fields may be shown
  - `bound_task_id`, `bound_task_title`, and `bound_task_status` must only be rendered when `bound_task_visible` is true
- Files must not infer task workspace attachment from the task list.
- Save points, restore previews/runs, and task file templates are backend-owned state; the frontend displays API results and never derives restore readiness locally.

## 4. UX Contract

- File library list is the entry surface.
- File browser is the primary interaction surface once a library is selected.
- Sorting is header-click driven (`name`, `size`, `modified_at`).
- Search is scoped to the current folder.
- Multi-select is explicit:
  - `Ctrl/Cmd + click` and `Shift + click` for range
  - `Esc` exits multi-select
- Batch action row must not cause layout jump.
- The module must not expose local connector setup, backend storage identifiers, export URLs, credentials, or local setup commands.
- Bound libraries must be labeled in the library list. Deleting a bound library is blocked until the bound task is deleted; redacted bound tasks must not leak title/id/status.
- Members with read/use access may browse and download project files.
- New folder, File states, Upload, Rename, Delete, and library mutation controls require `project:files:update` and must be hidden or unusable without that permission.
- File states copy must describe the scope as the whole task workspace file set, including system folders; it must not teach users to manage implementation folders directly.
- Task creation copy must call published templates `task file templates`.

## 5. Backend Contract Linkage

- Architecture and runtime truth:
  - `docs/contracts/afscp-file-libraries-architecture.md`
- The frontend must align with current `file-libraries` APIs. Local connector routes are not part of the product contract.

## 6. Test Contract

- Unit tests:
  - route validation and permission checks
  - file library CRUD orchestration
  - connector entry points stay absent from the Files product UI
- Integration/E2E:
  - file library create/delete lifecycle
  - browse/upload/rename/move/delete/download
  - UTF-8 filename integrity
  - nested directory correctness
  - degraded/failed runtime state handling
