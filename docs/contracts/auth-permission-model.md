# Auth Token vs Permission Gate Model

## Purpose

Clarify the boundary between authentication data and authorization enforcement to avoid backend/frontend contract misunderstandings.

## Model

1. `Auth token`
- Carries caller identity and claims.
- Typical fields: subject/user id, expiration, optional permission claims.

2. `Permission point`
- Canonical action identifier.
- Source of truth: `src/lib/constants/permissions.ts`.
- Project-level permissions in MVP are intentionally reduced to four:
  - `project:endpoint:use`
  - `project:manage`
  - `project:agent:manage`
  - `project:agent:public`

Legacy aliases accepted by frontend gate compatibility layer:
- `project:endpoint:invoke` -> `project:endpoint:use`
- `project:agent:create` -> `project:agent:manage`
- `project:agent:publish` -> `project:agent:public`

3. `Frontend gate`
- Uses permission points to drive UX states (show/hide/disable/error state).
- Optimization for usability; not security authority.

4. `Backend enforcement`
- Must independently validate token + permission policy.
- Must return deterministic `401/403` and stable error code schema.

## Decision Rule

- If frontend gate says "allow" but backend says "deny", backend result is authoritative.
- Frontend must treat `403` as final and non-retryable for same request payload.

## Frontend Navigation Sections

> Updated: 2026-03-02 (Navigation Restructure WP-01/WP-02)

| Section | Description | Pages |
|---------|-------------|-------|
| `home` | Overview and landing | Overview |
| `use` | End-user daily AI tools | Chat, Notebook, Files |
| `develop` | Developer agent building | Agents |
| `govern` | Configuration and policy | Endpoints, Resource Policy, Credentials, Members, Usage, Audit, Settings |
| `operate` | Runtime operations | Runtime Console |

## Contract Guidance

- Use identical permission vocabulary in FE and BE.
- Do not introduce new permission points without updating this file and `src/lib/constants/permissions.ts`.
- Keep page/operation mapping in `frontend-backend-gating-matrix.md`.
- Keep status/error schema in the active contract set in `docs/contracts/`.
