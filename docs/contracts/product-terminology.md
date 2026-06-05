# Product Terminology Contract

Last updated: 2026-05-27
Status: `authoritative`

This document defines the canonical product-facing names for current AgentSmith surfaces and objects.

Use this contract for:

1. page titles and subtitles
2. sidebar and governance navigation labels
3. user-guide wording
4. product-facing contract docs that describe pages, scopes, and page-level permission gates

Do not use this contract to rename machine-readable API fields, OpenAPI tags, backend storage collection names, or implementation-only filenames.

## Authority relationship

- `docs/CURRENT_BASELINE.md` is the human current-truth router.
- `docs/contracts/README.md` partitions current active contracts by
  product surface and engineering concern.
- This terminology contract defines product-facing names and IA boundaries.
  Deploy vocabulary for release handoff lives in
  `docs/contracts/unified-deploy-contract.md`; this file mirrors only the
  product/operator-facing names and does not promote pre-GA diagnostic entry
  names into product concepts.

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
- Scope: libraries, folders, upload/download, rename/move, delete, preview.

8. `Usage`
- Read-only usage and cost evidence surface for the current project.

9. `Access guide`
- Read-only project access/setup guidance page.
- Route slug may remain `use-guide`, but product-facing naming is `Access guide`.

### Develop and governance objects

10. `Agent Runners`
- Developer/governance surface for task execution capability.
- Canonical route: `.../agent-runners`
- It shows the deployment default managed runner as read-only status and manages Developer runners.
- Managed runner configuration is deployment/system-side, not a frontend/project setting.
- It is not a user execution entrypoint.
- It must not expose Chat/Notebook type selectors, external/internal choices, docker/compose/k8s runtime choices, or an ordinary runner picker.
- The canonical layout order is deployment default managed runner status, then Developer runners.

11. `Agent Runner`
- Task execution capability shown on Agent Runners.
- Public kinds are managed runner and Developer runner.
- Ordinary Agent task creation binds the deployment default managed runner.
- Authorized expert task creation may bind a Developer runner.
- Agent task dispatch is backend-owned and resolves the eligible default Agent Runner for the ordinary path; later runs use the task's immutable bound runner.
- Ordinary task users should not have to think about this object when creating or running work.
- Public records expose stable `kind`, source, and actions.

12. `Runner binding`
- Expert task-creation selector for choosing the runner bound to an Agent task.
- It is not a normal runner picker and is not shown to ordinary task users.
- It appears only when backend binding options expose visible binding affordance.
- The selector includes the deployment default managed runner plus backend-visible Developer runners with reason codes.
- It must not be sourced from the full Agent Runner list and must not expose secrets or full diagnostics.
- Selector visibility comes from backend binding-options rows and affordances, not from frontend checks against Agent Runner read permission.

13. `UI audience`
- Presentation context derived from backend affordances and safe response shape.
- Current audience labels include Ordinary task user, Expert task creator, Runner maintainer, and Diagnostics viewer.
- These labels are not role names and must not be used for authorization.

14. `Deployment default managed runner`
- Deployment-level default Agent task runner used when task creation omits `bound_runner_id`.
- There is exactly one in the current milestone.
- It is configured outside the frontend and available across workspaces/projects.
- Developer runners cannot become the deployment default managed runner.

15. `Managed runner`
- Platform-managed execution environment for Agent tasks.
- In this milestone, the managed runner is the deployment default managed runner.
- It is read-only in public project UI.
- Public project APIs cannot create, edit, delete, set default for, or issue/revoke connection keys for managed runners.

16. `Developer runner`
- Developer-mode testing object for connecting a local runner and validating capability with Test connection and a runner test task.
- It may appear in Agent Runners only when development/local capability is enabled by backend affordance.
- It can be explicitly bound to a task at creation by authorized expert users.
- It is not a formal deployment runtime, cannot become the deployment default managed runner, and cannot be used as managed release proof.

17. `Developer mode`
- Local runner debugging/testing entrypoint.
- It is not a formal deployment runtime, not a product configuration mode, and not a replacement for managed runner execution.

18. `Endpoints`
- Governed model capability configuration for a project.
- Scope: provider/model/policy/secret binding.

20. `Policy`
- Project resource-policy surface.

21. `Shared context`
- Shared project context/governance object.
- This is a formal governance object and must not be treated as a hidden route.

22. `Project secrets`
- Project-scoped secret management surface.
- Product-facing replacement for `Credentials`.

23. `Members`
- Project membership governance surface.

24. `Audit`
- Project audit review surface.

25. `Alerts` / `Alert Center`
- Project-scoped operational signal surface for alert rules and notifications.
- Scope: cost, limit, policy, endpoint-health, and in-app notification signals.
- It is an operations support surface, not release orchestration, not a project governance launcher, and not required to appear as a primary sidebar item.

26. `Settings`
- Project identity / ownership / lifecycle / profile surface.
- Settings must not return to being a governance launcher.
- Not a governance launcher page.

### Workspace and personal connection objects

27. `Workspace integrations`
- Workspace-scoped shared integration/configuration surface.
- Product-facing replacement for workspace `Connections`.

28. `Personal connections`
- Personal third-party account connection surface.
- Product-facing replacement for `Third-party accounts` as the default UI name.

### Agent task execution terms

29. `Task inputs`
- Agent task inputs attached from the shared project library or explicit task input channels.

30. `Activity`
- User-facing task/run progress and execution-detail timeline.
- Use `Activity` or `Execution details` in the Agent task UI; reserve `trace` for engineering/audit internals.

31. `Artifacts`
- Agent task outputs produced by task execution.
- Artifacts are collected from `.artifacts`.

32. `Terminal session`
- Agent task-scoped terminal execution session.
- Scope: many `Terminal sessions` may exist under one task.
- They share the same task workspace and task-scoped home; they are not isolated sandboxes.
- Session creation uses the task's bound runner and persists `resolved_runner_id`; reconnect/input/resize/close reuse the session runner.
- A terminal can belong to an active run/test run or be a standalone task terminal created from the task's bound runner.
- Product-facing terminal UX must describe session lifecycle truth, not treat terminal as a generic floating panel.

33. `任务执行环境 / task execution environment`
- Product-facing term for the environment where Agent tasks run.
- Use it as the primary user-side wording in UI, i18n, status, and errors.
- Do not expose deployment service names, image references, internal URLs, keys, or provider error codes through this term.

## Deploy Terms

These terms belong to `docs/contracts/unified-deploy-contract.md` and define the
current deploy vocabulary.

Current Docker-only local-kind unified deploy remains the current pre-GA
focused diagnostic baseline, not formal release target vocabulary and not
long-term deployment truth. `external_declared` in P0 is schema, fixture,
validator, and evidence boundary only. It does not mean P2/P3 completed real
Kubernetes, cloud, or airgap handoff support. Product-facing terms must not
present that P0 boundary as a new product capability.

1. `AgentSmith deploy`
- Operator-facing deployment workflow.
- Formal release language is `online` / `airgap` distribution crossed with
  `use_existing` / `install_substrates` substrate strategy.
- Internal machine values are `target_cluster`, `substrate_source`, and
  `distribution`; they are not a second operator vocabulary.
- It is not a current frontend page or sidebar object unless a later UI/IA
  contract explicitly adds one.

2. `Release distribution`
- Operator-facing deployment distribution choice.
- Current values are `online` and `airgap`.
- It must not be replaced by local diagnostic names.

3. `Substrate strategy`
- Operator-facing choice for dependency ownership at deploy time.
- Current GA operator values are `use_existing` and `install_substrates`.
- It must not be expanded into a provider matrix in product-facing language.

4. `use_existing`
- Operator provides PostgreSQL/pgvector, MongoDB, Redis, S3-compatible object
  storage, Keycloak/OIDC, and related connection truth.
- Internal machine value: `substrate_source=external_declared`.
- Release kit validates the declared truth; it does not create cloud resources.

5. `install_substrates`
- Release-kit namespace-scoped substrate installer path.
- Internal machine value: `substrate_source=kit_installed`.
- It emits the same connection truth shape used by `use_existing`, and must
  bind namespace-scoped installer evidence plus explicit operator confirmation.
- It does not mean AgentSmith deploys substrates, does not create a cloud
  provider matrix, and does not add in-product substrate management.
- Legacy `kit_provided` is an internal compatibility alias for focused
  diagnostics only and not a GA operator `deployment_path`.

6. `pre-GA diagnostic entry names`
- `local-kind` and `existing-cluster` are allowed only as pre-GA/local
  diagnostic entry names, migration references, or negative-test vocabulary.
- They are not release targets, not product capabilities, and not operator
  choices in the formal four-quadrant release model.

7. `Substrate module`
- Docker-only dependency base for PostgreSQL, MongoDB, Redis, MinIO, and
  Keycloak.
- It owns dependency lifecycle, health, destructive reset, dependency readiness
  reseed, and connection truth.
- It does not own AgentSmith app workloads or product bootstrap.

8. `AgentSmith app`
- Kubernetes workload set for `web`, `api`, `llmup`, the internal sandbox
  execution service (ASBCP), managed runner deployment configuration, and required
  Kubernetes resources.
- It consumes substrate truth and must not invent dependency addresses.
- ASBCP is a developer/operator deployment term only. It must not become a
  visible UI route, user-guide concept, i18n label, system management side, or
  user access entrypoint.
- This terminology contract only records that product-facing prohibition. Lock
  update, manifest comparison, and focused deploy diagnostics belong in
  `docs/contracts/unified-deploy-contract.md`, not here.

9. `app-managed llmup`
- Deployment ownership term.
- It means `llmup` is deployed as an AgentSmith app Kubernetes workload and
  called by API through an internal service.
- It does not mean AgentSmith owns llmup source code, source builds, or
  model-provider feature expansion.

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
- Any such allowlist or cleanup evidence must be exact and owned, with a deletion trigger and a contract/doc check proving it cannot become an active route, alias, bridge, or compatibility layer.
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
6. active docs, i18n, MSW handlers, route manifests, public/generated contracts, SDK exports, and deployment truth are covered by forbidden naming scans
7. `contracts:check` fails if the current terminology contract drifts
