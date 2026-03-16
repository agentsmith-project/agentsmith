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
- Current project-level permissions in MVP are:
  - `project:endpoint:use`
  - `project:agent:manage`
  - `project:agent:public`
  - `project:audit:read`
  - `project:governance:update`
  - `project:membership:update`
  - `project:admins:update`
  - `project:lifecycle:update`
  - `project:manage`

3. `Frontend permission gate`
- Uses permission points to drive UX states (show/hide/disable/error state).
- Optimization for usability; not security authority.

4. `Backend enforcement`
- Must independently validate token + permission policy.
- Must return deterministic `401/403` and stable error code schema.

## Authorization Truth

1. Permission is the only runtime authorization truth.
- Route guards, page guards, mutation guards, and backend enforcement must ultimately resolve to permission checks in scope.
- The permission token set remains the final authority for allow/deny decisions.

2. Role names are not first-class authorization primitives.
- `WorkspaceAdmin`, `ProjectCreator`, `ProjectOwner`, and `ProjectAdmin` are product/model labels.
- They exist to describe:
  - default permission bundles
  - resource relationships
  - management UI concepts
- They must not become an alternate runtime authorization system beside permission checks.

3. Resource relationship is allowed as a permission source, not as permission truth.
- Example: `owner_id` may be used to sync the built-in owner group.
- Example: built-in member groups such as `grp_project_admins` may contribute governance permissions through their bound templates.
- But allow/deny still resolves through permissions, not through scattered role-name branching or legacy admin lists.

## Authn / Authz Boundary

1. Authn is provided by IdP.
- System super admin uses a system-level login entry.
- System super admin credentials are injected at system startup; default credentials are `mbos-admin / mbos-admin`.
- All non-system users must first enter a workspace context, then authenticate with that workspace's IdP.

2. Authz is provided by AgentSmith.
- AgentSmith decides:
  - system super admin privileges
  - workspace admin privileges
  - workspace project-creation privileges
  - project owner privileges
  - project admin privileges
  - permission token checks
- These privileges should be implemented as permission mappings, not as a second role-only gate system.

3. Workspace membership source is external.
- Users are sourced from the workspace-bound IdP.
- AgentSmith does not manage workspace member lifecycle as a separate identity system.

## System vs Workspace Roles

1. `System super admin`
- Only role allowed to manage workspace lifecycle.
- Can create/configure/disable/delete workspace.
- Can configure workspace data config and workspace IdP config.

2. `Workspace admin`
- Is a workspace-scoped governance label that maps to workspace permissions.
- Can create projects in that workspace.
- Can grant or revoke workspace-scoped project creation ability.
- Can force-transfer project ownership inside that workspace.
- Cannot manage workspace lifecycle.
- Cannot manage workspace IdP or tenant-isolation configuration.

3. `Project creator`
- Is a delegated project-creation label, not a separate authorization system.
- Is granted workspace-scoped project creation ability by a workspace admin.
- Automatically becomes `project owner` for projects they create.
- Does not become workspace admin.

4. `Project owner`
- Is a project relationship label that maps to owner-only project permissions.
- Owns project lifecycle and final project authority.
- Can transfer ownership.
- Can assign or revoke `project admin`.
- Can manage project lifecycle actions such as delete.

5. `Project admin`
- Is a project governance label that maps to project governance permissions.
- Is assigned by the `project owner`.
- Can read project audit via `project:audit:read`.
- Can govern project resources, credentials, policy, and project-scope settings.
- Cannot delete the project.
- Cannot assign other project admins.
- Cannot transfer ownership.
- Does not gain workspace or system authority.

## Target Permission Refactor (Accepted, Implementation Pending)

The current implementation is moving from a simplified `project:manage` model toward a split project-scope permission model.

The accepted target model is:

1. `workspace:project:create`
- Can be held by workspace admins and by explicitly delegated project creators.

2. `project owner`
- Holds lifecycle authority.
- Holds admin-assignment authority.

3. `project admin`
- Holds governance authority but not ownership authority.

4. Accepted target project-scope permissions
- `project:governance:update`
- `project:membership:update`
- `project:admins:update`
- `project:lifecycle:update`

Current migration intent:
- `project:governance:update` covers credentials, resource policy, and similar governance surfaces
- `project:membership:update` covers join requests, member lifecycle writes, templates, and groups
- `project:admins:update` covers assigning or revoking project admins
- `project:lifecycle:update` covers delete, owner transfer, and other lifecycle actions
- `project:manage` remains a temporary umbrella gate while page and route checks are migrated to the split model

Practical effect:

1. A delegated project creator creates a project and automatically becomes its owner.
2. Only the owner can:
- delete a project
- transfer ownership
- assign or revoke project admins
3. A non-owner project admin can:
- manage project governance surfaces
- but cannot manage lifecycle or delegate management

This section is authoritative for upcoming refactor work even where current code still temporarily treats `project admin` and `owner` as equivalent or still relies on role labels too directly.

## Capability Boundary (Accepted Target)

| Capability | System super admin | Workspace admin | Project creator | Project owner | Project admin |
|------------|--------------------|-----------------|-----------------|---------------|---------------|
| Create workspace | yes | no | no | no | no |
| Configure workspace IdP/data | yes | no | no | no | no |
| Grant workspace project creation | no | yes | no | no | no |
| Create project | no | yes | yes | no | no |
| Become owner on project create | no | no | yes | n/a | no |
| Delete project | no | no | no | yes | no |
| Transfer project owner | no | force only | no | yes | no |
| Assign/revoke project admins | no | no | no | yes | no |
| Read project audit | no | no | no | yes | yes |
| Govern project resources/policy/settings | no | no | no | yes | yes |

## Decision Rule

- If frontend permission gate says "allow" but backend says "deny", backend result is authoritative.
- Frontend must treat `403` as final and non-retryable for same request payload.
- When role or relationship data exists, it must first be normalized into permission-bearing decisions before UI and backend mutation flow rely on it.

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
