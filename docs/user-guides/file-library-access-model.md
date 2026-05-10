# File Library Access Model

Files are managed through the AgentSmith web Files page and the project file-library API.

Supported work:
- browse directories and files
- download files
- upload files, create folders, rename, move, and delete entries when you have Files update access
- manage project-scoped file libraries when you have Files update access
- review whether a library is attached to an Agent task

Agent task work uses backend-managed task files. Treat the Files page as the supported inspection and management surface for project files.

## Directory Model

- Opening the Files page from normal project navigation starts in `workspace/`, which is where task work should place user-facing task files.
- The file-library root is still reachable from the breadcrumb or with `prefix=/` in the Files URL.
- The root view shows task files and system folders exactly as the backend lists them. Dot folders such as `.codex/`, `.mbos/`, `.agents/`, or `.artifacts/` are not hidden by the frontend.
- Folder visibility is a file library state issue. If a system folder looks unexpected, review the file library status and task activity before deleting or moving it.

## Access Model

- Members with project read/use access can browse file libraries and download files.
- Members also need Files update access to create libraries, upload files, create folders, rename, move, delete, manage File states, create save points, restore files, or publish task file templates.
- Published task file templates are starting file sets for new Agent tasks. Task creation shows them as task file templates, not as generic file templates.

## Current Behavior

The Files page does not show local setup dialogs, desktop connector buttons, storage credentials, backend storage identifiers, metadata endpoints, buckets, or setup commands.

Only documented public API routes are part of the current contract. Requests to paths outside the contract are handled as unmatched routes.

## Troubleshooting

### Files page shows `Failed` or `Degraded`

Treat this as a Files management problem.

Recommended action:
1. Open the library in the Files page.
2. Read the status badge and status reason.
3. If the library is temporary or disposable, delete it after emptying it.
4. If the library contains real user files, contact the workspace/project administrator.

### non-empty library delete denied

This is expected. A file library must be empty before it can be deleted.

### bound library delete denied

This is expected. A library attached to a task cannot be deleted until the bound task is deleted.

### File states are not visible

This is expected for members without Files update access. You can still browse and download project files when you have read/use access.

## Release Checks

Release sign-off uses:

```bash
npm run release:ready
```

Focused Files diagnostics can help investigate a failure, but they are not release-grade verdicts by themselves.
