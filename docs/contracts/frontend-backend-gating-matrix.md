# Frontend-Backend Gating Matrix (Page/Operation Level)

Last updated: 2026-02-08
Owner: Frontend
Audience: Backend auth team, QA, FE

> Target MVP direction is `resource policy` as defined in
> `docs/contracts/frontend-resource-policy-governance-v1.md`.

## Purpose

This matrix defines the permission contract from user-visible operations to backend API groups.
Backend should enforce 401/403 according to this matrix. Frontend already applies route/component gates for listed pages.

## Terminology

- `Auth token`: identity/claims carrier.
- `Permission point`: canonical permission string (for example `project:source:use`).
- `Frontend gate`: UX-side precheck (hide/disable/permission state).
- `Backend enforcement`: authoritative decision.

## Error Contract

- `401 unauthorized`: no valid auth context/token
- `403 forbidden`: authenticated but missing required permission
- `422 validation_error`: invalid route params or request body

## Matrix

| Page | User Operation | Required Permission(s) | Backend API Group | FE Expected on 403 |
|---|---|---|---|---|
| projects list | view projects | `workspace:read` | `/workspaces/{ws}/projects` | error state or empty permissions fallback |
| projects list | read workspace context | `workspace:read` | `GET /workspaces/{ws}`, `GET /workspaces/{ws}/members` | page context degraded/fallback |
| projects list | create project | `workspace:project:create` | `POST /workspaces/{ws}/projects` | disable create button + toast/error |
| projects list | delete project | `project:settings:manage` | `DELETE /workspaces/{ws}/projects/{project}` | destructive dialog fails gracefully |
| chat | access chat page and all chat operations | `project:chat:access` | `/chat/sessions`, `/messages`, `/attachments` | page-level permission denied |
| ai-studio list/detail | access studio page and task operations | `project:studio:access` | `GET/POST/PATCH/DELETE /recipes*`, `GET /recipes/{id}/events` | page-level permission denied |
| sources | view/use sources and libraries | `project:source:use` | `GET /sources*`, `GET /source-libraries*` | page-level permission denied |
| sources | switch source library context | `project:source:use` | `GET /source-libraries*`, `GET /source-libraries/{libraryId}/files*`, `GET /source-libraries/{libraryId}/ai-ready-jobs*` | keep page visible, block unavailable context with deterministic error |
| sources | create/update/delete source or library | `project:source:manage` | `POST/PATCH/DELETE /sources*`, `POST/PATCH/DELETE /source-libraries*` | mutating controls disabled |
| sources | file CRUD in selected library | `project:source:manage` | `POST/PATCH/DELETE /source-libraries/{libraryId}/files*` | mutating controls disabled |
| sources | start/cancel AIReady job | `project:source:manage` | `POST /source-libraries/{libraryId}/ai-ready-jobs`, `POST /source-libraries/{libraryId}/ai-ready-jobs/{jobId}:cancel` | mutating controls disabled; keep job status visible |
| agents | view/use agents | `project:agent:use` | `GET /agents*`, `GET /agents/{id}/runtime-config` | page-level permission denied |
| agents | create/update/delete agent and keys | `project:agent:manage` | `POST/PATCH/DELETE /agents*`, `POST/DELETE /agents/{id}/keys*` | mutating controls disabled |
| endpoints | view/use endpoints | `project:endpoint:use` | `GET /endpoints*` | page-level permission denied |
| endpoints | create/update/delete endpoint | `project:endpoint:manage` | `POST/PUT/DELETE /endpoints*` | mutating controls disabled |
| resource policy | view/update resource policy | `project:resource_policy:manage` | `GET/PATCH /resources/{type}/{id}/policy` | mutating controls disabled |
| credentials | view/manage credentials | `project:credential:manage` | `GET/POST/DELETE /credentials*` | page-level permission denied |
| members | view members | `project:member:view` | `GET /members*`, `GET /groups`, `GET /permission-templates`, `GET /quota-templates*` | page-level permission denied |
| members | manage members/templates/groups | `project:member:manage` | `/members/*`, `/invites`, `/join-requests/*`, `/groups*`, `/permission-templates*`, `/quota-templates*` | mutating controls disabled |
| settings | view/update project settings | `project:settings:manage` | `GET/PATCH /projects/{id}` | page-level permission denied or save disabled |
| settings | delete project from settings | `project:settings:manage` | `DELETE /projects/{id}` | delete denied |
| audit | view audit data | `project:audit:view` | `GET /audit` | component-level permission denied |
| usage | view usage data | `project:usage:view` | `GET /usage`, `GET /usage/kpi` | component-level permission denied |

## Notes for Backend Team

1. Endpoint gate token family is `project:endpoint:{use|manage}`; source gate token family is `project:source:{use|manage}`.
2. For settings delete, FE and backend should both enforce `project:settings:manage`.
3. FE treats 403 as a non-retryable authorization error. Return deterministic error code/message for consistent UX.
4. For batch template apply, backend should return per-member `results[]` to support failed-member detail and `Retry Failed` UX.
5. Workspace-scoped project list route has no `[project]` param. FE must use workspace membership-derived permissions and must not use authenticated fallback for access decisions.
6. MVP target model: default allow for all project members + project-default limits + resource/subject overrides.
7. Governance write actions are token-only in FE; role/group names are just template labels and must not be used as runtime gate conditions.
8. Source library requests and AIReady tasks must remain in the selected `source_library_id` context and must not mix tuple namespaces across libraries.
