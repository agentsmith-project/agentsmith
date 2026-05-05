# Agent Task Frontend Module Map

This document defines the current module boundary for the Agent task list/detail pages and their immediate growth constraints.

Terminology note:
- Product name: `Agent tasks`
- Canonical list route: `/agent-tasks`
- Canonical detail route: `/agent-tasks/[taskId]`

## Scope

- List route: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/page.tsx`
- Detail route: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/[taskId]/page.tsx`
- List UI: `src/components/agent-tasks/TaskList.tsx`
- Detail UI: `src/components/agent-tasks/TaskPage.tsx` and task conversation/activity components
- Fixed HTTP contract namespace: `/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/*`

## Current Structure

1. `agent-tasks/page.tsx`
- Route param validation and permission gate (`project:agent_task:use`).
- Uses shared project layout mode (`useProjectLayoutMode`) to control page width:
  - `standard` -> `contentWidth="wide"`
  - `ultrawide` -> `contentWidth="full"`
- No page-local layout toggle. Toggle is owned by Topbar (`topbar__layout-toggle`).

2. `TaskList.tsx`
- Owns task list data loading (`useTasks`) and list-level interactions.
- Uses compact module toolbar pattern (action row only, no duplicate page title row).
- Primary action: create task.
- Empty/loading/list rendering are contained in this component.
- CreateTask stores task intent and inputs only. It must not send or persist `runner_selection`, `runner_id`, `agent_id`, `agent_name`, hidden default, or future runner preference.

3. Agent task detail (`components/agent-tasks/TaskPage.tsx`)
- Three-pane layout contract:
  - left: Inputs panel
  - center: Conversation, activity, and final answer
  - right: Artifacts panel
- Center conversation panel supports expandable execution details:
  - default collapsed (result-first UI)
  - lazy detail fetch on expand: `GET /tasks/{taskId}/traces?message_id=<messageId>`
  - supports pagination for earlier events via `before_id`
  - supports productized Activity/Execution details for ordinary users
  - supports raw event view only when audit/diagnostics affordance allows it; raw event view must not display raw diagnostics, secrets, or internal paths
- Inputs panel supports:
  - Files library picker (canonical)
  - Local upload (uploads to Files, then attaches)
  - URL input (stored as URL note file, then attaches)
- Attached input details should be fetched via task-scoped route (`GET /tasks/{taskId}/inputs`) rather than loading the full Files list and filtering client-side.

4. Agent task activity data contract (detail page)
- Task SSE route (`/tasks/{taskId}/events`) emits structured execution telemetry for real-time activity.
- Trace REST route (`/tasks/{taskId}/traces`) returns persisted/in-memory trace slices with pagination hints:
  - `has_more`
  - `next_after_id`
- Deployment/execution coordination note:
  - current task SSE replay and active-run guards are server-instance local in `api-entry-node`
  - multi-instance deployments should use sticky routing or future shared coordination primitives
- Terminal fallback note:
  - if execution dispatch/stream fails before any telemetry frame arrives, backend must synthesize one terminal trace event (`name=execution.terminal`, `phase=end`, `status=error|success`) so frontend/ops never observe a forever-empty activity timeline.
  - task remains a reusable conversation container; terminal trace marks run completion/failure, not task closure.
- Frontend keeps display strategy local (timeline/raw/filtering) and must not depend on backend-generated UI formatting strings.

5. Run start and Execution environment
- `StartTaskRun` is the milestone contract that may accept run-scoped `runner_selection`.
- UI create-and-start behavior must call CreateTask first, then StartTaskRun; selector state must not be cached on the task.
- `StartTaskRun` must recompute selection authority, readiness, policy, capability, and freshness; it must not trust an older snapshot.
- Ordinary users start runs through Project default with no Execution environment control.
- Permissioned expert UI may show `Execution environment` only under Advanced/Execution settings and only from backend selection snapshot/affordance.
- The selection snapshot fetch requires `project:agent_task:use` and returns Project default, selectable/disabled environments, reason codes, and per-row `actions.select_for_task`; it must not use the full Agent Runner list or include secrets/full diagnostics.
- A Project default safe row may be returned with task-use. Non-default System managed rows require backend row-level `project:agent_runner:read` plus readiness/policy/capability checks. Developer runner rows require backend row-level `project:agent_runner:manage` plus readiness/freshness/policy/capability checks.
- If the caller has no selection authority, the snapshot may return only the Project default safe row and must not leak hidden runner names or diagnostics.
- If a previously selected environment becomes unavailable, invisible, or permission-denied after refresh, keep it as a safe disabled selected row with reason code, block submit, and require switching to Project default or another available option.

6. Terminal session runner binding
- Terminal session creation resolves exactly once and persists `resolved_runner_id`.
- If attached to an active run or Developer runner test run, creation uses that run's resolved runner.
- Standalone task terminal creation uses Project default and does not require an active run.
- Reconnect/input/resize/close reuse the terminal session runner and never re-resolve Project default.
- Missing or unusable `resolved_runner_id` returns a typed recovery/error.
- Terminal backend routes and websocket frames must require both `project:agent_task:use` and `project:agent_task:terminal`.

## UX Contract

- Keep project-level header density consistent with Chat/Files:
  - No duplicate module title row inside page content.
  - Keep toolbars compact and action-first.
- Agent task create/run flow must not include an ordinary runner picker, hidden runner override, URL runner override, or local-storage runner preference.
- The only allowed selector is the run-scoped expert `Execution environment` described above.
- Use `Activity` or `Execution details` in product UI; reserve `trace` for engineering/audit internals.
- Ordinary task-user error copy must not leak runner, System managed, endpoint, model configuration, connection key, `required_permissions`, raw `reason_code`, raw diagnostics, secrets, or internal paths.
- UI audiences such as Ordinary task user, Execution expert, and Diagnostics viewer are derived from backend affordances and safe response shape, not role names.

## Growth Guardrails

- If list toolbar grows beyond one row, split into a dedicated toolbar component before adding more logic.
- Do not add per-page width toggles; keep layout mode global at project shell level.
- Keep route-level permission and parameter validation in route pages; avoid leaking this logic into leaf UI components.
- Keep execution telemetry storage/transport structured (`trace_event` + `/traces`) and keep presentation logic in frontend components rather than backend-formatted strings.
- Add route permission tests proving terminal controls and backend calls require `project:agent_task:use` plus `project:agent_task:terminal`.
- Add tests proving raw event view appears only under audit/diagnostics affordance and ordinary users receive Activity/Execution details summaries.
