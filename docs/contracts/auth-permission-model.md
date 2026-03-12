# Auth Token vs Permission Gate Model

## Purpose

Clarify the boundary between authentication data and authorization enforcement to avoid backend/frontend contract misunderstandings.

## Model

1. `Auth token`
- Carries caller identity and claims.
- Typical fields: subject/user id, expiration, optional permission claims.
- In current MVP, Authn comes from the workspace-bound IdP.
- Current supported workspace IdP: `Keycloak`.

2. `Permission point`
- Canonical action identifier.
- Source of truth: `src/lib/constants/permissions.ts`.
- Project-level permissions in MVP are intentionally reduced to four:
  - `project:endpoint:use`
  - `project:manage`
  - `project:agent:manage`
  - `project:agent:public`

3. `Frontend permission gate`
- Uses permission points to drive UX states (show/hide/disable/error state).
- Optimization for usability; not security authority.

4. `Backend enforcement`
- Must independently validate token + permission policy.
- Must return deterministic `401/403` and stable error code schema.

## Authn / Authz Boundary

1. Authn is provided by IdP.
- System super admin uses a system-level login entry.
- System super admin credentials are injected at system startup; default credentials are `mbos-admin / mbos-admin`.
- All non-system users must first enter a workspace context, then authenticate with that workspace's IdP.

2. Authz is provided by AgentSmith.
- AgentSmith decides:
  - system super admin privileges
  - workspace admin privileges
  - project admin privileges
  - permission token checks

3. Workspace membership source is external.
- Users are sourced from the workspace-bound IdP.
- AgentSmith does not manage workspace member lifecycle as a separate identity system.

## System vs Workspace Roles

1. `System super admin`
- Only role allowed to manage workspace lifecycle.
- Can create/configure/disable/delete workspace.
- Can configure workspace data config and workspace IdP config.

2. `Workspace admin`
- Can create projects in that workspace.
- Can assign project admins.
- Cannot manage workspace lifecycle.
- Cannot manage workspace IdP or tenant-isolation configuration.

## Decision Rule

- If frontend permission gate says "allow" but backend says "deny", backend result is authoritative.
- Frontend must treat `403` as final and non-retryable for same request payload.

## Frontend Navigation Sections

> Updated: 2026-03-02 (Navigation Restructure WP-01/WP-02)

| Section | Description | Pages |
|---------|-------------|-------|
| `home` | Overview and landing | Overview |
| `use` | End-user daily AI tools | Chat, Notebook, Files |
| `develop` | Developer agent building | Agents |
| `govern` | Configuration and policy | Endpoints, Resource Policy, Credentials, Members, Usage, Audit, Settings |
| `operate` | Execution-related backend operations | Internal execution/configuration routes only; user-facing review goes through Audit |

## Contract Guidance

- Use identical permission vocabulary in FE and BE.
- Do not introduce new permission points without updating this file and `src/lib/constants/permissions.ts`.
- Keep page/operation mapping in `frontend-backend-gating-matrix.md`.
- Keep status/error schema in the active contract set in `docs/contracts/`.
