# File Library Local Mount

This guide explains how to mount a project file library locally and how to verify that local changes stay in sync with the Files page.

## Prerequisites

- `juicefs` CLI installed on the local machine
- access to the target project file library
- mount permission through AgentSmith
- platform filesystem support:
  - Linux: FUSE
  - macOS: macFUSE
  - Windows: JuiceFS-supported mount dependencies

## Exchange Mount Access

In the Files page:

1. Open the target file library.
2. Click `Mount Access`.
3. Reveal the `metadata_url`.
4. Copy the command for your platform.

The default exchange surface exposes:
- `filesystem_name`
- `metadata_url`
- recommended mount path
- platform-specific `juicefs mount` commands

It does not expose backend MinIO credentials by default.

## Mount Locally

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

### `file_library_juicefs_cli_missing`
The AgentSmith backend host does not have `juicefs` installed or it is not reachable via PATH.

### `file_library_mc_cli_missing`
The AgentSmith backend host does not have `mc` installed or it is not reachable via PATH.

### `file_library_env_missing_*`
The backend is missing one or more required storage environment variables.

### non-empty library delete denied
This is expected. A file library must be empty before it can be deleted.

## Release Checks

The release-grade validation commands are:

```bash
npm run test:files:real:smoke
npm run test:files:real:sync
```
