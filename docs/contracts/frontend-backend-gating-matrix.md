# Frontend-Backend Gating Matrix (Page/Operation Level)

Last updated: 2026-03-08
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
- `project:agent:manage`
- `project:agent:public`
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
| chat | access chat page and stream completion | `project:endpoint:use` | `/chat/sessions`, `/messages`, `/attachments`, stream routes | page-level permission denied |
| notebook list/detail | access notebook page and task operations | `project:endpoint:use` | `GET/POST/PATCH/DELETE /tasks*`, `GET /tasks/{id}/events` | page-level permission denied |
| files | view/use project file libraries | `project:endpoint:use` | `GET /file-libraries*` | page-level permission denied |
| files | create/update/delete file or library | `project:files:update` | `POST/PATCH/DELETE /file-libraries*` | mutating controls disabled |
| agents | view/use visible agents | `project:agent:manage` | `GET /agents*`, `GET /agents/{id}/execution-config`, `GET /agents/{id}/connection-info` | page-level permission denied |
| agents | create/update/delete own agent and keys | `project:agent:manage` | `POST/PATCH/DELETE /agents*`, `POST/DELETE /agents/{id}/keys*` | mutating controls disabled |
| agents | publish/unpublish agent to project | `project:agent:public` | `PATCH /agents/{id}` (visibility/public flags) | publish controls disabled |
| endpoints | view/use endpoints | `project:endpoint:use` | `GET /endpoints*` | page-level permission denied |
| endpoints | create/update/delete endpoint | `project:governance:update` | `POST/PUT/DELETE /endpoints*` | mutating controls disabled |
| resource policy | view/update endpoint/agent policy | `project:governance:update` | `GET/PATCH /resources/{endpoint\|agent}/{id}/policy` | mutating controls disabled |
| credentials | view/manage credentials | `project:governance:update` | `GET/POST/DELETE /credentials*` | page-level permission denied |
| members | view/manage members/templates/groups | `project:membership:update` | `/members/*`, `/invites`, `/join-requests/*`, `/groups*`, `/permission-templates*`, `/spending-limit-templates*` | page-level permission denied or mutating controls disabled |
| settings | view project settings shell | `project:governance:update` or `project:admins:update` or `project:lifecycle:update` | `GET /projects/{id}` | page-level permission denied |
| audit | view audit data | `project:audit:read` | `GET /audit` | component-level permission denied |
| usage | view own usage data (read-only) | `project:endpoint:use` | `GET /usage`, `GET /usage/facts` | component-level permission denied |
| use guide | view API access handbook | `project:endpoint:use` | N/A (static guidance page) | page-level permission denied |

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
8. Files mainline now runs on JuiceFS-backed project `file-libraries`.
   New Files frontend or backend work must target `file-libraries`, not the removed `source-libraries` public surface.

## Target Migration (Accepted)

- `project:governance:update`
  - endpoints governance writes
  - credentials
  - resource policy
- `project:files:update`
  - file and library mutations
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
