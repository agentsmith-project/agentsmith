# Agent Task Bound Runner and Agent Runners UX Milestone Plan v1

Status: `handoff_plan_ready`
Owner: Product + Engineering
Last updated: 2026-05-06

This plan is the current product and engineering source of truth for Agent task runner binding and the Agent Runners UX.

AgentSmith is pre-GA. This milestone keeps runner binding at task creation so the product does not carry run-time runner switching complexity.

Implementation note: active OpenAPI/generated types may still represent old implementation details until this milestone is developed. They must be updated before any implementation slice claims contract acceptance.

## Purpose

The product model should be simple:

- Chat is for talking to LLM models.
- Agent Tasks are bound to one runner when the task is created.
- Ordinary task creation does not ask users to understand or choose runners.
- Developer-runner-bound tasks are explicit because the binding affects retry, recovery, terminal sessions, and debugging.
- A task's runner does not change during later runs, retry, terminal creation, page refreshes, or session recovery.
- Managed runners are deployment capabilities configured outside the project UI.
- Developer runners are explicit development/local capabilities for authorized agent developers.

This removes run-time runner switching, reduces session ambiguity, and matches user expectations: a task created for one runner should keep using the same runner because session files, terminal sessions, artifacts, and runtime state are not portable across runner implementations.

## Product Decisions

1. Task creation binds a runner.
   - Ordinary `CreateTask` omits `bound_runner_id`; the backend binds the deployment default managed runner.
   - The ordinary UI path must not submit a hidden managed runner id.
   - Expert task creation may bind an authorized Developer runner only.
   - An explicit managed runner id is rejected, not normalized, so the contract stays clear and the ordinary mental model remains low-friction.
   - The selected runner becomes an immutable task fact.

2. Expert mode is a single-task Developer runner override.
   - The UI copy and structure should be "Developer runner override for this task".
   - This is not a generalized runner picker, execution target picker, or runtime selector.
   - The create page must use the backend `runner-binding-options` endpoint and `bind_to_task` affordances.
   - The create page must not derive options from the full Agent Runners list.

3. Run start does not choose a runner.
   - `StartTaskRun`, retry, and recover actions use the task's bound runner.
   - Runner fields in run-start payloads are rejected.
   - No UI or API path may switch a runner at run start, retry, recovery, terminal start, or session reconnect.

4. Managed runner configuration is not a frontend capability.
   - The deployment has exactly one default managed runner in the current milestone.
   - Managed runner configuration is system/deployment-side configuration.
   - The Agent Runners page may show the managed runner as a read-only projection with status, source, and "not configurable here" copy.
   - Ordinary task surfaces must not reinforce managed runner concepts.
   - Managed runner capability details and diagnostics are shown only when a backend affordance explicitly allows that surface.
   - The project UI cannot create, edit, delete, set default, issue key, rotate key, or revoke key for managed runners.

5. Developer runners are development tools.
   - Developer runners appear only when backend development/local capability is enabled.
   - Developer runners are created and managed from the Agent Runners page through backend lifecycle affordances.
   - Developer runners are available for explicit single-task binding only when `runner-binding-options` returns an allowed `bind_to_task` affordance.
   - Developer runners do not become the ordinary default runner.

## Terms And Public Language

- Bound runner: the runner stored on the task at creation time and used for all task runs and terminal/session recovery.
- Default managed runner: the deployment-level managed runner configured outside the frontend. In this milestone there is exactly one.
- Developer runner: a project-level development/local runner connection used by agent developers.
- `runner_binding_source`: audit/API metadata only. It is not a user-facing term.

Machine-readable enum boundary:

- New task binding fields may use `bound_runner_kind: managed | developer`.
- Existing `AgentRunner.kind` wire contracts may retain `system_managed | developer` if the API contract owner keeps that shape.
- Do not present `system_managed` as UI copy, and do not imply that the task binding enum changes every existing machine-readable runner enum.

Avoid exposing implementation terms such as pod, Kubernetes, sandbox, browser-host localhost, runner selection snapshot, `runner_binding_source`, `system_managed`, raw reason codes, or internal diagnostics in ordinary user-facing copy.

## Non-Goals

- No frontend creation, deletion, editing, key management, or default selection for managed runners.
- No project-level managed runner configuration.
- No managed runner marketplace or multi-managed-runner routing policy.
- No run-scoped runner selection.
- No automatic runner migration for existing tasks.
- No automatic fallback from a Developer-runner-bound task to the managed runner.
- No fallback from a missing, forbidden, offline, or unavailable bound runner to another runner.
- No session conversion between runner implementations.
- No inactive developer key history in daily UI.
- No heavy full visual catalog, release gate, or unified deploy gate after each small implementation slice.

## API And Data Contract

This section is the target contract delta for implementation. OpenAPI, generated clients, local task types, MSW handlers, route-kind maps, route tests, and backend authorization must move together.

Slice 0 contract cleanup is a hard gate:

- Active public/action artifacts must remove `/run-selection-snapshot`, `StartTaskRunRequest.runner_selection`, action `select_for_task`, and type tests that prove run-scoped runner selection.
- The string `select_for_task` may appear only in negative cleanup evidence.
- The first implementation slice must replace old artifacts with `CreateTaskRequest.bound_runner_id`, task bound runner response fields, `StartTaskRunRequest` without runner fields, `runner-binding-options`, and `bind_to_task` affordance naming.
- No runtime/UI implementation slice may claim acceptance while generated types, MSW fixtures, route-kind maps, or contract tests still prove the old run-scoped model.
- This plan does not partially edit generated artifacts by hand; generated artifacts are updated through the owning OpenAPI/generation workflow during implementation.

Task creation:

- `CreateTaskRequest.bound_runner_id?: string`
- Omitted `bound_runner_id` means "bind the deployment default managed runner".
- The ordinary UI path must submit no `bound_runner_id`.
- Explicit `bound_runner_id` is valid only for a Developer runner returned with `bind_to_task.allowed=true`.
- Explicit managed runner id is rejected with a typed validation error such as `invalid_binding_target` or equivalent contract-owned code.
- Public task creation rejects old or conflicting runner fields such as `runner_selection`, `runner_id`, `agent_id`, `agent_name`, managed-runner config fields, default-setting fields, `is_default`, and `default_endpoint_id`.
- `CreateTask` must recompute permission, policy, readiness, freshness, capability, and environment capability at submit time. A previous `runner-binding-options` response is not authorization proof.

Task record:

- `bound_runner_id`
- `bound_runner_kind: managed | developer`
- `runner_binding_source: default_managed | explicit`
- `bound_at`
- `bound_by_user_id`

Task response:

- Returns the bound runner fields needed by the task detail page.
- Managed-bound task metadata is low-emphasis or hidden on ordinary surfaces.
- Developer-bound task metadata is explicit because it changes retry, recovery, terminal, and debugging expectations.
- `runner_binding_source` remains API/audit metadata and must not appear as user copy.

Run start:

- `StartTaskRunRequest` has no runner selection field.
- Any runner selection/configuration field in run-start payloads is rejected as `unsupported_field`.
- Task run summaries may expose `resolved_runner_id` as execution evidence, but it must come from the task's bound runner.

Runner binding options:

- Endpoint: `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/runner-binding-options`.
- OpenAPI must declare and validate both path params: `workspaceId` and `projectId`.
- Generated clients must include the route in the route-kind map and require the correct params.
- The endpoint is a read-only convenience for the create UI; final authorization and binding are recomputed on `CreateTask`.
- The response allowlist is:
  - the default managed row as the implicit ordinary path;
  - backend-visible Developer runner rows only;
  - per-row `bind_to_task` affordance;
  - safe disabled/unavailable reason codes;
  - display labels/status/source that are safe for the current surface.
- The response must not include secrets, key material, provider config, full diagnostics, internal paths, endpoint secrets, private model details, or raw environment diagnostics.
- The frontend must not call the full Agent Runners list to build task binding options.
- If development/local capability is disabled, the endpoint returns no Developer rows or returns disabled Developer rows only when the backend contract explicitly allows safe reason display.

Default managed runner API delta:

- The managed runner is a deployment-level read-only projection. It is not a project-created asset.
- Current milestone default managed cardinality is exactly one per deployment.
- Task binding and default resolution must not depend on project-level `default_endpoint_id`, `is_default`, row ordering, or mutable project runner state.
- If existing `AgentRunner` wire fields such as `default_endpoint_id` or `is_default` are retained for compatibility, they are not task binding truth and must not drive task default parsing.
- Public project APIs reject managed runner create/edit/delete/default/config/key issue/key rotate/key revoke attempts, including forged payloads from users who can manage Developer runners.

OpenAPI/generated clients must be updated in the same slice as contract changes.

## Runtime Resolution

Use two explicit resolver phases:

1. `bindRunnerForTask`
   - Runs during task creation.
   - Resolves omitted `bound_runner_id` to the deployment default managed runner.
   - Rejects explicit managed runner ids.
   - Validates explicit Developer runner binding through backend authority, policy, readiness, freshness, capability, and development/local environment capability.
   - Persists immutable binding fields on the task.
   - Fails before dispatch when no default managed runner is configured or ready.

2. `resolveBoundRunnerForRun`
   - Runs during run start, retry, recovery, terminal creation, and session creation.
   - Reads the task's bound runner.
   - Does not use project default state, runner list ordering, or request payload selection.
   - Fails with typed state if the bound runner is missing, forbidden, unavailable, stale, capability-disabled, or offline.

Typed state boundary:

- `forbidden` means the actor no longer has authority for the bound Developer runner or action.
- `unavailable` means the runner or environment cannot currently serve the task despite the actor having task authority.
- User copy maps these states to audience-safe i18n text; raw codes remain diagnostics.

Managed runner ownership:

- The deployment default managed runner owns execution capability and sandbox/runtime configuration.
- Model/endpoint access should be resolved through the existing project endpoint/model governance path, not through mutable frontend runner configuration.

Developer runner ownership:

- Developer runners are project-scoped records used for development validation.
- Developer runner connectivity and key state are mutable, but existing task bindings remain unchanged.
- Disabling development/local capability hides or disables Developer runner creation and binding through backend affordances and causes direct calls to fail closed.

## UX Requirements

Audience matrix:

| Audience | Normal path | Runner visibility |
| --- | --- | --- |
| Ordinary task user | Creates tasks and starts/retries work with the default managed runner. | No runner selector. Managed-bound task metadata is low-emphasis or absent from ordinary surfaces. |
| Expert task creator / agent developer | May open Advanced settings for a Developer runner override for this task. | Sees backend-authorized `runner-binding-options` only during task creation. |
| Runner maintainer | Manages Developer runner lifecycle, keys, connection info, and test task evidence. | Uses Agent Runners; managed runner remains read-only. |
| Deployment/operator context | Configures the default managed runner outside the frontend. | Not a project UI role or frontend capability in this milestone. |

Task creation:

- Ordinary path: no runner choice is shown and no `bound_runner_id` is submitted.
- Advanced settings may show "Developer runner override for this task".
- Advanced settings are not a general runner picker and must not use copy such as "Execution target" or "External runner".
- The default managed runner remains the implicit ordinary path. If it appears in Advanced for orientation, submitting the default still omits `bound_runner_id`.
- Developer runners are shown only from backend `runner-binding-options` rows and only when `bind_to_task` allows or safely explains a disabled state.
- If no Developer runner option is visible or development/local capability is disabled, the override control is hidden or disabled according to backend reason state.
- Submit is blocked for stale/forbidden/unavailable Developer options, and `CreateTask` still revalidates.

Task detail and recovery:

- Show the bound runner as read-only task metadata only where it helps the user understand behavior.
- For managed-bound tasks, keep this metadata low-emphasis so ordinary users do not need to learn runner concepts.
- For Developer-runner-bound tasks, make the binding explicit because it affects retry, recovery, terminal access, and debugging.
- Do not offer runner switching, run selection, or per-run environment switching.
- Retry/recover buttons use the bound runner automatically.
- If a Developer-runner-bound task can no longer run because the user lost runner authority or the Developer runner is deleted/offline, offer "Create new task with default managed runner" only when the user has task creation permission.
- That recovery action creates a new managed-bound task from reusable task inputs and user instructions only.
- It does not migrate or copy session state, terminal state, artifacts, runner runtime state, active runs, trace events, or hidden binding metadata from the original task.
- The original task binding remains immutable.

Agent Runners page:

- Show the deployment default managed runner as a read-only item with status, source such as "Configured by deployment", and "not configurable here" copy.
- Do not promise ordinary UI capability detail for managed runners. Capability summaries and diagnostics appear only behind backend affordances on maintainer/diagnostic surfaces.
- Do not show managed runner create, edit, delete, set default, issue key, rotate key, or revoke key actions.
- "Create runner" should be "Create Developer Runner".
- Developer runner rows support lifecycle actions such as connection info, create key, rotate key, revoke key, test connection, and delete only when backend affordances allow them.
- If development/local capability is disabled, hide or disable Developer runner creation/actions according to backend affordance and show safe unavailable copy.
- Clicking a row expands its details inline.
- Remove separate detail cards rendered below the list.

Developer runner key UX:

- A Developer runner has one active connection key in daily UX.
- If no active key exists, show a single create key action.
- After key creation, show the secret once and then offer `Done` or close controls. Do not label the post-creation close action as `Cancel`, because the key already exists.
- Do not keep showing a second create-key button while an active key exists.
- Do not show inactive key history in normal UI; inactive/revoked keys belong in audit/debug surfaces if needed.
- Runner connection address belongs in runner details or connection instructions, not inside the key creation confirmation area.

## Permissions And Backend Affordances

Backend authorization remains authoritative.

- Default managed task creation requires normal Agent Task creation/use permission.
- The task creation page must not hardcode `project:agent_runner:manage` as the UI truth for Developer binding. It uses `runner-binding-options` and `bind_to_task` as the only frontend truth.
- `CreateTask` must revalidate all required backend permissions and policies for explicit Developer binding, including task use, runner binding authority, policy, readiness, freshness, capability, and environment capability.
- Agent Runners lifecycle management is controlled by Agent Runners backend affordances and the relevant management permission checks.
- Starting, retrying, recovering, or opening a terminal for a Developer-runner-bound task revalidates that the actor can still use that Developer runner.
- Managed runner configuration is not exposed through project/workspace UI permissions in this milestone.
- Do not implement permission checks using role names.

## Terminal, Session, And Recovery Semantics

- Terminal creation uses the task's bound runner.
- Terminal session creation persists `resolved_runner_id` on the terminal session.
- Terminal reconnect, input, resize, and close use the terminal session's persisted `resolved_runner_id`; they do not re-resolve from current task defaults or runner lists.
- Developer-bound terminal sessions continue to revalidate runner authority for the actor/action before sensitive operations.
- Terminal recovery uses persisted task/session binding, not current runner list state.
- Refresh, route switching, or reconnect must show predictable state from backend truth.
- Active task runs and terminal sessions should not become ambiguous if the runner list changes after task creation.
- If the default managed runner is missing or not configured, task creation or create-and-start must fail during preflight before dispatch with a clear unavailable/configuration state.
- If a previously bound runner becomes temporarily offline after task creation, start/retry/recovery should fail with a typed unavailable error without fallback.

Error copy:

- Ordinary task-user copy should explain availability in product terms, for example "Task execution is not ready yet" or "Task execution is temporarily unavailable".
- Ordinary task-user copy must not expose runner internals, sandbox configuration, pod/Kubernetes terms, endpoint/model internals, connection keys, raw reason codes, diagnostic ids, or internal paths.
- Activity, execution summaries, SSE-derived messages, terminal open/reopen errors, toasts, and inline errors must pass through audience-safe i18n copy.
- Runner maintainers or diagnostics viewers may see a redacted diagnostic reason and a link to Agent Runners when backend affordance allows it.
- `AGENT_SANDBOX_NOT_CONFIGURED` and similar internal codes are diagnostics, not ordinary user-facing copy.

## Local Manual Regression Gates

The milestone must explicitly fix or prove the following before closure:

1. Local clean seed must not use public Agent Runners API to create a managed runner.
   - Managed runner creation/configuration is system-side.
   - Public API rejects managed-runner creation/config fields.

2. A normal local manual task using the default managed runner must not fail after dispatch with `AGENT_SANDBOX_NOT_CONFIGURED`.
   - Dispatch has a preflight that fails early with unavailable/configuration state when managed runtime is not configured.
   - In the expected local manual profile, the default managed runner has a valid internal sandbox/runtime configuration.
   - `AGENT_SANDBOX_NOT_CONFIGURED` remains a diagnostic code, not ordinary copy.

3. Session recovery must not use browser-host `localhost` as the API base from inside the sandbox when that address points to the sandbox itself.
   - Internal API base is resolved from deployment/runtime configuration.
   - Sandbox-internal calls use an address reachable from the runner environment.

4. Activity/SSE output must not leak internal codes or diagnostics to ordinary task users.
   - Internal codes are projected through audience-safe copy.
   - Privileged diagnostics remain redacted and affordance-gated.

## Test And Gate Plan

Use focused progressive validation during implementation. Heavy gates run only at milestone closure or when the changed slice requires them.

Required focused closure evidence:

- `npm run contracts:check`
- `npm run contracts:check-openapi`
- `npm run openapi:check-generated`
- route-kind map coverage for `runner-binding-options` path params
- MSW parity for task binding options, Developer-only binding, managed read-only rows, capability-disabled behavior, and negative mutation paths
- generated type negative tests for removed runner fields, explicit managed `bound_runner_id`, and removed `select_for_task`
- focused backend-real terminal/runner evidence for task create, run, terminal session creation, reconnect/input/resize/close, and Developer authority revalidation
- `npm run verify -- --goal=pr --run` at final PR closure when the implementation spans contracts, UI, and runtime paths

Focused evidence producer:

- `npm run test:agent-runners:lifecycle:evidence` exists as a focused evidence producer for Agent Runners lifecycle behavior.
- This producer is not backend-real proof, managed execution proof, release-readiness proof, or a substitute for the required contract/backend-real closure gates above.

Contract/type tests:

- Task creation without `bound_runner_id` binds the default managed runner.
- Ordinary UI submit omits `bound_runner_id`.
- Task creation with explicit Developer runner binds that runner only after current backend revalidation.
- Task creation with explicit managed runner id is rejected.
- CreateTask rejects old/conflicting runner fields.
- Run start rejects runner fields.
- `runner-binding-options` OpenAPI includes `workspaceId` and `projectId` path params and generated clients require them.
- `runner-binding-options` response is allowlisted and omits secrets/full diagnostics.
- Active artifacts remove `select_for_task`; only negative cleanup evidence may mention it.
- Public Agent Runners API rejects managed-runner create/edit/delete/default/config/key issue/key rotate/key revoke payloads.
- Generated OpenAPI/types match the new contract.

Unit/UI tests:

- Task create ordinary path hides runner choice and defaults by omission.
- Task create Advanced mode uses "Developer runner override for this task" framing.
- Task create options come only from `runner-binding-options`, not the full Agent Runners list.
- Capability-disabled environments hide or disable Developer runner override and Agent Runners lifecycle actions through backend affordance state.
- Task detail displays low-emphasis managed binding metadata and explicit Developer runner binding metadata.
- Retry/recover/terminal actions do not expose runner switching.
- Developer-runner-bound unavailable/forbidden state offers "Create new task with default managed runner" only when task creation permission allows it.
- Recovery action copies only reusable inputs/instructions and does not imply migration.
- Ordinary unavailable/error copy hides internal runner/sandbox diagnostics; privileged diagnostics remain redacted and affordance-gated.
- Activity/SSE, terminal, toast, inline, and execution-summary copy pass i18n leakage tests.
- Agent Runners page shows managed runner read-only status/source/not-configurable copy and no managed mutation/key/default actions.
- Developer key UX shows one active key flow and no inactive key history in daily UI.
- Row click expands runner details inline.

Integration/backend-real tests:

- Managed task create -> run -> terminal creation -> reconnect/input/resize/close all use the same bound/session runner.
- Developer task create -> run -> terminal creation -> reconnect/input/resize/close all use the same bound/session runner and revalidate Developer authority.
- Changing runner list/default-like state after task creation does not affect existing task execution.
- Deleting, disabling, disconnecting, or capability-disabling a Developer runner produces typed forbidden/unavailable state for existing Developer-bound tasks without fallback.
- Preflight blocks dispatch when default managed runtime is not configured.
- Sandbox-internal API base is not browser-host `localhost`.
- Activity/SSE projections do not leak internal codes to ordinary users.

Backend-real focused smoke ids:

- `task_create_default_managed_runner`
- `task_create_expert_developer_runner`
- `task_rejects_explicit_managed_bound_runner_id`
- `task_runner_binding_immutable`
- `managed_task_terminal_uses_bound_runner`
- `developer_task_terminal_uses_bound_runner`
- `terminal_reconnect_uses_session_resolved_runner_id`
- `terminal_input_resize_close_use_session_resolved_runner_id`
- `developer_terminal_revalidates_runner_authority`
- `managed_task_session_reconnect_uses_bound_runner`
- `developer_task_session_reconnect_uses_bound_runner`
- `public_api_rejects_managed_runner_create_edit_delete_default_key`
- `runner_binding_options_path_params_and_allowlist`
- `developer_capability_disabled_affordances`
- `local_real_seed_default_managed_runner_internal_path`
- `default_managed_sandbox_configured_or_unavailable_preflight`
- `sandbox_api_base_not_browser_localhost_inside_sandbox`
- `activity_sse_no_internal_code_leakage`

Do not run full visual catalog, `release:ready`, or unified deploy gates for every slice unless the slice changes those surfaces or the final release request requires them.

UI/i18n copy scan:

- Current product surfaces must not show old mental-model copy such as "runner picker", "External runner", "Execution target", "Notebook", or "Agents".
- Ordinary task surfaces must not expose raw `runner_binding_source`, `system_managed`, `select_for_task`, `reason_code`, diagnostic ids, internal paths, or sandbox/runtime internals.
- en-US and zh-CN keys must exist for new audience-safe copy.

## Acceptance Criteria

- Creating a task without expert options omits `bound_runner_id` and binds the deployment default managed runner.
- Authorized expert users can bind a Developer runner at task creation only through backend `runner-binding-options` and `bind_to_task`.
- Explicit managed runner ids are rejected.
- Bound runner fields are immutable task metadata; ordinary managed-bound tasks do not teach runner concepts, while Developer-bound tasks clearly show the binding.
- No UI or API path can switch the runner at run start, retry, terminal start, session reconnect, or recovery.
- Managed runner is visible only as a read-only deployment projection in Agent Runners with status/source/not-configurable copy.
- Managed runner cannot be created, edited, deleted, set as default, issued a key, rotated, or revoked from frontend/public project APIs.
- Developer runner lifecycle appears only when backend development/local capability and lifecycle affordances allow it.
- Developer-runner-bound tasks have an explicit recovery path to create a new managed-bound task from reusable inputs/instructions when the original binding is no longer usable; the original task binding and runtime state remain untouched.
- Terminal/session behavior uses task bound runner at creation and persisted terminal `resolved_runner_id` for reconnect/input/resize/close.
- Ordinary user-facing errors use product availability language and do not expose internal sandbox/runner diagnostics.
- Required contract, generated client, route-kind map, MSW parity, generated negative tests, and focused backend-real terminal/runner gates pass.
- Current docs present task-bound runner selection as the only target.

## Documentation Updates Required

The following documents must align with this milestone:

- `docs/engineering/agentsmith-chat-agent-runner-evolution-plan-v1.md`: update target invariants from run-scoped selection to task-bound runner.
- `docs/contracts/agent-task-frontend-module-map.md`: replace run selection/snapshot language with task creation binding.
- `docs/contracts/agent-runners-frontend-module-map.md`: clarify managed read-only deployment capability and Developer-only lifecycle management.
- `docs/agent-task-runner-runbook.md`: clarify system-side managed runner configuration and task-bound execution.
