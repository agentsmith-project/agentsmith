# Product Terminology Contract

Last updated: 2026-05-05
Status: `authoritative`

This document defines the canonical product-facing names for current AgentSmith surfaces and objects.

Use this contract for:

1. page titles and subtitles
2. sidebar and governance navigation labels
3. user-guide wording
4. product-facing contract docs that describe pages, scopes, and page-level permission gates

Do not use this contract to rename machine-readable API fields, OpenAPI tags, backend storage collection names, or implementation-only filenames.

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
- Conversation-based product surface for project-scoped LLM/model use.
- Chat does not display, filter, select, or dispatch Agent Runners.

5. `Model`
- Chat selector name.
- The selected Model is backed by Endpoint truth.
- Product-facing Chat UI must use `Model`, not `Execution target`, for the primary selector.
- It is not a generic provider picker and it does not make Agent Runners selectable from Chat.

6. `Agent tasks`
- User-facing intelligent task execution surface.
- Canonical route: `.../agent-tasks`
- Scope: task workspace, inputs, activity, final answer, terminal sessions, and artifacts.

7. `Files`
- Shared project library.
- Canonical route: `.../files`
- Scope: libraries, folders, upload/download, rename/move, delete, preview, share-link.

8. `Usage`
- Read-only usage and cost evidence surface for the current project.

9. `Access guide`
- Read-only project access/setup guidance page.
- Route slug may remain `use-guide`, but product-facing naming is `Access guide`.

### Develop and governance objects

10. `Agent Runners`
- Developer/governance surface for task execution capability.
- Canonical route: `.../agent-runners`
- It configures task execution capability and is not a user execution entrypoint.
- It must not expose Chat/Notebook type selectors, external/internal choices, docker/compose/k8s runtime choices, or a product runner picker.

11. `Agent Runner`
- Project-scoped managed task runner configuration object.
- Agent task dispatch is backend-owned and resolves the eligible default Agent Runner.
- Ordinary task users should not have to think about this object when creating or running work.

12. `Managed runner`
- Platform-managed execution environment for Agent tasks.
- This term may appear in engineering/deployment documentation, but it is not a primary user-facing product choice.

13. `Developer mode`
- Local runner debugging entrypoint.
- It is not a formal deployment runtime, not a product configuration mode, and not a replacement for managed runner execution.

14. `Endpoints`
- Governed model capability configuration for a project.
- Scope: provider/model/policy/secret binding.

15. `Policy`
- Project resource-policy surface.

16. `Shared context`
- Shared project context/governance object.
- This is a formal governance object and must not be treated as a hidden route.

17. `Project secrets`
- Project-scoped secret management surface.
- Product-facing replacement for `Credentials`.

18. `Members`
- Project membership governance surface.

19. `Audit`
- Project audit review surface.

20. `Alerts` / `Alert Center`
- Project-scoped operational signal surface for alert rules and notifications.
- Scope: cost, limit, policy, endpoint-health, and in-app notification signals.
- It is an operations support surface, not release orchestration, not a project governance launcher, and not required to appear as a primary sidebar item.

21. `Settings`
- Project identity / ownership / lifecycle / profile surface.
- Settings must not return to being a governance launcher.
- Not a governance launcher page.

### Workspace and personal connection objects

22. `Workspace integrations`
- Workspace-scoped shared integration/configuration surface.
- Product-facing replacement for workspace `Connections`.

23. `Personal connections`
- Personal third-party account connection surface.
- Product-facing replacement for `Third-party accounts` as the default UI name.

### Agent task execution terms

24. `Task inputs`
- Agent task inputs attached from the shared project library or explicit task input channels.

25. `Activity`
- User-facing task/run progress and execution-detail timeline.
- Use `Activity` or `Execution details` in the Agent task UI; reserve `trace` for engineering/audit internals.

26. `Artifacts`
- Agent task outputs produced by task execution.
- Artifacts are collected from `.artifacts`.

27. `Terminal session`
- Agent task-scoped terminal execution session.
- Scope: many `Terminal sessions` may exist under one task.
- They share the same task workspace and task-scoped home; they are not isolated sandboxes.
- Product-facing terminal UX must describe session lifecycle truth, not treat terminal as a generic floating panel.

## 2. Removed or restricted product-facing terms

The following terms are not allowed as primary product-facing names in current UI, user guides, or product contract docs:

1. `Notebook`
- Use `Agent tasks` for the active product surface.
- The old term may appear only in this removed-terms section, breaking allowlists, or negative contract tests that explicitly prove removal/rejection.
- It must not be described as a supported route, alias, runtime view, bridge, fallback, double-read path, or compatibility layer.

2. `Agents`
- Use `Agent Runners` for the active developer/governance surface.
- Do not use `Agents` as a visible navigation item, page title, or product entrypoint.

3. `Execution target` for Chat selection
- Use `Model` in Chat.
- The old selector label may appear only in removed-term or negative-test evidence. It is not an engineering synonym for current Chat behavior.

4. `External runner`
- Use `Developer mode` for local runner debugging.
- Formal deployment uses managed runner execution only.

5. `Credentials`
- Use `Project secrets` when referring to the project governance page/object.

6. `Connections`
- Use `Workspace integrations` for workspace-shared integrations.
- Use `Personal connections` for user-owned connections.

7. `Third-party accounts`
- Use `Personal connections` for the active UI name. The old label is removed from current product-facing surfaces.

8. `Sources`
- Current product-facing file surface is `Files`.

9. `Context` as a standalone governance page name
- Use `Shared context` for the project governance object.

## 3. Hidden-object rule

1. `Shared context` is a formal project governance object.
2. It must remain visible in the project govern information architecture.
3. It must remain a formal governance object and formal navigation item.
4. It must not regress into a hidden route reachable only from other pages.

## 4. Route and contract notes

1. Current route slugs are part of the target model when listed in active route contracts.
- Example: route slug `use-guide` is the current technical slug while the user-facing label is `Access guide`.

2. Pre-GA target contracts reject and remove old runtime/API surfaces instead of keeping aliases, bridges, double-read paths, fallback APIs, or compatibility views.
- Public OpenAPI paths, route-kind maps, SDK exports, generated client types, route manifests, navigation, i18n, user docs, and module maps must use the current names and paths.
- Old route paths, payload fields, terminal views, and public API names may appear only in breaking allowlists, negative contract tests, or one-shot cleanup/assertion evidence that explicitly proves they are forbidden or removed.
- Backend storage collection names and implementation-only filenames may contain old implementation terms only when they are not public/runtime entrypoints, not product-facing truth, and not used as compatibility bridges.

3. Product-facing contract docs must use current names when listing pages, navigation sections, or governance objects.
- Examples:
  - `Model` for Chat selection, not `Execution target`
  - `Agent tasks`, not `Notebook`
  - `Agent Runners`, not `Agents`
  - `Project secrets`, not `Credentials`
  - `Shared context`, not bare `Context`
  - `Access guide`, not `Use guide`, when describing the page in user-facing terms

## 5. Enforcement

Current enforcement must at least verify:

1. this contract stays present and current
2. page-level permission contracts use current product-facing names
3. Chat selection is described as `Model`
4. `Agent tasks` and `Agent Runners` are the active route/module-map names
5. `Shared context` remains a visible governance object in the route manifest
6. active docs, i18n, MSW handlers, route manifests, public/generated contracts, SDK exports, and deployment truth are covered by forbidden legacy naming scans
7. `contracts:check` fails if the current terminology contract drifts
