# File Library Fast Save And Restore Simplification Plan v1

<!-- markdownlint-disable MD013 -->

Status: `team_reviewed_handoff_ready`
Date: 2026-05-14
Owner: Files / Agent task HOME maintainers

## 1. Purpose

This plan turns file library save/restore into a faster, simpler, user-owned workflow.

The product decision is direct:

- Users create save points only when they explicitly choose to save current state.
- Restore does not secretly save the current state.
- Restore does not ask users to wait for a visible preview.
- Restore clearly warns that current unsaved file changes will be discarded.
- After confirmation, the system restores directly to the selected save point.

This is a pre-GA simplification plan, not a migration compatibility plan and not a new recovery platform. The goal is to remove unnecessary hidden work, reduce user mental load, and make the common restore path fast enough for live use and customer demos. Because AgentSmith is pre-GA, the implementation should be a clean range refactor: do not keep old preview-first behavior as a compatibility layer or fallback shim.

## 2. Current Problem

The current restore path is too heavy:

1. User clicks restore on a save point.
2. AgentSmith creates a hidden `Restore preview current state` fence save point.
3. AgentSmith asks AFSCP/JVS to create a restore preview.
4. User then confirms restore-run.

In a real file library, the hidden fence save point can take more than two minutes because it snapshots the whole task HOME file tree, including runtime folders such as `.codex/`. AgentSmith currently polls AFSCP operations for about 30 seconds by default, so the UI can receive `FILE_LIBRARY_OPERATION_PENDING` before any durable restore preview exists. After refresh, the user cannot see or continue the preparation state and may click restore again, creating another hidden fence save point.

This creates slow behavior and confusing product semantics:

- Users did not ask the system to save current state.
- The UI implies restore is available, but the system first does hidden save work.
- Refresh loses the restore preparation state.
- Tests can pass on small fixtures while real libraries fail or appear stuck.
- The save point list needs extra logic to hide internal fence save points.

## 3. Product Decision

Save point is the only recovery boundary users need to understand.

Restore is a destructive, confirmed operation:

> Restore this file library to the selected save point. Current file changes that were not saved to a save point will be discarded.

There should be no product-level restore preview step.

The user flow should be:

1. User creates a save point before important changes.
2. User later chooses a save point and clicks restore.
3. UI shows a simple confirmation dialog.
4. User confirms.
5. Backend starts a direct restore operation.
6. UI shows restoring progress until terminal success or failure.
7. Files refreshes and shows the restored file tree.

This decision does not remove safety. It moves safety to the right boundary: explicit save point creation plus explicit destructive confirmation.

## 4. Non-Goals

- Do not add another visible preview/diff workflow.
- Do not keep hidden current-state save points in the normal restore path.
- Do not ask users to type a save point name unless a future product incident proves simple confirmation is insufficient.
- Do not introduce a broad recovery dashboard.
- Do not preserve compatibility with the old user-facing restore preview mental model or old preview-first contract.
- Do not reduce backend ownership checks, permission checks, storage readiness checks, or active-writer blocking.
- Do not change task messages, traces, terminal history, runner binding, or artifact metadata during restore; restore changes files only.
- Do not solve generic file version history in this milestone.

## 5. Target UX

### 5.1 Save Point Creation

The save point panel remains explicit and user-owned.

Required behavior:

- Primary action: `Save current state`.
- Optional note remains lightweight.
- While saving, show `Saving file state...`.
- If saving is still syncing, show a recoverable pending state and keep the user's note.
- Do not create any save point as a side effect of restore.

Suggested copy:

- Title: `Save current state`
- Helper: `Create a recovery point for the whole file library before major file changes.`
- Pending: `Saving file state...`
- Success: `Save point created.`

### 5.2 Restore Entry

Each save point row has one restore action.

Restore button behavior:

- Clicking restore opens a confirmation dialog.
- It does not call backend preview first.
- It does not create a hidden fence save point.
- It does not disable the whole save point list unless a restore operation is already active.

Suggested row action:

- Button: `Restore`

### 5.3 Restore Confirmation Dialog

Use a small, plain-language destructive confirmation.

Required content:

- Which save point will be restored.
- Scope: the whole file library content.
- Consequence: current file changes not saved to a save point will be discarded.
- Conversations and traces are not restored.

Suggested copy:

Title:

`Restore to "{savePointLabel}"?`

Description:

`This will replace the current file library files with the selected save point. Current file changes that were not saved to a save point will be lost. Other save points will remain, but the file library will return to this saved state. Conversations and traces will not change.`

Additional helper:

`If you want to keep the current files, cancel and save the current state first.`

Actions:

- Secondary: `Cancel`
- Destructive primary: `Restore files`

Avoid:

- `preview`
- `diff`
- `fence`
- `current-state backup`
- `HOME payload` in user-facing copy
- raw backend operation terms

### 5.4 Restore Progress

After confirmation, show one visible durable operation state.

States:

- `restoring`: `Restoring files...`
- `succeeded`: `Files restored.`
- `failed`: `Restore failed. No successful restore was applied. Review the reason and try again.`
- `blocked before start`: typed user-action blocker, for example active writer or storage not ready.

Refresh behavior:

- If the page is refreshed while restore is running, reopening File states must show the active restore operation.
- The file table should be disabled or guarded for destructive writes while restore is active.
- On success, file object caches are invalidated and the browser refetches the current directory.

### 5.5 Active Writer And Storage Blockers

The faster flow still needs real consistency protection.

Keep blockers for:

- file library not ready
- project file storage unavailable
- active writer / bound task still writing
- namespace or ownership mismatch
- unsupported project capability

Copy must tell users what to do next. It must not expose internal resource ids, storage paths, or AFSCP/JVS error payloads.

## 6. Target Backend Contract

### 6.1 Product API

Use a direct product API. Because the product is pre-GA, remove the old preview-first product contract rather than keeping a compatibility layer.

```http
POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/restore
Content-Type: application/json
Idempotency-Key: 4c9e5a3f-8c1d-4a2e-8e91-9d0ff4f68f5b

{
  "save_point_id": "flsp_...",
  "discard_unsaved_changes_confirmed": true
}
```

Successful response:

```json
{
  "id": "flro_...",
  "file_library_id": "flib_...",
  "source_save_point_id": "flsp_...",
  "status": "pending",
  "created_at": "2026-05-14T00:00:00.000Z",
  "updated_at": "2026-05-14T00:00:00.000Z"
}
```

Active operation projection:

```http
GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/file-libraries/{libraryId}/restore
```

Returns:

```json
{
  "restore_operation": null
}
```

or:

```json
{
  "restore_operation": {
    "id": "flro_...",
    "file_library_id": "flib_...",
    "source_save_point_id": "flsp_...",
    "status": "restoring",
    "created_at": "2026-05-14T00:00:00.000Z",
    "updated_at": "2026-05-14T00:00:02.000Z"
  }
}
```

Allowed statuses:

- `pending`
- `restoring`
- `succeeded`
- `failed`

Blockers such as active writer, storage not ready, save point not found, namespace mismatch, and unsupported capability are admission checks. They return typed errors before a restore operation is created. Do not create a long-lived `blocked` restore operation for preflight failures.

`Idempotency-Key` is required. Do not silently replace a missing key with a server-generated random id in the direct restore handler. Missing or invalid idempotency keys should fail validation so double-clicks, retries, and refresh recovery are deterministic.

Remove these old product routes from the active contract:

- `POST /restore-preview`
- `GET /restore-preview`
- `POST /restore-run` with `restore_preview_id`
- `POST /restore-cancel`

If implementation files temporarily keep internal helper names while code is being refactored, they must not remain in generated types, MSW public mocks, active OpenAPI, route-kind maps, product docs, frontend hooks, or tests after the slice is complete.

### 6.2 AFSCP Adapter

Required target AFSCP capability:

- direct restore by `save_point_id`
- no current-state fence save point
- durable operation id
- idempotency key
- ownership and namespace validation

If current AFSCP only exposes preview/run at implementation time, this implementation slice is upstream-blocked until AFSCP provides direct restore by save point or an equivalent direct operation. Do not implement AgentSmith's target flow by wrapping preview/run behind the adapter. That would keep the old behavior as an internal workaround and recreate the same latency and state-continuation risks under a new name.

The storage port should move from preview-oriented methods to direct restore methods, for example:

- `restoreSavePoint(input)`
- `reconcileRestoreOperation(input)`

Normal restore must not call preview, run-preview, or preview-discard adapter methods.

Acceptance evidence must prove restore does not create any restore-triggered save point, checkpoint, fence, or preview record. The check must use operation type/source evidence, not only the old `Restore preview current state` message string.

### 6.3 Sibling Project Capability Gaps

If a required capability is missing from a sibling project, for example `agentsmith-fs-control-plane`, `jvs`, or `llm-universal-proxy`, the plan must treat that as product infrastructure work, not as an AgentSmith workaround, wait state, or vague external dependency.

Required process:

- Assign a dedicated team member to enter the sibling project, with a narrow ownership scope.
- Use a separate branch in the sibling project for the capability work.
- Start with sibling-project TDD that proves the required capability directly, such as direct restore by `save_point_id` without hidden current-state save points.
- Keep the sibling change small and structural: add the missing runtime capability at the right layer instead of compensating in AgentSmith.
- Build and run the sibling project's focused tests before AgentSmith integration begins.
- Record the sibling project commit, version, image, local build artifact, and contract evidence that AgentSmith consumes.
- Treat that sibling evidence as AgentSmith acceptance input before the dependent AgentSmith slice can be considered complete.
- Only then update AgentSmith's adapter, contracts, and real lane evidence against that sibling capability.

Forbidden process:

- Do not add an AgentSmith compatibility layer to hide missing sibling capability.
- Do not leave AgentSmith waiting on an unnamed or unowned sibling-project dependency.
- Do not wrap old preview/run behavior and call it direct restore.
- Do not fake performance evidence with mocks if the sibling runtime path is still missing.
- Do not merge AgentSmith UI/API changes that depend on a missing sibling capability without marking the slice blocked.

For this restore simplification, the concrete sibling requirement is:

- AFSCP/JVS must provide direct restore from an existing save point with durable operation tracking, idempotency, namespace/ownership validation, and no restore-triggered save point creation.

### 6.4 Persistence

Create or adapt a durable restore operation record. The product-facing model should use restore operation language, not restore preview language.

Required fields:

- `id`
- `workspace_id`
- `project_id`
- `file_library_id`
- `source_save_point_id`
- `source_afscp_save_point_id`
- `afscp_operation_id`
- `idempotency_key`
- `status`
- `created_by_user_id`
- `created_at`
- `updated_at`
- optional `started_at`
- optional `finished_at`
- optional typed blocker summary
- optional sanitized failure reason

`source_afscp_save_point_id`, `afscp_operation_id`, and low-level storage metadata are internal persistence fields only. Do not expose them in the product API projection, user-visible audit summary, or UI. Do not persist internal AFSCP/JVS raw payloads into product-visible records.

Audit must still record:

- actor
- file library
- selected save point
- explicit discard confirmation
- final result
- sanitized failure category if failed

### 6.5 Idempotency

Restore confirmation must be idempotent.

Required behavior:

- Repeated clicks with the same `Idempotency-Key` return the same restore operation.
- Persist a unique key on `(workspace_id, project_id, file_library_id, idempotency_key)`.
- If the same save point restore is already active for the library, return the active operation instead of starting another one.
- If another restore operation is active, return `FILE_LIBRARY_OPERATION_PENDING` with the active operation projection.
- If restore already succeeded and the same idempotency key is retried, return the succeeded operation.
- Do not use `requestId ?? randomUUID()` as restore idempotency semantics.

### 6.6 Concurrency

While restore is active:

- block file upload, delete, move, rename, and folder creation for the target library
- block save point creation for the target library
- block task file template creation/publish for the target library
- allow read-only listing/download when backend storage can serve a consistent view; otherwise return pending

The backend remains authoritative. Frontend disabling is only a UX affordance.

Use one shared backend gate, for example `ensureNoActiveRestoreOperation`, for all mutating file-library routes that can conflict with restore. The gate must cover upload, delete, move, rename, folder creation, save point creation, and task file template publish/create. Active writer and storage readiness checks must run before any AFSCP restore mutation.

Task file template internals must not be confused with user save points. If template creation needs an internal snapshot, it must be modeled as a template source artifact or internal AFSCP implementation detail, not as a user-visible save point.

## 7. Implementation Slices

### Slice 0. Contract And UX Decision Lock

Actions:

- Add or update API contract for direct restore.
- Remove preview-first restore routes from active OpenAPI/generated types/MSW public contract.
- Remove old route registrations from `projects-route-match.ts`, `project-route-dispatchers-file-libraries.ts`, `required-project-permissions.ts`, and `docs/contracts/specs/openapi-route-kind-map.json`.
- Add direct restore route-kind coverage for `POST /restore` and `GET /restore`.
- Mark user-facing restore preview as obsolete or remove it from active docs.
- Update copy source for new confirmation and progress states.
- Define restore operation status projection.

Acceptance:

- Product docs and UX copy no longer describe preview as a user step.
- Contracts expose direct restore semantics.
- No user-facing text says the system saves current state before restore.
- Generated API types do not require `restore_preview_id` for the normal restore path.
- Frontend API endpoints do not expose restore preview as the main Files recovery flow.
- Static contract guard fails if active OpenAPI, generated types, route-kind map, MSW handlers, Files API hooks, messages, E2E stories, or real smoke scripts still encode the old normal restore path.

Focused verification:

```bash
npm run contracts:check
npm run contracts:check-openapi
npm run openapi:check-generated
```

### Slice 1. Backend Direct Restore

Actions:

- If AFSCP/JVS direct restore is missing, pause AgentSmith backend implementation and assign a team member to implement that sibling capability first.
- Delete or isolate `createRestorePreviewCurrentStateFence` and `RESTORE_PREVIEW_FENCE_SAVE_POINT_MESSAGE` from the normal restore path.
- Add direct restore route/handler.
- Persist restore operation before or at operation start so refresh can resume state.
- Reconcile AFSCP operation status into restore operation status.
- Refactor the storage port from `createRestorePreview` / `runRestorePreview` / `discardRestorePreview` to direct restore semantics for the normal path.
- Keep active writer, storage readiness, namespace, permission, and capability checks.
- Remove normal-path creation of `restore_preview_fence` save points.
- Add the shared active-restore mutation gate across conflicting file-library routes.
- Remove or rewrite route tests that encode hidden fence, stale preview, cancel preview, or preview-first semantics.

Acceptance:

- If sibling work was required, AgentSmith evidence names the sibling commit/version/image/local artifact and contract evidence used for integration.
- Backend unit test proves restore does not call `createSavePoint`.
- Backend unit test proves restore does not create a restore preview record.
- Adapter test proves normal restore does not call preview, run-preview, or preview-discard methods.
- Backend integration test proves restore changes files to the selected save point.
- API response is idempotent for duplicate confirm with the same `Idempotency-Key`.
- Refresh/reopen can read active restore operation.

Focused verification:

```bash
npm run test -- -t "file library restore"
npm run test -- -t "project file library routes"
```

Use the repo's actual focused test command names during implementation if they differ.

### Slice 2. Frontend UX Simplification

Actions:

- Replace preview panel with direct restore confirmation dialog.
- Remove task-template blocking based on visible preview; block only while a restore operation is active.
- Show active restore operation on dialog reopen.
- Invalidate file object caches after terminal success.
- Keep save point creation pending UI, but do not reuse it for restore.
- Remove active restore preview query/cache from the recovery dialog and hooks.
- Update `zh-CN` and `en-US` messages together; no old `restore preview` text should remain in active UI.

Acceptance:

- Restore click opens confirmation immediately.
- No spinner appears before the confirmation dialog.
- Confirmation copy states unsaved file changes will be discarded.
- During restore, UI shows one progress state and disables conflicting writes.
- Refresh while restoring shows restoring state.
- The user-facing copy says “whole file library content” or equivalent plain language, not raw `HOME payload`, AFSCP, JVS, fence, or preview terminology.

Focused verification:

```bash
npm run test -- -t "FileLibraryRecoveryDialog"
```

### Slice 3. Real Lane User Story Coverage

Actions:

- Rewrite restore user story around direct destructive confirmation.
- Keep whole-HOME content verification.
- Add refresh-during-restore coverage. Backend and frontend/MSW tests must use a deterministic pending restore operation; real lane should provide API-level pending producer evidence if the full browser path cannot reliably hold the operation pending.
- Add evidence assertion that no hidden fence save point appears in ordinary save point list.
- Add backend/AFSCP evidence assertion that restore did not create any restore-triggered save point, checkpoint, fence, or preview record.
- Add request evidence proving the UI calls one direct `POST /restore` for a restore confirm, does not call `POST /save-points`, does not call `/restore-preview`, does not call legacy `/restore-run`, does not call `/restore-cancel`, and never sends `restore_preview_id`.

Required ordinary file-library user story:

1. Create file library.
2. Write `root-restore-target.txt` with `before restore`.
3. Write `workspace/docs/restore-target.txt` with `before restore`.
4. Create user save point.
5. Modify root file.
6. Delete workspace file.
7. Add `workspace/docs/post-savepoint-only.txt`.
8. Click restore.
9. Confirm destructive restore.
10. Wait for terminal restore success.
11. Verify root file content is `before restore`.
12. Verify workspace file exists and content is `before restore`.
13. Verify post-savepoint-only file is gone.

Required task HOME user story:

1. Bind a file library to an Agent task HOME.
2. Create an artifact file and a normal workspace file.
3. Create a user save point.
4. Mutate both files and add a post-savepoint-only file.
5. Restore directly to the save point with destructive confirmation.
6. Verify artifact and workspace file content match the save point.
7. Verify post-savepoint-only file is gone.
8. Verify task message, trace, terminal, runner binding, and artifact metadata are not restored or rewound.

Acceptance:

- Test fails if restore button returns success without file content changing.
- Test fails if hidden current-state save point is created during restore.
- Test fails if UI requires preview before confirmation.
- Test fails if restore success is shown before terminal restore success.
- Test fails if restored file content is not verified by download/hash.

Focused verification:

```bash
BASE_URL=http://localhost:3101 npx playwright test e2e/integration-files-user-stories.spec.ts --grep "restore"
```

### Slice 4. Performance Evidence

Actions:

- Capture restore duration from user confirmation to backend terminal success.
- Capture AFSCP operations emitted during restore.
- Compare before/after on a realistic file library that includes runtime folders.
- Save the evidence artifact path in the handoff summary.

Acceptance targets:

- Restore no longer performs a hidden `save_point_create`.
- Restore starts within one backend request round trip after confirmation.
- Restore duration is bounded by actual restore work, not by a pre-restore save.
- Save point creation remains explicit and independent from restore.
- The confirmation dialog opens without a backend preview request.

Required evidence:

- operation table summary grouped by operation type
- AFSCP operation summary containing exactly the expected direct restore operation and zero restore-triggered save point creates
- UI timing from restore click to confirmation visible
- UI timing from confirmation click to direct restore request start
- backend timing from restore request start to response
- UI timing from confirmation click to terminal status
- final file content assertions
- network request count showing zero restore-preview, zero legacy restore-run, zero restore-cancel, and zero POST save-points calls during restore confirm
- direct `/restore` request payload/header evidence, including `save_point_id`, discard confirmation, and `Idempotency-Key`

Target indicators:

- confirmation visible within 300 ms of clicking a restore action under normal frontend conditions
- restore request response returns `succeeded` or `pending + operation id` quickly for small libraries
- restore visible state appears within 1 second after confirmation
- small-file restore smoke completes within 30 seconds
- task artifact restore story completes within 120 seconds unless AFSCP reports a typed pending operation with evidence

### Slice 5. Documentation Cleanup

Actions:

- Update active contracts that currently say restore must be previewed before run.
- Update engineering docs that describe hidden restore preview fences as normal flow.
- Keep historical docs only if clearly marked historical or superseded.
- Update user guides to describe direct restore with destructive confirmation.
- Update Files frontend module map, OpenAPI, generated types, MSW handlers, `FileLibraryRecoveryDialog`, recovery hooks, real smoke scripts, and E2E stories together.
- Remove or rewrite `scripts/file-library-real-smoke.sh` and `scripts/file-library-real-smoke.test.ts` expectations that require `/restore-preview` or `/restore-run`.

Acceptance:

- New developer reading active docs will not rebuild the old preview/fence mental model.
- Product-facing docs use save point and restore language only.
- Internal implementation docs may mention old preview routes only as removed/superseded or internal legacy context.

## 8. Test Matrix

| Layer | Required tests | What must fail if broken |
| --- | --- | --- |
| Contract/OpenAPI | direct restore by `save_point_id` | `restore_preview_id` required by public schema |
| Static guard | active OpenAPI/generated types/route-kind map/MSW/Files API/hooks/messages/E2E/smoke contain only direct restore normal path | `/restore-preview`, legacy `/restore-run`, `/restore-cancel`, `restore_preview_id`, or `activeRestorePreview` remain in normal restore path |
| Backend unit | direct restore handler, idempotency, blockers | hidden save point call, restore preview record, duplicate operation, raw error leakage |
| Backend integration | save point -> mutate -> direct restore -> content verification | restore success without file changes |
| Adapter tests | AFSCP direct restore port | preview/run-preview/preview-discard call or restore-triggered save point during normal restore |
| Frontend unit | confirmation dialog, active restore state, blocker copy | preview required before confirm, missing destructive warning |
| MSW/API client | mock direct restore | mocks still drive restore-preview |
| Real lane E2E | whole-HOME restore user story | deleted file not restored, new file not removed, UI false success |
| Real smoke script | direct restore request and file hash/content proof | script still waits for restore-preview or restore-run |
| Docs/contracts | OpenAPI/generated types/docs drift | active docs still say user must preview restore |

Old tests to delete or rewrite:

- `packages/api-entry-node/src/project-file-library-routes.test.ts` hidden fence, restore-preview preparation pending, stale preview, cancel preview, and restore-run tests
- `packages/api-entry-node/src/file-library-persistence.test.ts` restore preview fence mapping tests
- `packages/api-entry-node/src/file-library-afscp-storage.test.ts` restore preview/run/discard normal-path tests
- `src/components/files/file-library-recovery/__tests__/FileLibraryRecoveryDialog.test.tsx` preview card and preview blocker tests
- `src/lib/hooks/__tests__/use-file-library-recovery.test.tsx` active restore preview hook/cache tests
- `scripts/file-library-real-smoke.test.ts` restore-preview and restore-run assertions
- `e2e/integration-files-user-stories.spec.ts` waits or assertions for `/restore-preview`, `/restore-run`, restore preview cards, or preview summaries

## 9. UX Review Checklist

Before handoff completion, reviewers must confirm:

- The first restore click opens a confirmation dialog, not a long-running backend preview.
- The confirmation is short enough for a business user to understand quickly.
- The destructive consequence is explicit.
- The UI does not over-explain AFSCP, JVS, fence, generation, or operation internals.
- Restore progress is visible and resumable after refresh.
- Success appears only after terminal restore success.
- Failure gives a clear next action.
- Save point remains an intentional user action.
- If users want to preserve current state, the only recommended path is cancel restore and explicitly create a save point.

## 10. Handoff Checklist

Development can start when this checklist is satisfied:

- Product decision is locked: no hidden save before restore.
- Direct restore product contract is chosen.
- Sibling project capability gap is identified: direct endpoint available, or a team member has been assigned to enter the sibling project and implement the structural capability before AgentSmith integration.
- Any required sibling project work has its own branch, TDD scope, focused verification, and consumable commit/version/image/local artifact/contract evidence plan.
- UX copy is approved at the level of intent, not pixel-final design.
- TDD matrix includes backend, frontend, and real lane content verification.
- Active docs to update are listed.
- Focused gate commands and expected evidence artifact paths are listed before development starts.
- No planned slice introduces a new user-facing recovery concept.
- No compatibility layer is planned for the old preview-first Files recovery flow.

## 11. Review Log

This document must reach `team_reviewed_handoff_ready` only after product/UX, backend/architecture, and test/verification review agree that it simplifies the workflow without weakening data consistency.

Round 1 findings incorporated:

- Product/UX review required immediate confirmation before any backend preview request, simple destructive copy, no user-facing storage internals, and complete removal of preview copy from active UI.
- Backend/architecture review required no hidden fence, durable restore operation, stable idempotency, active writer fail-closed checks, and no raw AFSCP/JVS leakage.
- Test/verification review required direct restore contract tests, E2E request evidence proving zero restore-preview calls, content/hash verification, and deletion or rewrite of old preview/fence tests.
- User clarification incorporated: AgentSmith is pre-GA, so the plan intentionally avoids compatibility with the old preview-first flow and allows clean range refactoring.

Round 2 findings incorporated:

- Removed the adapter fallback that allowed internal preview/run wrapping; direct restore capability is now a hard dependency or upstream blocker.
- Tightened evidence from message-string checks to operation type/source checks, so renamed hidden fences cannot pass.
- Added explicit `Idempotency-Key` contract and persistence requirements.
- Split admission blockers from durable restore operation status to avoid long-lived blocked operations.
- Added static guard coverage for OpenAPI, generated types, route-kind maps, MSW, hooks, messages, E2E, and smoke scripts.
- Split ordinary file-library restore and task HOME restore into separate user stories.
- Converted performance evidence from suggested to required handoff artifacts.

Round 3 user clarification incorporated:

- If a sibling project lacks a required capability, the plan now requires assigning a team member to improve that sibling project directly, with its own branch, TDD, verification, commit/version/image/local artifact/contract evidence, and no AgentSmith workaround, waiting, or vague dependency before integration.
