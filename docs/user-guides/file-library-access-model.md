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

- Opening the Files page from normal project navigation starts at the file library HOME root. When a library is attached to an Agent task, that root is the task HOME.
- The `workspace/` folder is a normal child folder under HOME. Task work can place user-facing task files there, and task artifacts live under `workspace/.artifacts/`.
- The HOME root view shows files and system folders exactly as the backend lists them. Dot folders such as `.codex/`, `.mbos/`, `.agents/`, or `.cache/` are not hidden by the frontend when they exist; not every HOME contains every example folder.
- Folder visibility is a file library state issue. If a system folder looks unexpected, review the file library status and task activity before deleting or moving it.

## Access Model

- Members with project read/use access can browse file libraries and download files.
- Members also need Files update access to create libraries, upload files, create folders, rename, move, delete, manage Version & templates, create restore points, restore files, or publish task file templates.
- Published task file templates are starting file sets for new Agent tasks. Task creation shows them as task file templates, not as generic file templates.
- Save points and restore apply to the whole file library HOME, not just the currently open folder or `workspace/`.
- Restoring may take time. Treat "restoring" or "pending" as an in-progress state until the Files page reaches a final success or failure state.
- A file library attached to a task stays attached until that task is deleted and the release finishes. Stopping or ending a task run does not make the library reusable.
- Reusing a released library carries over HOME files only. Old task messages, traces, terminal sessions, runner binding, and artifact metadata are not reused.

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

### Version & templates is not visible

This is expected for members without Files update access. You can still browse and download project files when you have read/use access.

## Release Checks

Release sign-off uses:

```bash
npm run release:ready
```

Focused Files diagnostics can help investigate a failure, but they are not release-grade verdicts by themselves.
