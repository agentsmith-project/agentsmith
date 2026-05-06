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
- Can govern project resources, project secrets, policy, and project-scope settings.
- Cannot delete the project.
- Cannot assign other project admins.
- Cannot transfer ownership.
- Does not gain workspace or system authority.

## Target Permission Refactor Status

The current implementation uses a split project-scope permission model for active route and mutation gates.

Current project-scope model:

1. `workspace:project:create`
- Can be held by workspace admins and by explicitly delegated project creators.

2. `project owner`
- Holds lifecycle authority.
- Holds admin-assignment authority.

3. `project admin`
- Holds governance authority but not ownership authority.

4. Active project-scope permissions
- `project:endpoint:use`
- `project:agent_task:use`
- `project:agent_task:terminal`
- `project:agent_runner:read`
- `project:agent_runner:manage`
- `project:audit:read`
- `project:governance:update`
- `project:files:update`
- `project:membership:update`
- `project:admins:update`
- `project:lifecycle:update`

Current split-token scope:
- `project:endpoint:use` covers Chat, Endpoint read/use, Files read/use, Usage, and Access guide access
- `project:agent_task:use` covers Agent task list/detail/create/run/update/archive/cancel, default managed runner binding at task creation, binding-options fetch, and Developer runner test task only when paired with runner-manage/action affordance
- `project:agent_task:terminal` covers Agent task terminal access and must be granted explicitly with task access; backend terminal create/open/reconnect/input/resize/close must require both `project:agent_task:use` and `project:agent_task:terminal`
- `project:agent_runner:read` covers Agent Runner route/list/status read and display-safe diagnostics only when backend `actions.view_diagnostics.allowed=true`
- `project:agent_runner:manage` covers Developer runner create/edit/disable/delete, Developer runner explicit task binding and later Developer-bound task execution/recovery/terminal use, Test connection, connection key/one-time-secret/mutating connection actions, and Developer runner test task only when paired with `project:agent_task:use`
- `project:audit:read` covers Audit and Alert Center read/action access in the current MVP alert surface
- `project:governance:update` covers project secrets, resource policy, endpoint governance, and similar governance surfaces
- `project:files:update` covers file-library create/update/delete/move/upload/share-link writes
- `project:membership:update` covers join requests, member lifecycle writes, templates, and groups
- `project:admins:update` covers assigning or revoking project admins
- `project:lifecycle:update` covers delete, owner transfer, and other lifecycle actions

Practical effect:

1. A delegated project creator creates a project and automatically becomes its owner.
2. Only the owner can:
- delete a project
- transfer ownership
- assign or revoke project admins
3. A non-owner project admin can:
- manage project governance surfaces
- but cannot manage lifecycle or delegate management

This section is authoritative for current permission boundaries and any remaining cleanup work.

Runner binding and Agent Runners operation rules:

| Operation | Required authority |
| --- | --- |
| Ordinary default managed task binding | `project:agent_task:use` |
| Binding options fetch | `project:agent_task:use` |
| Default managed binding option | `project:agent_task:use` |
| Explicit Developer runner bind action | Backend row-level `project:agent_task:use` + `project:agent_runner:manage` + policy/capability/readiness/freshness + binding action affordance |
| Run/retry/recovery of a managed-bound task | `project:agent_task:use`; backend resolves the task's immutable bound runner |
| Run/retry/recovery of a Developer-runner-bound task | `project:agent_task:use` + `project:agent_runner:manage` + backend bound-runner use affordance |
| Terminal creation/recovery for a Developer-runner-bound task | `project:agent_task:use` + `project:agent_task:terminal` + `project:agent_runner:manage` + backend bound-runner use affordance |
| Agent Runners route gate | `project:agent_runner:read` or `project:agent_runner:manage` |
| Display-safe diagnostics/view_diagnostics | `project:agent_runner:read` or `project:agent_runner:manage` + backend `actions.view_diagnostics.allowed` |
| Developer runner Test connection | `project:agent_runner:manage` + backend `actions.test_connection.allowed` |
| Developer runner test task | `project:agent_task:use` + `project:agent_runner:manage` + backend `actions.run_test_task.allowed` |

`CreateTask` must recompute binding authority, readiness, policy, capability, and freshness at submit time. Binding-options responses are UI affordance snapshots, not durable authorization artifacts. `StartTaskRun` must not accept runner selection fields. Action `required_permissions` values are per-row/per-operation diagnostic metadata and must not be treated as a frontend authorization source or as a fixed permission recipe for runner binding.

UI audiences such as Ordinary task user, Expert task creator, Runner maintainer, and Diagnostics viewer are backend-affordance-derived presentation contexts, not role names.

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

> Updated: 2026-04-29 (Navigation and operational signal boundary)

| Section | Description | Pages |
|---------|-------------|-------|
| `home` | Overview and landing | Overview |
| `use` | End-user daily AI tools | Chat, Agent tasks, Files, Usage, Access guide |
| `develop` | Developer task execution capability | Agent Runners |
| `govern` | Configuration and policy | Endpoints, Policy, Shared context, Project secrets, Members, Audit, Settings |
| `operate` | Execution-related backend operations | Internal execution/configuration routes plus supporting operational signals such as Alerts; user-facing evidence review still goes through Audit |

## Contract Guidance

- Use identical permission vocabulary in FE and BE.
- Do not introduce new permission points without updating this file and `src/lib/constants/permissions.ts`.
- This milestone does not introduce separate Developer runner ownership/test authority; any future split from `project:agent_runner:manage` requires an RFC and permission contract update.
- Developer runner test task creates standard task/run evidence, so it must keep the explicit `project:agent_task:use` requirement in addition to runner-manage/action affordance.
- Keep page/operation mapping in `frontend-backend-gating-matrix.md`.
- Keep status/error schema in the active contract set in `docs/contracts/`.
