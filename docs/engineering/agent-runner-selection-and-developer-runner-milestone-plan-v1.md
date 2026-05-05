# Execution Environment Selection and Developer Runner Milestone Plan v1

Last updated: 2026-05-05 PDT
Status: `handoff_plan_ready`
Owner: Product + Engineering

## 1. Status and Scope

This is the next-milestone handoff plan for Execution environment selection and Developer runner lifecycle after the second-round team review. It is planning evidence only; authoritative contracts, OpenAPI, generated types, route gates, permission matrices, and backend authorization must be updated before implementation treats these fields or actions as supported behavior.

Pre-GA rule: there is no historical field support obligation. `runner_id`, `agent_id`, and `agent_name` are removed unsupported fields and may appear only in negative tests, cleanup evidence, or forbidden-field assertions.

Current implementation blockers:

1. The current backend route gate/tests in `required-project-permissions.ts` still check only `project:agent_task:terminal` for terminal routes. This is a known security-boundary implementation gap, not a normal acceptance item.
2. This gap must be fixed early in this milestone by updating `required-project-permissions.ts` and the corresponding route permission tests to require both `project:agent_task:use` and `project:agent_task:terminal`.
3. Until that fix is implemented and covered by tests, terminal runner/session changes cannot be treated as passing governance acceptance.

In scope:

1. Run-scoped Execution environment selection.
2. Project default through System managed runners only.
3. Developer runner create/connect/Test connection/test task loop.
4. Agent Runners page UX with always-visible Project default status.
5. Backend action affordances, permissions, audit, resolver rules, terminal/session rules, and split local evidence.

Product UI terms: `Execution environment`, `Project default`, `System managed`, `Developer runner`, `Test connection`.

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
3. Task creation stores task intent and inputs only; it must not persist selected runner, last selected runner, hidden selector, or future run preference.
4. Canonical run contract for this milestone: `StartTaskRun` accepts optional `runner_selection`; `CreateTask` does not accept it.
5. Project default run start omits `runner_selection`; backend resolves the System managed Project default.
6. The run records `resolved_runner_id` only after resolver success.
7. UI that offers "create and start" must first call `CreateTask`, then call `StartTaskRun`; it must not hide, cache, or persist selector state on the task.
8. `StartTaskRun` must recompute selection authority, policy, capability, readiness, and freshness at submit time. It must not trust an earlier selection snapshot as authorization proof.

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
10. Snapshot rows include only display-safe fields such as id, name, public `kind`, public source label, freshness/readiness summary, capability summary, disabled reason codes, and action affordance.
11. The snapshot must not return connection secrets, key material, complete diagnostics, private provider config, endpoint secrets, or raw environment diagnostics.
12. Snapshot authorization is backend-owned; frontend visibility is a UX reflection of the snapshot, not a separate source of truth.

UX:

1. Ordinary create/start UX has no Execution environment control.
2. Permissioned expert UX shows run-scoped `Execution environment` only under `Advanced` or `Execution settings`, and only when the backend selection snapshot exposes a visible affordance.
3. Default option is `Project default`.
4. Explicit options come from a backend-visible snapshot.
5. Unavailable environments stay visible only when the backend snapshot returns a safe disabled row. Backend reason codes map to audience-safe i18n copy; raw reason codes are not ordinary task-user copy.
6. Refresh updates the snapshot without list jumps or silently changing the user's selected option.
7. If the previously selected environment becomes unavailable, invisible, or permission-denied after refresh, keep it as the disabled selected row, show the reason, forbid submit, and require the user to switch back to `Project default` or another available option.
8. Submit `runner_selection` only when the user intentionally chooses a non-default option.
9. No URL parameters, localStorage/sessionStorage preference, hidden field, or stale form state may select a runner.
10. Selector display is controlled only by backend snapshot rows and affordances. The frontend must not query the Agent Runner list or directly use `project:agent_runner:read` to decide whether the selector appears.

Acceptance:

1. CreateTask rejects all removed runner fields and `runner_selection`.
2. StartTaskRun owns run-scoped `runner_selection`.
3. Ordinary start resolves Project default without selector.
4. Explicit selection records only resolved runner id after backend success.
5. Failed explicit selection leaves no selector on the task.
6. Expert selector options come from the selection snapshot, not from the full Agent Runner list.
7. Snapshot fetch requires only `project:agent_task:use`; non-default rows are included only by backend row-level affordance.
8. `StartTaskRun` rejects stale or no-longer-authorized selection even if an older snapshot allowed it.

Validation:

1. Contract tests for CreateTask rejection and run-scoped selection.
2. Backend tests proving resolved runner id is written only after success.
3. Backend/API tests for snapshot field allowlist, disabled reason codes, `actions.select_for_task`, and secret/diagnostic omission.
4. Backend tests for Project default safe row, no-authority non-leakage, previously-selected disabled row, and StartTaskRun revalidation.
5. Frontend tests for ordinary no-selector submit, expert intentional selection submit, snapshot-only selector rendering, and disabled-selected refresh behavior.

## 4. Feature: Project Default and System Managed

Function:

1. Only System managed runners may be Project default.
2. Developer runners cannot become Project default through API, UI, seed, or runbook.
3. Default resolver considers only eligible System managed runners.
4. Public project APIs cannot create System managed runners, delete them, generate keys for them, or edit their underlying configuration.
5. Public Agent Runner records and selection snapshot rows must expose a stable public `kind`/source concept, such as `kind=system_managed|developer`, plus action affordances.
6. Public create APIs can create Developer runners only. They must reject `kind=system_managed`, `is_default`, `default_endpoint_id`, default-setting fields, and underlying System managed configuration fields.
7. Connection key issue/revoke actions are forbidden for System managed runners, even for users with `project:agent_runner:manage`.
8. `read_only` is display metadata only; actions come from backend affordances.

UX:

1. Agent Runners page uses this fixed order: top Project default status, System managed read-only section, Developer runners section.
2. Project default status is always visible above grouped lists.
3. Status shows runner name, readiness, endpoint/model summary when available, last check time, user-safe issue, and backend-allowed CTA.
4. Top CTAs are allowlisted to refresh/status actions, Project default setup/status actions when backend-allowed, and Create Developer runner when backend-allowed. Public UI cannot edit underlying System managed configuration. No top-level `Start task` CTA is allowed.
5. Status word priority is deterministic: disabled/blocked, not configured, unavailable/error, stale/warning, ready. Higher-severity state wins when multiple facts are present.
6. System managed section is read-only.
7. System managed section has no direct task-start action, key action, delete action, or underlying configuration edit.
8. `Set as Project default` appears only for System managed runners when `actions.set_project_default.allowed=true`.

Acceptance:

1. Ordinary default run never resolves to Developer runner.
2. Project default status remains visible regardless of tab/group state.
3. System managed rows expose only backend-allowed actions.
4. Public create rejects System managed/default/endpoint-binding fields.
5. System managed key issue/revoke is hidden or disabled by backend affordance and rejected by backend if called.

Validation:

1. Backend tests for default uniqueness and System managed-only constraint.
2. API tests rejecting Developer runner default changes.
3. UI tests for always-visible Project default status.
4. Negative API tests for public System managed create, `is_default`, `default_endpoint_id`, and key issue/revoke on System managed runners.
5. Backend-real evidence for ordinary run resolving System managed Project default.

## 5. Feature: Developer Runner Lifecycle

Function:

1. Developer runner is a developer-mode testing object. It may appear in Agent Runners only when development/local capability is enabled and backend affordances expose it.
2. Create form requires only `name`; `description` is optional.
3. Users should not configure capabilities at creation time. Optional `expected_capabilities` may exist later, but capability truth comes from handshake and Test connection.
4. Capability display distinguishes `expected_capabilities`, `reported_capabilities`, and `effective_capabilities`.
5. Align those fields with the existing capability map shape, or explicitly migrate the contract and regenerate types.
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
   - `waiting_for_connection`: show connection metadata, rotate/revoke key CTAs when allowed, and Test connection disabled until a connection exists.
   - `connected_fresh`: show freshness and enable Test connection when allowed.
   - `test_connection_passed`: show passed result and enable Run test task only if `project:agent_task:use`, `project:agent_runner:manage`, and `actions.run_test_task.allowed=true`.
   - `test_connection_warning`: show warning reason, diagnostics id when allowed, and only enable Run test task if backend action and required permissions remain allowed.
   - `test_connection_failed`: show failure reason and recovery CTA; Run test task disabled.
   - `key_expired`, `key_revoked`, `no_active_key`: show issue/rotate key CTA when allowed and block connection/test task.
   - `stale`, `disconnected`, `disabled`: show recovery CTA from affordances and block Run test task unless backend explicitly allows it.
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

Acceptance:

1. Developer runner create form is name/description only.
2. Capability display separates expected, reported, and effective values.
3. Developer runner cannot be Project default.
4. Run test task is not a general task creation entrypoint.
5. Developer runner create/actions disappear or disable by backend affordance when the developer provider is not enabled.
6. Developer runner sheet CTAs follow the state machine above.

Validation:

1. API/UI tests for create/update payload shape.
2. UI tests for capability categories and sheet-only Run test task.
3. Tests proving Developer runner cannot become Project default.
4. API/UI tests for developer-provider disabled affordances.
5. API tests for dedicated test-task endpoint, `project:agent_task:use` plus `project:agent_runner:manage` permission, `runner_test` evidence marker, resolved runner id, and selection metadata.

## 6. Backend Affordances, Permissions, and Audit

All UI actions must come from backend affordances. `read_only` is a label; it does not decide button visibility or permission.

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

`required_permissions` is per-row and per-operation diagnostic metadata. It is not a fixed permission recipe for every `select_for_task` action. A Project default safe row can report only `project:agent_task:use`; a non-default System managed row can report `project:agent_task:use` plus `project:agent_runner:read`; a Developer runner row can report `project:agent_task:use` plus `project:agent_runner:manage`.

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
3. `danger_level` controls destructive styling and confirmation.
4. `required_permissions` is diagnostic metadata, not frontend authorization truth.

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
11. Expiry cleanup is an explicit implementation work item: stale active-key indexes, connection state, and audit evidence must converge without requiring manual database edits.

Test connection endpoint:

`POST /workspaces/{workspaceId}/projects/{projectId}/agent-runners/{runnerId}/test-connection`

Request:

```json
{
  "timeout_ms": 10000,
  "required_capabilities": ["task_run"]
}
```

Rules:

1. Backend sends a ping or challenge to the currently connected Developer runner.
2. Default timeout is 10 seconds; maximum timeout is 30 seconds.
3. Freshness threshold is 60 seconds since last successful runner heartbeat unless final contract overrides it.
4. Result includes status, diagnostic id, freshness, expected/reported/effective capabilities, warnings, and errors.
5. Warning results do not allow dispatch unless `actions.select_for_task.allowed` or `actions.run_test_task.allowed` remains true.
6. Test connection never generates a key, starts a local runner, or starts an Agent task run.
7. Error codes must distinguish timeout, challenge failure, capability mismatch, key expired, key revoked, no active key, disconnected, stale, disabled, and permission denied.
8. Response diagnostics are display-safe summaries only; full diagnostics remain behind backend diagnostics policy.
9. Test connection requires `project:agent_runner:manage` plus `actions.test_connection.allowed`; it does not require `project:agent_task:use` because it creates no task/run evidence.

Response shape:

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
3. Show pass/warning/fail, checked time, diagnostic id, freshness, capability summary, and backend-allowed next CTA.

Validation:

1. API tests for one active key, rotate, revoke disconnect, expiry handshake rejection, expiry disconnect/re-auth behavior, metadata-only list, cleanup audit, and audit redaction.
2. Backend tests for Test connection connected, stale, disconnected, timeout, and challenge failure.
3. Backend tests for capability mismatch, key expired/revoked, no active key, and secret-bearing metadata redaction.
4. UI tests for Test connection result rendering and side-effect boundaries.

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

1. Ordinary Agent task user copy must not mention runner, System managed, endpoint, model configuration, connection key, `required_permissions`, raw `reason_code`, raw diagnostics, secrets, or internal paths.
2. Execution expert copy may use `Execution environment` and Project default language, but still must not expose raw diagnostics, secrets, private provider config, or internal paths.
3. Developer runner sheet copy may include Developer runner, key, connection metadata, and Test connection details because it is a developer-only surface, but every field still comes from backend affordance and redacted response schemas.
4. Diagnostics viewer copy may show diagnostic ids and sanitized details only when `actions.view_diagnostics.allowed=true`.

Validation:

1. Scan ordinary task error-message catalogs and ordinary task screenshots for the denylist: `runner`, `System managed`, `endpoint`, `model configuration`, `connection key`, `required_permissions`, `reason_code`, `diagnostics`, `raw diagnostics`, `internal path`.
2. Add component tests proving ordinary task errors use audience-safe i18n copy for backend reason codes.
3. Add Developer runner sheet tests proving key/Test connection detail appears only when the relevant backend affordance allows it and remains redacted.
4. Add raw event view tests proving ordinary users see Activity/Execution details summaries, while raw event view appears only under audit/diagnostics affordance and never includes raw diagnostics, secrets, or internal paths.

## 10. Local Evidence and Runbooks

Use separate namespaces:

1. `agent_runner.default_managed.*`
2. `agent_runner.developer.*`

Default managed evidence proves local-real seed has one System managed Project default, CreateTask has no runner fields, StartTaskRun omits `runner_selection`, backend resolves Project default, run records resolved runner id after success, audit records default resolution, and no Developer runner connection is required.

Developer evidence proves create Developer runner, issue/rotate key, connect local runner, observe fresh connection, run Test connection, invoke the dedicated Developer runner test-task endpoint, verify resulting `runner_test` run records `resolved_runner_id` and selection metadata, audit key/Test connection/test-task evidence, revoke key, and verify disconnect or reconnect failure.

Developer runner local evidence is development evidence only. It cannot be used as managed execution release proof.

Producer/report manifest direction:

1. `local-real` is an adapter/evidence line, not a new runtime identity.
2. Evidence producers should write a manifest with producer id, command/script entrypoint, git sha, environment capability line, report namespace, start/end time, result, relevant task/run/runner/session ids, diagnostic ids, redaction assertion result, and artifact/report paths.
3. Default managed reports must prove System managed Project default behavior without requiring a Developer runner connection.
4. Developer reports must prove the local developer loop and clearly mark the evidence as development testing evidence.
5. Report readers must not infer formal deployment readiness from `agent_runner.developer.*` evidence.

## 11. Development Work Items

1. Contract and terminology:
   - Put `runner_selection` on StartTaskRun only for this milestone.
   - Keep `runner_id`, `agent_id`, and `agent_name` out of CreateTask and StartTaskRun except negative tests; keep `runner_selection` out of CreateTask.
   - Add selection snapshot contract, action affordance schema, public `kind`/source concepts, Developer runner key lifecycle, Test connection, and dedicated test-task contracts.
2. Backend:
   - Implement System managed-only Project default.
   - Implement explicit resolver with selection authority.
   - Implement Developer runner lifecycle, key rotation/revoke, connection metadata, and Test connection.
   - Implement dedicated Developer runner test-task endpoint.
   - Persist `resolved_runner_id` on terminal session creation and reuse it for reconnect/input/resize/close.
   - Enforce terminal routes with `project:agent_task:use` plus `project:agent_task:terminal`.
   - Add audit coverage and secret redaction across diagnostics/Test connection.
3. Frontend:
   - Add always-visible Project default status.
   - Use fixed Agent Runners order: Project default status, System managed, Developer runners.
   - Add Developer runner create/connect/diagnostics sheet.
   - Add Advanced Execution environment selector for eligible run start only.
   - Use selection snapshot as selector data source, never the Agent Runner list, and implement disabled-selected refresh behavior.
   - Render actions from affordances.
   - Add error matrix messages to i18n.
   - Gate raw event view behind audit/diagnostics affordance; ordinary users see Activity/Execution details summaries only.
4. Local evidence:
   - Split local-real seed/evidence paths.
   - Add producer/report manifests.
   - Update local-manual instructions.
   - Use the two report namespaces above.
5. Closure:
   - Regenerate types.
   - Run focused validation.
   - Run `npm run verify -- --goal=pr --run` before PR closure.

## 12. Acceptance Criteria

1. CreateTask rejects `runner_selection`, `runner_id`, `agent_id`, and `agent_name`.
2. StartTaskRun owns run-scoped `runner_selection`; UI create-and-start behavior calls CreateTask then StartTaskRun.
3. Project default is always System managed and cannot be Developer runner.
4. Developer runner cannot pollute ordinary default path.
5. Explicit selection requires backend selection affordance, not only runner read.
6. Snapshot fetch requires `project:agent_task:use`; non-default row/select authority is row-level and backend-owned.
7. `StartTaskRun` recomputes selection authority and rejects stale snapshot decisions.
8. Agent Runners page is not a second ordinary task entrypoint.
9. Project default status is always visible at the top of Agent Runners.
10. Developer runner create form is name/description only.
11. Public create cannot create System managed runners and cannot pass default/endpoint-binding fields.
12. Key lifecycle uses one active key, rotate-revokes old key, 7-day expiry, expiry handshake rejection, expiry disconnect/re-auth behavior, revoke disconnect, and metadata-only listing.
13. Test connection is dedicated, typed, timed, audited, redacted, and side-effect bounded.
14. Dedicated Developer runner test task creates standard task/run evidence marked as runner test and requires `project:agent_task:use` plus `project:agent_runner:manage`.
15. Terminal session creation resolves once, persists `resolved_runner_id`, supports standalone task terminals through Project default creation-time resolution, and never re-resolves default after creation.
16. Terminal backend gate requires `project:agent_task:use` plus `project:agent_task:terminal`.
17. Raw event view is gated by audit/diagnostics affordance; ordinary users see productized Activity/Execution details.
18. Error UX matrix is implemented in both supported locales and ordinary task-user copy passes the leakage denylist scan.
19. local evidence is split into default managed and developer namespaces and includes producer/report manifests.

## 13. Focused Validation Plan

Use progressive validation. Heavy gates are for phase/PR/release closure, not every small slice.

| Slice | Focused validation |
| --- | --- |
| Task/run contracts | Contract tests for CreateTask rejection and run-scoped selection |
| Removed fields | Negative tests for `runner_id`, `agent_id`, `agent_name`, and `runner_selection` on CreateTask |
| Selection snapshot | API/UI tests for task-use fetch, Project default safe row, selectable/disabled rows, no-authority non-leakage, previously selected disabled row, reason-code mapping, action affordance, secret/diagnostic omission, and disabled-selected refresh |
| Default resolver | Backend tests for System managed-only default, no default, unavailable default, model unconfigured |
| Explicit resolver | Backend tests for selection authority, same project, permission, policy, capabilities, stale/offline Developer runner, no fallback |
| Affordances | API/UI tests for `visible`, `allowed`, `reason_code`, `required_permissions`, `operation`, `danger_level` |
| Public kind/source | Negative tests for public System managed create, default/endpoint fields, System managed key issue/revoke, and action affordance hiding |
| Developer lifecycle | API/UI tests for create/edit/disable/delete, provider-disabled affordances, sheet state machine, and name/description form |
| Key lifecycle | Tests for one active key, rotate, revoke disconnect, expiry handshake rejection, expiry disconnect/re-auth, cleanup audit, metadata-only list, audit redaction |
| Test connection | Tests for challenge/ping, timeout, freshness, diagnostics, warnings, capability mismatch, key errors, no key/task side effects, and secret-bearing metadata redaction |
| Developer test task | Tests for dedicated endpoint, task-use plus runner-manage permission, sheet-only trigger, runner-test evidence marker, resolved runner/selection metadata, and no ordinary task launcher |
| Terminal/session | Tests proving terminal session creation persists resolved runner, run/test-run terminals inherit run runner, standalone terminals resolve Project default once, reconnect/input/resize/close reuse session runner, and route gates require both terminal permissions |
| UX/i18n | Component tests for default status, Advanced selector snapshot, disabled reason rows, audience-safe error matrix, ordinary copy leakage scan, raw event gating, en-US/zh-CN keys |
| Local evidence | Backend-real default managed report and developer loop report under separate namespaces with producer/report manifests |

Suggested closure:

1. `npm run contracts:check`
2. `npm run contracts:check-openapi`
3. `npm run openapi:check-generated`
4. `npm run verify -- --goal=pr --run`

Reserve `npm run release:ready` for release closure or deployment-truth changes.

## 14. Non-goals

This milestone does not build a runner marketplace, low-code agent builder, complex scheduling platform, file-level policy, separate Chat/Agent task quota models, role-name authorization, URL/localStorage/hidden runner selection, removed runner field support, Developer runner Project default, explicit-selection fallback to Project default, an atomic `create_and_start` main path, a second ordinary task creation entrypoint, separate Developer runner ownership/test authority, or managed release proof from Developer runner local evidence.

## 15. Reviewer Focus

Non-blocking reviewer focus:

1. Final endpoint/path names for the selection snapshot and Developer runner test-task action.
2. Final action/reason code names for `select_for_task`, disabled selector rows, and Developer runner sheet states.
3. Final capability map labels for expected/reported/effective capabilities.
4. Final timeout, freshness, stale, and key-expiry threshold values.
5. Final audit event names and report namespace names.
