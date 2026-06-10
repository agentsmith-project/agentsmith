# AFSCP-Backed File Libraries Architecture

This document defines the product-facing Files contract.

## Summary

- A file library is a project-scoped resource for task files.
- Users manage libraries through the Files page and file-library APIs.
- The backend is the only authority for storage provisioning, readiness, task file attachment, auditing, and file operations.
- Browser clients must not receive storage backend identifiers, export URLs, raw credential material, or local setup commands.
- Local client connector access is not part of the current product surface.
- AgentSmith consumes AFSCP APIs and redacted operation projections only. JVS is an AFSCP-internal implementation detail or local bootstrap detail; AgentSmith product code must not parse JVS fields, command output, paths, hashes, or control-root settings.

Implementation detail: backend records and runner contracts may still use `HOME` or `task_home_*` field names for the sandbox path binding. Product UI and user-facing guides must describe this as task files, HOME hidden runtime directories, file library status, or file-library attachment.

## Public DTO

Required product fields:
- `id`
- `workspace_id`
- `project_id`
- `name`
- `description`
- `source`
- `status`
- `task_home_binding_status`
- `bound_task_visible`
- `created_by_user_id`
- `created_at`
- `updated_at`

Optional product status fields:
- `storage_status`
- `storage_next_action`
- `status_reason`

Do not add or expose backend storage fields such as storage backend names, buckets, provider names, metadata endpoints, export URLs, credentials, or setup commands.
`task_home_binding_status` is a DTO implementation field for backend-owned attachment state. Do not expose backend HOME path segments or render any attachment identifier as a user-facing storage path.

## Access Surfaces

### Files UI

The Files page supports:
- library create, rename, and delete
- browse directories and files
- default browsing starts at the file library HOME root
- `workspace/` is an ordinary directory under HOME and the agent/terminal default working directory, not the Files browser root
- upload and download
- move and delete entries
- task attachment display and deletion blocking
- Version & templates:
  - save points for the whole file library HOME payload
  - direct restore from a save point after confirming unsaved file changes will be discarded
  - task file template create, publish, unpublish, and delete

### Local Client Connectors

No local client connector route is defined in the current public contract. Files are accessed through the Web/API surface, and Agent task work uses backend-managed task file attachment. Browser clients must not receive connector setup fields, credentials, metadata endpoints, bucket URLs, or local setup commands.

## Provisioning Rules

The backend owns provisioning and must only project product-safe status to clients:
- `status`
- `storage_status`
- `storage_next_action`
- `status_reason`

Status fields must not include namespace, repository, volume, export id, credential, endpoint, or local path details.

## Runtime Rules

### Directory Visibility

- The backend is the authority for listed folders and files.
- The frontend must render the returned directory entries faithfully and must not filter dot folders or dot files.
- The normal Files entry opens the file library HOME root. `workspace/` is a normal child directory and the agent/terminal default working directory.
- User-facing copy should describe these entries as task files, HOME hidden runtime directories, and file library status. It must not expose backend storage paths, internal execution wording, or local connector concepts.

### Library Status

- `creating`
- `ready`
- `degraded`
- `failed`
- `deleting`

### Delete

- non-empty libraries fail fast
- task-bound libraries cannot be deleted until the bound task is deleted
- force-delete is out of scope for v1

### Save Points and Restore

- save points snapshot the whole file library HOME payload for the selected file library
- save point create `accepted` / `pending` states mean the request has entered a controlled operation; they are not terminal success and must not be projected as a list-visible save point
- after save point create or restore is `accepted` / `pending`, the public operation id must stay lookupable and resolve to terminal truth or an explicit typed pending/failed result; the operation must not silently disappear
- save point terminal success requires one durable save point fact that the same file library can observe through operation projection, save point list, save point read/detail paths, and restore admission/readiness paths
- if writer boundary, storage/materialization, or list-visible truth has not converged, the backend must keep the public operation typed pending or return a public-safe typed failed/recovery-required result; it must not leave users with an admitted operation, an unexplained terminal/empty projection, and a `200` empty save point list to wait on
- restore starts as a direct controlled operation after the user confirms current file changes that were not saved to a save point will be discarded; user request accepted / local operation accepted means AgentSmith has entered pending control, not that AFSCP storage restore has started or succeeded
- storage restore started semantics may be recorded or projected only after AFSCP restore admission/readiness succeeds; `listSavePoints` is history/listing evidence only and must not be treated as restore readiness
- restore readiness, blockers, stale state, and failures are backend-owned truth
- before restore is projected ready, the owning backend must converge related writer fence/drain/flush and release state; ASBCP/sandbox owns workload writer lifecycle and readiness signals, not Files terminal success
- restore pending states must remain pending/restoring in the UI until AFSCP restore terminal truth and the same file library list/read/restore visibility boundaries converge, or until the backend reports typed failure
- terminal success must correspond to same file library visible facts through operation projection plus list/read/restore paths; terminal success without those visible facts is not a valid public operation result
- restore changes files only; task conversation and trace state are not restored
- keep this surface KISS/DRY/YAGNI: use existing operation/list/read/restore projections and owner-typed errors instead of adding gate, report, or retry layers to compensate for terminal truth gaps

AFSCP sibling evidence: `agentsmith-fs-control-plane` commit `f8bd4576a8daa0bc9a04fdfca18bd272e09f43cf` added restore-specific admit/preflight capability. That is owner-side admission evidence and is distinct from Files list history; admission failure must be known before AgentSmith writes restore start/terminal audit or invokes AFSCP `/restore`.

### Read Export and Workspace Binding Convergence

这里的 convergence 指 Files API 为了让读投影、task file attachment、AFSCP workspace binding 回到可读/可释放状态而执行的后台收敛，不是用户可见的新产品流程。

| Surface | `pending` | `releasing` | `offline` | `not_found` |
| --- | --- | --- | --- | --- |
| Files | Return typed `file_library_list_pending`, continue runtime-access release convergence, and recheck without reading a stale projection. | Wait for workspace binding release convergence before creating read export; return typed pending while release is non-terminal. | Treat as no active writer and use only the Files read/export path; do not create an executable connector. | Treat as no active writer; do not synthesize an executable connector. |
| Agent Task sandbox | Continue bounded ASBCP status checks until `Running`, `Failed`, or timeout. | Wait for workload release or return a typed release-incomplete error; do not start a second task HOME holder. | Call ASBCP create-or-ensure, then continue status checks until `Running`, `Failed`, or timeout. | Call ASBCP create-or-ensure, then continue status checks until `Running`, `Failed`, or timeout. |
| AFSCP workspace binding | Keep the operation pending through the workspace binding owner until terminal success or typed failure/blocker. | Keep release convergence through the workspace binding owner until terminal `released`, `revoked`, `expired`, or `deleted`. | Treat as no active holder for release/read export; executable reattachment must use the Agent Task sandbox owner path. | Treat as no active holder for release/read export; executable reattachment must use the Agent Task sandbox owner path. |
| Read export | Return typed pending, continue runtime-access release, and keep the pending read export warm for the caller's next poll. | Wait for runtime release fence or export invalidation; avoid repeated revoke/create loops while convergence is non-terminal. | Create or reuse the read export only after no active writer is observed. | Create a fresh read export if runtime access is clean; otherwise return typed pending. |

- read export `pending` / `file_library_list_pending`: the list API returns typed pending, starts or continues runtime-access release, and invalidates the read export once when this request/background recheck moves runtime access to released. Background invalidation is scoped to exports created at or before the pending observation so an older recheck cannot revoke a newer export created by a later poll.
- entries list before read export: when an idle runtime writer is still bound, the backend converges runtime-access release before creating a read export. If release is still pending or a retryable runtime/AFSCP release failure is observed, the list API returns typed `file_library_list_pending` rather than a successful response from a stale pre-release projection.
- read export after release: once runtime access transitions to terminally released, the backend invalidates the pre-release list read export before the next successful list response.
- read export after completed release fence: if Files listing still reports `file_library_list_pending`, the completed fence is treated as released and the backend keeps the pending read export warm for the caller's next poll instead of creating a repeated export revoke/create loop.
- workspace binding `releasing` / `release_pending`: the backend keeps calling the workspace-binding release path with bounded rechecks until the binding reaches a terminal release state or a typed blocker is returned.
- workspace binding completed release fence: a later terminal/session or managed run for the same task owner resumes the completed local fence through the Agent Task sandbox owner path before creating or ensuring a new executable workspace binding; active release fences remain pending/conflict.
- workspace binding release rate limited: sandbox/ASBCP 429 is a retryable readiness conflict during release/cleanup, so focused gates use bounded increasing backoff; repeated evidence becomes a stability blocker.
- workspace binding revoke idempotency conflict: AFSCP 409 `conflict` during runtime release is a retryable readiness conflict for Files/read-export convergence; repeated focused failures with the same evidence are stability blockers rather than one-off Files bugs.
- workspace binding revoke idempotency key: revoke keys are scoped to the concrete mount binding generation/id, so recreating the same task HOME after a completed release cannot reuse the previous generation's revoke key.
- terminal close final truth: once a terminal session is closed in backend truth, focused cleanup does not fail solely because workspace-binding release is still pending; the remaining release/revoke state is carried by runtime readiness evidence and later Files/restore convergence.
- workspace binding `offline` / `not_found`: the state is treated as no active holder for release convergence; creation or reattachment must go through the owning Agent Task sandbox path instead of Files inventing a local connector.
- workspace binding `pending`: the backend keeps the operation pending/restoring/releasing until AFSCP returns terminal success or a typed failure/blocker.
- workspace binding PVC lookup not ready: ASBCP `ensure_workspace_binding` returning `internal_error` with message `get persistent volume claim failed` is classified as readiness convergence and retried within the bounded workspace-binding path.
- focused gate classification: first sandbox-unavailable failure followed by a passing focused rerun is a runtime flake; repeated sandbox-unavailable or release/read-export pending failures are stability blockers until backend-real evidence explains the runtime owner condition.
- gate observation should use increasing wait intervals after consecutive non-terminal checks; it should not rely on fixed once-per-minute polling.
- runtime readiness details: `runtime-readiness-details.json` must expose `signals` / `call_summaries` entries for `AGENT_SANDBOX_UNAVAILABLE`, including API, pod-manager, and ASBCP create/status summaries with request id, workload id, phase, status/error codes, and retryability when present in source logs.
- Product Readiness evidence must preserve the Files restore continuation focused backend-real gate before the full Product Readiness campaign, because this slice proves restore can continue through pending read export and release convergence.

### Task File Templates

- task file templates are published starting file sets for Agent task creation
- draft/unpublished templates are visible only in Version & templates management
- task creation may consume published task file templates through the Agent task creation contract
- template publication and deletion are file-library mutations

## Release Validation

Before release, use the release sign-off entrypoint:

```bash
npm run product:ready
```

`npm run release:ready` remains only a deprecated transition alias for `npm run product:ready`.
Focused Files owner diagnostics are useful while investigating Files behavior, but release sign-off must return to the appropriate verify or product readiness gate for the current stage.
