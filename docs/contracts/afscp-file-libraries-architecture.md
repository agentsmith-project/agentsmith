# AFSCP-Backed File Libraries Architecture

This document defines the product-facing Files contract.

## Summary

- A file library is a project-scoped resource for task files.
- Users manage libraries through the Files page and file-library APIs.
- The backend is the only authority for storage provisioning, readiness, task file attachment, auditing, and file operations.
- Browser clients must not receive storage backend identifiers, export URLs, raw credential material, or local setup commands.
- Local client connector access is not part of the current product surface.
- AgentSmith consumes AFSCP APIs and redacted operation projections only. JVS is an AFSCP-internal implementation detail or local bootstrap detail; AgentSmith product code must not parse JVS fields, command output, paths, hashes, or control-root settings.

Implementation detail: backend records and runner contracts may still use `HOME` or `task_home_*` field names for the sandbox path binding. Product UI and user-facing guides must describe this as task files, system folders, file library status, or file-library attachment.

## Public DTO

Required product fields:
- `id`
- `workspace_id`
- `project_id`
- `name`
- `description`
- `source`
- `file_library_home_segment`
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

`file_library_home_segment` and `task_home_binding_status` are DTO implementation fields. They may be used for backend-owned attachment state, but the frontend must not render them as user-facing storage paths.

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
- File states:
  - save points for the whole file library HOME payload
  - restore preview, restore run, and restore cancel
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
- The normal Files entry opens `workspace/`; the file-library root remains reachable and may contain system folders.
- User-facing copy should describe these entries as task files, system folders, and file library status. It must not expose backend storage paths, internal execution wording, or local connector concepts.

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
- restore must be previewed before it can run
- restore readiness, blockers, stale state, and failures are backend-owned truth
- restore changes files only; task conversation and trace state are not restored

### Task File Templates

- task file templates are published starting file sets for Agent task creation
- draft/unpublished templates are visible only in File states management
- task creation may consume published task file templates through the Agent task creation contract
- template publication and deletion are file-library mutations

## Release Validation

Before release, use the release sign-off entrypoint:

```bash
npm run release:ready
```

Focused Files owner diagnostics are useful while investigating Files behavior, but release sign-off must return to the appropriate verify or release gate for the current stage.
