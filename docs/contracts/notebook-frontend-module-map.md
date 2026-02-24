# Notebook Frontend Module Map

This document defines the current module boundary for the Notebook list/detail pages and their immediate growth constraints.

Terminology note:
- Product name: `Notebook`
- Canonical route: `/notebook`

## Scope

- Route: `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/notebook/page.tsx`
- List UI: `src/components/notebook/TaskList.tsx`
- Detail UI: `src/components/notebook/TaskPage.tsx` and notebook conversation components
- Fixed HTTP contract namespace: `/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/*`

## Current Structure

1. `notebook/page.tsx`
- Route param validation and permission gate (`project:notebook:access`).
- Uses shared project layout mode (`useProjectLayoutMode`) to control page width:
  - `standard` -> `contentWidth="wide"`
  - `ultrawide` -> `contentWidth="full"`
- No page-local layout toggle. Toggle is owned by Topbar (`topbar__layout-toggle`).

2. `TaskList.tsx`
- Owns task list data loading (`useTasks`) and list-level interactions.
- Uses compact module toolbar pattern (action row only, no duplicate page title row).
- Primary action: `notebook__create-task-btn`.
- Empty/loading/list rendering are contained in this component.

3. Notebook detail (`components/notebook/TaskPage.tsx`)
- Three-pane layout contract:
  - left: Inputs panel
  - center: Conversation panel
  - right: Artifacts panel
- Center conversation panel supports expandable agent execution details (message-scoped trace panel):
  - default collapsed (result-first UI)
  - lazy trace fetch on expand: `GET /tasks/{taskId}/traces?message_id=<messageId>`
  - supports trace pagination for earlier events via `before_id`
  - supports timeline view and raw event view (high-fidelity, Codex CLI-oriented)
- Inputs panel supports three add channels in current prototype:
  - Files library picker (canonical)
  - Local upload (uploads to Files, then attaches)
  - URL input (stored as URL note file, then attaches)
 - Attached input details should be fetched via task-scoped route (`GET /tasks/{taskId}/inputs`) rather than loading the full Files list and filtering client-side.

4. Notebook task trace data contract (detail page)
- Task SSE route (`/tasks/{taskId}/events`) emits `trace_event` for real-time execution telemetry.
- Trace REST route (`/tasks/{taskId}/traces`) returns persisted/in-memory trace slices with pagination hints:
  - `has_more`
  - `next_after_id`
- Deployment/runtime coordination note:
  - current task SSE replay and active-run guards are server-instance local in `api-entry-node`
  - multi-instance deployments should use sticky routing (or future shared coordination primitives)
- Frontend keeps display strategy local (timeline/raw/filtering) and must not depend on backend-generated UI formatting strings.

## UX Contract

- Keep project-level header density consistent with Chat/Files:
  - No duplicate module title row inside page content.
  - Keep toolbars compact and action-first.
- Preserve existing test ids for regression stability:
  - `notebook__task-list`
  - `notebook__create-task-btn`
  - `notebook__task-card`
- Preserve notebook trace panel test ids used by unit/e2e coverage:
  - `notebook__message-trace-toggle`
  - `notebook__message-trace-panel`
  - `notebook__message-trace-view-timeline`
  - `notebook__message-trace-view-raw`
  - `notebook__message-trace-load-more`

## Growth Guardrails

- If list toolbar grows beyond one row, split into a dedicated toolbar component before adding more logic.
- Do not add per-page width toggles; keep layout mode global at project shell level.
- Keep route-level permission and parameter validation in `notebook/page.tsx`; avoid leaking this logic into leaf UI components.
- Keep execution trace storage/transport structured (`trace_event` + `/traces`) and keep presentation logic in frontend components (`MessageItem`/trace panel) rather than backend-formatted strings.
