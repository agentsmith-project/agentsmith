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

3. Agent task detail (`components/agent-tasks/TaskPage.tsx`)
- Three-pane layout contract:
  - left: Inputs panel
  - center: Conversation, activity, and final answer
  - right: Artifacts panel
- Center conversation panel supports expandable execution details:
  - default collapsed (result-first UI)
  - lazy detail fetch on expand: `GET /tasks/{taskId}/traces?message_id=<messageId>`
  - supports pagination for earlier events via `before_id`
  - supports timeline view and raw event view for engineering/audit inspection
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

## UX Contract

- Keep project-level header density consistent with Chat/Files:
  - No duplicate module title row inside page content.
  - Keep toolbars compact and action-first.
- Agent task create/run flow must not include a runner picker, hidden runner override, URL runner override, or local-storage runner preference.
- Use `Activity` or `Execution details` in product UI; reserve `trace` for engineering/audit internals.

## Growth Guardrails

- If list toolbar grows beyond one row, split into a dedicated toolbar component before adding more logic.
- Do not add per-page width toggles; keep layout mode global at project shell level.
- Keep route-level permission and parameter validation in route pages; avoid leaking this logic into leaf UI components.
- Keep execution telemetry storage/transport structured (`trace_event` + `/traces`) and keep presentation logic in frontend components rather than backend-formatted strings.
