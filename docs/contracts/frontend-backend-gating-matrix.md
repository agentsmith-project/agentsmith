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
- `Permission point`: canonical permission string (for example `project:source:read`).
- `Frontend gate`: UX-side precheck (hide/disable/permission state).
- `Backend enforcement`: authoritative decision.

## Error Contract

- `401 unauthorized`: no valid auth context/token
- `403 forbidden`: authenticated but missing required permission
- `422 validation_error`: invalid route params or request body

## Matrix

| Page | User Operation | Required Permission(s) | Backend API Group | FE Expected on 403 |
|---|---|---|---|---|
| projects list | view projects | `workspace:read` + `project:read` | `/workspaces/{ws}/projects` | error state or empty permissions fallback |
| projects list | read workspace context | `workspace:read` | `GET /workspaces/{ws}`, `GET /workspaces/{ws}/members` | page context degraded/fallback |
| projects list | create project | `workspace:project:create` | `POST /workspaces/{ws}/projects` | disable create button + toast/error |
| projects list | delete project | `project:delete` | `DELETE /workspaces/{ws}/projects/{project}` | destructive dialog fails gracefully |
| chat | view sessions/messages | `agent_thread:read` or `agent_thread:create` | `/chat/sessions`, `/messages` | page-level permission denied |
| chat | create/update/delete thread | `agent_thread:create` | `POST/PATCH/DELETE /chat/sessions/*` | controls disabled/no-op + permission UI |
| chat | send/edit/regenerate message | `agent_thread:create` | `POST/PATCH /chat/sessions/*/messages*` | composer/actions disabled |
| workbench list/detail | view recipes | any of `project:recipe:read/create/update/delete` | `GET /recipes*` | page-level permission denied |
| workbench | create recipe | `project:recipe:create` | `POST /recipes` | create blocked |
| workbench | edit recipe | `project:recipe:update` | `PATCH /recipes/{id}` | edit blocked |
| workbench | delete recipe | `project:recipe:delete` | `DELETE /recipes/{id}` | delete blocked |
| workbench detail | subscribe recipe live events | `project:recipe:read` (recommended minimum) | `GET /recipes/{id}/events` | stream unavailable + recoverable error |
| sources | view sources | `project:source:read` | `GET /sources*` | page-level permission denied |
| sources | view source libraries | `project:source:read` | `GET /source-libraries` | library selector hidden/empty |
| sources | create/update/delete source library | one of `project:resource:create`, `project:resource:update`, `project:resource:delete` | `POST/PATCH/DELETE /source-libraries*` | library management actions disabled |
| sources | upload source | `project:source:upload` | `POST /sources/upload` | upload action blocked |
| sources | delete source | `project:source:delete` | `DELETE /sources/{id}` | delete blocked |
| sources | download source | `project:source:download` | `GET /sources/{id}/download` | download blocked |
| sources | AIReady start/cancel/retry | `project:source:upload` or `project:source:delete` (backend-defined stricter mapping allowed) | `/sources/*/ai-ready/*`, `/sources/batch/ai-ready/*` | batch/single action blocked |
| agents | view agents/diagnostics | `agent:read` or `agent:manage` | `GET /agents*`, `/diagnostics` | page-level permission denied |
| agents | view runtime config | `agent:read` or `agent:manage` | `GET /agents/{id}/runtime-config` | runtime-config panel blocked |
| agents | create/update/enable/disable/delete agent | `agent:manage` | `POST/PATCH/DELETE /agents*` | action controls disabled |
| agents | issue/revoke agent key | `agent:key:issue` / `agent:key:revoke` | `POST/DELETE /agents/{id}/keys*` | key actions hidden/disabled |
| endpoints | view endpoints | one of `project:resource:read`, `project:resource:update` | `GET /endpoints*` | page-level permission denied |
| endpoints | create/update/delete endpoint | one of `project:resource:create`, `project:resource:update`, `project:resource:delete` | `POST/PUT/DELETE /endpoints*` | action controls disabled |
| resource policy | view/update resource policy | `project:resource:update` (recommended baseline) | `GET/PATCH /resources/{type}/{id}/policy` | mutating controls disabled |
| credentials | view credentials | `wheel` governance + one of `project:resource:read`, `project:resource:update`, `project:resource:delete` | `GET /credentials` | page-level permission denied |
| credentials | create/rotate/delete | one of `project:resource:create`, `project:resource:update`, `project:resource:delete` | `POST /credentials*`, `DELETE /credentials/{id}` | action controls disabled |
| members | view members | `project:member:read` or `project:admin:grant` or `project:admin:revoke` | `GET /members*` | page-level permission denied |
| members | grant/revoke project admin | `project:admin:grant` / `project:admin:revoke` | `PATCH /members/*/permissions` | mutating controls disabled |
| members | invite/remove/update perms/quota | `project:admin:grant` or `project:admin:revoke` (MVP frontend gate) | `/members/*`, `/invites`, `/join-requests/*` | mutating controls disabled |
| members | view member governance history/context | `project:member:read` or `project:admin:grant` or `project:admin:revoke` | `/members/{id}/change-history`, `/memberships/{userId}` | detail drawer blocked/read fallback |
| members | manage resource policy (target) | `project:resource:update` | `/resources/{resourceType}/{resourceId}/policy` | policy editor disabled |
| project-groups | view groups | `project:member:read` | `GET /groups` | group section hidden/read-only |
| project-groups | create/update/delete group | `project:admin:grant` or `project:admin:revoke` | `POST/PATCH/DELETE /groups*` | mutating controls disabled |
| project-groups | apply group template to members | `project:admin:grant` or `project:admin:revoke` | `POST /groups/{id}/apply-template` | apply action disabled |
| permission-template | list templates | `project:member:read` | `GET /permission-templates` | tab visible read-only or blocked |
| permission-template | create/update/delete/apply | `project:admin:grant` or `project:admin:revoke` | `/permission-templates*`, `PATCH /members/*/permissions` | actions disabled |
| quota-template | list templates | `project:member:read` | `GET /quota-templates*` | tab visible read-only or blocked |
| quota-template | create/update/delete/apply | `project:admin:grant` or `project:admin:revoke` | `/quota-templates*`, `/quota-templates/{id}/apply` | actions disabled |
| settings | view settings | `project:policy:read` or `project:policy:update` | `GET /projects/{id}` | page-level permission denied |
| settings | update settings/governance/limits | `project:policy:update` | `PATCH /projects/{id}` | save buttons disabled |
| settings | delete project from settings | `project:delete` (recommended backend strict) | `DELETE /projects/{id}` | delete denied |
| audit | view audit data | `project:audit:read` | `GET /audit` | component-level permission denied |
| usage | view usage data | `project:usage:read` | `GET /usage`, `GET /usage/kpi` | component-level permission denied |
| userdata | view user data summary/end-users | one of `userdata:storage:read`, `userdata:docdb:read`, `userdata:vectordb:search` | `/userdata/*` | page-level permission denied |

## Notes for Backend Team

1. `endpoint` domain permission gate is unified to `project:resource:*`; do not introduce `endpoint:*` platform gate tokens.
2. For settings delete, FE and backend should both enforce `project:delete`.
3. FE treats 403 as a non-retryable authorization error. Return deterministic error code/message for consistent UX.
4. For batch template apply, backend should return per-member `results[]` to support failed-member detail and `Retry Failed` UX.
5. Workspace-scoped project list route has no `[project]` param. FE must use workspace membership-derived permissions and must not use authenticated fallback for access decisions.
6. MVP target model: default allow for all project members + project-default limits + resource/subject overrides.
