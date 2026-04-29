# Product Terminology Contract

Last updated: 2026-04-29
Status: `authoritative`

This document defines the canonical product-facing names for current AgentSmith surfaces and objects.

Use this contract for:

1. page titles and subtitles
2. sidebar and governance navigation labels
3. user-guide wording
4. product-facing contract docs that describe pages, scopes, and page-level permission gates

Do not use this contract to rename machine-readable API fields, OpenAPI tags, or backend implementation concepts.

## 1. Canonical product-facing terms

### Entry and product surfaces

1. `System Admin`
- System-level administration surface.
- Scope: workspace lifecycle, workspace data config, workspace IdP config, workspace admin assignment.

2. `Workspace Entry`
- User-facing concept for entering a workspace before business login.
- Scope: public workspace picker and direct workspace URL entry.

3. `Overview`
- Project health, readiness, and recent-state summary page.
- Sidebar is the cross-product IA truth; Overview must not return to being a work-link or governance-link hub.
- It is not a second navigation hub and not a governance launcher.

4. `Chat`
- Conversation-based product surface for project-scoped AI use.

5. `Notebook`
- Task-based product surface for task execution and artifacts.
- Canonical route: `.../notebook`

6. `Files`
- Shared project library.
- Canonical route: `.../files`
- Scope: libraries, folders, upload/download, rename/move, delete, preview, share-link.

7. `Access guide`
- Read-only project access/setup guidance page.
- Route slug may remain `use-guide`, but product-facing naming is `Access guide`.

### Governance objects

8. `Endpoints`
- Execution capability configuration for a project.

9. `Policy`
- Project resource-policy surface.

10. `Shared context`
- Shared project context/governance object.
- This is a formal governance object and must not be treated as a hidden route.

11. `Project secrets`
- Project-scoped secret management surface.
- Product-facing replacement for `Credentials`.

12. `Members`
- Project membership governance surface.

13. `Audit`
- Project audit review surface.

14. `Alerts` / `Alert Center`
- Project-scoped operational signal surface for alert rules and notifications.
- Scope: cost, limit, policy, endpoint-health, and in-app notification signals.
- It is an operations support surface, not release orchestration, not a project governance launcher, and not required to appear as a primary sidebar item.

15. `Settings`
- Project identity / ownership / lifecycle / profile surface.
- Settings must not return to being a governance launcher.
- Not a governance launcher page.

### Workspace and personal connection objects

16. `Workspace integrations`
- Workspace-scoped shared integration/configuration surface.
- Product-facing replacement for workspace `Connections`.

17. `Personal connections`
- Personal third-party account connection surface.
- Product-facing replacement for `Third-party accounts` as the default UI name.

### Execution naming

18. `Execution target`
- The user-facing name for choosing where Chat execution goes.
- It may point to an `Endpoint` or an `Agent`.
- It must not be labeled as `model` in product-facing Chat selection UI.
- It must not be described as a second model catalog or a generic provider picker.

19. `Endpoint`
- Project execution capability configuration object.
- Do not describe `Endpoint` and `Agent` as interchangeable model sources.

20. `Agent`
- Project execution behavior / runner object.
- Do not describe `Endpoint` and `Agent` as interchangeable model sources.

Object-boundary rule:
- do not describe `Endpoint` and `Agent` as interchangeable model sources.

### Notebook execution terms

21. `Task inputs`
- Notebook inputs attached from the shared project library or explicit task input channels.

22. `Artifacts`
- Notebook-generated outputs produced by task execution.

23. `Terminal session`
- Notebook task-scoped terminal execution session.
- Scope: many `Terminal sessions` may exist under one task.
- They share the same task workspace and task-scoped home; they are not isolated sandboxes.
- Product-facing terminal UX must describe session lifecycle truth, not treat terminal as a generic floating panel.

## 2. Removed or restricted product-facing terms

The following terms are not allowed as primary product-facing names in current UI, user guides, or product contract docs:

1. `Credentials`
- Use `Project secrets` when referring to the project governance page/object.

2. `Connections`
- Use `Workspace integrations` for workspace-shared integrations.
- Use `Personal connections` for user-owned connections.

3. `Third-party accounts`
- Keep only as historical or implementation context when necessary; prefer `Personal connections`.

4. `Sources`
- Current product-facing file surface is `Files`.

5. `Context` as a standalone governance page name
- Use `Shared context` for the project governance object.

6. `Model` for Chat target selection
- Use `Execution target`.
- `model` may still appear as endpoint metadata or provider/model implementation detail, but not as the primary Chat target selector name.

## 3. Hidden-object rule

1. `Shared context` is a formal project governance object.
2. It must remain visible in the project govern information architecture.
3. It must remain a formal governance object and formal navigation item.
4. It must not regress into a hidden route reachable only from other pages.

## 4. Route and contract notes

1. Current route slug stability is allowed when it reduces migration noise.
- Example: route slug `use-guide` may remain while the user-facing label is `Access guide`.

2. Machine-readable specs may retain implementation-oriented names.
- OpenAPI tags, schema names, and backend field names may still contain terms such as `Credentials` or `Sources`.
- Those names do not redefine product-facing terminology by themselves.

3. Product-facing contract docs must use current names when listing pages or governance objects.
- Examples:
  - `Project secrets`, not `Credentials`
  - `Shared context`, not bare `Context`
  - `Access guide`, not `Use guide`, when describing the page in user-facing terms

## 5. Enforcement

Current enforcement must at least verify:

1. this contract stays present and current
2. page-level permission contracts use current product-facing names
3. `Shared context` remains a visible governance object in the route manifest
4. `contracts:check` fails if the current terminology contract drifts
