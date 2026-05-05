# Frontend-Backend Gating Matrix (Page/Operation Level)

Last updated: 2026-05-05
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
| agent tasks | access task list/detail and create/run/update/archive/cancel tasks | `project:agent_task:use` | `GET/POST/PATCH/DELETE /tasks*`, `GET /tasks/{id}/events`, task message/run/cancel routes | page-level permission denied |
| agent task terminal | open/reconnect/input/resize/close terminal sessions | `project:agent_task:use` + `project:agent_task:terminal` | task terminal ticket/session routes and terminal websocket frames | terminal controls disabled or denied |
| files | view/use project file libraries | `project:endpoint:use` | `GET /file-libraries*` | page-level permission denied |
| files | create/update/delete/move/upload/share file or library | `project:files:update` | `POST/PATCH/DELETE /file-libraries*`, `POST /file-libraries/*/(folders|move|upload|share-link)` | mutating controls disabled |
| Agent Runners | view runner configuration and diagnostics | `project:agent_runner:read` or `project:agent_runner:manage` | `GET /agent-runners*`, `GET /agent-runners/{id}/execution-config`, `GET /agent-runners/{id}/connection-info`, `GET /agent-runners/{id}/diagnostics` | page-level permission denied |
| Agent Runners | create/update/delete/default runners and issue/revoke connection keys | `project:agent_runner:manage` | `POST/PATCH/DELETE /agent-runners*`, `POST/DELETE /agent-runners/{id}/keys*` | mutating controls disabled |
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
8. Files default path now runs on JuiceFS-backed project `file-libraries`.
   New Files frontend or backend work must target `file-libraries`.
9. Chat is Endpoint/Model-only. It must not dispatch Agent Runners or accept legacy runner binding fields.
10. Agent task dispatch is backend-owned and resolves the eligible default Agent Runner at run time.

## Current Split-Permission Status

- `project:endpoint:use`
  - Chat access, send/stream/stop/delete
  - endpoint read/use
  - Files read/use
  - Usage and Access guide read access
- `project:agent_task:use`
  - Agent task list/detail/create/run/update/archive/cancel
- `project:agent_task:terminal`
  - Agent task terminal open/reconnect/input/resize/close, always paired with task access
- `project:agent_runner:read`
  - Agent Runner list/detail/diagnostics read
- `project:agent_runner:manage`
  - Agent Runner create/update/delete/default and connection key mutations
- `project:governance:update`
  - endpoints governance writes
  - project secrets
  - resource policy
- `project:files:update`
  - file and library mutations
  - file-library move/upload/share-link writes
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
