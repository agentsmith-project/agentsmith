# Frontend-Backend Gating Matrix (Page/Operation Level)

Last updated: 2026-05-09
Owner: Frontend
Audience: Backend auth team, QA, FE

## Purpose

Define the permission contract from user-visible operations to backend API groups.
Backend enforces `401/403`; frontend applies route/component gates.

## Error Contract

- `401 unauthorized`: missing or invalid auth context/token
- `403 forbidden`: authenticated but missing required permission
- `422 validation_error`: invalid route params or request body

## Canonical Project Permissions (MVP)

- `project:endpoint:use`
- `project:agent_task:use`
- `project:agent_task:terminal`
- `project:agent_runner:read`
- `project:agent_runner:manage`
- `project:audit:read`
- `project:governance:update`
- `project:membership:update`
- `project:admins:update`
- `project:lifecycle:update`
- `project:files:update`

## Matrix

| Page | User Operation | Required Permission(s) | Backend API Group | FE Expected on 403 |
|---|---|---|---|---|
| projects list | view projects | `workspace:read` | `/workspaces/{ws}/projects` | error state or empty permissions fallback |
| projects list | create project | `workspace:project:create` | `POST /workspaces/{ws}/projects` | disable create button + toast/error |
| projects list | delete project | `project:lifecycle:update` | `DELETE /workspaces/{ws}/projects/{project}` | destructive dialog fails gracefully |
| chat | access chat page and model completion | `project:endpoint:use` | `/chat/sessions`, `/messages`, `/attachments`, stream routes | page-level permission denied |
| agent tasks | access task list/detail and create/update/archive/cancel tasks, create tasks with default managed runner binding, start/retry runs using the task's bound runner, and fetch task-creation runner binding options | `project:agent_task:use` | `GET/POST/PATCH/DELETE /tasks*`, `GET /tasks/{id}/events`, task message/run/cancel routes, `GET /tasks/runner-binding-options` | page-level permission denied |
| agent tasks | create a task from a published task file template | `project:agent_task:use` + backend template consumption affordance | `POST /tasks` with `workspace_mode=use_template`, published task file template list | template picker only lists published task file templates; submit blocked without selection |
| agent tasks | explicit Developer runner binding during task creation | `project:agent_task:use` + `project:agent_runner:manage` + backend binding affordance | `CreateTask` with `bound_runner_id`, binding-options route | expert selector hidden/disabled by backend binding options/affordance only; submit blocked |
| agent tasks | start/retry/recover a Developer-runner-bound task | `project:agent_task:use` + `project:agent_runner:manage` + backend bound-runner use affordance | task run/retry/recovery routes | action denied with typed unavailable/forbidden state |
| agent task terminal | create/open/reconnect/input/resize/close terminal sessions | `project:agent_task:use` + `project:agent_task:terminal` | task terminal ticket/session routes and terminal websocket frames | terminal controls disabled or denied |
| agent task terminal | create/recover terminal session for a Developer-runner-bound task | `project:agent_task:use` + `project:agent_task:terminal` + `project:agent_runner:manage` + backend bound-runner use affordance | task terminal ticket/session routes and terminal websocket frames | terminal denied with typed unavailable/forbidden state |
| files | view/use project file libraries and download files | `project:endpoint:use` | `GET /file-libraries*`, object browse/download routes | page-level permission denied |
| files | create/update/delete/move/upload file or library | `project:files:update` | `POST/PATCH/DELETE /file-libraries*`, `POST /file-libraries/*/(folders|move|upload)` | mutating controls hidden or disabled |
| files | manage File states: save point, restore preview/run/cancel, task file template publish/unpublish/delete | `project:files:update` | file-library save point/restore/template routes | File states entry point hidden or disabled |
| Agent Runners | access Agent Runners route and view public rows/status | `project:agent_runner:read` or `project:agent_runner:manage` | `GET /agent-runners*`, display-safe `GET /agent-runners/{id}/execution-config`, `GET /agent-runners/{id}/connection-info` | page-level permission denied |
| Agent Runners | view display-safe diagnostics | `project:agent_runner:read` or `project:agent_runner:manage` plus backend `actions.view_diagnostics.allowed` | `GET /agent-runners/{id}/diagnostics` | diagnostics hidden/disabled |
| Agent Runners | Developer runner create/edit/disable/delete | `project:agent_runner:manage` plus matching backend action affordance | `POST/PATCH/DELETE /agent-runners*` for Developer runner records only | mutating controls disabled |
| Agent Runners | Developer runner connection key, one-time secret, and mutating connection actions | `project:agent_runner:manage` plus matching backend action affordance | `POST/DELETE /agent-runners/{id}/keys*`, connection metadata/action routes | controls disabled; secrets never re-shown after issuance |
| Agent Runners | Developer runner Test connection | `project:agent_runner:manage` plus backend `actions.test_connection.allowed` | `POST /agent-runners/{id}/test-connection` | Test connection control disabled |
| Agent Runners | Developer runner test task | `project:agent_task:use` + `project:agent_runner:manage` + backend `actions.run_test_task.allowed` | dedicated test-task route such as `POST /agent-runners/{id}/test-task-runs` | Run test task hidden/disabled |
| Agent Runners | view managed runner read-only deployment status | `project:agent_runner:read` or `project:agent_runner:manage` plus backend row affordance when diagnostics are shown | `GET /agent-runners*`, display-safe status/diagnostics routes | managed config/default controls absent |
| endpoints | view/use endpoints | `project:endpoint:use` | `GET /endpoints*` | page-level permission denied |
| endpoints | create/update/delete endpoint | `project:governance:update` | `POST/PUT/DELETE /endpoints*` | mutating controls disabled |
| resource policy | view/update endpoint and Agent Runner policy | `project:governance:update` | `GET/PATCH /resources/{endpoint\|agent}/{id}/policy` | mutating controls disabled |
| Project secrets | view/manage project secrets | `project:governance:update` | `GET/POST/DELETE /credentials*` | page-level permission denied |
| members | view/manage members/templates/groups | `project:membership:update` | `/members/*`, `/invites`, `/join-requests/*`, `/groups*`, `/permission-templates*`, `/spending-limit-templates*` | page-level permission denied or mutating controls disabled |
| settings | view project settings shell | `project:governance:update` or `project:admins:update` or `project:lifecycle:update` | `GET /projects/{id}` | page-level permission denied |
| audit | view audit data | `project:audit:read` | `GET /audit` | component-level permission denied |
| Alerts / Alert Center | view alert rules and notifications | `project:audit:read` | `GET /alert-rules*`, `GET /alert-notifications*` | page-level permission denied |
| Alerts / Alert Center | manage/test alert rules and notification status | `project:audit:read` (current MVP alert surface gate) | `POST/PUT/DELETE /alert-rules*`, `POST /alert-rules/*/test`, `PUT /alert-notifications/*` | mutating controls fail gracefully |
| usage | view own usage data (read-only) | `project:endpoint:use` | `GET /usage`, `GET /usage/facts` | component-level permission denied |
| Access guide | view API access handbook | `project:endpoint:use` | N/A (static guidance page) | page-level permission denied |

## Notes for Backend Team

1. Keep ACLs aligned with this matrix and `src/lib/constants/permissions.ts`.
2. Return stable `401/403` semantics and deterministic error payload.
3. Frontend treats `403` as non-retryable for identical payloads.
4. `usage` module is user-self scope only; backend must always enforce `end_user_id = current_user_id`.
5. Do not introduce new project permission points without updating this matrix and permission constants.
6. `usage` should remain a low-cognitive personal usage view only; admin audit/troubleshooting actions belong to `audit` page.
7. `GET /limits/summary` should support endpoint-level limit projection for Usage UI:
   - return `endpoints[].limits[]` with canonical fields: `kind/window/metric/policy_key/used/max/remaining/usage_pct/reset_at`.
   - return `project_summary` with `project_used/project_max/project_remaining/project_usage_pct`.
8. Files default path now runs on AFSCP-backed project `file-libraries`.
   New Files frontend or backend work must target the project-scoped file-library APIs and keep backend storage details server-side.
9. Chat is Endpoint/Model-only. It must not dispatch Agent Runners or accept unsupported runner binding fields.
10. Ordinary Agent task creation binds the deployment default managed runner through backend task creation truth; run/retry/recovery then resolve the task's immutable bound runner.
11. Expert runner binding is allowed only during CreateTask plus backend binding-options/action affordance. Binding-options fetch requires `project:agent_task:use`; explicit Developer runner binding requires backend row-level `project:agent_runner:manage`. CreateTask must reject old selector fields, and StartTaskRun must reject all runner fields.
12. Terminal backend gates must be tested on create/open/reconnect/input/resize/close and must require `project:agent_task:use` plus `project:agent_task:terminal`.
13. Expert binding selector visibility is derived only from backend binding-options rows and action affordances; frontend must not directly use Agent Runner read permission or the full Agent Runner list to decide whether to show it.
14. Display-safe diagnostics and `view_diagnostics` require `project:agent_runner:read` or `project:agent_runner:manage` plus backend affordance.
15. Developer runner binding and later execution/recovery/terminal use require `project:agent_runner:manage`; Developer runner test task requires `project:agent_task:use` plus `project:agent_runner:manage`; Test connection remains `project:agent_runner:manage` plus action because it creates no task/run evidence.
16. UI audiences such as Ordinary task user, Expert task creator, Runner maintainer, and Diagnostics viewer are derived from backend affordances and safe response shape. They are not role names and must not be used as authorization inputs.

## Current Split-Permission Status

- `project:endpoint:use`
  - Chat access, send/stream/stop/delete
  - endpoint read/use
  - Files read/use
  - Usage and Access guide read access
- `project:agent_task:use`
  - Agent task list/detail/create/run/update/archive/cancel, task creation from published task file templates, default managed runner binding, binding-options fetch, and Developer runner test task when paired with runner-manage/action affordance
- `project:agent_task:terminal`
  - Agent task terminal create/open/reconnect/input/resize/close, always paired with task access
- `project:agent_runner:read`
  - Agent Runner route/list/status read and display-safe diagnostics when `actions.view_diagnostics.allowed=true`
- `project:agent_runner:manage`
  - Developer runner create/edit/disable/delete, Developer runner explicit task binding and later Developer-bound task execution/recovery/terminal use, Test connection, connection key/one-time-secret/mutating connection actions, and Developer runner test task only when paired with `project:agent_task:use`
- `project:governance:update`
  - endpoints governance writes
  - project secrets
  - resource policy
- `project:files:update`
  - file and library mutations
  - file-library move/upload writes
  - save point, restore, and task file template management
- `project:membership:update`
  - join requests
  - membership state changes
  - permission templates
  - project groups
- `project:admins:update`
  - assign/revoke project admins
- `project:lifecycle:update`
  - delete project
  - owner transfer
  - other lifecycle settings
