# AFSCP File Library Runtime Rearchitecture Plan

Status: decision-complete handoff for the next development milestone.

Owner: AgentSmith product and engineering.

Primary input: File Library storage runtime uses the AFSCP runtime image selected by unified deploy env `AFSCP_IMAGE`; the current example default is `ghcr.io/agentsmith-project/agentsmith-fs-control-plane:v1.0.5`, and release evidence must prove the selected tag/digest is usable. AgentSmith remains the product authority for workspace/project, permissions, file library catalog, task binding, task file template availability, UX, and audit projection.

## 1. Executive Summary

The requirement is reasonable and directionally correct.

AgentSmith File Library storage runtime uses AFSCP shared JuiceFS-backed volumes, namespace-scoped repos, save points, restore, templates, exports, workload mount bindings, operations, and audit. AgentSmith does not model per-file-library metadata databases, buckets, or managed gateways as product truth.

The target shape is:

- AgentSmith users still see `Files`, `file libraries`, `Agent tasks`, `task workspaces`, `save points`, and task file templates published to a project.
- AgentSmith stores product catalog, display names, ownership, project permissions, task binding, task file template availability, and UX state.
- AFSCP stores and executes storage truth: volume, namespace binding, repo, save point, restore plan, template clone, export session, workload mount binding, operation, and low-level audit.
- One deployment-wide or policy-selected shared JuiceFS volume can host many AgentSmith project namespaces and file library repos.
- File Library must faithfully show the user-visible file library HOME/repo
  payload contents, including dot folders created by agent/runtime/user activity.
  When the library is bound to a task, that HOME is the task HOME. It must not
  silently hide normal dot folders.
- Task file templates are published to the current project template library only. They are not shared to individual members or groups in this milestone.
- Project creation and project file-storage readiness are separate states.
  Project create may start the first bootstrap advance, but production
  correctness depends on project-storage preflight and on-demand reconcile.
  Every storage-dependent API must pass preflight first; only `ready` may call
  the product AFSCP adapter to create repos, exports, mount bindings, save
  points, restores, or templates.
- AFSCP is the only AgentSmith storage-control integration boundary. If AFSCP
  uses JVS internally, that is AFSCP implementation and release evidence, not an
  AgentSmith product API, business concept, or acceptance gate. AgentSmith
  deployment may still provide AFSCP contract-required runtime env/volumes, but
  JVS lifecycle and internal semantics remain owned by AFSCP.
- This is a pre-GA current model. AFSCP-backed storage is the only product
  storage path, with no user-visible storage switch or fallback behavior.

This changes the storage authority boundary. Slice 1 establishes the project
storage bootstrap foundation plus the state/preflight boundary. File Library
routes, the Files UI storage adapter, task mount integration, save point/restore,
and template create/clone behavior land in later slices.

## 2. Product Decisions

### 2.1 Product Objects Stay In AgentSmith

AFSCP must not become a user-facing product module.

AgentSmith owns:

- workspace, project, member, group, permission, endpoint, runner, task, and file-library catalog records.
- display names, descriptions, user-facing status, route structure, and i18n text.
- task file template catalog availability.
- task-to-file-library binding rules.
- frontend/backend permission checks.
- user-facing audit projection.

AFSCP owns:

- storage namespace and namespace volume binding.
- shared JuiceFS volume metadata and capability health.
- repo storage identity and lifecycle.
- save point, restore preview/run/discard, and template clone execution,
  including any internal versioned-filesystem implementation.
- export sessions and workload mount bindings.
- low-level operation records and redacted storage audit.

### 2.2 Namespace Mapping

Use one AFSCP namespace per AgentSmith project.

Rationale:

- AgentSmith files and tasks are project-scoped today.
- Project is the natural product permission boundary for Files and Agent tasks.
- AFSCP template clone defaults to same namespace. Project namespace mapping prevents accidental cross-project storage sharing.
- The storage overhead problem is still solved because many namespaces can bind to the same shared AFSCP/JuiceFS volume.

Mapping:

| AgentSmith | AFSCP |
| --- | --- |
| project storage boundary | namespace |
| deployment storage pool | volume |
| file library | repo |
| file library save point | repo save point |
| file library template catalog entry | AgentSmith template metadata + AFSCP repo template |
| task HOME | mounted repo payload root |
| task runtime access | workload mount binding |
| Files web UI access | AFSCP export session used only through AgentSmith backend |
| Files web UI storage access | AgentSmith backend Files UI storage adapter backed by server-side AFSCP WebDAV/export or upstream first-class AFSCP file API |
| user computer/client file access | deferred productized AFSCP WebDAV connector, not required in this milestone and never raw JuiceFS mount |

`workspace` remains the tenant/product grouping in AgentSmith. It may own many project namespaces, all bound to the deployment default AFSCP volume unless a later policy introduces project-specific storage classes.

Namespace IDs must be stable opaque storage IDs, not display names and not URL
slugs. AgentSmith must persist the project-to-AFSCP namespace mapping when the
project storage boundary is first created. Project rename must not change the
AFSCP namespace. Project delete must not assume AFSCP supports namespace delete;
repo/file-library lifecycle must be handled explicitly through repo operations.

Global AFSCP resource ownership invariant:

- Every product resource id that leads to AFSCP access must resolve through
  AgentSmith first: product id -> workspace/project -> product storage
  generation -> lifecycle visibility -> current ready AFSCP namespace and
  resource mapping. The project namespace must be ready for the current
  generation before AgentSmith makes a namespace-scoped AFSCP resource call.
- Every AFSCP resource id consumed by AgentSmith must be mapped back to the
  current `workspace_id/project_id/afscp_namespace_id` before use. This includes
  repo, template, save point, restore plan, export session, workload mount
  binding, operation id, and future namespace-scoped resource ids.
- Product storage generation and lifecycle visibility are part of ownership.
  Stale product resources, stale storage generations, deleting/tombstoned
  resources, and resources whose project storage is not ready must not be used
  as a shortcut to AFSCP access.
- AgentSmith must reject the request before the AFSCP call when the resource is
  not visible in the current product context.
- AFSCP must also reject namespace mismatch for namespace-scoped resource ids.
- Cross-namespace, deleted, or invisible resources return `not_found` to the
  caller. Responses must not reveal that a resource exists in another namespace
  or project.

### 2.3 Product Terminology

Use low-cognitive product terms in UI and API-facing copy:

- AgentSmith `workspace` is the tenant/product grouping that owns projects.
- `workspace/` is the default working directory inside a task HOME payload.
- User-facing copy should prefer `task files`, `file library`, `save point`,
  `restore`, and `task file template`.
- `namespace`, `repo`, `volume`, `mount binding`, and raw operation internals are
  internal stable concepts. They may appear in internal error codes, logs, and
  debug projections after authorization, but not as ordinary user-facing nouns.

### 2.4 File Library HOME Truth And Versioned Scope

For AFSCP-backed file libraries, the user-visible file library root equals the
repo payload root and equals task HOME when the library is bound to a task. The
versioned file-library scope is the whole HOME payload, not only
`$HOME/workspace`.

Common visible shape inside task runtime:

```text
$HOME/                         # AFSCP repo payload root
$HOME/workspace/               # default working directory
$HOME/workspace/.artifacts/    # generated deliverables
$HOME/.codex/
$HOME/.mbos/
$HOME/.agents/
$HOME/.cache/
$HOME/.config/
$HOME/.local/
```

The dot folders above are common runtime/system examples, not a guarantee that
every HOME contains all of them. The product rule is existence-based: if the
backend lists a HOME payload folder or file, including a dot folder, Files shows
it.

The Files page should open the HOME root by default, because it is the file
library root users compare with `cd ~` in the task terminal. `workspace/`
remains visible as an ordinary directory inside HOME and is the default
agent/terminal working directory. Normal dot folders must not be hidden by
generic filtering. Runtime folders such as `.codex`, `.mbos`, `.agents`,
`.cache`, `.config`, and `.local`, when present, should have a low-cognitive UX
guard: known top-level system/runtime folders are labeled as system/runtime
folders, and destructive actions such as delete, move, and rename require
clearer confirmation or are disabled by a backend typed blocker when the
folder/library is protected or in use. Storage-provider
internals are not part of the file-library payload. For AFSCP-managed repos,
internal storage-control metadata must live outside the payload root through
external control-root mode or an equivalent AFSCP-owned mechanism. The payload
HOME must not contain `.jvs` or control-root material. AgentSmith must not make
this true by filtering file listings. If AFSCP cannot guarantee
payload-outside control roots, integration must pause for an upstream fix before
AgentSmith continues.

Save points, restore, and task file templates operate on the whole HOME payload.
This means user-visible runtime/config/cache folders under HOME are file-library
content and are included in file snapshots. Dialog copy must make this scope
explicit: the action covers the whole task file library/HOME, including hidden
agent runtime folders such as `.codex`, `.mbos`, `.agents`, `.cache`, `.config`,
and `.local`, not only the currently opened `workspace/` view. What does not
carry over is non-payload task state: AgentSmith task records, messages, traces,
terminal sessions, runner bindings, active leases, AFSCP/internal
storage-control metadata, tickets, Project secrets, managed OAuth credentials,
service credentials, and other request-scoped secrets.

Whole HOME payload capture includes dot folders. That makes secret handling a
platform boundary, not a UI filtering problem. Platform-controlled secrets and
access material must not be automatically written into the AFSCP repo
payload/HOME: execution tickets, Project secrets, managed OAuth tokens, storage
credentials, WebDAV passwords, AFSCP service credentials, runner connection
secrets, short-lived mount/export credentials, and any managed credential
projection. Runtime integrations must use request-scoped environment variables,
AgentSmith Context Store reads, tmpfs or other non-payload ephemeral projection,
and explicit cache/config path redirection or blocking for tools that would
otherwise persist managed secrets under HOME. This acceptance boundary means
AgentSmith and the platform must not leak or persist managed secrets into HOME.
It does not claim the platform can fully prevent a user or agent from manually
writing secret text into files; such writes become user data risk and should be
handled through product guidance, audit, and future policy controls.

### 2.5 Project Task File Template Publishing

Task file template availability is an AgentSmith project feature, not an AFSCP
authorization feature. In this milestone, the shared availability object is the
current project template library: users publish a task file template to the
current project, and project members with the required project permission may use
it from that project. There is no member template share list, group template ACL,
or per-member/per-group availability rule in this milestone.

AgentSmith stores:

- template display name and description.
- source file library id.
- AFSCP `template_id`.
- creator and created time.
- lifecycle status: draft, published, unpublished, deleting, or failed where needed.
- project availability status for the current project task file template library.

AFSCP enforces:

- same-namespace template clone.
- no raw path or storage credential exposure.
- clone creates an independent repo with a new repo identity.

User-facing behavior:

- Draft templates are shown only in project template management, to the creator
  and to users with `project:files:update`.
- Published templates are shown during task creation only to current project
  members with `project:agent_task:use`.
- Create, edit, delete, publish, and unpublish actions require
  `project:files:update`.
- A project member with `project:agent_task:use` may choose a published task file template when creating a task in the same project namespace.
- AgentSmith validates project permission and template project availability first.
- AgentSmith calls AFSCP to clone the template into a new repo/file library.
- The new task binds to that new file library.
- The new task inherits HOME payload files only. It does not inherit chat history, task events, terminal sessions, active runner state outside HOME, runner binding, Project secrets, tickets, managed OAuth credentials, service credentials, or AFSCP/internal storage-control metadata.
- A task file template is a snapshot source. It is not a live shared folder. Unpublishing a template prevents future clone use but does not modify file libraries already cloned from it.
- Creating a template uses the current file library state by creating a fresh
  internal source save point and then a template. That internal source save
  point is not shown as an ordinary user recovery point. If it appears in
  audit/debug projection, it must be labeled `template source/internal`.
  Creating a template directly from arbitrary older save points is outside this
  milestone unless AFSCP adds an explicit supported contract.

### 2.6 Save Point And Restore

Save point and restore are file-library operations, not task rollback.

Product semantics:

- A save point is a recovery point inside one file library.
- A task file template is a reusable HOME payload snapshot for creating new file libraries/tasks.
- A template does not change when the source file library changes later.
- Restoring a save point changes files in the existing file library; cloning a template creates an independent new file library.

User-facing behavior:

- Users can create a save point from a file library.
- Users can list save points from the file library detail area.
- Users can restore through preview -> confirm restore, or cancel preview and
  leave files unchanged. User-facing copy should say cancel preview leaves files
  unchanged; the backend/AFSCP operation for canceling a preview may be named
  discard preview.
- Restore preview must consume an AFSCP redacted projection that includes affected file library, target save point, restore plan id, blocker state, destructive flags, and a user-readable added/changed/removed summary when the upstream engine can compute it.
- Restore changes files in the file library HOME. It does not change task records, task messages, run traces, audit records, terminal sessions, or runner binding.

Safety behavior:

- Restore-run must fail closed when active or uncertain read-write task/workload/export access exists.
- Restore preview must bind the generated restore plan to the repo base
  revision/generation/head and a writer-session fence token. Restore-run must
  verify that the file library still matches that preview base and fence. If the
  head/generation/fence no longer matches, restore-run fails with a typed stale
  preview state and requires the user to preview again before confirming.
- If restore preview materializes a current-state save point or equivalent
  checkpoint for fence/recovery purposes, it is an internal restore preview
  fence. It must be hidden from ordinary save point lists. If surfaced in
  audit/debug projection, label it `internal/restore preview fence`.
- AgentSmith frontend may explain the blocker, but backend and AFSCP remain the authority. Blocking UX must use typed AFSCP blockers and tell the user the next action: stop the running task, close/release terminal sessions, wait for file operations to finish, or retry later.
- Restore operations must be operation-driven and auditable.
- If AFSCP cannot provide enough redacted preview or blocker detail for a clear UX, that is an upstream contract gap. AgentSmith must not parse raw storage-backend output or inspect private control files to invent the summary.

### 2.7 User Access And WebDAV Connector

Do not keep ordinary raw JuiceFS local mount in the product path.

Current AgentSmith mount instructions expose `metadata_url`, bucket endpoint details, and raw `juicefs mount` commands. That conflicts with AFSCP's boundary: ordinary clients and workloads must not receive JuiceFS root credentials, metadata URLs, bucket credentials, raw mount commands, Secret refs, or control-root details.

Required in this milestone:

- AgentSmith backend uses a Files UI storage adapter to power the
  list/upload/download/create-folder/move/delete operations. The safe
  implementation path can be either an AFSCP server-side WebDAV/export adapter or
  an upstream first-class AFSCP file API; these are equivalent ways to satisfy
  Files UI storage access, not permission to skip the Files UI storage adapter.
- WebDAV/export credentials remain server-side. The frontend receives only
  AgentSmith Files DTOs and never receives AFSCP `access.url`, password,
  redirect URL, export credential, Secret ref, storage path, metadata URL, or
  bucket details.
- Existing raw desktop/local mount UX, docs, and `Connect on my computer`
  entry points must be deleted from this milestone's product surface. Do not
  show disabled/unavailable placeholders for desktop/local mount or computer
  connection. A future WebDAV connector is a separate product surface to design
  in its own milestone; it must not reuse the deleted mount entry or show raw
  JuiceFS commands or storage details.

Deferred from this milestone:

- A user-computer "Connect on my computer" productized WebDAV connector is not a
  required user feature for this handoff.
- If AgentSmith offers a connector UX in a later milestone, it must be a new
  productized AFSCP WebDAV export/connector over the normal web/HTTPS entrypoint
  and must not expose JuiceFS mounts, metadata databases, object buckets, or
  storage service credentials to user computers.

Future productized WebDAV connector requirements:

- short TTL.
- read-only or read-write mode.
- password returned only once.
- revoke support.
- payload-only access.
- control roots stay outside payload; export must never expose `.jvs` or control-root material.
- no raw storage details.
- served through the web/ingress port or an equivalent controlled HTTPS entrypoint.
- stable audit and active-session accounting so restore and lifecycle operations can block active or uncertain writers.
- AgentSmith must revoke or invalidate affected exports when membership changes,
  project access is disabled, file-library visibility changes, the project is
  disabled, or the user explicitly revokes the connector. TTL is not the only
  security boundary.

If the server-side WebDAV adapter proves too slow or semantically weak for Files
UI correctness, the correct follow-up is to request/add a first-class AFSCP file
API. Do not reintroduce raw JuiceFS access.

### 2.8 Authorization Matrix

AgentSmith backend is the end-user authorization authority. AFSCP service auth
does not replace product permission checks. Every operation defaults to deny
unless both the project permission and resource visibility rules allow it.
Current AgentSmith permissions do not define `project:files:read`; Files
read/use follows the existing `project:endpoint:use` contract, while Files
mutations use `project:files:update`.

| Operation | AgentSmith permission and visibility rule |
| --- | --- |
| List/open file libraries | `project:endpoint:use`; returned rows are limited to project-visible libraries |
| Browse/download files | `project:endpoint:use` plus file library visibility in the current project |
| Upload/create folder/move/delete files | `project:files:update` plus file library visible and mutable state |
| Create/update/delete file library | `project:files:update`; delete also requires no current task binding and lifecycle admission |
| Create task with new file library | `project:agent_task:use`; backend creates an internal task HOME file library |
| Create task from published task file template | `project:agent_task:use`; template must be published in the current project namespace |
| Bind existing file library to task | `project:agent_task:use` plus same-actor ownership of a released, ready, unbound task workspace; backend runtime writable affordance is `task_internal_home`, not Files edit permission; explicit Developer runner binding still requires runner-manage affordance |
| Open terminal for bound task | `project:agent_task:use` + `project:agent_task:terminal` plus task visibility |
| Create/list save points | `project:endpoint:use` plus `project:files:update` for create; file library visible |
| Restore preview/confirm/cancel preview | `project:files:update`; file library visible; restore operation state valid; no active/uncertain writer for run; cancel preview maps to backend discard-preview semantics |
| Create/edit/delete task file template draft | `project:files:update`; source file library or template visible in the current project; creator visibility is allowed for own drafts in project template management |
| Publish/unpublish task file template | `project:files:update`; template belongs to the current project namespace |
| List/use task file templates during task creation | `project:agent_task:use`; template is published in the current project |
| Clone task file template into new task | `project:agent_task:use`; template is published in the current project; clone target stays in same project namespace |
| Server-side export for file browser | same permission as the file operation being proxied; no frontend credential exposure |
| Future productized WebDAV connector | deferred; when productized, `project:endpoint:use` for read-only connector, `project:files:update` for read-write connector; file library visible and export policy enabled |
| View storage operation/debug projection | `project:audit:read` plus current project/resource visibility; cross-namespace or invisible operations return not found |

Task file template publishing does not create live shared write access to an
existing file library. If live file-library sharing is later required, it needs a
separate UX, ACL, revocation, audit, and binding-conflict plan.

### 2.9 Async UX States

AFSCP-backed storage operations are durable and may be asynchronous. UI must
handle these states without pretending the operation finished synchronously:

- creating file library.
- ready.
- failed with retry or inspectable reason.
- restore preview pending.
- restoring.
- restore-run accepted but still pending/reconciling; UI must not show success
  until terminal success is observed.
- restore blocked by active writer/session.
- template creating.
- template clone creating file library/task.
- task workspace binding draining/releasing.
- lifecycle deleting/tombstoned/purging where productized.

Disabled controls must explain the missing permission or runtime blocker in
plain language. Use user-facing terms such as file library, task files, save
point, restore, and template; keep AFSCP repo/namespace/volume names out of
ordinary UX.

### 2.10 Current AFSCP Storage Completion Criteria

This is a pre-GA current storage model with no data-carryover requirement for
development/test records outside the AFSCP-backed model.

Required completion decisions:

- AFSCP-backed storage is the only product behavior. No selectable, hidden,
  fallback, or evidence path may use a separate per-file-library JuiceFS
  runtime.
- Delete raw mount UI, raw local desktop mount instructions,
  `metadata_url`/bucket/storage DTO fields, backend loopback gateway assumptions,
  and tests/docs that encode per-file-library JuiceFS as the product truth.
- Fixtures and generated/mock evidence must encode the current AFSCP storage
  truth, including MSW fixtures, e2e fixtures, storybook/story/generated
  fixtures, mock payloads, OpenAPI/generated type fixtures, backend-real evidence
  fixtures, and any fixture that touches `metadata_url`, raw mount, bucket, or
  JuiceFS provider details.
- Local, development, and test file libraries outside the AFSCP-backed model may
  be reset and recreated. This milestone does not design data carryover for
  those dev/test records.
- Implementation may land in slices, but slice acceptance must be based on the
  slice target behavior and evidence. Acceptance evidence must come from the
  current AFSCP-backed product behavior.

### 2.11 Project And Workspace Storage Lifecycle

Project disable/delete and workspace disable/delete must close storage access
through AgentSmith and AFSCP. Do not assume AFSCP namespace delete is available.

Required lifecycle behavior:

- Block new file-library, export, template clone, save point, restore, task
  binding, and runner access for disabled/deleting projects and workspaces.
- Revoke or invalidate active export sessions and workload mount bindings.
- Drain and reconcile active sessions until AFSCP reports no active or uncertain
  writers remain.
- Apply lifecycle policy per repo and template instead of raw filesystem delete.
- Tombstone the AgentSmith project-to-AFSCP namespace mapping after repo/template
  lifecycle has reached the configured terminal state, while preserving enough
  mapping data for audit/debug projection and orphan reconciliation.
- Reconcile orphaned repos, templates, exports, mount bindings, restore plans,
  and operations by stored resource ids, operation ids, and generation keys.
- Cross-namespace or invisible orphan candidates must be treated as `not_found`
  in product APIs and must not leak existence.

### 2.12 Project Storage Bootstrap Saga

Project creation success does not mean project file storage is ready. AgentSmith
must model project storage bootstrap as its own operation-driven saga, because a
project can exist while AFSCP namespace upsert, namespace readiness, and
namespace-volume binding are still pending, retrying, or blocked.

Project create may be the first place AgentSmith advances bootstrap, but it
cannot be the only production entrypoint. Storage-dependent APIs must call a
project-storage preflight/on-demand reconcile entrypoint before any product
AFSCP operation. The preflight either returns a ready project storage context or
a typed pending/retryable/admin-blocked state; handlers must not call the
product AFSCP adapter until the state is `ready`.

AgentSmith stores the project storage state with at least these concepts:

- `project_storage_status`: not started, bootstrapping, ready, retryable failed,
  blocked needs admin, deleting, or tombstoned.
- `project_storage_stage`: namespace upsert, namespace ready, namespace-volume
  binding, binding ready, reconcile, or terminal lifecycle.
- `project_storage_generation`: monotonically changes when the mapping is
  recreated, reconciled, or tombstoned.
- `last_storage_operation_id`: the latest durable AFSCP operation id when AFSCP
  returns one.
- `storage_retryable`: whether AgentSmith can retry or reconcile without
  administrator action.
- `storage_next_action`: wait, retry now, automatic retry scheduled, retry after
  service recovery, or administrator action required.
- `storage_failure_code`: stable internal reason, redacted from ordinary
  user-facing copy.

Unexpected bootstrap exceptions must be collapsed into sanitized storage states
and stable internal error codes. Product responses, ordinary logs, audit
snapshots, tests, and evidence bundles must not echo raw AFSCP responses, raw
paths, tokens, credentials, Secret refs, namespace ids, volume ids, binding ids,
or storage-root details.

Bootstrap stages:

| Stage | Meaning | Operation | Retryability and next action |
| --- | --- | --- | --- |
| `not_started` | Project exists, but storage bootstrap has not started. | none | Retryable; start idempotent bootstrap on project creation worker or first storage-dependent request. |
| `namespace_upserting` | AgentSmith is ensuring the AFSCP namespace mapping for this project generation. | namespace upsert or ensure operation when AFSCP exposes one | Retryable for unavailable/network/timeout; poll or retry with the same idempotency key. |
| `namespace_ready` | AFSCP namespace exists and is ready for the current generation; binding has not completed. | last namespace operation | Retryable; start namespace-volume binding. |
| `binding_upserting` | AgentSmith is ensuring the namespace-volume binding to the deployment default or policy-selected volume. | namespace-volume binding operation | Retryable for unavailable/network/timeout; conflicts, AFSCP service permission failures, missing volume, or invalid config require administrator action. |
| `ready` | Namespace and binding are both ready for the current generation. | latest successful bootstrap operation | Storage-dependent APIs may proceed. |
| `reconciling` | AgentSmith has a stale, unknown, or partially observed bootstrap state. | operation inspection or idempotent ensure | Retryable while AFSCP is unavailable or operation state is unknown; converge from AFSCP operation truth. |
| `retryable_failed` | Bootstrap failed for a transient reason such as AFSCP unavailable, network flap, timeout, or worker crash. | failed or unknown operation | Retryable; UI says project file storage is getting ready or temporarily unavailable. |
| `blocked_needs_admin` | Bootstrap failed because storage policy, service authorization, volume binding conflict, capability, or deployment configuration is invalid. | failed operation with stable reason | Not retryable by ordinary users; UI says project file storage needs administrator attention. |

Namespace upsert and namespace-volume binding are separate stages unless AFSCP
adds an explicit single-operation durable ensure that atomically creates or
confirms both and returns a ready binding. In the current AgentSmith plan,
namespace-volume binding must not start until namespace readiness is confirmed.
If AFSCP later provides the single-operation ensure, AgentSmith may consume that
operation as one bootstrap stage, but must still persist status, generation,
operation, retryability, and next action.

Storage-dependent API handlers may trigger idempotent on-demand reconcile when a
project has no bootstrap attempt, a retryable failure, or stale/unknown operation
state. They must not hide non-retryable conflicts or configuration failures by
looping forever. Ordinary user copy must use low-cognitive terms such as project
file storage, file library, task files, or storage unavailable; it must not
mention namespace, volume, binding, or AFSCP internals.

## 3. Architecture Decisions

### 3.1 Shared Volume Ownership

The actual JuiceFS volume is a deployment/platform resource.

Responsibilities:

| Layer | Responsibility |
| --- | --- |
| Deployment/substrate | install JuiceFS CSI driver, create or configure the shared JuiceFS volume, provide storage-root Secret material to AFSCP only |
| AFSCP | record volume metadata/capabilities, bind namespaces to volumes, resolve repo paths, execute save point/restore/template operations, issue export/mount bindings |
| AgentSmith API | call AFSCP with service identity after product authorization; store only opaque AFSCP IDs |
| Sandbox manager / Kubernetes / CSI | consume AFSCP repo/namespace/destination/TTL-scoped mount plan and SecretRef, then mount repo payload into task pod |
| Runner/task container | see only mounted HOME payload, not storage credentials or control root |

AFSCP `volume ensure` is not a product operation for ordinary users. It should be handled by deployment/bootstrap or a system admin job. AgentSmith project initialization may ensure the project namespace and namespace-volume binding exist through the project storage bootstrap saga.

Bootstrap identity split:

- deployment/bootstrap job owns volume admin and first namespace-volume binding bootstrap through deployment namespace policy.
- AgentSmith product caller owns normal repo, save point, template, export, mount-binding, and operation-inspection calls after product authorization.
- sandbox manager caller owns mount plan retrieval, heartbeat, release, and revoke confirmation.
- ordinary end users never receive AFSCP roles; their permissions are enforced by AgentSmith before any AFSCP call.
- product caller token/caller-service and bootstrap token/caller-service must be
  distinct. AgentSmith must fail fast at startup or configuration load if either
  credential/caller-service is missing, reused across boundaries, or routed to
  the wrong port.

Namespace-volume binding must respect bootstrap stage ordering. AgentSmith does
not advance from namespace upsert to binding until namespace readiness is known,
unless AFSCP exposes a single durable ensure operation that explicitly owns both
steps and returns a binding-ready result.

Sandbox manager/Kubernetes/CSI contract:

- The sandbox manager consumes only AFSCP-issued mount plans scoped to one
  repo/namespace/destination/TTL and the SecretRefs included in that plan.
- The sandbox manager must not persist storage-root credentials, list arbitrary
  Kubernetes Secrets, read Secrets outside the scoped plan, or derive its own
  raw JuiceFS/root mount material.
- The sandbox manager must not expose storage-root material, SecretRefs, raw paths,
  or control-root details to runner/task containers, terminal sessions, logs, or
  AgentSmith product DTOs.

### 3.2 AFSCP Adapter Layer

Add AgentSmith backend ports/adapters instead of spreading raw AFSCP calls
through route handlers.

Boundary requirements:

- Ordinary product route dependencies receive a product AFSCP adapter only. They
  must not receive a raw AFSCP client that can be configured with a bootstrap
  token or bootstrap caller-service.
- Project storage bootstrap code uses an explicit bootstrap port. That port is
  callable only from project creation/bootstrap/reconcile workers or tightly
  scoped system-admin intervention paths, not ordinary product file/task/template
  routes.
- The underlying raw `AfscpClient` is a private implementation detail of these
  ports. It must not be injected directly into route handlers or shared helper
  modules where product routes could bypass the ready-namespace preflight or
  ownership guard.
- Product and bootstrap adapters use distinct credentials and caller-service
  values. AgentSmith fails fast if config points both ports at the same token or
  caller-service.

Adapter responsibilities:

- construct only the required AFSCP headers for each route: service auth and caller service for all calls, correlation id for all calls, namespace id for namespace-bound calls, actor/idempotency for mutating calls, and no namespace header for volume-global calls.
- require AFSCP to map the authenticated service principal to the canonical caller service and reject spoofed `X-AFSCP-Caller-Service`; `actor` is only the already-authorized end actor for audit/context and never replaces service authorization.
- normalize AgentSmith workspace/project/user identity into AFSCP namespace/actor context.
- require ready project namespace plus the global product-resource ownership
  guard before every product AFSCP operation, including operation projection and
  status polling for namespace-scoped resources.
- expose a project-storage preflight used by every storage-dependent API before
  it calls the product AFSCP adapter. The preflight may advance or reconcile
  bootstrap idempotently, and returns ready, started/reconciling, retryable
  blocked, or needs-admin blocked without exposing namespace or volume details
  to ordinary callers.
- map AFSCP operation envelopes and stable errors into AgentSmith API errors.
- preserve AFSCP retryability and next-action semantics when mapping operation
  envelopes, especially for project storage bootstrap and storage-dependent
  child operations.
- poll or reconcile AFSCP asynchronous operations.
- enforce redaction before any value reaches product DTOs, logs, audit snapshots, or tests.
- sanitize unexpected bootstrap and product-operation errors before they become
  product state or public API responses.
- keep raw URLs, Secret refs, mount plans, WebDAV password, storage credentials, and raw paths out of ordinary responses.
- consume only caller-safe allowlist operation views from AFSCP. AgentSmith must not store or parse raw storage-backend stdout/stderr, raw `run_command`, `--control-root`, Secret refs, raw paths, or credential-shaped values.

The adapter should be testable without real AFSCP and should have backend-real tests against an AFSCP instance.

### 3.3 File Library Catalog Model

Extend the AgentSmith file library catalog with AFSCP mapping fields.

Recommended fields:

- `storage_provider: "afscp"`.
- `afscp_namespace_id`.
- `afscp_repo_id`.
- `afscp_volume_id`.
- `afscp_repo_status`.
- `last_storage_operation_id`.
- `file_library_home_segment`.

Fields to remove from ordinary DTOs:

- `metadata_url`.
- `storage_bucket_url`.
- PostgreSQL metadata connection details.
- MinIO bucket/user details.
- gateway loopback URL/port.
- raw mount command.

The existing task binding fields remain AgentSmith-owned:

- `workspace_file_library_id`.
- `task_home_segment`.
- `file_library_binding_generation`.
- binding holder/lease/generation fields.

Project storage mapping is stored separately from individual file libraries and
is part of every storage ownership check:

- `project_storage_status`.
- `project_storage_stage`.
- `project_storage_generation`.
- `afscp_namespace_id`.
- `afscp_volume_id`.
- `last_storage_operation_id`.
- `storage_retryable`.
- `storage_next_action`.
- `storage_failure_code`.

File-library, template, restore, export, and workload-binding records should
carry the product storage generation they were created under. A resource created
under an older generation or a non-visible lifecycle state must not be reused for
new AFSCP access without an explicit reconcile path.

### 3.4 File Browser Access Strategy

The current AFSCP file-library contract does not expose a first-class file browse/upload/download/move API. It exposes export sessions and a WebDAV gateway contract.

Decision for this milestone:

1. Keep AgentSmith Files product APIs stable at the frontend boundary.
2. Replace the backend implementation with a Files UI storage adapter backed by
   either server-side AFSCP WebDAV/export or an upstream first-class AFSCP file
   API.
3. Keep WebDAV credentials server-side only. The frontend never receives AFSCP `access.url`, password, redirect URL, or export credential.
4. Use short-lived exports per operation or a tightly scoped server-side session cache with TTL and revoke/reconcile behavior. Cache keys must include actor, repo, mode, and permission generation, and must be invalidated on permission change, project disable, export revoke, expiry, or session reconciliation.
5. Add redaction tests to prove credentials and raw paths never reach frontend, audit, logs, operation details, or evidence bundles.

If WebDAV cannot support required browser semantics with acceptable correctness,
pause implementation and define a minimal AFSCP internal file API contract. That
first-class API is an equivalent safe backing for the Files UI storage adapter.
Do not skip the adapter boundary, and do not fall back to AgentSmith-managed
JuiceFS gateway.

The AgentSmith adapter must stay thin. AFSCP owns payload path resolution,
no-follow protection, external-control-root enforcement, access/session ledger,
credential verification where credentials exist, revoke/expiry reconciliation,
and raw path redaction. When the selected backing uses WebDAV/export, AFSCP also
owns WebDAV `Destination` policy and export session semantics. AgentSmith proxies
product-authorized file operations and maps results to Files DTOs; it does not
reimplement AFSCP's storage security layer.

### 3.5 Runner And Terminal Mount Strategy

AgentSmith keeps task/file-library binding authority. AFSCP provides runtime storage access.

Managed runner flow:

1. AgentSmith creates or reuses a file library.
2. AgentSmith acquires the task-file-library binding.
3. AgentSmith creates an AFSCP workload mount binding for the file library repo with destination `/home/<file_library_home_segment>`.
4. The sandbox manager fetches the AFSCP mount plan.
5. Kubernetes/CSI mounts only the repo payload subdir through JuiceFS CSI/subPath into the sandbox pod.
6. The task container starts with `HOME=$TASK_HOME=/home/<file_library_home_segment>` and `cwd=$HOME/workspace`.
7. The sandbox manager heartbeats and releases/revokes the mount binding when the pod/session ends.

Developer runner flow:

- Developer runner must use the same AFSCP repo/HOME semantics as managed runner.
- Same HOME semantics means the same HOME-relative layout and Files mapping, not the same absolute path. Managed runner uses `/home/<file_library_home_segment>`; Developer runner uses the backend-provided runtime-profile resolved path.
- It must use one sanctioned storage path: an AFSCP export-backed developer
  runner lease/connector managed by AgentSmith backend.
- AgentSmith backend issues and owns the developer access lease. The lease must
  be short TTL, revocable, heartbeat/reconcile aware, scoped to the current
  repo/namespace/destination/mode, and represented in AFSCP export/session
  accounting so restore and lifecycle admission can see it.
- The runner protocol still receives opaque workspace access context from AgentSmith.
- It must not receive AFSCP root credentials, raw control paths, Secret refs,
  metadata URLs, bucket details, storage-root material, or direct JuiceFS mount
  material.
- If the current AFSCP contract cannot safely express this export-backed developer runner
  lease/connector abstraction, Slice 5 is blocked on an upstream AFSCP contract
  change. Do not add an AgentSmith workaround, a dedicated developer sandbox-manager
  identity, or raw storage shortcuts.

### 3.6 Restore And Active Writers

Restore-run must coordinate with task runtime access.

AFSCP export/workload session state is the storage authority for restore
admission. AgentSmith task holder state is a supplemental product preflight, not
a parallel storage lock. Every writable terminal, run, and file browser export
must be represented in AFSCP sessions or bindings. When Slice 5 is unblocked,
every developer-runner access path must use the same representation. If any
writer/access path cannot be represented, it is an AFSCP/sandbox-manager contract
gap.

Required behavior:

- active read-write task session blocks restore-run.
- expired/failed/uncertain mount state blocks restore-run until reconciled.
- task delete, terminal close, runner shutdown, export/lease revoke, and any
  future connector revoke move access through releasing/draining states; file
  libraries are not reusable until AFSCP confirms no active or uncertain writer
  remains.
- read-only file browsing does not block restore-run by itself, but lifecycle delete/archive may still need access drain according to AFSCP rules.
- restore preview can exist as a pending plan and must have a cancel-preview UX
  that leaves files unchanged, backed by AFSCP cancel/discard-preview semantics.

### 3.7 Deployment Shape

AFSCP should be deployed alongside AgentSmith in the platform topology, with
independent AFSCP release gates/contracts and internal-only access:

- `afscp-api`.
- `afscp-worker`.
- `afscp-export-gateway` when the Files UI storage adapter is backed by
  server-side WebDAV/export; an upstream first-class AFSCP file API can replace
  this backing path, but not the Files UI storage adapter boundary.
- internal AFSCP API service accessible only to AgentSmith API and the sandbox manager.
- optional future WebDAV gateway ingress/base URL for productized user-computer connector traffic; this is not required in this milestone and is not the AFSCP internal API.
- service credentials configured through deployment secrets.
- storage readiness checks plus AFSCP image/release evidence for its internal
  storage engine. AgentSmith product/business logic must not directly sense or
  call JVS. Deployment templates only declare AFSCP contract-required runtime
  env/volumes, such as `AFSCP_JVS_CWD` when the selected AFSCP release requires
  it; JVS lifecycle and internal semantics remain AFSCP-owned.

Substrates remain outside the app pods:

- PostgreSQL.
- object storage.
- Keycloak.
- JuiceFS metadata/object-store substrate as required by the selected volume.

JuiceFS CSI driver remains cluster infrastructure. AFSCP internals may hold
volume metadata and generate sandbox-manager-only mount plans. Outside AFSCP
internals, only the sandbox manager may receive plan-scoped CSI SecretRefs
needed for Kubernetes/CSI to mount one repo payload for one destination/TTL. It
must not receive or persist storage-root credentials. AgentSmith product
callers, frontend, runners, and task containers never receive SecretRefs,
storage-root details, or control-root material.

AgentSmith gates and deployment templates must name this bootstrap boundary as
AFSCP/substrate, for example `AFSCP_STORAGE_CSI_*` and
`AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT`. Provider-specific JuiceFS env names
are allowed only at the sandbox-manager/AFSCP substrate process boundary when
that component is the selected implementation. They are not File Library product
config, runner config, API DTOs, or acceptance evidence.

### 3.8 Upstream Design Review Policy

AFSCP is the only upstream storage-control boundary AgentSmith integrates with.
When a storage abstraction or API is wrong for AgentSmith's product needs, fix
the upstream AFSCP contract and then integrate it, instead of hiding design
problems in AgentSmith. If AFSCP uses JVS internally, JVS-specific validation is
attached to AFSCP release evidence and does not become an AgentSmith gate.

If implementation discovers that AFSCP exposes the wrong abstraction, misses a
required contract, leaks storage details, or forces AgentSmith to hold
storage-specific policy, treat that as an upstream design issue. The team should
open or update the AFSCP change plan with:

- the product behavior AgentSmith needs.
- the module that should own the behavior.
- the contract/API shape required by AgentSmith.
- the security and redaction requirements.
- focused upstream tests or release evidence.
- the AgentSmith slice blocked by the upstream change.

Do not create AgentSmith workarounds for upstream gaps such as unsafe local
mounts, raw JuiceFS credential handling, control-root exposure, product
authorization inside AFSCP, or AgentSmith-side parsing of private storage state.
The boundary rule is simple: AgentSmith owns product catalog and permission;
AFSCP owns storage control; sandbox manager, Kubernetes, and CSI own task HOME
mounting; runner containers only consume mounted HOME.

### 3.9 Cross-System Saga And Reconciliation

Any flow that spans AgentSmith catalog/task records and AFSCP durable operations
must be operation-driven and reconciled. AgentSmith creates or updates its
product record with a pending storage state, calls AFSCP with a deterministic
idempotency key derived from the AgentSmith resource/action/generation, stores
the AFSCP operation id, and reconciles to ready, blocked, or failed from AFSCP
operation truth.

| Flow | AgentSmith state | AFSCP state | Reconciliation rule |
| --- | --- | --- | --- |
| Project storage bootstrap | project storage `bootstrapping` with stage, generation, operation id, retryability, and next action | namespace upsert/ensure operation followed by namespace-volume binding operation, unless AFSCP provides one durable ensure for both | project storage becomes ready only after namespace and binding are ready for the current generation; binding does not start before namespace ready; unavailable/network/timeout stays retryable, conflict/permission/configuration goes blocked needs admin |
| Create file library | `creating` catalog row with namespace/retry key | repo create operation | ready only after repo operation succeeds; failed row can retry with same generation |
| Create task from template | task and file library `creating_from_template` | template clone operation | task becomes runnable only after cloned repo is ready and binding succeeds; failed clone leaves retry/delete affordance |
| Delete task / release binding | task deleted or archived, binding `draining` | workload/export release or revoke operations | file library becomes reusable only after confirmed non-accessing terminal state |
| Restore run | file library `restoring` | restore run operation and writer-session fence | ready only after restore succeeds and writer fence is clear; blocked state keeps retry or cancel-preview affordance when applicable |
| File library lifecycle delete/archive | lifecycle pending | repo lifecycle operation and access drain | terminal product state follows AFSCP lifecycle result; no raw filesystem delete |
| Server-side export or future connector revoke | export revoking | export revoke/reconcile | access is unusable immediately in AgentSmith and terminal only after AFSCP confirms revoke/expiry |
| Project/workspace disable | access disabled, lifecycle draining | export and workload binding revoke/reconcile; later per-repo/template lifecycle | no new storage access; terminal only after AFSCP confirms sessions are inactive or reconciled |
| Operation/audit projection | audit/debug projection pending or ready | allowlisted operation/audit view | visible only with `project:audit:read`, current resource visibility, and namespace match; otherwise `not_found` |

Orphaned AFSCP repos/templates/save points/restore plans/exports/mount bindings
and operations caused by crashed AgentSmith flows must be reconciled by stored
operation ids, resource ids, and resource-generation keys, not by guessing from
paths or names.

## 4. API And UX Requirements

### 4.1 Storage-Ready Preconditions

Every storage-dependent AgentSmith route must check project storage readiness
after product authorization and before any namespace-scoped AFSCP call. The
precondition is:

- workspace and project are active.
- project storage is ready for the current `project_storage_generation`.
- namespace upsert and namespace-volume binding are ready.
- the selected product resource id is visible in the current project, belongs to
  the same storage generation, and is in a lifecycle state that allows the
  requested action.

If the precondition is not ready:

- For `not_started`, stale, unknown, or retryable failed bootstrap state,
  AgentSmith may start or continue idempotent on-demand reconcile and return a
  typed pending/retryable response.
- For an in-progress bootstrap, AgentSmith returns a typed pending response with
  a low-cognitive next action: wait or retry later.
- For conflict, AFSCP service permission failure, missing/default volume
  misconfiguration, unsupported capability, or invalid deployment config,
  AgentSmith returns a typed needs-admin response. Ordinary users are not asked
  to fix namespace, volume, or binding details.
- Non-idempotent child work must not advance past its own safe pending state
  until project storage is ready.

Storage-dependent API behavior:

| API area | Behavior while project storage is not ready |
| --- | --- |
| File library create | Trigger or continue project storage bootstrap when retryable; do not call repo create until project storage is ready. |
| File library list/detail | May return existing AgentSmith catalog rows with a project storage pending/blocked status, but must not call namespace-scoped AFSCP list/detail operations until storage is ready. |
| File browser list/download/upload/move/delete | Typed block or retryable pending response; on-demand reconcile is allowed, server-side export/file API access is not created until ready. |
| File library mutation/delete/lifecycle | Typed block or retryable pending response; lifecycle reconcile may use stored ids only after namespace readiness is known. |
| Task create with new file library | Do not create the repo or runnable task workspace until project storage is ready; if a product task row is created early, it stays `waiting_for_project_storage` and is not runnable. |
| Task create from template | Validate product template availability first, then block/reconcile until storage is ready before cloning the AFSCP template. |
| Bind existing file library to task | Requires project storage ready, resource generation match, file-library lifecycle visibility, and confirmed reusable binding state. |
| Workload mount binding / terminal start | Must not request AFSCP mount binding or sandbox manager plan until project storage and file-library repo are ready. |
| Save point, restore preview/run/cancel | Typed block or retryable pending response until project storage and target file library are ready; stale preview remains a separate typed state. |
| Template create/publish/use/clone | Product metadata visibility may be shown, but AFSCP template create/clone waits for project storage ready and source/target generation match. |
| Server-side export / future connector | Must not create export/session/lease until project storage and resource lifecycle are ready. |

Typed blocked responses should include internal status, retryability, and next
action. User-facing copy should say the project file storage is getting ready,
temporarily unavailable, or needs administrator attention.

### 4.2 Files UI

Required UX:

- File library list remains the entry surface.
- File browser opens the HOME root by default for every AFSCP-backed file library; `workspace/` remains an ordinary directory inside HOME and is the default agent/terminal working directory.
- Normal dot folders are visible and navigable.
- Save points are visible in the file library detail save point list.
- Save point, restore, and template dialogs clearly state that the action applies to the whole file library HOME, which is the task HOME when bound, including hidden agent runtime folders, not only the current `workspace/` view.
- Restore flow is preview-first and clearly says it restores files, leaves task conversation unchanged, and canceling preview leaves files unchanged.
- Restore-run pending is shown as restoring/reconciling until the backend
  reports terminal success or a typed failure/blocker; the UI does not show
  "restored successfully" for a pending operation.
- Template action is named as saving current task files as a task file template.
- Template creation does not show its internal source save point as a normal recovery point; audit/debug views label it as `template source/internal` if surfaced.
- Published task file templates appear in the current project's template library. That project template library is the only sharing/availability surface in this milestone; the UI must not ask users to choose individual members or groups for template sharing.
- Mutating controls must be gated by `project:files:update`; view controls remain gated by the current Files read/use permission, `project:endpoint:use`.

Do not expose these to ordinary users:

- AFSCP repo id as primary UI identity.
- AFSCP namespace id.
- volume id.
- JuiceFS metadata URL.
- bucket endpoint.
- raw mount command.
- PV/PVC/Secret refs.
- WebDAV password after first issue.
- PostgreSQL, object storage, bucket, or JuiceFS root credentials.

This milestone must not show a `Connect on my computer` product feature.
Existing raw mount entry points must be deleted from product navigation, docs,
tests, and fixtures. Do not keep a disabled/unavailable placeholder. A future
WebDAV connector belongs to a separate connector milestone and must be designed
as a new product surface.

### 4.3 Task Create UX

Task create should offer:

- Start with new task files.
- Reuse your own released task workspace/file library.
- Start from a task file template.

Existing one-file-library-per-undeleted-task binding remains:

- A bound file library cannot be bound to another undeleted task.
- Deleting a task starts release/drain for the binding and keeps file library content.
- A released file library can be reused for a new task only after AFSCP workload/export writer sessions reach a confirmed non-accessing terminal state.

### 4.4 Error Semantics

AgentSmith must translate AFSCP errors into stable product errors. Internal
stable error codes may include storage terms such as namespace, repo, volume,
mount binding, or operation. User-facing copy must not. UI copy should use file
library, task files, template, save point, restore, or storage unavailable.

Every storage error mapping must carry retryability and next action:

- AFSCP unavailable, network flap, timeout, unknown operation state, and worker
  crash are retryable/reconcilable unless a later operation view proves a
  terminal failure.
- Namespace-volume conflict, AFSCP service permission failure, missing/default
  volume misconfiguration, unsupported capability, invalid storage policy, and
  deployment configuration errors are non-retryable for ordinary users and need
  administrator action.
- A user request that races an already-running idempotent operation should return
  a pending/in-progress state, not duplicate the child operation.
- User-facing copy must not expose namespace, volume, binding, raw path,
  credential, or operation internals. Operation/debug projection can expose
  redacted details only behind audit/debug authorization and resource visibility.
- Unexpected bootstrap exceptions must become sanitized `retryable_failed` or
  `blocked_needs_admin` project storage state. Public responses must not echo
  raw exception text, raw AFSCP payloads, raw paths, tokens, storage ids, or
  credential-shaped values.

Examples:

| Internal stable error code | User-facing copy direction |
| --- | --- |
| `afscp_project_storage_bootstrapping` | Project file storage is getting ready. |
| `afscp_project_storage_retryable` | File storage is temporarily unavailable. Try again soon. |
| `afscp_project_storage_needs_admin` | Project file storage needs administrator attention. |
| `afscp_namespace_disabled` | This project file storage is unavailable. |
| `afscp_resource_not_found` | This file library or operation was not found. |
| `afscp_repo_not_ready` | This file library is still getting ready. |
| `afscp_active_writer_blocks_restore` | Stop active file sessions before restoring. |
| `afscp_restore_preview_stale` | Files changed after preview; preview again before restoring. |
| `afscp_restore_plan_requires_recovery` | This restore needs storage recovery before it can continue. |
| `afscp_capability_denied` | This storage action is not available for this project. |
| `afscp_storage_unavailable` | File storage is temporarily unavailable. |
| `afscp_idempotency_conflict` | This action is already in progress or conflicts with another request. |
| `afscp_template_clone_not_allowed` | This template cannot be used in this project. |
| `afscp_volume_mismatch_requires_import` | This file library needs storage recovery before it can be used. |
| `afscp_storage_config_invalid` | Project file storage needs administrator attention. |
| `afscp_service_permission_denied` | Project file storage needs administrator attention. |

Errors must not leak raw paths, credentials, Secret refs, metadata URLs, raw storage-backend command strings, or backend details.

## 5. AFSCP Capability Gaps To Validate

AFSCP has the core storage-control primitives needed for this direction:

- namespace volume binding.
- repo create/lifecycle.
- save point list/create.
- restore preview/run/discard, where discard is the backend operation behind user-facing cancel preview.
- repo template create/clone.
- export sessions.
- workload mount binding and sandbox-manager-only plan.
- operation/audit model.

Known gaps or integration risks:

1. No first-class file browser API. AgentSmith must use a Files UI storage
   adapter backed by server-side WebDAV/export or request/add an upstream
   first-class AFSCP file API.
2. Workload mount binding depends on a sandbox manager/Kubernetes/CSI contract: payload-only mount, plan-scoped SecretRef RBAC, no arbitrary Secret reads, heartbeat, release, revoke, and confirmed-unmounted terminal states.
3. Current AgentSmith raw local mount UX conflicts with AFSCP security model and
   must be deleted from product flows. Productized user-computer WebDAV
   connector is deferred to a separate connector milestone; the Files UI storage
   adapter is required and must be backed by server-side WebDAV/export or an
   upstream first-class AFSCP file API.
4. AFSCP operation model is asynchronous/durable; AgentSmith file library create currently behaves like synchronous provisioning and must be reconciled.
5. Project storage bootstrap needs clear namespace upsert, namespace readiness,
   namespace-volume binding readiness, retryability, and next-action semantics.
   AgentSmith will stage namespace upsert before binding unless AFSCP provides a
   single durable ensure that atomically owns both.
6. AFSCP lifecycle semantics are archive/delete/tombstone/purge. AgentSmith product delete must map deliberately and cannot be raw filesystem deletion.
7. Quota is only a policy hook unless the selected volume capability enforces directory quota.
8. Unified deploy renders AFSCP API/worker/export gateway plus schema/default-volume bootstrap Jobs from the selected `AFSCP_IMAGE`. AgentSmith product/business logic must not directly sense or call JVS; deployment templates only declare AFSCP contract-required runtime env/volumes, such as `AFSCP_JVS_CWD` when required by the selected AFSCP release. JVS lifecycle and internal semantics remain AFSCP-owned.
9. AFSCP control-root and clone behavior must be pinned to the product semantics AgentSmith needs: payload-only HOME, no control-root exposure, snapshot-style templates, no internal storage-control state copy, and stable restore summaries. HOME payload files are intentionally copied. If AFSCP cannot express those safely, fix AFSCP instead of parsing private state in AgentSmith.
10. AFSCP redaction and operation summaries must be strong enough for AgentSmith audit/debug projection. If raw storage-backend commands, private paths, or recovery internals are required to understand an operation, improve the upstream summary contract.
11. Restore preview and restore-run admission must return typed blockers, redacted file-change summaries, and a preview base revision/generation/head/fence token that restore-run verifies. AgentSmith should not infer active writer causes or destructive restore effects from unrelated task state.
12. Template creation should preferably be an AFSCP operation for "create template from current repo state" that internally materializes a source save point and returns `template_id` plus `source_save_point_id`. AgentSmith should not expose source save point plumbing as the normal template UX.
13. Developer runner parity is a target of this milestone and requires an AFSCP
    export-backed developer runner lease/connector with short TTL, revoke,
    heartbeat/reconcile, and export/session accounting. If the current AFSCP contract cannot
    express that safely, Slice 5 is blocked upstream and AgentSmith must record
    the blocker instead of adding a workaround.
14. AFSCP must enforce namespace mismatch rejection for every namespace-scoped resource id AgentSmith passes, including repo, template, save point, restore plan, export session, workload mount binding, and operation id.
15. AFSCP internal contract validation can start with focused validation for the
    current slice, but subsequent integration slices require schema/generated
    client evidence for the AFSCP internal API surface they use. This is a
    requirement, not an optional cleanup item.

Upstream security gates before AgentSmith integration:

- AFSCP maps authenticated service principal to canonical caller service and rejects caller spoofing.
- AFSCP namespace upsert/ensure returns enough durable operation/readiness state
  for AgentSmith to persist bootstrap stage, operation id, retryability, and
  next action.
- AFSCP namespace-volume binding either rejects not-ready namespaces or exposes a
  single durable ensure operation that explicitly owns namespace and binding
  readiness together.
- AFSCP rejects namespace mismatch for namespace-scoped resource ids and returns `not_found` without existence leakage.
- AFSCP errors distinguish retryable unavailability/unknown operation state from
  non-retryable conflict, service permission, capability, and configuration
  failures.
- AFSCP uses external control-root mode or an equivalent AFSCP-owned mechanism for managed repos; payload exports and mounts never expose `.jvs` or control roots.
- When WebDAV/export is the selected Files UI backing, AFSCP WebDAV gateway
  enforces payload-only no-follow path policy, method policy, `Destination`
  policy, credential verification, runtime request accounting, revoke, expiry,
  and redaction; an upstream first-class AFSCP file API must enforce equivalent
  storage-access safety.
- AFSCP restore admission uses export/workload writer-session fences, binds preview plans to base revision/generation/head/fence, and returns typed blockers.
- AFSCP export/session accounting includes server-side Files exports and, when
  Slice 5 is unblocked, developer runner leases/connectors.
- AFSCP operation views exposed to AgentSmith are allowlisted/redacted and contain no raw storage-backend command, stdout/stderr, raw path, Secret ref, or credential-shaped value.
- AFSCP internal API schema/generated client evidence exists for the endpoints a
  subsequent AgentSmith slice consumes. Slice 1 may use focused validation while
  the boundary is being established, but later slices must not rely only on
  hand-written request/response assumptions.
- AFSCP template clone stays within the project namespace unless a future explicit cross-namespace import/export contract is designed.

These are not blockers to planning. They are implementation checkpoints. Any
checkpoint that fails because the upstream abstraction is wrong should produce
an AFSCP change item with evidence, not an AgentSmith workaround.

## 6. Development Plan

### Slice 1: AFSCP Client And Project Namespace Bootstrap

Scope boundary:

Slice 1 is the project storage bootstrap foundation plus the state/preflight
boundary. It does not replace File Library routes, does not implement the Files
UI storage adapter, does not mount task HOME through AFSCP, and does not
implement save point, restore, template create, or template clone flows. Those
are later slices. Slice 1 may persist internal storage state and add internal
tests; it should not change public OpenAPI, generated types, or MSW handlers
unless the next implementation explicitly exposes user-visible project storage
status/next-action. If that user-visible status is introduced, it is a
contract-first change with the normal OpenAPI/generated/MSW/i18n artifacts.
Slice 1 acceptance proves only this bootstrap/preflight foundation; it does not
accept File Library runtime behavior, and it must not use per-library JuiceFS
execution as product evidence.

TDD first:

- product adapter vs bootstrap port separation; ordinary product route deps
  cannot access a bootstrap-token raw AFSCP client.
- product token/caller-service and bootstrap token/caller-service distinctness,
  with fail-fast configuration validation.
- typed AFSCP client header construction.
- route-specific service auth/caller/actor/idempotency/correlation validation.
- project -> namespace id mapping.
- project storage bootstrap saga state: stage, generation, operation id,
  retryability, next action, and redacted failure code.
- Slice 1 ownership guard for project storage mapping and bootstrap/operation
  ids available in this slice, plus a reusable guard contract that later slices
  must apply to repo, template, save point, restore plan, export session,
  workload mount binding, and operation ids when those records are introduced.
- namespace and namespace-volume binding bootstrap with namespace-ready before binding, unless AFSCP provides one durable ensure operation for both.
- storage-dependent API preflight that returns ready, pending/retryable, or needs-admin without leaking namespace/volume details, and only returns product-adapter call context when the project storage state is ready.
- retryable vs non-retryable bootstrap error mapping.
- unexpected bootstrap error sanitization; no raw path, token, credential,
  namespace id, volume id, binding id, or raw AFSCP payload reaches public
  state/response/evidence.
- product AFSCP operations inside the Slice 1 boundary cannot run before ready
  namespace plus the Slice 1 ownership guard.
- redaction of all AFSCP sensitive fields.
- bootstrap caller separation: deployment/bootstrap identity can create first namespace-volume binding; ordinary product caller cannot.
- focused AFSCP internal contract validation for the Slice 1 endpoints, with a
  required path to schema/generated client evidence for subsequent slices.

Implementation:

- add AgentSmith `AfscpClient`.
- add explicit product AFSCP adapter and project storage bootstrap port; keep the
  raw client private to those adapters.
- add project storage bootstrap service and the preflight/on-demand reconcile
  entrypoint that later storage-dependent routes must call.
- persist project storage status/stage/generation/operation/retryability/next-action fields.
- add configuration for AFSCP base URL, caller service, service credential, default volume id, and namespace policy defaults.
- add startup/config validation that fails fast when product and bootstrap
  tokens or caller-service values are reused across ports.
- keep public OpenAPI/generated types/MSW unchanged in the baseline Slice 1
  unless user-visible project storage status is introduced in the same change.

Acceptance:

- product routes cannot import or receive a bootstrap-token raw AFSCP client.
- product and bootstrap credentials/caller-services are distinct and fail fast
  when misconfigured.
- project creation can succeed while project storage is bootstrapping, retryable
  failed, or blocked needs admin; the preflight boundary exposes that state to
  storage-dependent handlers without claiming File Library route cutover.
- project initialization can create/ensure AFSCP namespace and namespace-volume
  binding with correct stage ordering.
- ordinary user responses never include AFSCP raw storage material.
- Slice 1 project storage and bootstrap/operation ids are checked against the
  current project storage mapping; resource-specific not-found behavior for
  repos, templates, save points, restore plans, exports, and mount bindings is
  implemented in the slices that introduce those records.
- on-demand reconcile for retryable storage bootstrap state is idempotent and
  converges without creating duplicate namespaces or bindings.
- unexpected bootstrap failures are stored and returned only as sanitized
  status/error/next-action values.
- File Library routes, Files adapter access, task mount, save point/restore,
  and template flows are not reported as complete by Slice 1 evidence.

### Slice 2: File Library Catalog Backed By AFSCP Repo

TDD first:

- creating a file library calls AFSCP repo create and stores opaque repo mapping.
- file library create/list/detail/mutation apply project storage preflight and
  never call namespace-scoped AFSCP repo operations before project storage is
  ready.
- file library status follows AFSCP operation result.
- failed operation maps to typed file library status/error.
- deleting a file library maps to AFSCP lifecycle policy and respects task binding.
- task delete/release marks binding draining until AFSCP confirms no active or uncertain writer remains.
- project/workspace disable blocks new storage access, revokes exports/mount bindings, drains sessions, and reconciles per-repo/template lifecycle without assuming namespace delete.
- operation/audit projection is owned here for the baseline file-library lifecycle: typed endpoint, DTO, status, error mapping, `project:audit:read` gate, namespace/resource visibility, and redaction. Later restore/template slices extend this projection instead of creating a parallel model.
- contract-first handoff covers endpoint definitions, DTO/status/error shape, OpenAPI, generated types, MSW handlers, i18n messages, focused e2e for lifecycle/status states, and focused visual coverage only when UI states change.

Implementation:

- use AFSCP-backed per-library repo provisioning as the product behavior; do not
  expose a selectable, hidden, or fallback product path that uses separate
  per-library JuiceFS provisioning.
- keep the File Library product API at the frontend/product boundary defined by
  current contracts.
- remove ordinary backend/gateway/mount details from DTOs, tests, fixtures,
  generated/mock payloads, backend-real evidence fixtures, and docs that would
  encode separate per-library JuiceFS storage assumptions.

Acceptance:

- new file library creates one AFSCP repo under the project namespace.
- no per-file-library JuiceFS filesystem/database/bucket is created by AgentSmith, and raw `metadata_url`/bucket/local mount product DTOs are gone.
- project/workspace disable and delete lifecycle have storage drain/revoke/reconcile states instead of raw namespace delete assumptions.
- operation/audit projection for file-library lifecycle is authorized, redacted, and returns not found for cross-namespace or invisible resources.

### Slice 3: Server-Side File Browser Adapter

TDD first:

- list directory, upload, download, create folder, move, delete through an AFSCP-backed adapter.
- Files storage operations block or trigger retryable project storage reconcile
  when project storage is not ready; they do not create exports or file API
  sessions early.
- dot folders under HOME root are visible.
- `.jvs` and control-root material are absent from payload/export because AFSCP keeps control roots outside the payload, not because AgentSmith hides them.
- any WebDAV/export credential stays server-side.
- abort/cancel behavior does not leave leaked sessions.
- raw desktop/local mount UX is deleted and no `Connect on my computer` entry is shown; no user-facing connector exposes raw JuiceFS mount credentials.
- contract-first handoff covers Files endpoints, DTOs, upload/download/mutation status, AFSCP error mapping, OpenAPI, generated types, MSW handlers, i18n messages, focused e2e for list/upload/download/move/delete, and focused visual coverage only for changed UI states.

Implementation:

- implement the Files UI storage adapter backed by server-side WebDAV/export, or
  stop and define a minimal upstream AFSCP file API if WebDAV is insufficient.
- keep frontend Files API stable except DTO fields that must disappear for security.
- delete raw local mount/desktop connect UI; a future productized WebDAV connector requires its own new product surface.

Acceptance:

- Files UI can browse and mutate an AFSCP-backed file library.
- Terminal/agent-created files appear in Files.
- Files-created files appear in task HOME.
- No user-facing connector exposes PostgreSQL, object storage, bucket, metadata URL, or JuiceFS mount credentials.
- When the selected Files UI storage adapter backing uses WebDAV/export,
  server-side sessions are short TTL, revoke/reconcile aware, represented in
  AFSCP export accounting, and never expose credentials to the frontend.

### Slice 4: Managed Runner Workload Mount Integration

TDD first:

- task binding creates AFSCP workload mount binding.
- task create/bind/mount paths require project storage ready before repo create,
  workload mount binding, terminal start, or sandbox manager plan fetch.
- mount plan is fetched only by sandbox manager identity.
- task pod receives only payload root mounted at HOME.
- sandbox manager cannot list/read arbitrary Kubernetes Secrets and consumes only AFSCP plan-scoped SecretRefs.
- release/revoke/heartbeat updates are idempotent.
- active writable mount blocks restore-run.
- binding reuse is denied while the previous mount/export session is releasing, expired, failed, or otherwise uncertain.

Implementation:

- replace sandbox-manager raw `metadata_url`/storage endpoint contract with AFSCP mount binding + sandbox manager plan.
- keep AgentSmith task binding generation and holder fences.

Acceptance:

- managed runner task writes files to AFSCP-backed HOME.
- terminal and agent share the same HOME.
- no pod/workload receives control root or root storage credentials.

### Slice 5: Developer Runner Workspace Parity

Slice 5 is a milestone target. If the current AFSCP contract cannot provide the safe
export-backed developer runner lease/connector, Slice 5 is blocked upstream:
record the upstream blocker and the explicit no-workaround decision, then do not
treat developer-runner-specific backend-real/deploy smoke as a pass condition for
this round. If the lease/connector is unlocked and implemented, the developer
runner smoke is mandatory.

TDD first:

- developer runner receives the same task execution context fields.
- developer runner uses an AFSCP export-backed lease/connector issued by AgentSmith backend.
- lease is short TTL, revocable, heartbeat/reconcile aware, and visible in AFSCP export/session accounting.
- developer runner cannot receive or persist AFSCP secrets, root credentials, metadata URLs, bucket details, Secret refs, or raw JuiceFS material.
- managed/developer file outputs show the same Files root behavior.
- developer runner absolute HOME path may differ from managed runner, but HOME-relative layout and Files mapping must match.

Implementation:

- provide the AFSCP export-backed developer runner lease/connector path that preserves the same HOME semantics.
- do not add a second product model for developer files.
- if the current AFSCP contract cannot support the safe lease/connector abstraction, stop Slice 5 and open the upstream AFSCP contract change; do not add a dedicated developer sandbox-manager identity or raw storage workaround.
- while Slice 5 is blocked, the active `workspace-access` / `task_home_binding`
  contract exposes only `mode: pre_mounted`; developer runner file access fails
  closed with an explicit 409 and must not surface placeholder connector modes.

Acceptance:

- when Slice 5 is unblocked and implemented, developer runner test task can
  write a marker file.
- when Slice 5 is unblocked and implemented, Files UI shows the marker at the
  same HOME-relative path as managed runner.
- when Slice 5 is unblocked and implemented, restore and project lifecycle
  blockers can see active/uncertain developer runner access through AFSCP
  session/export accounting.
- when Slice 5 is blocked upstream, acceptance evidence is the upstream blocker,
  the no-workaround record, and proof no raw storage workaround was added.

### Slice 6: Save Points And Restore

TDD first:

- create save point.
- list save points.
- save point and restore APIs require project storage and target file library
  ready; project storage pending/retryable/admin states are typed separately
  from restore blockers and stale previews.
- restore preview returns a plan bound to repo base revision/generation/head and writer-session fence token.
- restore run from a matching preview verifies the base/fence still matches and rejects stale previews with a typed error.
- cancel preview leaves files unchanged, backed by the AFSCP cancel/discard-preview operation.
- active writer conflict.
- redacted operation/audit projection extends the Slice 2 projection model.
- contract-first handoff covers save point and restore endpoints, DTO/status/error shape, OpenAPI, generated types, MSW handlers, i18n messages, focused e2e for preview/run/cancel/blockers, and focused visual coverage only for changed UI states.

Implementation:

- add file library save point API.
- add file library restore API.
- add Files UI save point list and restore flow.
- add stale-preview and discard-preview state mapping to the existing operation/audit projection.

Acceptance:

- user can create save point, change files, restore to save point, and see restored HOME in Files and terminal.
- user can cancel a restore preview and leave files unchanged.
- stale preview requires a new preview before restore-run.
- restore blocked states are typed and understandable.

### Slice 7: Project Template Library

TDD first:

- create template metadata in AgentSmith.
- call AFSCP repo template create.
- template create/use/clone require project storage ready and source/target
  storage generation match before AFSCP template operations run.
- internal source save point created for template source is hidden from ordinary recovery point lists and labeled `template source/internal` in audit/debug projection if surfaced.
- draft templates are visible only in project template management to the creator and users with `project:files:update`.
- publish or unpublish the template in the current project task file template library.
- list published task file templates available to the current actor.
- clone template into new file library during task creation.
- cross-project or unauthorized template use is denied by AgentSmith before AFSCP call.
- no member/group template sharing or per-member/per-group availability rule is introduced.
- template use during task creation requires `project:agent_task:use`, not a new template permission point.
- edit/delete/publish/unpublish require `project:files:update`.
- redacted operation/audit projection extends the Slice 2 projection model.
- contract-first handoff covers template management and task-create endpoints, DTO/status/error shape, OpenAPI, generated types, MSW handlers, i18n messages, focused e2e for draft/publish/use/deny paths, and focused visual coverage only for changed UI states.

Implementation:

- add task file template catalog and availability rules in AgentSmith.
- add task-create path from template.
- clone AFSCP template into a new repo/file library.

Acceptance:

- project member with `project:agent_task:use` can create a task from a published task file template.
- user without `project:agent_task:use` cannot see or use the template in task creation.
- unpublished template is not available for new task creation.
- draft template visibility is limited to creator/project template managers and mutation actions require `project:files:update`.
- cloned task gets an independent file library and repo.

### Slice 8: Deploy And Focused Smoke

TDD/focused checks:

- render AFSCP deployments/services/secrets in unified deploy.
- `npm run test:unified-deploy:render`
- `npm run test:unified-deploy:manifest`
- `npm run test:unified-deploy:substrate-boundary`
- `npm run test:unified-deploy:k8s-dry-run:unit`
- run a real k8s dry-run when manifest or substrate-boundary changes cannot be trusted from unit dry-run alone.
- ensure AFSCP services are reachable only internally.
- ensure AFSCP internal API is not publicly exposed, while any future optional WebDAV connector gateway uses a controlled HTTPS/ingress entrypoint.
- run focused product flow for workspace/project, files, managed runner.
- run product-flow smoke covering file-library create, Files UI sync, managed
  runner marker, developer runner marker when Slice 5 is unblocked,
  save point/restore, and template publish/clone; when Slice 5 is blocked, attach
  the upstream blocker and no-workaround evidence instead of the developer marker
  smoke.

Acceptance:

- local development/test deploy can start AFSCP, AgentSmith API/web, llmup, managed runner, and required substrates.
- managed runner passes a minimal echo/file creation smoke against AFSCP-backed
  storage; developer runner passes the same smoke when Slice 5 is unblocked and
  implemented, or contributes upstream blocker plus no-workaround evidence when
  Slice 5 is officially blocked.

## 7. Verification Strategy

Use progressive validation. Do not run full heavy gates after every small change.

AgentSmith file tests that assert raw JuiceFS/local mount behavior are not valid
acceptance evidence for the current AFSCP-backed implementation. Retarget or
rename them as the AFSCP-backed implementation lands; acceptance evidence must
assert current storage behavior.
This includes MSW fixtures, e2e fixtures, storybook/story/generated fixtures,
mock payloads, OpenAPI/generated type fixtures, backend-real evidence fixtures,
and any other fixture that still encodes `metadata_url`, raw mount, bucket, or
JuiceFS provider assumptions.

Developer runner evidence follows one rule everywhere: Slice 5 is in scope for
this milestone, but if the current AFSCP contract officially blocks the safe export-backed
lease/connector, developer-runner-specific backend-real and deploy smoke are not
required to pass for this round. The close evidence must instead include the
upstream blocker, the no-workaround decision, and proof AgentSmith did not add a
raw storage workaround. If Slice 5 is unblocked and implemented, developer runner
smoke must pass.

AFSCP internal contract validation is required evidence. Slice 1 may use focused
validation for the bootstrap/client boundary while the internal API contract is
being pinned down. Subsequent AFSCP integration slices must add schema/generated
client evidence for the AFSCP endpoints they consume before slice acceptance;
focused validation remains useful diagnostics but is not enough by itself once a
broader product flow depends on the contract.

Slice 1 does not require public OpenAPI, generated type, or MSW fixture changes
when project storage status remains backend-internal. If a user-visible storage
status/next-action response is introduced, that specific change must update the
public contract artifacts before acceptance.

Boundary evidence matrix:

| Boundary | Evidence | Trigger |
| --- | --- | --- |
| AgentSmith product/API | unit/internal contract tests for touched product permission, file-library catalog, task binding, task file template availability, DTO redaction, product adapter/bootstrap port separation, distinct caller credentials, storage-ready preflight, ownership guard, and AFSCP adapter header construction; public OpenAPI/MSW evidence only when the slice changes public API shape | every AgentSmith slice, scoped to touched boundaries |
| AgentSmith backend-real | focused smoke proving Files <-> task HOME sync through AFSCP-backed storage | file browser, task HOME, runner, or terminal changes |
| AFSCP upstream | AFSCP repo-local contract verifier, schema/generated client evidence after Slice 1, focused Go tests for namespace, repo, save point, restore, template, export, mount binding, operation, and redaction; if AFSCP uses JVS internally, AFSCP release evidence may attach JVS-local evidence for external control root, save/restore, clone/template, and recovery state | any AFSCP contract or behavior gap |
| Manual deploy smoke | managed runner echo/file marker flow plus developer runner echo/file marker flow when Slice 5 is unblocked; upstream blocker plus no-workaround evidence when Slice 5 is officially blocked | milestone close |

Focused AgentSmith checks:

- targeted unit tests for touched areas: AFSCP adapter, project storage
  bootstrap/preflight, file library catalog, Files API, task binding, and task
  file template catalog as those slices land.
- focused tests proving ordinary product route dependencies cannot access a raw
  bootstrap-token AFSCP client, and storage-dependent product AFSCP operations
  introduced by the slice pass ready namespace plus product-resource ownership
  guard first.
- startup/config validation proving product and bootstrap token/caller-service
  values are distinct and fail fast when missing or reused.
- bootstrap error sanitation tests proving unexpected errors produce only
  sanitized status/error/next-action values and never public raw paths, tokens,
  storage ids, credentials, or raw AFSCP payloads.
- `npm run contracts:check`, `npm run contracts:check-openapi`, and `npm run openapi:check-generated` when API contracts or generated DTOs change.
- generated type, MSW, and i18n checks for Slice 2/3/6/7 contract changes
  before focused e2e, and for Slice 1 only if user-visible project storage
  status/next-action is added.
- fixture cleanup check covering MSW fixtures, e2e fixtures,
  storybook/story/generated fixtures, mock payloads, OpenAPI/generated type
  fixtures, backend-real evidence fixtures, and any other fixture that still
  assumes per-library JuiceFS product behavior.
- focused e2e for changed file-library lifecycle, Files operations, restore, and template flows.
- focused visual scenario only when UI state/copy/layout changes in those flows.
- `npm run test:agent-task:runner:fast`
- `npm run test:agent-task:runner:backend-real` when task HOME, tickets, mount, runner runtime, or Context Store are touched
- `npm run test:agent-task:backend-real:terminal:matrix` when terminal/workspace recovery is touched
- focused backend-real check proving platform-managed Project secrets, managed OAuth credentials, execution tickets, runner connection secrets, AFSCP credentials, and WebDAV/export passwords are not automatically persisted into HOME payload after task, template, export, and terminal flows.
- focused backend-real check proving task delete/release keeps a file library non-reusable until AFSCP writer sessions are confirmed non-accessing.
- focused Files UI storage adapter check proving permission revocation, project
  disable, membership removal, or operation abort revokes or invalidates affected
  server-side exports/sessions when the selected backing uses WebDAV/export, or
  the equivalent upstream AFSCP file API access state when that path is selected.
- focused UI/backend check proving raw desktop/local mount UX is deleted, no `Connect on my computer` entry is shown, and no raw mount instructions remain in product flows.
- focused operation projection check proving `project:audit:read` plus resource visibility is required and cross-namespace operations are treated as not found.
- focused project/workspace lifecycle check proving disable/delete blocks new access, drains/revokes AFSCP sessions/bindings, and tombstones mapping without assuming namespace delete.

`npm run test:files:backend-real:smoke` and
`npm run test:files:backend-real:home-binding` are the AFSCP-path evidence
entrypoints for Files API and task HOME binding behavior. Raw mount, metadata
URL, and storage credential assertions, including the same assumptions inside
fixtures or generated/mock payloads, must not be treated as acceptance evidence
for this milestone.

Focused AFSCP checks:

- AFSCP contract verifier.
- Slice 1 may use focused validation for current bootstrap/client endpoints;
  subsequent slices require schema/generated client evidence for the AFSCP
  internal endpoints they consume.
- focused Go tests for namespace binding, repo create, save point,
  restore preview/run/discard with base/fence validation, template clone,
  workload mount, session accounting, resource namespace mismatch, and
  redaction; include export gateway checks when WebDAV/export backs the Files UI
  storage adapter, include equivalent first-class file API checks when that path
  is selected, and include developer runner export-backed lease/connector when
  Slice 5 is unblocked or attach upstream blocker evidence when Slice 5 is
  officially blocked.

AFSCP internal implementation evidence attachments:

- JVS-local evidence, when AFSCP uses JVS internally, is attached to AFSCP
  upstream/release evidence and is not an AgentSmith product, E2E, deploy, or
  acceptance gate.
- Evidence may cover external control-root behavior, save/restore,
  clone/template behavior, recovery state, payload-only behavior, and no
  internal storage-control state copy.

Manual/backend-real smokes:

- managed runner writes `workspace/managed-marker.txt`; Files sees it.
- developer runner writes `workspace/developer-marker.txt`; Files sees it when
  Slice 5 is unblocked and implemented. When Slice 5 is officially blocked,
  attach upstream blocker plus no-workaround evidence instead.
- Files uploads `workspace/files-marker.txt`; terminal sees it.
- HOME runtime marker under `.config` or `.local` is visible and participates in save point/template behavior.
- save point -> mutate -> restore -> terminal and Files see restored state.
- restore preview -> mutate files -> confirm restore fails stale and requires preview again.
- template create -> publish to project -> clone into new task -> file appears.
- template internal source save point is absent from ordinary recovery point list.
- task delete -> session drain -> released file library can be reused only after confirmed non-accessing state.
- project disable blocks new access and invalidates active exports/mount bindings.

Deploy evidence at Slice 8 close:

- `npm run test:unified-deploy:render`
- `npm run test:unified-deploy:manifest`
- `npm run test:unified-deploy:substrate-boundary`
- `npm run test:unified-deploy:k8s-dry-run:unit`
- real k8s dry-run when unit dry-run cannot cover changed manifests/substrate boundaries.
- focused product-flows covering workspace/project, Files UI, managed runner,
  developer runner when unblocked, save point/restore, and template clone; when
  Slice 5 is blocked, deploy close evidence includes the upstream blocker and
  no-workaround record instead of developer-runner-specific smoke.

Stage close checks:

- `npm run contracts:check` at slice close when frontend/backend contracts changed.
- run heavier `npm run verify -- --goal=pr --run` or release readiness only at milestone close or before merge/release, based on risk.

## 8. Acceptance Criteria

This milestone is complete only when:

1. New file libraries are backed by AFSCP repos on a shared AFSCP/JuiceFS volume.
2. AgentSmith no longer creates or exposes the per-file-library JuiceFS product path: no per-library JuiceFS filesystems, metadata databases, buckets, users, policies, loopback gateways, raw mount UI, raw desktop/local mount docs, `metadata_url`/bucket DTOs, or fixtures/generated/mock/evidence payloads remain as product truth.
3. Files UI is backed by an AgentSmith backend Files UI storage adapter. That adapter may use server-side AFSCP WebDAV/export or an upstream first-class AFSCP file API as equivalent safe backing paths; credentials stay server-side and frontend/API responses never expose export credentials.
4. The user-computer `Connect on my computer` product feature is absent in this milestone. No disabled/unavailable placeholder is shown. No acceptance criterion requires a productized desktop WebDAV connector, and no raw JuiceFS/PostgreSQL/object-storage/bucket/metadata/service credential instructions are exposed.
5. Files browser faithfully reflects the user-visible HOME/repo payload root for every AFSCP-backed file library, including normal dot folders, and opens the HOME root by default. `workspace/` remains an ordinary directory inside HOME and is the default agent/terminal working directory, not the Files browser root.
6. Save point, restore, and template dialogs tell users the scope is the whole file library HOME, which is the task HOME when bound, including hidden agent runtime folders, not only the current `workspace/` view.
7. Platform-managed Project secrets, managed OAuth credentials, execution tickets, runner connection secrets, WebDAV/export passwords, AFSCP credentials, and storage-root material are not automatically leaked or persisted into HOME payload. The handoff and tests distinguish this from user/agent-authored secret text files, which are user data risk rather than a platform guarantee.
8. Managed runner uses AFSCP workload mount binding and a sandbox-manager-only repo/namespace/destination/TTL-scoped mount plan. The sandbox manager cannot list/read arbitrary Kubernetes Secrets, cannot persist root credentials, and never exposes storage-root material to runner/task containers; Kubernetes/CSI performs the pod mount.
9. Developer runner uses the selected AFSCP export-backed lease/connector path with short TTL, revoke, heartbeat/reconcile, and AFSCP export/session accounting when Slice 5 is unblocked and implemented. If the current AFSCP contract cannot support this safely, Slice 5 remains officially blocked upstream with upstream blocker evidence, a no-workaround record, and no developer-runner-specific backend-real/deploy smoke required for this round.
10. Save point list/create works.
11. Restore preview/confirm/cancel works; cancel leaves files unchanged, restore blocks active or uncertain writers, preview plans bind repo base revision/generation/head/fence token, stale previews require preview again before restore-run, and restore-run pending is shown as restoring/reconciling until the backend reports terminal success before success feedback appears. The backend operation may still be named discard preview.
12. Template draft/publish/unpublish/delete/clone works within the AgentSmith project namespace model. Drafts are shown only in project template management to the creator and `project:files:update` users, mutation actions require `project:files:update`, published templates are available during task creation to current project members with `project:agent_task:use`, and no member/group sharing is introduced.
13. Template creation internal source save points are not shown as ordinary recovery points and are labeled `template source/internal` in audit/debug projection if surfaced.
14. Every product resource id and AFSCP resource id AgentSmith consumes maps back to the current `workspace_id/project_id/afscp_namespace_id`, current storage generation, lifecycle visibility, and ready namespace; AFSCP also rejects namespace mismatch; cross-namespace or invisible resources return not found without existence leakage.
15. Project/workspace disable/delete blocks new storage access, revokes exports and mount bindings, drains/reconciles active sessions, applies per-repo/template lifecycle, tombstones namespace mapping, and handles orphaned resources without assuming namespace delete.
16. AFSCP calls include the correct route-specific service auth, namespace, actor, idempotency, and correlation context without sending headers that do not belong to that route.
17. AFSCP operation/audit IDs can be projected into AgentSmith audit/debug views only with `project:audit:read`, current resource visibility, namespace match, and no sensitive storage details.
18. Permission revocation, membership removal, project disable, operation abort, or lease/revoke invalidates affected Files UI storage adapter access, server-side WebDAV exports when present, developer runner leases when present, and workload mount bindings.
19. File library reuse after task delete waits for AFSCP confirmed non-accessing terminal state.
20. Slice 2/3/6/7 contract-first artifacts are updated: endpoints, DTO/status/error shape, OpenAPI, generated types, MSW handlers and fixtures, i18n messages, focused e2e fixtures/scenarios, and focused visual coverage where UI states changed.
21. Slice 8 deploy evidence exists for unified deploy render/manifest/substrate-boundary/k8s dry-run unit checks and required product-flow smokes; developer-runner-specific deploy smoke is required only when Slice 5 is unblocked and implemented.
22. AFSCP upstream/release evidence exists for service caller mapping, namespace mismatch rejection, external control-root, selected Files UI storage backing policy, writer-session fence, restore preview base/fence validation, redacted operation view, template clone boundary, and required AFSCP internal contract validation. If AFSCP uses JVS internally, JVS-local proof is attached to AFSCP release evidence rather than becoming an AgentSmith gate. Developer runner lease/session accounting evidence is required when Slice 5 is unblocked; otherwise the upstream blocker and no-workaround record are required.
23. Focused tests and backend-real smokes listed above are green, except developer-runner-specific backend-real/deploy smoke is replaced by upstream blocker plus no-workaround evidence when Slice 5 is officially blocked.
24. Ordinary product routes cannot import, inject, or receive a raw AFSCP client configured with bootstrap token/caller-service. Product routes use the product adapter; project storage bootstrap uses the bootstrap port.
25. Product token/caller-service and bootstrap token/caller-service are distinct, and AgentSmith fails fast when they are missing, reused, or routed to the wrong port.
26. Product AFSCP operations are admitted only after ready namespace plus product-resource ownership/generation/lifecycle guard succeeds.
27. Unexpected bootstrap errors are persisted and returned only as sanitized status/error/next-action values; public responses and evidence never echo raw paths, tokens, storage ids, credentials, Secret refs, or raw AFSCP payloads.
28. Slice 1 may close with focused AFSCP internal contract validation for the bootstrap/client boundary and no public OpenAPI/generated/MSW change when storage status remains backend-internal; if user-visible project storage status/next-action is introduced, that change updates public contract artifacts. Subsequent integration slices require schema/generated client evidence for the AFSCP endpoints they consume.

## 9. Documentation Updates Required During Implementation

The implementation must keep these active documents aligned as behavior lands:

- `docs/contracts/afscp-file-libraries-architecture.md`: canonical AFSCP shared-volume repo model and Files adapter boundary.
- `docs/contracts/files-frontend-module-map.md`: frontend module contract for the AFSCP-backed file-library surface.
- `docs/contracts/internal-agent-workspace-binding-model-v1.md`: managed runner authority through AFSCP workload mount binding, sandbox-manager-only mount plan, and task HOME contract; developer runner authority through the export-backed lease/connector path, or through the upstream blocker/no-workaround record while Slice 5 remains blocked.
- `docs/agent-task-runner-runbook.md`: AFSCP-backed HOME runtime and no-secret persistence rules.
- `docs/user-guides/file-library-access-model.md`: user-facing file library access model. The current milestone must not expose raw JuiceFS local mount guidance; productized WebDAV connector guidance belongs only in a later connector milestone.
- Deleted raw JuiceFS docs such as `docs/contracts/juicefs-file-libraries-architecture.md`
  and `docs/user-guides/file-library-local-mount.md` must not be reintroduced.
  New docs must point to the active AFSCP contract and access model instead.
- OpenAPI, generated types, MSW handlers, and i18n messages when project
  storage readiness becomes user-visible, and for later save point, restore,
  template, and AFSCP-backed file-library status contract changes.
- Cleanup must include fixtures and mock/evidence payloads: MSW fixtures, e2e
  fixtures, storybook/story/generated fixtures, mock payloads,
  OpenAPI/generated type fixtures, backend-real evidence fixtures, and any
  other fixture that still encodes `metadata_url`, raw mount, bucket, or JuiceFS
  provider assumptions must be replaced or deleted.

Do not keep conflicting current-runtime storage descriptions once this implementation becomes the active path.
