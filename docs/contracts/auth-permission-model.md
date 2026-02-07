# Auth Token vs Permission Gate Model

## Purpose

Clarify the boundary between authentication data and authorization enforcement to avoid backend/frontend contract misunderstandings.

## Model

1. `Auth token`
- Carries caller identity and claims.
- Typical fields: subject/user id, expiration, optional permission claims.

2. `Permission point`
- Canonical action identifier (for example `project:admin:grant`).
- Source of truth: `src/lib/constants/permissions.ts`.
- Access-only examples in MVP: `project:chat:access`, `project:studio:access`.

3. `Frontend gate`
- Uses permission points to drive UX states (show/hide/disable/error state).
- Optimization for usability; not security authority.

4. `Backend enforcement`
- Must independently validate token + permission policy.
- Must return deterministic `401/403` and stable error code schema.

## Decision Rule

- If frontend gate says "allow" but backend says "deny", backend result is authoritative.
- Frontend must treat `403` as final and non-retryable for same request payload.

## Contract Guidance

- Use identical permission vocabulary in FE and BE.
- Keep endpoint-level required permissions in `frontend-token-interaction-contract.md`.
- Keep page/operation mapping in `frontend-backend-gating-matrix.md`.
- Keep status/error schema in the active contract set in `docs/contracts/`.
