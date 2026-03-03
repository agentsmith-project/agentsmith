# Frontend-Backend Gating Matrix (Page/Operation Level)

Last updated: 2026-03-02 (Navigation Restructure)
Owner: Frontend
Audience: Backend auth team, QA, FE

> Target MVP direction is `resource policy` as defined in
> `docs/contracts/frontend-resource-policy-governance-v1.md`.

> **Navigation Restructure (WP-01/WP-02)**: Section structure updated from Home+Build+Govern+Operate to Home+Use+Develop+Govern+Operate.

## Purpose

This matrix defines the permission contract from user-visible operations to backend API groups.
Backend should enforce 401/403 according to this matrix. Frontend already applies route/component gates for listed pages.

## Terminology

- `Auth token`: identity/claims carrier.
- `Permission point`: canonical permission string (for example `project:endpoint:use`).
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
| chat | access chat page and all chat operations | `project:endpoint:use` | `/chat/sessions`, `/messages`, `/attachments` | page-level permission denied |
| chat | stream chat via external agent (thread-level binding) | `project:endpoint:use` + `project:agent:use` | `POST /chat/sessions/{id}/messages/stream` (when `external_agent_id` is set in session) | fail-fast stream error with explicit message |
| notebook list/detail | access notebook page and task operations | `project:endpoint:use` | `GET/POST/PATCH/DELETE /tasks*`, `GET /tasks/{id}/events` | page-level permission denied |
| files | view/use files and libraries | `project:endpoint:use` | `GET /sources*`, `GET /source-libraries*` | page-level permission denied |
| files | switch file library context | `project:endpoint:use` | `GET /source-libraries*`, `GET /source-libraries/{libraryId}/files*`, `GET /source-libraries/{libraryId}/ai-ready-jobs*` | keep page visible, block unavailable context with deterministic error |
| files | create/update/delete file or library | `project:settings:manage` | `POST/PATCH/DELETE /sources*`, `POST/PATCH/DELETE /source-libraries*` | mutating controls disabled |
| files | file CRUD in selected library | `project:settings:manage` | `POST/PATCH/DELETE /source-libraries/{libraryId}/files*` | mutating controls disabled |
| files | start/cancel AIReady job | `project:settings:manage` | `POST /source-libraries/{libraryId}/ai-ready-jobs`, `POST /source-libraries/{libraryId}/ai-ready-jobs/{jobId}:cancel` | mutating controls disabled; keep job status visible |
| agents | view/use agents | `project:agent:use` | `GET /agents*`, `GET /agents/{id}/runtime-config`, `GET /agents/{id}/connection-info` | page-level permission denied |
| agents | create/update/delete agent and keys | `project:agent:manage` | `POST/PATCH/DELETE /agents*`, `POST/DELETE /agents/{id}/keys*` | mutating controls disabled |
| agents runtime | agent websocket connect (external process) | agent service key (`Authorization: Bearer ask_*`) | `GET /api/v1/agent-runtime/ws?agent_id=*` | connection rejected with 401/403 |
| endpoints | view/use endpoints | `project:endpoint:use` | `GET /endpoints*` | page-level permission denied |
| endpoints | create/update/delete endpoint | `project:endpoint:manage` | `POST/PUT/DELETE /endpoints*` | mutating controls disabled |
| resource policy | view/update endpoint resource policy | `project:settings:manage` | `GET/PATCH /resources/endpoint/{id}/policy` | mutating controls disabled |
| credentials | view/manage credentials | `project:settings:manage` | `GET/POST/DELETE /credentials*` | page-level permission denied |
| members | view members | `project:settings:manage` | `GET /members*`, `GET /groups`, `GET /permission-templates`, `GET /quota-templates*` | page-level permission denied |
| members | manage members/templates/groups | `project:settings:manage` | `/members/*`, `/invites`, `/join-requests/*`, `/groups*`, `/permission-templates*`, `/quota-templates*` | mutating controls disabled |
| settings | view/update project settings | `project:settings:manage` | `GET/PATCH /projects/{id}` | page-level permission denied or save disabled |
| settings | delete project from settings | `project:settings:manage` | `DELETE /projects/{id}` | delete denied |
| audit | view audit data | `project:endpoint:use` | `GET /audit` | component-level permission denied |
| usage | view usage data | `project:endpoint:use` | `GET /usage`, `GET /usage/kpi` | component-level permission denied |

## Runtime Console (Navigation Restructure - Merged Page)

> New unified console combining runtime-control-plane, runtime-observability, release-ops, and alerts.

| Tab | User Operation | Required Permission(s) | Backend API Group | FE Expected on 403 |
|-----|----------------|------------------------|-------------------|-------------------|
| overview | view runtime health and control plane | `project:settings:manage` | `GET /projects/{id}`, `GET /runtime/*` | tab-level permission denied, show access message |
| monitoring | view runtime metrics and traces | `project:endpoint:use` | `GET /runtime/metrics`, `GET /runtime/traces` | tab-level permission denied, show access message |
| alerts | view and manage alert rules | `project:endpoint:use` | `GET /alert-rules`, `GET /alert-notifications` | tab-level permission denied, show access message |
| control | view release gates and control | `project:endpoint:use` | `GET /release-ops/*`, `GET /governance/*` | tab-level permission denied, show access message |
| reports | view release reports and history | `project:endpoint:use` | `GET /release-reports` | tab-level permission denied, show access message |

## Section Migration Table (Navigation Restructure)

| Page | Old Section | New Section | Permission |
|------|-------------|-------------|------------------------|
| Chat | Build | Use | `project:endpoint:use` |
| Notebook | Build | Use | `project:endpoint:use` |
| Files | Build | Use | `project:endpoint:use` |
| Agents | Build | Develop | `project:agent:use`, `project:agent:manage` |
| Endpoints | Build | Govern | `project:endpoint:use`, `project:endpoint:manage` |
| Settings | Operate | Govern | `project:settings:manage` |
| Runtime Console (merged) | Operate (4 pages) | Operate | `project:settings:manage`, `project:endpoint:use` |

## Route Redirect Mapping (Documentation Reference)

| Old Route | New Route | Default Tab |
|-----------|-----------|-------------|
| `/runtime-control-plane` | `/runtime-console` | `overview` |
| `/runtime-observability` | `/runtime-console?tab=monitoring` | `monitoring` |
| `/release-ops` | `/runtime-console?tab=control` | `control` |
| `/alerts` | `/runtime-console?tab=alerts` | `alerts` |

## Notes for Backend Team

1. MVP project permission set is fixed to:
   - `project:endpoint:use`
   - `project:endpoint:manage`
   - `project:agent:use`
   - `project:agent:manage`
   - `project:settings:manage`
2. For settings delete, FE and backend should both enforce `project:settings:manage`.
3. FE treats 403 as a non-retryable authorization error. Return deterministic error code/message for consistent UX.
4. For batch template apply, backend should return per-member `results[]` to support failed-member detail and `Retry Failed` UX.
5. Workspace-scoped project list route has no `[project]` param. FE must use workspace membership-derived permissions and must not use authenticated fallback for access decisions.
6. MVP target model: default allow for all project members + project-default limits + resource/subject overrides.
7. Governance write actions are token-only in FE; role/group names are just template labels and must not be used as runtime gate conditions.
8. Do not introduce additional project permission points without updating this matrix and `src/lib/constants/permissions.ts`.
