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

### Library missing from AgentSmith Desktop
This is expected when the file library is not mountable yet.

AgentSmith Desktop only lists libraries that are ready for local mounting:
- status is `ready`
- backend initialization exists
- mount access exists

If a library does not appear in Desktop, go back to the Files page and inspect that library there.

### Files page shows `Failed` or `Degraded`
Treat this as a Files management problem, not as a Desktop mount problem.

Recommended action:
1. Open the library in the Files page.
2. Read the status badge and status reason.
3. If the library is a broken temporary or smoke library, delete it.
4. If the library is a real user library, rebuild or recreate it before trying Desktop again.

Important:
- AgentSmith Desktop hides non-mountable libraries on purpose.
- Files management is the place to govern failed or degraded libraries.
- AgentSmith does not provide a one-click reinitialize action for failed libraries.
- Current best practice is manual governance: decide whether to delete and recreate, instead of retrying an opaque repair action with unclear storage side effects.

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

### `file_library_mount_access_not_found`
The target library does not have usable mount access.

This usually means the library never finished backend initialization.

Recommended action:
1. Do not keep retrying in Desktop.
2. Return to Files management.
3. Delete the broken library if it is temporary or disposable.
4. Recreate the library and wait until it is `ready` before mounting.

Do not expect a `reinitialize` button here. The current product policy is to keep failed-library recovery explicit and operator-driven.

### `file_library_env_missing_*`
The backend is missing one or more required storage environment variables.

### non-empty library delete denied
This is expected. A file library must be empty before it can be deleted.

## Release Checks

The release-grade validation commands are:

```bash
npm run test:files:backend-real:smoke
npm run test:files:backend-real:sync
npm run test:e2e:integration:files:management-ux
```

For the combined real gate:

```bash
bash scripts/run-file-library-real-gate.sh
```

Expected resource recovery proof:
- a `boot-baseline.json` snapshot is captured before the API starts, and `file-library-api-startup.json` turns that boot snapshot into an explicit startup verdict instead of summary-only evidence
- startup quiesce proof is bound to a saved authority object in `startup-quiesce.authority.json`, so freeze and failure observation both revalidate the same owned listener identity instead of trusting pid-only handoff
- temporary file-library gateway state returns exactly to the pre-run baseline
- managed `juicefs gateway` processes return exactly to the pre-run baseline, including the same per-library pid set
- the API process and every managed gateway process return to the ready baseline for `open_fd_count` and `socket_fd_count`
- tracked TCP connections from the API process and managed gateways do not grow beyond the ready baseline; new `ESTABLISHED` / `CLOSE_WAIT` tuples are treated as leaks
- the mount-sync smoke mountpoint is no longer an exact mount and no matching `juicefs mount` process remains
- missing cleanup truth is a hard failure: if `/proc` fd truth, `ss`, `findmnt`, `ps`, a step verify report, or the final summary report cannot be produced, the gate fails closed

Failure-path expectation:
- each smoke step must still emit its recovery verify report even when that smoke step itself fails
- the final summary is allowed to pass only when every required step report exists and all recovery checks return to baseline

The real gate writes a structured recovery report under:
- `artifacts/backend-real/current/file-library-real-gate/resource-recovery/boot-baseline.json`
- `artifacts/backend-real/current/file-library-real-gate/resource-recovery/baseline.json`
- `artifacts/backend-real/current/file-library-real-gate/resource-recovery/startup-quiesce.snapshot.json`
- `artifacts/backend-real/current/file-library-real-gate/resource-recovery/startup-quiesce.authority.json`
- `artifacts/backend-real/current/file-library-real-gate/resource-recovery/failure-observation.json` when the gate fails before the ready baseline is frozen
- `artifacts/backend-real/current/file-library-real-gate/resource-recovery/file-library-api-startup.json`
- `artifacts/backend-real/current/file-library-real-gate/resource-recovery/report.json`
- `artifacts/backend-real/current/file-library-real-gate/resource-recovery/report.md`

`report.json` and `report.md` now preserve the startup evidence chain instead of flattening every pre-ready snapshot into a fake ready baseline:
- `boot-baseline.json` proves what existed before the API booted
- `startup-quiesce.snapshot.json` is the startup candidate that satisfied the declared steady-state contract before the ready baseline freeze
- `startup-quiesce.authority.json` proves which owned listener identity the startup candidate belonged to
- `failure-observation.json` records the later pre-ready observation when startup fails before the ready baseline is frozen
- `file-library-api-startup.json` distinguishes whether startup was evaluated against the ready baseline, the startup candidate, or the failure observation
- `baseline.json` exists only when the ready baseline was actually frozen and is the baseline that every smoke step must return to

This report is a file-library real-gate substep artifact.
It is not a new global governance evidence kind.

The Files management walkthrough command above is the release-grade UX check for:
- `ready` libraries remaining mountable
- `degraded` libraries showing recovery guidance instead of a misleading loading state
- delete confirmation using explicit cleanup wording
- screenshot artifacts being generated for release evidence

The screenshot evidence is written under `test-results/` so the release reviewer can inspect:
- ready library overview
- degraded library overview
- degraded library delete confirmation
