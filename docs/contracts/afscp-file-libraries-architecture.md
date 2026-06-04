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
- restore starts as a direct operation after the user confirms current file changes that were not saved to a save point will be discarded
- direct restore admission must use AFSCP `POST /internal/v1/repos/{repoId}/restore:admit` before AgentSmith creates a local durable restore operation; `listSavePoints` is history/listing evidence only and must not be treated as restore readiness
- restore readiness, blockers, stale state, and failures are backend-owned truth
- restore pending states must remain pending/restoring in the UI until the backend reports terminal success or typed failure
- restore changes files only; task conversation and trace state are not restored

AFSCP sibling evidence: `agentsmith-fs-control-plane` commit `f8bd4576a8daa0bc9a04fdfca18bd272e09f43cf` added restore-specific admit preflight. Capability denied from that endpoint is an admission failure and must happen before AgentSmith writes restore start/terminal audit or invokes AFSCP `/restore`.

### Read Export and Workspace Binding Convergence

这里的 convergence 指 Files API 为了让读投影、task file attachment、AFSCP workspace binding 回到可读/可释放状态而执行的后台收敛，不是用户可见的新产品流程。

- read export `pending` / `file_library_list_pending`: the list API returns typed pending, starts or continues runtime-access release, and retries the read export only after release completes.
- read export after release: once runtime access is terminally released, the backend invalidates the list read export before the next successful list response.
- read export after completed release fence: if Files listing still reports `file_library_list_pending`, the completed fence is treated as released and the backend invalidates the stale read export, returns typed pending, and lets the caller's next poll use a fresh export until the listing succeeds or a typed blocker is returned.
- workspace binding `releasing` / `release_pending`: the backend keeps calling the workspace-binding release path with bounded rechecks until the binding reaches a terminal release state or a typed blocker is returned.
- workspace binding `offline` / `not_found`: the state is treated as no active holder for release convergence; creation or reattachment must go through the owning Agent Task sandbox path instead of Files inventing a local connector.
- workspace binding `pending`: the backend keeps the operation pending/restoring/releasing until AFSCP returns terminal success or a typed failure/blocker.
- workspace binding PVC lookup not ready: ASBCP `ensure_workspace_binding` returning `internal_error` with message `get persistent volume claim failed` is classified as readiness convergence and retried within the bounded workspace-binding path.
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
