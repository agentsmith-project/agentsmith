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
  - File states: save points, direct restore operations, and task file template publication
  - connector routes remain disabled and are not shown as product actions

## 2. Functional Contract

- Module scope is file library management and file browsing.
- A file library is a project-scoped HOME payload file set. When it is bound to
  an Agent task, that HOME payload is the task HOME; unbound or released file
  libraries are not described as a specific task HOME.
- The file browser opens the file library HOME root by default. `workspace/` is
  a normal child folder and the default task runtime working directory, not the
  Files browser root.
- Supported capabilities:
  - file library create/update/delete
  - browse directories and files
  - upload/download
  - rename/move
  - delete (single/batch)
  - multi-select
  - view file library storage readiness using product-safe status fields
  - create save points for the whole file library HOME payload
  - confirm and start a direct restore operation against a save point
  - publish/unpublish/delete task file templates from the current file library HOME payload
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
- A file library may be attached to at most one undeleted task. Stopping,
  ending, failing, or closing a task run does not release the attachment. The
  library becomes reusable only after task deletion and backend release/drain
  reach a reusable terminal state.
- Reusing a released file library carries over HOME payload files only,
  including files under `workspace/.artifacts/` when present. It must not carry
  over task messages, traces, terminal sessions, runner bindings, active leases,
  artifact metadata, Project secrets, tickets, managed OAuth credentials, or
  storage/control metadata.
- Implementation detail: the current DTO field names are:
  - `task_home_binding_status: unbound | bound`
  - `bound_task_visible` controls whether task summary fields may be shown
  - `bound_task_id`, `bound_task_title`, and `bound_task_status` must only be rendered when `bound_task_visible` is true
- Files must not infer task workspace attachment from the task list.
- Save points, direct restore operations, and task file templates are backend-owned state; the frontend displays API results and never derives restore readiness locally.
- The normal restore path must not create hidden current-state save points or
  product-level preview records. Users who want to keep current files must cancel
  restore and create an explicit save point first.
- Published task file templates capture the file state at publish time. Later
  source library changes, unpublish, or template delete do not mutate already
  cloned task file libraries.

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
- Dot folders are visible when the backend lists them. The frontend must not
  apply a generic dot-folder hide filter. Examples such as `.codex/`,
  `.agents/`, `.mbos/`, `.cache/`, `.config/`, and `.local/` are common
  runtime/system folders, not guaranteed contents of every HOME.
- Known top-level runtime/system dot folders must be labeled as
  runtime/system folders. Destructive actions such as delete, move, and rename
  must require a second confirmation, or be disabled when a backend typed
  blocker says the folder/library is protected or in use.
- File states copy must describe the scope as the whole file library HOME
  payload, including runtime/system folders when present; it must not teach
  users to manage implementation folders directly.
- Restore operation pending states must not be presented as success. The UI shows
  restoring/converging copy until the backend reaches a terminal success or
  typed failure state.
- Task creation copy must call published templates `task file templates`.
- Typed blocker copy must distinguish capability denied, project file storage
  not ready, operation/restore pending, library in use, out-of-date restore state,
  and active writer/session blockers. Do not collapse all blockers into
  "contact an administrator"; only non-retryable storage readiness or capability
  configuration states should suggest administrator action.

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
  - HOME root default browsing and "dot folder exists => visible" behavior
  - whole-HOME save point and direct restore operation round trip, including pending success timing
  - direct restore does not create hidden current-state save points in ordinary save point lists
  - task file template publish-time snapshot and clone independence
  - template internal source save point is absent from ordinary recovery lists
  - file library binding exclusivity, release after task delete, and reuse without old task state
  - out-of-date restore state is handled with typed copy
  - active writer/session blocks direct restore with typed copy
  - known top-level runtime/system dot folder destructive guard
  - typed blocker copy for capability denied, storage not ready, restore pending, and library in use; capability denied may stay at component/error-mapping coverage unless the UI path is stable and non-racy
