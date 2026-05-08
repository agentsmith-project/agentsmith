# Agent Task Model Setting Milestone Plan v1

Status: `handoff_plan_ready`
Owner: Product + Engineering
Last updated: 2026-05-07

This document is the handoff plan for making Agent tasks use a project-selected Endpoint/default model without moving model configuration into Agent Runners.

The product object in this milestone is the **Agent task model setting**. Do not generalize it into a broad execution settings container.

## Product Decision

Agent task model selection is a project-level setting managed from the Endpoints surface.

- Project admins choose which Endpoint/default model Agent tasks use.
- Agent task users do not choose Endpoint or model when creating a task.
- Agent Runners are execution carriers. They do not own model configuration.
- Developer runners only change where development/debug tasks run.
- Managed runners are backend-provided, read-only execution carriers in project UI.
- This milestone assumes exactly one backend-provided default managed runner. No managed runner selector, routing, priority, or project UI configuration is in scope.

The user-facing model is:

> Choose an Endpoint on Endpoints, then use its default model for Agent tasks.

The engineering model is:

> Task creation binds an execution carrier. Run/session start resolves the project Agent task model setting and records a snapshot.

## Object Boundaries

| Object | Responsibility | Owns Agent task model |
| --- | --- | --- |
| Endpoint | Provider config, credential binding, default model, health, governance metadata | No. It provides the selectable AI resource |
| Agent task model setting | Project pointer to the Endpoint/default model used by Agent tasks | Yes |
| Agent task | User work, messages, traces, artifacts, runner binding | No |
| Managed runner | Backend-provided execution carrier | No |
| Developer runner | Local/development execution carrier and connection lifecycle | No |
| Task run or terminal session | Execution evidence and resolved model snapshot | Records only |

## Invariants

1. Runner binding remains separate from model selection.
   - `CreateTaskRequest.bound_runner_id` keeps its current meaning.
   - Omitted `bound_runner_id` binds the default managed runner.
   - Explicit `bound_runner_id` remains Developer-runner-only.
   - Runner binding options describe runner binding availability only.

2. The Agent task model setting is narrow.
   - It stores only an Endpoint/default model pointer plus revision and audit fields.
   - It does not contain runner, quota, routing, priority, policy, or fallback configuration.
   - First implementation uses the Endpoint default model as the only model source.

3. Backend remains authoritative.
   - The frontend must not infer Agent task model eligibility from raw Endpoint fields.
   - Submit paths recompute permissions, Endpoint readiness, credential availability, governance, and resource policy.
   - URL params, local storage, hidden fields, and stale row affordances are not authority.

4. Runs and sessions use snapshots.
   - Task creation does not snapshot Endpoint/model.
   - Run start and standalone terminal/test-session start resolve the current setting and write a snapshot.
   - Active runs are not changed mid-flight when the project setting changes.
   - Retry creates a new run and resolves the current setting.
   - Recovery/reconnect of an existing run or terminal uses the existing snapshot.

## Non-Goals

- No Endpoint/model selector on normal Agent task creation.
- No Developer-runner-owned model setting.
- No managed-runner-owned model setting or project UI configuration.
- No managed runner selector, routing, priority, or multi-managed-runner policy.
- No candidate list API for Agent task models.
- No new `agent_task_capable` value in `EndpointCapabilityType`.
- No Chat default/model behavior change.
- No Chat/Agent-task split quota.
- No automatic fallback to runner preferences, `default_endpoint_id`, or hard-coded models.
- No migration of active runs after changing the project setting.

## API Contract

Use a narrow project resource:

- `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/agent-task-model-setting`
- `PATCH /api/v1/workspaces/{workspaceId}/projects/{projectId}/agent-task-model-setting`

Allowed setting fields:

- `workspace_id`
- `project_id`
- `endpoint_id`
- `default_model_id` optional only if the Endpoint contract already has a stable default-model record
- `setting_revision`
- `updated_at`
- `updated_by_user_id`
- audit metadata needed to prove before/after setting changes

No runner, quota, routing, priority, fallback, policy body, credential secret, or upstream request field belongs in this setting.

### GET

`GET` is permission-shaped.

- Viewers with `project:agent_task:use` may receive display-safe readiness for Agent task surfaces.
- Viewers with `project:governance:update` may receive the setting details and setup affordance needed to manage the setting.
- Task-only users must not receive Endpoint route/detail access, provider credentials, raw diagnostic paths, or privileged reason detail.

Suggested governance-shaped response:

```json
{
  "readiness": {
    "state": "ready",
    "display_summary": "Agent tasks are ready to run."
  },
  "setting": {
    "endpoint_id": "ep_123",
    "endpoint_display_name": "OpenAI production",
    "default_model": "gpt-5.5",
    "setting_revision": "set_7",
    "updated_at": "2026-05-07T00:00:00.000Z",
    "updated_by_user_id": "user_123"
  },
  "actions": {
    "update": {
      "operation": "update",
      "visible": true,
      "allowed": true,
      "required_permissions": ["project:governance:update"],
      "danger_level": "none"
    }
  }
}
```

### PATCH

`PATCH` requires:

- `project:governance:update`
- `expected_setting_revision`
- same workspace/project validation
- backend recomputation of the Endpoint row action `actions.use_for_agent_tasks`
- audit evidence for before/after state

Suggested request:

```json
{
  "endpoint_id": "ep_123",
  "expected_setting_revision": "set_6"
}
```

For first-time configuration, `expected_setting_revision` is still required and must be `null`; `null` means the caller expects that no project Agent task model setting exists yet.

Reject stale updates with a typed conflict such as `agent_task_model_setting_conflict`.

Readiness uses backend runtime semantics as the contract: `ready`, `not_configured`, or `blocked`, with `agent_task_model_*` reason codes such as `agent_task_model_setting_missing`, `agent_task_model_endpoint_not_found`, `agent_task_model_endpoint_disabled`, `agent_task_model_default_missing`, `agent_task_model_capability_mismatch`, `agent_task_model_protocol_unsupported`, `agent_task_model_credential_missing`, `agent_task_model_credential_unavailable`, `agent_task_model_policy_denied`, `agent_task_model_rate_limited`, and `agent_task_model_spending_limited`.

Do not accept:

- runner IDs or runner preferences
- routing, priority, quota, or fallback fields
- upstream URL, provider credential, or raw protocol fields
- free-form model strings
- task/run scoped Endpoint/model overrides

If the Endpoint model catalog already has a stable default-model ID, the backend may store that pointer. The first version still treats the Endpoint default model as the only allowed model source, not as a user-facing model picker.

## Endpoint Row Affordance

Do not add a separate candidate-list API in the first version. Use the existing Endpoint list rows.

Endpoint rows must expose backend-owned `actions.use_for_agent_tasks` when the viewer has the appropriate shaped affordance.

Candidate visibility is expressed through this Endpoint row affordance, not through a new resource.

`agent_task_capable` is not an `EndpointCapabilityType` enum value. It is a backend-computed row action/readiness result based on:

- Endpoint is active.
- Endpoint has a usable default model.
- Endpoint supports the required chat/completion capability.
- Upstream protocol is supported by the Agent task runtime.
- Credential/configuration is available.
- Governance and resource policy allow Agent task use.

The frontend must render row badge/action/readiness from backend affordances. It must not locally infer that an Endpoint is selectable from `active`, capability enums, model text, or health fields alone.

## Task Creation And Binding

Task creation does two things only:

1. Check display-safe Agent task model readiness/preflight.
2. Bind the runner carrier.

It must not snapshot or submit Endpoint/model fields.

Disallowed public payload fields include:

- `CreateTaskRequest.endpoint_id`
- `CreateTaskRequest.model`
- `CreateTaskRequest.default_endpoint_id`
- `StartTaskRunRequest.endpoint_id`
- `StartTaskRunRequest.model`
- Agent Runner create/update `default_endpoint_id`
- Agent Runner create/update model or execution preference fields

`runner-binding-options` returns runner binding availability only. It must not carry model readiness, Endpoint candidates, or Agent task model selection state.

## Runtime Resolution

Introduce one runtime resolver, for example:

`resolveAgentTaskModelTarget(workspaceId, projectId, context, actor)`

This resolver is the only runtime entrypoint for Agent task model resolution across:

- run start
- retry
- recovery/reconnect paths that need to load an existing snapshot
- standalone terminal/session start
- terminal attached to an existing run
- Developer runner test task

For new runs/sessions, the resolver:

1. Loads the project Agent task model setting.
2. Loads the selected Endpoint.
3. Uses the Endpoint default model as the only first-version model source.
4. Validates active state, required chat/completion support, protocol support, credential availability, governance, and resource policy.
5. Returns a resolved target and writes the run/session snapshot before dispatch.

For recovery/reconnect of an existing run or terminal session, the resolver must reuse the stored snapshot. It must not read the current project setting and silently change the model.

Resolution priority is intentionally short:

1. Endpoint default model from the Agent task model setting.
2. Typed failure if that default model is missing or unusable.

There is no fallback to runner `default_endpoint_id`, runner `execution_preferences`, runner preferences, environment defaults, or hard-coded models.

## Request-Scoped Proxy Protocol

The current static `server.hello.resource_proxy` shape is structurally wrong for this product decision because it is derived from runner default Endpoint state. A connected runner would keep using the wrong proxy after the project Agent task model changes.

First-version protocol requirements:

- `server.hello` must not send a static resource proxy derived from runner `default_endpoint_id`.
- `agent-execution-service` must send the proxy in each request's execution context.
- The runner must use the request context proxy for that run/session.
- The request context must contain the resolved model metadata needed by the runner without letting the runner choose or mutate Endpoint/model.

Minimum wire shape:

```json
{
  "execution_context": {
    "agent_task_model": {
      "endpoint_id": "ep_123",
      "resolved_model": "gpt-5.5",
      "upstream_protocol": "openai_chat_completions",
      "setting_revision": "set_7"
    },
    "resource_proxy": {
      "base_url": "https://agent-execution-service.example/proxy/run_123"
    }
  }
}
```

Keep the proxy credential opaque to the runner and backend-owned. Complex ticket hardening belongs in follow-up unless an existing security gate requires it for launch.

## Snapshot Contract

First-version run/session snapshots include only fields with current authoritative sources:

- `endpoint_id`
- `endpoint_display_name` optional
- `resolved_model`
- `upstream_protocol` optional
- `setting_revision`
- `policy_decision_id` optional
- `resolved_at`

Do not require `endpoint_revision`, `model_profile_version`, or `credential_binding_revision` until those sources exist as stable contracts.

Snapshot boundaries:

- Active run state stores the snapshot used by dispatch, retry evidence, recovery, and reconnect.
- Audit and usage records copy the snapshot fields needed for evidence and billing/reporting.
- Terminal session records either inherit an existing run/test-run snapshot or store their own snapshot at standalone session creation.

## Permissions

Use permission tokens, not role names. Do not add a split permission in this milestone.

| Action | Required permission and backend behavior |
| --- | --- |
| View display-safe readiness on Agent task surfaces | `project:agent_task:use` |
| See model-setting management affordance and selectable Endpoint row actions | `project:governance:update` shaped affordance |
| Patch the Agent task model setting | `project:governance:update` plus `expected_setting_revision` |
| Create/run/retry/recover Agent tasks | `project:agent_task:use` plus resolver/governance/resource-policy preflight |
| Open Agent task terminal | Existing terminal permission plus `project:agent_task:use` and backend preflight |
| Bind Developer runner at task creation | Existing Developer runner binding affordance; model remains project-level |

`project:agent_task:use` does not grant Endpoint route/detail access, Endpoint IDs for task-only users, provider credentials, Chat access, or raw model governance detail.

## UX Scope

Endpoints:

- Show an `Agent task model` summary near the Endpoint list.
- Show selected row badge `Agent task model`.
- Show row action `Use for Agent tasks` only from backend `actions.use_for_agent_tasks`.
- After Endpoint create/import, show the setup next step only when backend affordance says it is visible.
- Do not imply Chat defaults changed.

Agent Tasks:

- No Endpoint selector.
- No model selector.
- No managed runner selector.
- Advanced section contains only Developer runner override.
- If project model setup blocks task creation/run, show display-safe readiness.
- Governance viewers may get a focused link to Endpoints; task-only users get contact-admin copy.

Agent Runners:

- Managed runner is read-only.
- No Endpoint/model edit controls.
- Model readiness is separate from runner connection readiness.
- Developer runner connection/test task stays here.
- Developer runner test task may report that the runner is connected but project model setup blocks execution.

## Implementation Slices

Use TDD and keep each slice small. Focused green evidence is local evidence, not release signoff.

1. Contract red tests
   - Add OpenAPI/contract tests for the narrow GET/PATCH resource.
   - Reject task/run/runner Endpoint/model override payloads.
   - Assert no Agent task model candidate-list API is introduced.

2. Settings store/API
   - Add the Agent task model setting storage and handlers.
   - Add `expected_setting_revision`, stale conflict, permission-shaped GET, audit, and same-project validation.

3. Endpoint row action computation
   - Add backend computation for `actions.use_for_agent_tasks`.
   - Cover active/default-model/chat-or-completion/protocol/credential/governance-policy cases.
   - Ensure frontend tests consume affordances instead of local inference.

4. Resolver unit
   - Add `resolveAgentTaskModelTarget`.
   - Cover missing setting, missing default model, disabled Endpoint, capability mismatch, credential unavailable, policy denied, and no fallback to runner defaults.

5. Run-path integration
   - Wire run start, retry, recovery/reconnect, and Developer runner test task through the resolver.
   - Verify task creation only binds a runner and does not snapshot Endpoint/model.

6. Minimal protocol slice
   - Move proxy from static hello to request-scoped `execution_context.resource_proxy.base_url`.
   - Stop deriving request proxy from runner `default_endpoint_id`.

7. Terminal snapshot slice
   - Cover terminal attached to current task run/test run inheriting the existing snapshot.
   - Cover standalone terminal resolving once at session creation.
   - Cover reconnect/input/resize/close reusing the terminal session snapshot.

8. Frontend RTL/MSW/i18n
   - Endpoints summary, row badge/action, and post-create/import setup affordance.
   - Agent Tasks unavailable states and selector-free create flow.
   - Agent Runners separation of connection readiness and model setup readiness.
   - en-US and zh-CN strings for new display-safe copy.

## Test And Gate Plan

Focused checks during slices:

- Contract/OpenAPI checks for changed API surfaces.
- Focused unit tests for settings API, row action computation, resolver, and snapshot behavior.
- Focused frontend RTL/MSW tests for Endpoints, Agent Tasks, Agent Runners, and i18n.
- `npm run test:agent-task:runner:fast` when runner execution context changes.
- `npm run test:skills:fast` when runner execution context or skill runtime environment changes.
- `npm run test:skills:backend-real` only when backend-real runner/context paths are affected.

Closure gate:

- `npm run contracts:check`
- `npm run contracts:check-openapi`
- `npm run openapi:check-generated`
- `npm run verify -- --goal=pr --run`

Do not run release gates, full visual catalog, or unified deploy gates after every small slice. Escalate only at milestone closure or when a slice directly changes that surface.

## Acceptance Criteria

- Project admins can set the Agent task model from Endpoints using a backend-owned row action.
- Agent task creation has no Endpoint/model selector and Advanced only allows Developer runner override.
- Managed runners remain read-only and never own Endpoint/model configuration.
- Developer runners affect execution location only and never own model configuration.
- All run, retry, recovery, terminal, and Developer test-task paths use `resolveAgentTaskModelTarget`.
- Endpoint default model is the first-version only source; missing default model produces a typed failure.
- Runtime uses request-scoped `execution_context.resource_proxy.base_url`, not static `server.hello.resource_proxy` from runner defaults.
- Runs and terminal sessions record the agreed first-version snapshot fields.
- Task-only users receive display-safe readiness without Endpoint detail access.
- Focused tests cover contracts, setting store/API, row affordances, resolver, run paths, protocol slice, terminal snapshots, frontend RTL/MSW, and i18n.

## Follow-Up, Not This Milestone

- Managed runner selector, routing, priority, or multi-managed-runner policy.
- Dedicated Agent task model candidate-list API.
- Adding `agent_task_capable` to `EndpointCapabilityType`.
- Per-task model selection or run-scoped model selection.
- Chat default/model setting.
- Quota/rate-limit policy design beyond existing resource-policy preflight.
- Full execution-ticket anti-replay design: `jti`, renewal, cross-connection proof, replay consumption semantics, and revocation detail.
- Fine-grained proxy path capability matrix.
- Full terminal protocol generalization beyond the snapshot behavior above.
- Snapshot fields without current stable sources, such as `endpoint_revision`, `model_profile_version`, and `credential_binding_revision`.
- Migration of active runs after setting changes.

## Documentation To Align During Implementation

- `docs/engineering/agent-task-bound-runner-and-runner-ux-milestone-plan-v1.md`
- `docs/contracts/agent-task-frontend-module-map.md`
- `docs/contracts/agent-runners-frontend-module-map.md`
- `docs/contracts/endpoints-frontend-module-map.md`
- `docs/contracts/agent-execution-protocol.md`
- `docs/agent-task-runner-runbook.md`
- OpenAPI specs and generated API types

Key wording:

- Runner binding is execution carrier binding.
- Agent task model setting is Endpoint/default model governance.
- Endpoint/model configuration does not belong to Agent Runner lifecycle.
