# File Library Local Mount

This guide explains the supported local-mount paths for project file libraries.

The default product path is now:

- use **AgentSmith Desktop**

Manual JuiceFS shell commands are kept only for advanced debugging and verification.

## Prerequisites

- access to the target project file library
- mount permission through AgentSmith

If you are using AgentSmith Desktop:

- install the Desktop build for your platform
- let Desktop Doctor check the platform prerequisites

If you are using the manual debug path:

- `juicefs` CLI installed on the local machine
- platform filesystem support:
  - Linux: FUSE
  - macOS: macFUSE
  - Windows: JuiceFS-supported mount dependencies

## Preferred Path: AgentSmith Desktop

In the Files page:

1. Open the target file library.
2. Click `Desktop`.
3. Sign in to AgentSmith Desktop with the same deployment.
4. Activate the target library inside Desktop.

Expected behavior:

- Desktop lists the current user's visible libraries
- the user activates the library there
- Desktop handles the local mount target
- Desktop diagnostics explain missing prerequisites or mount failures

## Advanced Debug Path: Manual Mount

Use this path only when you need to debug or manually validate the underlying JuiceFS access.

In the Files page:

1. Open the target file library.
2. Click `Advanced manual mount`.
3. Reveal the `metadata_url`.
4. Copy the command for your platform.

The exchange surface exposes:
- `manual_mount_access.filesystem_name`
- `manual_mount_access.metadata_url`
- `manual_mount_access.storage_bucket_url`
- recommended mount path
- platform-specific `juicefs mount` commands

It does not expose backend MinIO credentials by default.

## Manual Mount Locally

Example:

```bash
juicefs mount <metadata_url> <mountpoint>
```

For background mode:

```bash
juicefs mount <metadata_url> <mountpoint> -d
```

To unmount:

```bash
juicefs umount <mountpoint>
```

## Sync Expectations

The Files page and the local mount operate on the same JuiceFS filesystem.

Expected behavior:
- a file created locally appears in Files
- a file uploaded in Files appears locally
- deletes and renames propagate both ways

## Common Failures

### Desktop path blocked by missing prerequisites
This is expected when the current machine is missing one or more platform requirements:

- Linux: FUSE
- macOS: macFUSE
- Windows: WinFsp

Use Desktop diagnostics to see the missing prerequisite and the next action.

### `desktop_mount_prerequisites_missing:*`
Desktop blocked mount activation because the local machine is not ready for filesystem mounting yet.

### `desktop_mount_access_failed_*`
Desktop could not exchange mount access for the target library.

### `file_library_env_missing_*`
The backend is missing one or more required storage environment variables.

### non-empty library delete denied
This is expected. A file library must be empty before it can be deleted.

## Release Checks

The release-grade validation commands are:

```bash
npm run test:files:backend-real:smoke
npm run test:files:backend-real:sync
```
