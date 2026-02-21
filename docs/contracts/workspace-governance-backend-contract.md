# Workspace Governance Backend Contract

Last updated: 2026-02-21
Status: contract defined; backend persistence required for release freeze
Owner: Frontend (contract); Backend (implementation)

## Purpose

Define the API contract for workspace governance group persistence (wheel/user).
Frontend already uses this contract; backend must persist and return `governance_group` so frontend can drop any local fallback.

## Scope

- **Governance group**: per-workspace-member classification `wheel` | `user`.
- **Semantics**: Management label only; runtime authorization is token-only (see `frontend-token-interaction-contract.md`).
- **Persistence**: Backend must persist `governance_group` and return it in workspace member responses.

## API Contract

### GET /api/v1/workspaces/:workspaceId/members

- **Response**: `{ items: WorkspaceMember[]; total: number }`
- **WorkspaceMember** must include:
  - `id`, `user_id`, `name`, `email`, `role`, `status`, `joined_at`
  - **`governance_group`**: `'wheel' | 'user'` (required for release; frontend may infer from permissions until backend returns it)
- Backend must persist and return each member’s `governance_group`. If not yet set, backend may derive (e.g. owner/admin → wheel) and persist on first read or PATCH.

### PATCH /api/v1/workspaces/:workspaceId/members/:memberId/governance

- **Request body**: `{ governance_group: 'wheel' | 'user' }`
- **Response**: Updated `WorkspaceMember` (with `governance_group` persisted).
- **Authorization**: Caller must have `workspace:governance:update` (or equivalent backend permission).
- **Errors**:
  - `404` — workspace or member not found
  - `400` — `governance_group` missing or not one of `wheel` | `user`
  - `403` — insufficient permission

## Frontend Usage

- **Client**: `src/lib/api/endpoints/workspaces.ts` — `listMembers()`, `updateMemberGovernanceGroup()`.
- **Hook**: `src/lib/hooks/use-workspace-governance.ts` — uses member `governance_group` when present; falls back to inferring from permissions until backend returns it.
- **UI**: Workspace Settings → Members → per-member dropdown (wheel / user).

## Backend Implementation Checklist

1. Add persistent storage for workspace member `governance_group` (e.g. workspace_members table column or equivalent).
2. Include `governance_group` in GET workspace members response; default or migrate existing rows (e.g. role-based default).
3. Implement PATCH .../members/:memberId/governance with validation and authorization.
4. Ensure 404/400/403 responses match above so frontend error handling remains valid.

## References

- `frontend-mvp-role-governance-requirements.md` — Remaining MVP Gaps (workspace governance persistence).
- `frontend-token-interaction-contract.md` — Token set; `workspace:governance:update`.
- `src/lib/api/types/index.ts` — `WorkspaceMember.governance_group`.
