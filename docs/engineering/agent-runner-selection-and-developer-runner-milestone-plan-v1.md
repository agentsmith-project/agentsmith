# Execution Environment Selection and Developer Runner Milestone Plan v1

Last updated: 2026-05-06
Status: `archived_superseded`
Owner: Product + Engineering

> Superseded by `docs/engineering/agent-task-bound-runner-and-runner-ux-milestone-plan-v1.md`.
> This file is retained as historical planning evidence only. It describes the previous run-scoped `Execution environment` direction and must not be used as the current product or engineering target.
> Archived-only warning: do not copy endpoint names, action names, UI copy, permission claims, or run-scoped selector behavior from the body below into active implementation. The active plan uses task creation binding, `runner-binding-options`, and `bind_to_task`.

## 1. Status and Scope

This archived plan captured the earlier Execution environment selection and Developer runner lifecycle direction after the second-round team review. Current work must follow the task-bound runner milestone linked above.

Historical note: the body below contains obsolete run-scoped `runner_selection`, `select_for_task`, Project default, and System managed decisions. Current contracts must follow `docs/engineering/agent-task-bound-runner-and-runner-ux-milestone-plan-v1.md`, where `CreateTask` binds the runner, ordinary task creation omits `bound_runner_id`, explicit binding is Developer-runner-only, and `StartTaskRun` rejects runner fields.

Reviewed findings and implementation status ledger:

Ledger state vocabulary:

1. **Accepted** means the finding is reviewed, implemented, and backed by the required focused evidence for the stated scope.
2. **Implemented in dirty diff; evidence pending** means implementation exists in the current unmerged diff, but focused evidence and final review are still required.
3. **Partial in dirty diff** means the current unmerged diff covers only part of the acceptance surface.
4. **Partial** means the area is intentionally incomplete or still lacks full acceptance coverage.
5. **Open** means no accepted implementation slice exists yet.

Dirty diff is an implementation signal only. Dirty diff != final acceptance, and this ledger must not treat unmerged code or focused local evidence as backend-real, release-readiness, live-runner, or managed-execution proof.

| Workstream/finding | Ledger state | Engineering review status | Remaining gap / next action |
| --- | --- | --- | --- |
| Terminal dual-permission gate | **Accepted** | `required-project-permissions.ts` and route permission tests require `project:agent_task:use` plus `project:agent_task:terminal` for terminal session routes, with focused permission evidence recorded below. | Preserve the dual-permission gate; backend-real/release proof remains separate. |
| Run-scoped `runner_selection` task contract | **Accepted for focused/local scope** | Backend route handlers, OpenAPI, generated types, local task types, MSW task handlers, and frontend submit flow model `StartTaskRun`-only `runner_selection`; `CreateTask` and `StartTaskRun` negative fields are rejected; current-state revalidation fails stale selections closed; `resolved_runner_id` is recorded only after success; successful send resets run-scoped selection to Project default. | Keep the no-alias/no-legacy rule in negative tests for both endpoints. Backend-real/release proof remains separate. |
| No-authority selected runner non-leakage | **Accepted for focused/local scope** | Selection snapshot/default-only rendering avoids leaking selected runner details when the caller lacks selection authority, with focused API/UI evidence recorded below. | Keep broader release/backend-real proof separate. |
| Successful send resets run-scoped selection to Project default | **Accepted for focused UI/unit scope** | Frontend create/start success path resets the run-scoped selector to Project default and does not persist a reusable task preference. | Keep integration/release proof separate. |
| AgentRunner backend public row shape | **Accepted** | Backend public rows expose `kind`, source label, action affordances, and `read_only`; focused backend/MSW/type evidence is recorded below. | Keep release/backend-real proof separate. |
| Public backend Developer-only AgentRunner mutations | **Accepted for focused backend/local scope** | Backend public create/update/key paths are narrowed to Developer runner behavior and reject System managed/default/config mutation fields. | Keep System managed lifecycle/key/config mutation out of project UI and keep negative tests for forged System managed lifecycle/key/config API calls. Backend-real/release proof remains separate. |
| Ordinary runner-resolution safe copy subset | **Partial** | Ordinary runner-resolution safe copy and ordinary REST/SSE display-safe projection are implemented for the current scoped surfaces. | The broader ordinary error matrix remains a scoped future/partial item, not a P0 blocker for the fixed projection path; extend validation across toast, inline, terminal open/reopen, Activity/Execution summary, and SSE/event-derived copy before broader UX/release closure. |
| AgentRunner UI/actions rendering | **Accepted** | AgentRunner row actions no longer stack the frontend `canManageRunners` gate on top of backend affordances; connection sheet entry uses action-family visibility; list-level `actions.create_developer_runner` exists and the frontend Create CTA uses the backend action. | No remaining Create collection affordance gap. Broader UI/visual evidence remains separate if required for release. |
| Developer runner key lifecycle | **Accepted** | Focused implementation covers one-active-key behavior, rotate revoking the previous key, revoke/rotate disconnect, 7-day expiry, expiry cleanup, metadata-only key list, and audit redaction. | Still not backend-real or release proof. |
| Agent Runner test endpoint contracts | **Accepted** | `test-connection` runtime accepts only `timeout_ms`; unsupported fields return 400 `unsupported_field`; responses do not echo raw secrets. `test-task-runs` OpenAPI documents 400 and backend/MSW both reject unsupported fields. | Keep live-runner/backend-real proof separate. |
| Test connection P0 semantics | **Accepted for scoped P0 behavior** | Current behavior is a bounded presence/auth freshness check with safe copy, `timeout_ms` default/range parity, and strict request allowlist. `actions.test_connection.allowed` means manage/action availability, not online status; offline Developer runners can execute Test connection and receive a disconnected result. | Do not promise live ping/challenge or capability proof. Run test task still requires fresh/connected/allowed state. |
| Cleanup/timeout/delete contract drift | **Accepted** | Cleanup response type is aligned in OpenAPI/generated types/MSW; Test connection timeout default/range parity is aligned; DELETE Developer runner returns 204 with no body. | Keep final contract gate/release proof separate. |
| Terminal session resolver | **Accepted for focused/local scope** | Focused terminal/task-run evidence covers active run/test-run `resolved_runner_id` inheritance, missing resolved id fail-closed behavior, standalone terminal Project default resolution at creation, and existing-session reuse of the persisted runner id. | Keep backend-real terminal proof separate. |
| Ordinary error matrix | **Partial** | Safe copy subset exists, but matrix coverage is not complete. | Finish audience-safe i18n mapping and leakage tests across all ordinary task surfaces. |
| Selection snapshot | **Accepted for focused/local scope** | Focused snapshot/backend/frontend evidence covers default-only/no-authority non-leakage, `visible=false` omission, and disabled selected safe row/no-selector handling. | Keep backend-real/release proof separate. |
| Agent Runners fixed IA and Project default status | **Accepted for focused UI/unit scope** | Focused UI evidence covers fixed page order, always-visible Project default card, System managed and Developer grouping, and no ordinary Start task CTA. | Visual/release evidence remains separate. |
| Developer runner sheet/state machine | **Accepted for P0 focused scope** | Focused UI coverage includes no active key, issued/waiting, fresh, stale, disconnected, warning, failure, affordance denied/hidden, revoked/expired history, and Run test task fresh gate. Test connection remains presence/auth freshness, not live ping/challenge/capability proof. | Release/visual/backend-real proof remains separate. |
| Dedicated Developer test-task dispatch/evidence | **Accepted** | Dedicated `runner_test` backend dispatch, MSW path, sheet result label, and task list/header/message/Activity/active_run surfacing are implemented with focused evidence; mutation start/error clears stale accepted result. | Evidence is local/development testing only, not managed release proof. |
| MSW AgentRunner parity | **Accepted** | Public row, mutation, Test connection, test-task, key lifecycle, cleanup response, timeout, delete-204, and project scoping parity exist; list/get/update/delete/diagnostics/connection-info/keys/test-connection/test-task filter by project and wrong project returns 404. | Keep backend-real/release proof separate. |
| Raw event gating and `payload.at` safety | **Accepted for ordinary projection** | Ordinary task-use REST traces and SSE events pass through display-safe projection; runner-provided `payload.at` is untrusted, public `at` uses server time, and REST/SSE projection validates historical malformed `at`. Frontend keeps a second-defense display handling path. | Privileged raw diagnostics, audit, or full raw event route remains a future/full gap if explicitly desired; do not treat ordinary projection as full raw access acceptance. |
| Local evidence namespaces/manifests | **Accepted for local-focused scope** | Split namespaces and manifests exist as local-focused evidence only. They are not backend-real, live, release-readiness, or managed-execution proof. | Keep the scope local-focused unless a later gate explicitly upgrades it. |
| Runner identity/capability simplification | **Partial** | Public `kind` and action metadata exist. | Keep public identity to `kind=system_managed|developer` plus display/source label; keep `required_permissions` diagnostic-only; defer full expected/reported/effective capability triad to P1 diagnostics. |

Focused evidence recorded for this sync is local/focused only, not backend-real, live, release-readiness, visual, or managed-execution proof: `git diff --check`, `npm run contracts:check`, `npm run contracts:check-openapi`, `npm run openapi:check-generated`, `npx tsc --noEmit --project tsconfig.json`, `npm run typecheck -w @mbos/api-entry-node`, and the focused `npm run test:run -- packages/api-entry-node/src/task-route-handler.test.ts packages/api-entry-node/src/notebook-terminal-service.test.ts packages/api-entry-node/src/notebook-task/task-run-coordination.test.ts packages/api-entry-node/src/agent-route-handler.test.ts packages/api-entry-node/src/agent-resource-service.test.ts packages/api-entry-node/src/agent-execution-service.test.ts packages/api-entry-node/src/request-handler/required-project-permissions.test.ts packages/api-entry-node/src/projects-route-match.test.ts src/components/agent-tasks/__tests__/TaskPage.test.tsx src/components/agent-tasks/__tests__/ConversationInput.test.tsx src/components/agent-tasks/__tests__/ConversationPanel.test.tsx src/components/agent-tasks/__tests__/MessageItem.test.tsx src/components/agent-tasks/__tests__/TaskHeader.test.tsx src/components/agent-tasks/task-list/__tests__/TaskCard.test.tsx src/lib/api/__tests__/errors.test.ts src/lib/api/__tests__/tasks-api.test.ts src/lib/api/types/__tests__/tasks.test.ts src/lib/api/types/__tests__/agent-runners.test.ts src/lib/__tests__/agent-runners-msw-parity.test.ts src/lib/__tests__/msw-stop-contracts.test.ts src/components/api-keys/__tests__/AgentRunnerKeysDialog.test.tsx 'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-runners/__tests__/page.test.tsx' src/components/agent-runners/__tests__/AgentRunnerDialogs.test.tsx` suite (23 files, 768 tests). Earlier focused evidence also remains green: the 8-file / 291-test suite and the 3-file / 72-test Agent Runner test endpoint drift suite, plus `npm run openapi:sync-json`, `npm run openapi:generate`, `npm run openapi:check-generated`, and TypeScript checks for that drift slice.

In scope:

1. Run-scoped Execution environment selection.
2. Project default through System managed runners only.
3. Developer runner create/connect/Test connection/test task loop.
4. Agent Runners page UX with always-visible Project default status.
5. Backend action affordances, permissions, audit, resolver rules, terminal/session rules, and split local evidence.

Product UI terms: `Execution environment`, `Project default`, `System managed`, `Developer runner`, `Test connection`.

`Execution environment` is product copy for run settings and selector UX. It is not a third product object beside Agent task runs and Agent Runners, and it must not introduce a separate lifecycle, identity, or policy model.

Product/UX guardrails:

1. Users without selection authority must not see an Execution environment selector; a default-only/no-authority snapshot is rendered as ordinary Project default behavior, not as a confusing disabled expert control.
2. `actions.select_for_task.visible=false` rows must not render as ordinary disabled selector options.
3. Ordinary task copy and affordances must not expose runner terminology, raw event details, diagnostics labels, diagnostic ids, or diagnostic entrypoints.
4. The Project default card may show only user-safe status, issue, display/source label, last-check context, and backend-allowed CTAs; raw readiness diagnostics, private endpoint/model details, and internal configuration stay out of the card.
5. `runner_test` badge/source surfacing exists for task list/header/message/Activity/active_run with focused local/development evidence; it is not managed release proof.

Avoid UI copy: `docker`, `k8s`, `pod`, `external`, `internal`, `runtime selector`.

## 2. Product Decisions

1. Ordinary users create tasks and start runs through Project default without seeing an Execution environment selector.
2. Expert users may select an Execution environment for a specific run only when the backend exposes selection authority for that runner.
3. Agent developers may create a Developer runner, connect a local runner process, run Test connection, and start a developer test task.
4. Developer runners cannot become Project default in this milestone.
5. Agent Runners is a governance/developer surface, not a second ordinary task entrypoint.
6. UI audiences such as Ordinary task user, Execution expert, Runner maintainer, and Diagnostics viewer are derived from backend affordances and response shape. They are not role names and must not be used for authorization.

P0:

1. Make `runner_selection` run-scoped and remove it from ordinary task creation.
2. Enforce Project default = System managed runner only.
3. Add backend `select_for_task` or equivalent dedicated selection authority.
4. Add Developer runner lifecycle, one active connection key, Test connection, and test task flow.
5. Make terminal session creation resolve exactly once, persist `resolved_runner_id` on the terminal session, and never re-resolve Project default for reconnect/input/resize/close.
6. Split evidence into `agent_runner.default_managed.*` and `agent_runner.developer.*`.

P1:

1. Stabilize Advanced selector refresh and disabled-runner reasons.
2. Add richer diagnostics display after core Test connection exists.
3. Refine visual coverage for Project default status and Developer runner sheets.
4. Expand local-manual runbooks after backend-real evidence is clean.

## 3. Feature: Run-Scoped Execution Environment

Function:

1. `runner_selection` belongs to a run, not to the task container.
2. `CreateTaskRequest` must reject `runner_selection`, `runner_id`, `agent_id`, and `agent_name`.
3. `StartTaskRun` must reject `runner_id`, `agent_id`, and `agent_name`; its only allowed runner-related input is optional `runner_selection`.
4. Task creation stores task intent and inputs only; it must not persist selected runner, last selected runner, hidden selector, or future run preference.
5. Canonical run contract for this milestone: `StartTaskRun` accepts optional `runner_selection`; `CreateTask` does not accept it.
6. Project default run start omits `runner_selection`; backend resolves the System managed Project default.
7. The run records `resolved_runner_id` only after resolver success.
8. UI that offers "create and start" must first call `CreateTask`, then call `StartTaskRun`; it must not hide, cache, or persist selector state on the task.
9. `StartTaskRun` must recompute selection authority, policy, capability, readiness, and freshness at submit time. It must not trust an earlier selection snapshot as authorization proof.

Separate run action shape:

```json
{
  "runner_selection": {
    "mode": "explicit",
    "agent_runner_id": "arun_..."
  }
}
```

Future RFC only:

An atomic `create_and_start` contract is not the main path for this milestone. If needed later, it must be handled as a separate RFC and still keep selection run-scoped rather than task-scoped.

Selection snapshot contract:

1. The expert selector must use a dedicated backend selection snapshot, not the full Agent Runner list.
2. Draft endpoint concept: `GET /workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/run-selection-snapshot`; final path/name is owned by the API contract owner.
3. Snapshot fetch requires the base task permission `project:agent_task:use`.
4. The snapshot returns the `Project default` option, backend-visible selectable and disabled Execution environments, backend reason codes, and per-row `actions.select_for_task`.
5. A display-safe Project default row may be returned to callers with `project:agent_task:use`.
6. Non-default System managed rows and select actions require backend row-level validation of `project:agent_task:use`, `project:agent_runner:read`, readiness, policy, and capabilities inside `actions.select_for_task.allowed`.
7. Developer runner rows and select actions require backend row-level validation of `project:agent_task:use`, `project:agent_runner:manage`, readiness, freshness, policy, and capabilities inside `actions.select_for_task.allowed`.
8. If the caller has no selection authority, the snapshot may return only the Project default safe row. It must not leak invisible runner names, private diagnostics, provider config, endpoint details, or capability internals.
9. If a previously selected environment becomes denied or unavailable, the snapshot may return a safe disabled selected row with stable id, public label when already known to the user, and backend reason code. It must not include raw diagnostics or private configuration.
10. Snapshot rows include only task-selector-safe fields such as id, name, public `kind`, freshness/readiness summary, capability summary, disabled reason codes, and action affordance.
11. Source/provider display labels are for Agent Runners and diagnostics surfaces, not task selector safe fields. The task composer should not teach the runner source model, and tests intentionally avoid source leakage.
12. The snapshot must not return connection secrets, key material, complete diagnostics, private provider config, endpoint secrets, source/provider display labels, or raw environment diagnostics.
13. Snapshot authorization is backend-owned; frontend visibility is a UX reflection of the snapshot, not a separate source of truth.

UX:

1. Ordinary create/start UX has no Execution environment control.
2. Permissioned expert UX shows run-scoped `Execution environment` only under `Advanced` or `Execution settings`, and only when the backend selection snapshot exposes a visible affordance.
3. If the caller has no visible selection affordance, render no selector instead of a Project-default-only or disabled expert control.
4. Default option is `Project default`.
5. Explicit options come from a backend-visible snapshot.
6. Unavailable environments stay visible only when the backend snapshot returns a safe disabled row with `actions.select_for_task.visible=true`. Rows with `actions.select_for_task.visible=false` are omitted entirely, not displayed as disabled options. Backend reason codes map to audience-safe i18n copy; raw reason codes are not ordinary task-user copy.
7. Refresh updates the snapshot without list jumps or silently changing the user's selected option.
8. If the previously selected environment becomes unavailable, invisible, or permission-denied after refresh, keep it as the disabled selected row only when the backend returns a safe row for it, show the reason, forbid submit, and require the user to switch back to `Project default` or another available option.
9. Submit `runner_selection` only when the user intentionally chooses a non-default option.
10. No URL parameters, localStorage/sessionStorage preference, hidden field, or stale form state may select a runner.
11. Selector display is controlled only by backend snapshot rows and affordances. The frontend must not query the Agent Runner list or directly use `project:agent_runner:read` to decide whether the selector appears.

Acceptance:

1. CreateTask rejects all removed runner fields and `runner_selection`.
2. StartTaskRun rejects removed runner fields and owns the only allowed runner input, run-scoped `runner_selection`.
3. Ordinary start resolves Project default without selector.
4. Explicit selection records only resolved runner id after backend success.
5. Failed explicit selection leaves no selector on the task.
6. Expert selector options come from the selection snapshot, not from the full Agent Runner list.
7. Snapshot fetch requires only `project:agent_task:use`; non-default rows are included only by backend row-level affordance.
8. `StartTaskRun` rejects stale or no-longer-authorized selection even if an older snapshot allowed it.

Validation:

1. Contract tests for CreateTask forbidden fields, StartTaskRun forbidden removed fields, and StartTaskRun-only run-scoped selection.
2. Backend tests proving resolved runner id is written only after success.
3. Backend/API tests for snapshot field allowlist, disabled reason codes, `actions.select_for_task`, and secret/diagnostic omission.
4. Backend tests for Project default safe row, no-authority non-leakage, previously-selected disabled row, and StartTaskRun revalidation.
5. Frontend tests for ordinary no-selector submit, no-authority no-selector rendering, expert intentional selection submit, snapshot-only selector rendering, visible=false omission, and disabled-selected refresh behavior.

## 4. Feature: Project Default and System Managed

Function:

1. Only System managed runners may be Project default.
2. Developer runners cannot become Project default through API, UI, seed, or runbook.
3. Default resolver considers only eligible System managed runners.
4. Project UI System managed scope is status, refresh, view diagnostics, and backend-allowed `set_project_default` only.
5. Public project APIs cannot create System managed runners, delete them, generate keys for them, rotate/revoke keys for them, or edit lifecycle/configuration fields.
6. Backend must reject forged System managed lifecycle/key/config API calls even when the UI hides the action and even when the caller has `project:agent_runner:manage`.
7. Public Agent Runner records must expose `kind=system_managed|developer`, display/source label, and action affordances. Selection snapshot rows expose public `kind` and selector-safe action affordances, but not source/provider labels. The display/source label is not an authorization, lifecycle, or compatibility type.
8. Public create APIs can create Developer runners only. They must reject `kind=system_managed`, `is_default`, `default_endpoint_id`, default-setting fields, and underlying System managed configuration fields.
9. Connection key issue/revoke actions are forbidden for System managed runners, even for users with `project:agent_runner:manage`.
10. `read_only` is display metadata only; actions come from backend affordances.

UX:

1. Agent Runners page uses this fixed order: top Project default status, System managed read-only section, Developer runners section.
2. Project default status is always visible above grouped lists.
3. Project default status shows only user-safe status, issue, display/source label, last check time, and backend-allowed CTA; endpoint/model/readiness details appear only as backend-provided safe summaries for the current surface.
4. Top CTAs are allowlisted to refresh/status actions, Project default setup/status actions when backend-allowed, and Create Developer runner when backend-allowed. Public UI cannot edit underlying System managed configuration. No top-level `Start task` CTA is allowed.
5. Status word priority is deterministic: disabled/blocked, not configured, unavailable/error, stale/warning, ready. Higher-severity state wins when multiple facts are present.
6. System managed section is read-only for lifecycle, key, and underlying configuration changes.
7. System managed section has no direct task-start action, create/update/delete action, key action, endpoint/model config action, or hidden mutation path.
8. `Set as Project default` appears only for System managed runners when `actions.set_project_default.allowed=true`.

Acceptance:

1. Ordinary default run never resolves to Developer runner.
2. Project default status remains visible regardless of tab/group state.
3. System managed rows expose only backend-allowed actions.
4. Public create rejects System managed/default/endpoint-binding fields.
5. System managed lifecycle/key/config mutation is absent from project UI and rejected by backend if called.
6. Any `set_project_default` affordance is backend-owned, System managed-only, and does not imply broader System managed edit authority.

Validation:

1. Backend tests for default uniqueness and System managed-only constraint.
2. API tests rejecting Developer runner default changes.
3. UI tests for always-visible Project default status.
4. Negative API tests for public System managed create, `is_default`, `default_endpoint_id`, lifecycle/config mutation, and key issue/revoke on System managed runners.
5. Backend-real evidence for ordinary run resolving System managed Project default.

## 5. Feature: Developer Runner Lifecycle

Function:

1. Developer runner is a developer-mode testing object. It may appear in Agent Runners only when development/local capability is enabled and backend affordances expose it.
2. Create form requires only `name`; `description` is optional.
3. Users should not configure capabilities at creation time. Optional `expected_capabilities` may exist later. Current P0 Test connection proves only presence/auth freshness; any displayed capability summary must come from backend-accepted connection metadata or diagnostic summary. Live handshake/challenge/capability-contract proof is future scope.
4. P0 shows a compact backend capability summary only. Full `expected_capabilities` / `reported_capabilities` / `effective_capabilities` comparison belongs to P1 diagnostics and must not block core lifecycle acceptance.
5. If the P1 diagnostics triad is implemented, align those fields with the existing capability map shape, or explicitly migrate the contract and regenerate types.
6. Lifecycle actions: create, edit name/description, issue/rotate key, copy connection metadata and one-time secret, revoke key, view diagnostics, Test connection, Run test task, disable, delete.
7. Developer runner is not a formal deployment runtime, cannot become Project default, and cannot be used as managed release proof.
8. When the developer provider is not enabled for the environment, Developer runner create/actions must be hidden or disabled by backend affordance and rejected by backend if called.

UX:

1. Developer runner list shows name, description, enabled state, connection freshness, Test connection result, and capability summary.
2. Connect/diagnostics uses a sheet or dialog.
3. `Run test task` appears only inside the Developer runner connection/diagnostics sheet after connection context is visible.
4. Developer runner row actions render from backend affordances only.
5. Developer runner sheet state machine:
   - `created_no_key`: show issue key CTA.
   - `key_issued_secret_shown_once`: show one-time secret, copy metadata/secret CTAs, and clear warning that the secret cannot be shown again.
   - `waiting_for_connection`: show connection metadata and rotate/revoke key CTAs when allowed; Test connection follows `actions.test_connection.allowed` and may return a disconnected/no-presence result while Run test task remains blocked.
   - `connected_fresh`: show freshness and enable Test connection when allowed.
   - `test_connection_presence_auth_fresh`: show bounded presence/auth freshness result and enable Run test task only if `project:agent_task:use`, `project:agent_runner:manage`, and `actions.run_test_task.allowed=true`; do not present this as live ping/challenge proof.
   - `test_connection_warning`: show warning reason, diagnostics id when allowed, and only enable Run test task if backend action and required permissions remain allowed.
   - `test_connection_failed`: show failure reason and recovery CTA; Run test task disabled.
   - `key_expired`, `key_revoked`, `no_active_key`: show issue/rotate key CTA when allowed and block connection/test task.
   - `stale`, `disconnected`, `disabled`: show recovery CTA from affordances; Test connection availability is action-driven rather than online-state-driven, while Run test task stays blocked unless backend explicitly reports fresh/connected/allowed.
   - `active_test_run`: show the active test run evidence and block duplicate test task starts.
   - `delete_blocked`: show backend reason and keep destructive action disabled.

Developer test task contract:

1. Developer runner test task uses a dedicated backend action/endpoint, not the ordinary Agent task create/start entrypoint.
2. Draft endpoint concept: `POST /workspaces/{workspaceId}/projects/{projectId}/agent-runners/{runnerId}/test-task-runs`; final path/name is owned by the API contract owner.
3. The endpoint is triggered only from the Developer runner sheet.
4. It creates standard Agent task/run evidence, but marks the task/run/audit metadata as `runner_test` so it is distinguishable from ordinary user work.
5. It requires `project:agent_task:use` plus `project:agent_runner:manage` plus backend `actions.run_test_task.allowed`, because it creates standard task/run evidence.
6. Resulting `runner_test` task/run records include `resolved_runner_id` and selection metadata that identifies the dedicated Developer runner test-task operation rather than ordinary `StartTaskRun` explicit selection.
7. It must not write selector state to a reusable task preference, and it must not expose a top-level start-task CTA on Agent Runners.
8. It must not be reused as ordinary task preference, ordinary task launcher state, or managed release evidence.
9. The endpoint request body is allowlisted; unsupported fields return 400 `unsupported_field` in backend/MSW, and OpenAPI documents the 400 response.

Implementation status/guardrail:

1. Backend standard `runner_test` dispatch, MSW path, Developer runner sheet result label, and task list/header/message/Activity/active_run surfacing are implemented with focused local/development evidence.
2. The implementation clears stale accepted Run test task results on mutation start/error, so old success state is not preserved across failed starts.
3. The previous unavailable/error response behavior is a failure-path requirement, not an accurate description of the current dirty-diff endpoint.
4. `runner_test` evidence is development testing evidence only and cannot be used as managed release proof.

Acceptance:

1. Developer runner create form is name/description only.
2. P0 capability display uses a compact backend summary; full expected/reported/effective diagnostics are P1.
3. Developer runner cannot be Project default.
4. Run test task is a sheet-only trigger and is not a general task creation entrypoint.
5. Resulting evidence must be visibly marked with a `runner_test` badge/source label wherever it appears.
6. Ordinary task lists and Activity/Execution summaries must not imply `runner_test` work is ordinary user task work.
7. Developer runner create/actions disappear or disable by backend affordance when the developer provider is not enabled.
8. Developer runner sheet CTAs follow the state machine above.
9. `runner_test` cannot be reused as ordinary task preference and cannot count as managed release evidence.

Validation:

1. API/UI tests for create/update payload shape.
2. UI tests for compact capability summary, P1 diagnostics when implemented, and sheet-only Run test task.
3. Tests proving Developer runner cannot become Project default.
4. API/UI tests for developer-provider disabled affordances.
5. API tests for dedicated test-task endpoint, 400 unsupported-field response, `project:agent_task:use` plus `project:agent_runner:manage` permission, `runner_test` evidence marker, resolved runner id, selection metadata, unavailable/failure response, and no managed-release evidence claim.
6. UI tests for `runner_test` badge/source label in ordinary task lists and Activity/Execution summaries without making it look like ordinary user work, plus stale result clearing on start/error.

## 6. Backend Affordances, Permissions, and Audit

All UI actions must come from backend affordances. `read_only` is a label; it does not decide button visibility or permission.

Public runner identity for this milestone is exactly `kind=system_managed|developer`. Any source/provider text is a display label only, not an authorization source, lifecycle type, compatibility alias, or branching product object.

Required action schema concepts:

```json
{
  "operation": "select_for_task",
  "visible": true,
  "allowed": false,
  "reason_code": "developer_runner_disconnected",
  "required_permissions": ["project:agent_task:use", "project:agent_runner:manage"],
  "danger_level": "none"
}
```

`required_permissions` is per-row and per-operation diagnostic metadata for diagnostics, audit explanation, and tests. It is not frontend authorization truth, and UI must not compare it with token claims to decide whether an action is visible or allowed. A Project default safe row can report only `project:agent_task:use`; a non-default System managed row can report `project:agent_task:use` plus `project:agent_runner:read`; a Developer runner row can report `project:agent_task:use` plus `project:agent_runner:manage`.

Initial operations:

1. `set_project_default`
2. `select_for_task`
3. `run_test_task`
4. `edit`
5. `disable`
6. `delete`
7. `issue_connection_key`
8. `revoke_connection_key`
9. `test_connection`
10. `view_diagnostics`

Rendering rules:

1. `visible=false`: do not render.
2. `visible=true` and `allowed=false`: render disabled only when explaining backend reason improves UX.
3. For `select_for_task`, `visible=false` means the option is absent from the selector; it must not appear as a normal disabled option.
4. `danger_level` controls destructive styling and confirmation.
5. `required_permissions` is diagnostic metadata, not frontend authorization truth.

Permission rules:

| Capability | Required authority |
| --- | --- |
| Ordinary Project default run | `project:agent_task:use` |
| Selection snapshot fetch | `project:agent_task:use` |
| Project default safe snapshot row | `project:agent_task:use` |
| View Agent Runners | `project:agent_runner:read` or `project:agent_runner:manage`, per route policy |
| Show expert selector | Backend snapshot/affordance only; frontend must not infer from Agent Runner read permission |
| Explicit non-default System managed selection | `project:agent_task:use` + `project:agent_runner:read` + policy/capability/readiness + `actions.select_for_task.allowed` |
| Explicit Developer runner selection | `project:agent_task:use` + `project:agent_runner:manage` + `actions.select_for_task.allowed` |
| Display-safe diagnostics/view diagnostics | `project:agent_runner:read` or `project:agent_runner:manage` + `actions.view_diagnostics.allowed` |
| Developer runner lifecycle/key/one-time secret/mutating connection actions | `project:agent_runner:manage` + action allowed |
| Test connection | `project:agent_runner:manage` + `actions.test_connection.allowed` |
| Developer runner test task | `project:agent_task:use` + `project:agent_runner:manage` + `actions.run_test_task.allowed` |
| Set Project default | `project:agent_runner:manage` + System managed runner + `actions.set_project_default.allowed` |

No role-name authorization is allowed.

This milestone does not define a separate ownership/test-authority permission model for Developer runner selection or test task. Any future split from `project:agent_runner:manage` requires a dedicated RFC and permission contract update.

Audit must record Project default resolution, explicit selection, selection snapshot denial where material, Developer runner create/edit/disable/delete, key issue/rotate/revoke/expiry, Test connection, Project default change, dedicated test task start from Developer runner sheet, terminal runner resolution, and resolver failures. Metadata includes actor, workspace, project, task/run/session when applicable, runner id, selection mode, operation, result/error code, diagnostic id when available, and redacted metadata only. Raw connection secrets must never be audited.

Validation:

1. API tests for fixed action schema across System managed and Developer runner records.
2. UI tests for visible/allowed/reason/danger rendering.
3. Permission tests for ordinary default, snapshot fetch, Project default safe row, explicit non-default System managed selection, explicit Developer runner selection, diagnostics, Test connection, and test task.
4. Permission tests proving Developer runner selection/test task require `project:agent_runner:manage`, and Developer runner test task also requires `project:agent_task:use`.
5. Audit tests for operation coverage and secret redaction.

## 7. Key Lifecycle and Test Connection

Key lifecycle:

1. One active connection key per Developer runner.
2. Issuing a new key rotates the key and atomically revokes the previous active key.
3. Key secret is shown once at issue time.
4. Key expires 7 days after issue unless revoked earlier.
5. Expired keys reject new handshakes.
6. At expiry, existing connections must be disconnected or forced through a new authentication handshake before accepting more runner work.
7. Revoking the active key disconnects existing runner connections for that Developer runner and blocks reconnect.
8. Key list returns only key id, prefix, issued_at, expires_at, revoked_at, last_used_at, and issuer id.
9. Stored key material is hashed or otherwise non-recoverable.
10. Audit records issue, rotate, expiry, revoke, disconnect, and cleanup result without raw secret.
11. Expiry cleanup is implemented in the focused slice: stale active-key indexes, connection state, and audit evidence converge without requiring manual database edits. This is still not backend-real or release proof.

Test connection endpoint:

`POST /workspaces/{workspaceId}/projects/{projectId}/agent-runners/{runnerId}/test-connection`

Current P0 status: the implemented contract is a bounded presence/auth freshness check with safe copy and strict request allowlist. Runtime accepts only `timeout_ms`, validates default `1000ms` and range `100-10000ms`, rejects unsupported fields with 400 `unsupported_field`, and does not echo raw secrets. `actions.test_connection.allowed` represents manage/action availability, not online state; an offline Developer runner may still execute Test connection and receive a disconnected result. This is not a live runner ping/challenge or capability proof, and UI/docs must not promise live verification from presence/auth freshness alone.

Current request shape:

```json
{
  "timeout_ms": 1000
}
```

Any additional field, including `required_capabilities`, is unsupported in the current P0 contract and must return 400 `unsupported_field`.

Future/full acceptance request target if live challenge/capability proof is explicitly added later:

```json
{
  "timeout_ms": 1000,
  "required_capabilities": ["task_run"]
}
```

Future/full acceptance rules:

1. Backend sends a ping or challenge to the currently connected Developer runner.
2. Current implementation validates timeout input with default `1000ms` and range `100-10000ms`; applying that timeout to live ping/challenge behavior remains a future/full-acceptance gap.
3. Freshness threshold is 60 seconds since last successful runner heartbeat unless final contract overrides it.
4. Result includes status, diagnostic id, freshness, warnings, errors, and a compact capability summary for P0. Full expected/reported/effective capability detail is a future/full diagnostics acceptance target.
5. Warning results do not allow Run test task dispatch unless `actions.run_test_task.allowed` remains true and the runner is fresh/connected enough for the backend action.
6. Test connection never generates a key, starts a local runner, or starts an Agent task run.
7. Error codes must distinguish timeout, challenge failure, capability mismatch, key expired, key revoked, no active key, disconnected, stale, disabled, and permission denied.
8. Response diagnostics are display-safe summaries only; full diagnostics remain behind backend diagnostics policy.
9. Test connection requires `project:agent_runner:manage` plus `actions.test_connection.allowed`; it does not require `project:agent_task:use` because it creates no task/run evidence.

Future/full acceptance response target:

```json
{
  "status": "failed",
  "diagnostic_id": "diag_...",
  "checked_at": "2026-05-05T18:00:00Z",
  "freshness": {
    "state": "stale",
    "last_seen_at": "2026-05-05T17:58:00Z"
  },
  "capabilities": {
    "expected": ["task_run"],
    "reported": [],
    "effective": []
  },
  "warnings": [],
  "errors": [{ "code": "developer_runner_disconnected" }]
}
```

Secret redaction:

1. Secret redaction applies across ingress logging, storage, response serialization, diagnostics, Test connection, and audit.
2. Use an allowlist response schema or a recursive redactor for any metadata object that may include tokens, keys, authorization headers, provider secrets, endpoint secrets, env vars, URLs with credentials, or filesystem paths that encode credentials.
3. Diagnostics and Test connection must never echo raw key material, bearer tokens, connection strings with credentials, local env dumps, or provider secret values.
4. Validation must include negative tests with secret-bearing metadata in handshake payloads, diagnostics payloads, Test connection warnings/errors, and audit metadata.

UX:

1. Label is `Test connection`.
2. Result appears in the Developer runner connection/diagnostics sheet.
3. Current implementation shows bounded presence/auth freshness result, checked time, safe freshness/auth copy, disconnected/offline results when applicable, and backend-allowed next CTA. Future live ping/challenge may add verified/warning/fail semantics after contract evidence exists.

Validation:

1. API tests for one active key, rotate, revoke disconnect, expiry handshake rejection, expiry disconnect/re-auth behavior, metadata-only list, cleanup audit, and audit redaction.
2. Current P0 API/UI tests for Test connection connected, stale, disconnected/offline, timeout default/range, unsupported-field rejection, no raw secret echo, result rendering, action-driven affordance, Run test task fresh gate, and side-effect boundaries.
3. Full acceptance backend tests for future live challenge failure, capability mismatch, key expired/revoked, no active key, and secret-bearing metadata redaction if those full diagnostics are added.

## 8. Resolver, Runtime, and Terminal Rules

Default resolver:

1. Selects only eligible System managed Project default.
2. Fails typed on no default, multiple defaults, default unavailable, model unconfigured, policy denial, or capability mismatch.
3. Never falls back to Developer runner.

Explicit resolver:

1. Validates exact runner id, same workspace/project, selection authority, readiness, endpoint/model where required, policy, effective capabilities, and Developer runner freshness.
2. Never silently rewrites selected id.
3. Never falls back to Project default after explicit selection failure.
4. `StartTaskRun` recomputes the full selection decision. A snapshot action is advisory UI state, not durable authorization.

Terminal/session:

1. Terminal session creation resolves exactly once and persists `resolved_runner_id` on the terminal session.
2. Reconnect/input/resize/close reuse the terminal session's persisted `resolved_runner_id`; they never re-run Project default resolution.
3. If the terminal belongs to an active run or Developer runner test run, session creation uses that run's `resolved_runner_id`.
4. A standalone task terminal does not require an active run. It uses the current Project default at terminal session creation.
5. If session creation cannot resolve a runner, or an existing session has no usable `resolved_runner_id`, return a typed recovery/error such as `agent_runner_not_resolved` or `terminal_runner_unavailable`.
6. Project default changes do not affect existing terminal sessions. They affect only future standalone terminal session creation.
7. Backend terminal routes and websocket frames must require both `project:agent_task:use` and `project:agent_task:terminal`.

Validation:

1. Resolver unit/integration tests for default, explicit, and failure paths.
2. Terminal backend tests for creation-time resolution, persisted session runner reuse, active run/test run inheritance, standalone Project default resolution, typed no-runner recovery, and no default re-resolution after creation.
3. Route/backend permission tests proving create/open/reconnect/input/resize/close require `project:agent_task:use` plus `project:agent_task:terminal`.
4. Audit tests for resolver failure reasons.

## 9. Error UX Matrix

| Scenario | Audience/surface | User-safe message | Privileged detail | CTA gate | Retry |
| --- | --- | --- | --- | --- | --- |
| No Project default | Ordinary task user | `Task execution is not ready yet.` | `agent_runner_selection_required` plus safe setup state only for Runner maintainer or Diagnostics viewer | Contact maintainer; Agent Runners link only when route affordance allows | Retry after setup changes |
| Project default unavailable | Ordinary task user | `Task execution is temporarily unavailable.` | `agent_runner_unavailable` plus redacted readiness summary only when diagnostics affordance allows | Refresh task; Agent Runners status link only when route affordance allows | Retry after readiness changes |
| Default model unconfigured | Ordinary task user | `Task execution needs setup before it can run.` | `agent_runner_model_unconfigured` plus endpoint/model summary only for privileged diagnostics surfaces | Contact maintainer; setup link only when backend affordance allows | Retry after setup changes |
| Expert has no selectable environment | Execution expert | `No execution environment is available for this run.` | Reason code and per-row disabled reasons from selection snapshot, redacted | Refresh snapshot; use Project default if available | Refresh snapshot |
| Selected environment stale/offline | Execution expert | `Selected execution environment is offline or stale.` | Freshness state and diagnostic id only when `view_diagnostics` allows | Choose another environment; Test connection only on Developer runner sheet when allowed | Retry after freshness changes |
| Permission denied | Ordinary task user | `You do not have access to run this task with the current settings.` | Backend reason code retained in telemetry/audit; not rendered as copy on ordinary task surfaces | Use Project default if visible; request access through normal project process | Do not auto-retry |
| Selection no longer allowed | Execution expert | `This execution environment is no longer available for selection.` | Snapshot reason code mapped to i18n copy; no raw diagnostics | Refresh snapshot; choose another allowed environment | Refresh snapshot |
| Developer runner disconnected | Runner maintainer, Developer runner sheet | `Developer runner is disconnected.` | Redacted connection state, diagnostic id, last heartbeat, and action affordance | Test connection; copy connection metadata only when action allows | Retry after reconnect |
| Developer provider disabled | Runner maintainer, Agent Runners | `Developer runners are not available in this environment.` | Environment capability code, redacted | Hide create/action CTAs or render disabled backend-affordance reason | Retry only after environment capability changes |
| Test connection timeout | Runner maintainer, Developer runner sheet | `Test connection timed out.` | Diagnostic id, timeout, redacted freshness/capability summary | Retry Test connection when `actions.test_connection.allowed=true` | Retry with bounded timeout |
| Test connection challenge failed | Runner maintainer, Developer runner sheet | `Test connection could not verify this Developer runner.` | Challenge failure code and redacted diagnostics only | Reconnect runner; rotate key when key action allows | Retry after reconnect or key rotation |
| Capability mismatch | Execution expert or Runner maintainer | `This execution environment does not support the required task capability.` | Expected/reported/effective capability summary, redacted | Choose another environment; view diagnostics when allowed | Retry after capability report changes |
| Key expired | Runner maintainer, Developer runner sheet | `Connection key expired.` | Key prefix/id and expiry time only, never secret | Issue or rotate key when action allows | Retry after new key handshake |
| Key revoked | Runner maintainer, Developer runner sheet | `Connection key was revoked.` | Key prefix/id and revoked_at only, never secret | Issue key when action allows | Retry after new key handshake |
| No active key | Runner maintainer, Developer runner sheet | `No active connection key is available.` | Redacted key state | Issue key when action allows | Retry after key issue and handshake |
| Terminal execution unavailable | Ordinary task user | `Terminal session is not ready. Try reopening it later.` | `terminal_runner_unavailable` or `agent_runner_not_resolved` only in audit/diagnostics surfaces | Reopen terminal; contact maintainer if repeated | Retry after recovery |
| Raw event details unavailable | Diagnostics viewer | `Detailed event data is not available.` | Raw event access denial code; no secrets, raw diagnostics, or internal paths | Show Activity/Execution details summary; raw event view only when audit/diagnostics affordance allows | Refresh only after affordance changes |

All messages need `en-US` and `zh-CN` i18n keys. Backend returns reason codes; frontend maps them to audience-safe i18n copy for the current surface. Backend reason text is not rendered directly.

Audience rules:

1. Ordinary Agent task user copy and affordances must not mention runner, System managed, endpoint, model configuration, connection key, `required_permissions`, raw `reason_code`, raw diagnostics, raw event details, diagnostic ids, secrets, internal paths, or diagnostic entrypoints.
2. Execution expert copy may use `Execution environment` and Project default language, but still must not expose raw diagnostics, secrets, private provider config, or internal paths.
3. Developer runner sheet copy may include Developer runner, key, connection metadata, and Test connection details because it is a developer-only surface, but every field still comes from backend affordance and redacted response schemas.
4. Diagnostics viewer copy may show diagnostic ids and sanitized details only when `actions.view_diagnostics.allowed=true`.

Validation:

1. Scan ordinary task error-message catalogs, ordinary task screenshots, toast copy, inline errors, terminal open/reopen errors, Activity/Execution summaries, and SSE/event-derived copy for the denylist: `runner`, `System managed`, `endpoint`, `model configuration`, `connection key`, `required_permissions`, `reason_code`, `diagnostics`, `diagnostic id`, `diagnostic entrypoint`, `raw event`, `raw diagnostics`, `internal path`.
2. Add component tests proving ordinary task errors use audience-safe i18n copy for backend reason codes across toast, inline, terminal, Activity/Execution summary, and event-derived surfaces.
3. Add Developer runner sheet tests proving key/Test connection detail appears only when the relevant backend affordance allows it and remains redacted.
4. Keep focused tests proving ordinary REST traces and SSE events use display-safe projection plus frontend second-defense display; add privileged raw event view tests proving raw access appears only under audit/diagnostics affordance and never includes raw diagnostics, secrets, or internal paths.

## 10. Local Evidence and Runbooks

Use separate namespaces:

1. `agent_runner.default_managed.*`
2. `agent_runner.developer.*`

Default managed local-focused evidence proves the local seed has one System managed Project default, CreateTask has no runner fields, StartTaskRun omits `runner_selection`, backend resolves Project default, run records resolved runner id after success, audit records default resolution, and no Developer runner connection is required.

Developer local-focused evidence proves create Developer runner, issue/rotate key, connect local runner, observe fresh connection, run Test connection, invoke the dedicated Developer runner test-task endpoint, verify resulting `runner_test` run records `resolved_runner_id` and selection metadata, audit key/Test connection/test-task evidence, revoke key, and verify disconnect or reconnect failure.

These manifests are local-focused evidence only. They are not backend-real release proof, release readiness sign-off, or managed execution release proof.

Producer/report manifest direction:

1. `local-focused` is an adapter/evidence line, not a new runtime identity.
2. Evidence producers should write a manifest with producer id, command/script entrypoint, git sha, environment capability line, report namespace, start/end time, result, relevant task/run/runner/session ids, diagnostic ids, redaction assertion result, and artifact/report paths.
3. Default managed reports must prove System managed Project default behavior without requiring a Developer runner connection.
4. Developer reports must prove the local developer loop and clearly mark the evidence as development testing evidence.
5. Report readers must not infer formal deployment readiness from `agent_runner.developer.*` evidence.

## 11. Development Work Items

Implementation order guardrails:

1. Close contract and permission blockers before building broad UI flows. Do not add selector UI, Developer runner sheets, or terminal runner/session UX that depends on fields or affordances not yet enforced by backend contracts.
2. Update OpenAPI, generated types, local frontend types, MSW handlers, backend route handlers, and negative tests in the same slice when changing CreateTask, StartTaskRun, Agent Runner public `kind`, display/source label, or action affordance contracts.
3. Convert Agent Runner public APIs to Developer-runner-only lifecycle before enabling create/edit/key UI. System managed rows must already be read-only by backend affordance before they are shown next to Developer runner actions.
4. Fix terminal route permission requirements before terminal session resolver changes are accepted. Terminal tests must prove both task-use and terminal permissions for create/open/reconnect/input/resize/close paths.
5. Implement ordinary task error-code-to-copy mapping before exposing new runner resolution failures to users. Raw resolver codes are allowed in audit/diagnostics surfaces only when the relevant affordance permits them.
6. `runner_test` focused implementation includes ordinary task list/header/message/Activity/active_run surfacing; treat it as local/development testing evidence only unless a later backend-real/release gate explicitly upgrades it.

1. Contract and terminology:
   - Put `runner_selection` on StartTaskRun only for this milestone.
   - Keep `runner_id`, `agent_id`, and `agent_name` out of CreateTask and StartTaskRun except negative tests; keep `runner_selection` out of CreateTask; do not add aliases or migration grace.
   - Add selection snapshot contract, action affordance schema, public `kind=system_managed|developer`, display/source label, Developer runner key lifecycle, Test connection, and dedicated test-task contracts.
   - Bring MSW AgentRunner fixtures/handlers to parity with public `kind`, display/source label, actions, `read_only`, and key lifecycle behavior before relying on them for UI acceptance.
2. Backend:
   - Implement System managed-only Project default.
   - Reject forged System managed lifecycle/key/config mutation calls.
   - Implement explicit resolver with selection authority.
   - Implement Developer runner lifecycle, key rotation/revoke, connection metadata, and Test connection.
   - Implement dedicated Developer runner test-task endpoint that creates standard task/run evidence marked `runner_test`.
   - Persist `resolved_runner_id` on terminal session creation and reuse it for reconnect/input/resize/close.
   - Enforce terminal routes with `project:agent_task:use` plus `project:agent_task:terminal`.
   - Add audit coverage and secret redaction across diagnostics/Test connection.
3. Frontend:
   - Add always-visible Project default status.
   - Use fixed Agent Runners order: Project default status, System managed, Developer runners.
   - Keep System managed lifecycle/key/config mutation out of project UI; allow only status/refresh/view diagnostics and backend-allowed `set_project_default`.
   - Add Developer runner create/connect/diagnostics sheet.
   - Keep Run test task sheet-only and mark resulting ordinary-list/Activity evidence with `runner_test` badge/source.
   - Add Advanced Execution environment selector for eligible run start only.
   - Use selection snapshot as selector data source, never the Agent Runner list, and implement disabled-selected refresh behavior.
   - Render actions from affordances.
   - Add error matrix messages to i18n across toast, inline, terminal, Activity/Execution summary, and SSE/event-derived surfaces.
   - Keep ordinary REST trace/SSE event projection display-safe; gate privileged raw event view behind audit/diagnostics affordance so ordinary users see Activity/Execution details summaries only.
4. Local evidence:
   - Split local-focused seed/evidence paths.
   - Add producer/report manifests.
   - Update local-manual instructions.
   - Use the two report namespaces above.
5. Closure:
   - Regenerate types.
   - Run focused validation.
   - Run `npm run verify -- --goal=pr --run` before PR closure.

## 12. Acceptance Criteria

1. CreateTask rejects `runner_selection`, `runner_id`, `agent_id`, and `agent_name`.
2. StartTaskRun rejects `runner_id`, `agent_id`, and `agent_name`; its only runner input is run-scoped `runner_selection`.
3. UI create-and-start behavior calls CreateTask then StartTaskRun without hidden selector state, aliases, or legacy compatibility.
4. Project default is always System managed and cannot be Developer runner.
5. Developer runner cannot pollute ordinary default path.
6. Explicit selection requires backend selection affordance, not only runner read.
7. Snapshot fetch requires `project:agent_task:use`; non-default row/select authority is row-level and backend-owned.
8. `StartTaskRun` recomputes selection authority and rejects stale snapshot decisions.
9. Agent Runners page is not a second ordinary task entrypoint.
10. Project default status is always visible at the top of Agent Runners.
11. System managed project UI has no lifecycle/key/config mutation; backend rejects forged System managed lifecycle/key/config calls.
12. Public create cannot create System managed runners and cannot pass default/endpoint-binding fields.
13. Developer runner create form is name/description only.
14. Key lifecycle uses one active key, rotate-revokes old key, 7-day expiry, expiry handshake rejection, expiry disconnect/re-auth behavior, revoke disconnect, and metadata-only listing.
15. Test connection must remain dedicated, typed, timed, audited, redacted, and side-effect bounded; current P0 implementation covers bounded presence/auth freshness, strict `timeout_ms` request allowlist, unsupported-field rejection, timeout default/range parity, action-driven availability, offline disconnected result, and no raw secret echo, but not live ping/challenge or capability proof.
16. Dedicated Developer runner test task creates standard task/run evidence marked `runner_test`, requires `project:agent_task:use` plus `project:agent_runner:manage`, is triggered only from the sheet, and cannot count as managed release evidence.
17. `runner_test` focused evidence covers ordinary task list/header/message/Activity/active_run surfacing and stale result clearing on start/error; it remains local/development testing evidence, not backend-real or managed release proof.
18. Terminal session creation resolves once, persists `resolved_runner_id`, supports standalone task terminals through Project default creation-time resolution, and never re-resolves default after creation.
19. Terminal backend gate requires `project:agent_task:use` plus `project:agent_task:terminal`.
20. Ordinary task-use REST traces and SSE events use display-safe projection; privileged raw event view/audit diagnostics affordance remains gated and unaccepted until raw-gate evidence exists, while ordinary users see productized Activity/Execution details.
21. Final acceptance still requires the Error UX matrix to be implemented in both supported locales and ordinary task-user copy to pass the leakage denylist scan across toast, inline, terminal open/reopen, Activity/Execution summary, and SSE/event-derived surfaces.
22. Local-focused evidence is split into default managed and developer namespaces and includes producer/report manifests; it is not backend-real release proof.
23. OpenAPI, generated types, local frontend types, MSW handlers, and backend route handlers agree on CreateTask, StartTaskRun, Agent Runner public `kind`, display/source label, and action affordance contracts.
24. Agent Runner list-level `actions.create_developer_runner` drives the frontend Create CTA; there is no remaining Create collection affordance gap.
25. Cleanup response type, Test connection timeout default/range, Developer runner DELETE 204/no-body, and MSW project scoping parity are aligned in the focused contract evidence.

## 13. Focused Validation Plan

Use progressive validation. Heavy gates are for phase/PR/release closure, not every small slice.

| Slice | Focused validation |
| --- | --- |
| Task/run contracts | Contract tests for CreateTask rejection, StartTaskRun-only `runner_selection`, generated/local type parity, MSW parity, and backend route-handler parity |
| Removed fields | Negative tests for `runner_id`, `agent_id`, and `agent_name` on CreateTask and StartTaskRun; `runner_selection` forbidden on CreateTask; StartTaskRun has no runner input other than `runner_selection` |
| Selection snapshot | API/UI tests for task-use fetch, Project default safe row, selectable/disabled rows, no-authority non-leakage, no-authority no-selector rendering, previously selected disabled row, reason-code mapping, action affordance, `visible=false` omission, secret/diagnostic/source-label omission, and disabled-selected refresh |
| Default resolver | Backend tests for System managed-only default, no default, unavailable default, model unconfigured |
| Explicit resolver | Backend tests for selection authority, same project, permission, policy, capabilities, stale/offline Developer runner, no fallback |
| Affordances | API/UI tests for public `kind`, display/source label, `visible`, `allowed`, `reason_code`, diagnostic-only `required_permissions`, `operation`, `danger_level`, System managed read-only action rendering, AgentRunner row action rendering, connection sheet action-family visibility, list-level `actions.create_developer_runner`, and frontend Create CTA binding to that backend action |
| Public kind/display label | Negative tests for public System managed create, default/endpoint fields, System managed lifecycle/config mutation, System managed key issue/revoke, and action affordance hiding |
| MSW AgentRunner parity | Fixture/handler tests proving MSW AgentRunner rows match public `kind`, display/source label, actions, `read_only`, Developer-only create/update/test-connection/test-task/key behavior, one-active-key, 7-day expiry, rotation revoke, metadata-only list, cleanup response type, DELETE 204/no-body, System managed rejection behavior, project-scoped list/get/update/delete/diagnostics/connection-info/keys/test-connection/test-task, and wrong-project 404 |
| Developer lifecycle | API/UI tests for create/edit/disable/delete, provider-disabled affordances, sheet state machine, and name/description form |
| Key lifecycle | Tests for one active key, rotate, revoke disconnect, expiry handshake rejection, expiry disconnect/re-auth, cleanup audit, metadata-only list, audit redaction |
| Test connection | Current focused slice covers bounded presence/auth freshness, strict `timeout_ms`-only request allowlist, 400 `unsupported_field`, timeout default/range parity, safe copy, no raw secret echo, action-driven availability, offline disconnected result, Run test task fresh gate, and side-effect boundaries; full acceptance still needs challenge/ping, capability mismatch, expanded diagnostics/warnings, key errors, audit, and secret-bearing metadata redaction if those scopes are added |
| Developer test task | Tests for dedicated endpoint, 400 unsupported-field contract, task-use plus runner-manage permission, sheet-only trigger, `runner_test` evidence marker, task list/header/message/Activity/active_run badge/source surfacing, resolved runner/selection metadata, unavailable/failure response, stale result clearing on start/error, no ordinary task launcher/preference reuse, no managed release evidence claim, and audit/usage/backend-real caveat closure or explicit scoping |
| Terminal/session | Tests proving terminal session creation persists resolved runner, run/test-run terminals inherit run runner, standalone terminals resolve Project default once, reconnect/input/resize/close reuse session runner, and route gates require both terminal permissions |
| Raw trace/events projection | Focused tests proving ordinary task-use REST traces and SSE events go through display-safe projection, runner-provided `payload.at` is not trusted for public `at`, server time is used, historical malformed `at` is guarded, frontend second-defense display is applied, and privileged raw route/audit/raw diagnostics affordance remains unavailable until gated evidence exists |
| UX/i18n | Component tests for user-safe Project default status, Advanced selector snapshot, no-authority no-selector rendering, disabled reason rows, audience-safe error matrix, ordinary copy leakage scan across toast/inline/terminal/Activity/Execution/SSE-derived surfaces, raw event gating, en-US/zh-CN keys |
| Local evidence | Local-focused default managed report and developer loop report under separate namespaces with producer/report manifests; not backend-real release proof |

Suggested closure:

1. `npm run contracts:check`
2. `npm run contracts:check-openapi`
3. `npm run openapi:check-generated`
4. `npm run verify -- --goal=pr --run`

Reserve `npm run release:ready` for release closure or deployment-truth changes.

## 14. Non-goals

This milestone does not build a runner marketplace, low-code agent builder, complex scheduling platform, file-level policy, separate Chat/Agent task quota models, role-name authorization, `Execution environment` as a third product object, URL/localStorage/hidden runner selection, removed runner field support, legacy aliases or migration grace, System managed lifecycle/key/config mutation from project UI, Developer runner Project default, explicit-selection fallback to Project default, an atomic `create_and_start` main path, a second ordinary task creation entrypoint, separate Developer runner ownership/test authority, or managed release proof from Developer runner local evidence.

## 15. Reviewer Focus

Non-blocking reviewer focus:

1. Final endpoint/path names for the selection snapshot and Developer runner test-task action.
2. Final action/reason code names for `select_for_task`, disabled selector rows, and Developer runner sheet states.
3. Final capability map labels for expected/reported/effective capabilities.
4. Final timeout, freshness, stale, and key-expiry threshold values.
5. Final audit event names and report namespace names.
