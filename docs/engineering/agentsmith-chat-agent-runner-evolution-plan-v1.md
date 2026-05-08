# AgentSmith Chat, Agent Tasks, and Agent Runners Target Plan v1

Status: `current-target`
Owner: Product + Engineering
Last updated: 2026-05-05

## Status / Purpose

This is a pre-GA target plan, not a compatibility plan. Active product behavior, public contracts, route manifests, generated types, deployment truth, gates, user guides, and copy move directly to this model with no compatibility aliases, bridges, double-read paths, fallback APIs, or compatibility views.

This plan is planning evidence only. Implementation may rely on target names, fields, permissions, deployment behavior, or gates only after authoritative contracts and generated artifacts are updated and passing.

Contract note: `docs/contracts/product-terminology.md` is the authoritative source for current product-facing names. Chat selection is `Model`, backed by an `Endpoint`; Agent task runner choice, when allowed, is an expert task-creation binding, not a run-time selector.

## Target Invariants

1. `Chat` is only conversation with an LLM/model. Users choose a `Model`; the Model is governed through an `Endpoint`, and backend Endpoint truth remains the capability and policy authority.
2. Chat-type Agent, Notebook-type Agent, and all Agent type selectors are gone. There is no Chat/Notebook workload choice in UI, API, SDK, or wire contracts.
3. `Notebook` becomes `Agent tasks`; current `Agents` becomes `Agent Runners`. Active routes are `/chat`, `/agent-tasks`, `/agent-tasks/[taskId]`, and `/agent-runners`.
4. `/notebook` and `/agents` are not target aliases.
5. Agent task `CreateTask` accepts task intent, optional inputs, and optional expert `bound_runner_id`. Omitted `bound_runner_id` binds the deployment default managed runner. Payloads containing runner selection or removed runner/agent identity fields fail closed.
6. `StartTaskRun` is the canonical run contract and must not accept runner selection fields. UI create-and-start behavior must bind the runner during CreateTask, then StartTaskRun uses the task's immutable bound runner.
7. Backend dispatch resolves the runner from the task's immutable binding. A missing, offline, unauthorized, or unavailable bound runner fails with a typed error and never falls back to another runner.
8. Agent Runners are developer/governance-side task execution capability visibility and Developer runner management. Managed runners are deployment-side configured and read-only in the frontend. Agent Runners are not an ordinary user execution entrypoint and expose no Chat/Notebook type, external/internal mode, or docker/k8s runtime choice.
9. Public runner SDK and wire contracts are task-only: no chat/notebook public contexts, no `interaction_kind`, no `external_agent_id`, and no `chat_runner`.
10. Developer mode is local debugging/testing only. It may appear in Agent Runners when development/local capability is enabled by backend affordance, but it is not a formal deployment runtime, cannot become the deployment default managed runner, and cannot be managed release proof.
11. Formal deployment uses managed runner execution only. External docker runner deploy/runtime is removed, while Docker/Compose/Kubernetes infrastructure for local-kind, existing-cluster, integration, base images, sandbox, app, and verification is retained.
12. Artifacts are collected only from `.artifacts`. Other task workspace files may exist and be edited, but are not collected or displayed as artifacts.
13. Removed-data closure is export-before-delete/rewrite/assert, idempotent, retention/access/redaction-owned, audit-schema-owned, and proves active runtime no longer depends on removed Chat Agent, Notebook Agent, external runner, `mode`, `runner_runtime`, `interaction_kind`, or `external_agent_id` fields.

## Product Surfaces, Routes, Permissions

Permission names below are target contract names. Code may use them only after `auth-permission-model`, route gates, frontend/backend matrix, and generated types own them.

Backend authorization is authoritative; frontend gates are routing and UX guards only. Route params remain URL truth and must be validated with the workspace/project validation helpers.

| Surface | Active route | Target meaning | Route gate | Mutation/action gate | Must not expose |
| --- | --- | --- | --- | --- | --- |
| Chat | `/chat` | Project LLM/model conversation. User-facing selector is `Model`, derived from Endpoint truth. | `project:endpoint:use` | send/stream/stop/delete: `project:endpoint:use` | Agent Runner picker, runner readiness, runner diagnostics, runner dispatch, removed Chat Agent fields |
| Agent tasks | `/agent-tasks`, `/agent-tasks/[taskId]` | User task workspace with inputs, activity, final answer, terminal sessions, and artifacts. Ordinary users bind the deployment default managed runner at task creation; authorized experts may bind an available Developer runner at task creation. | `project:agent_task:use` | create/update/archive/cancel and default managed binding: `project:agent_task:use`; explicit Developer runner binding and later Developer-bound start/retry/recovery: `project:agent_task:use` plus `project:agent_runner:manage` plus backend affordance; managed-bound start/retry/recovery use the task's bound runner and accept no runner fields | ordinary runner picker, run-time runner selector, hidden default, URL/local-storage runner override, Agent type selector |
| Agent task terminal | nested under task route | Task-scoped terminal session. | `project:agent_task:use` + `project:agent_task:terminal` | create/open/reconnect/input/resize/close: same; Developer-runner-bound terminals also require `project:agent_runner:manage` plus backend bound-runner use affordance | terminal outside task scope, backend-authz bypass |
| Agent Runners | `/agent-runners` | Read-only deployment managed runner status plus Developer runner lifecycle for development validation. | `project:agent_runner:read` or `project:agent_runner:manage` | display-safe diagnostics: read-or-manage plus `view_diagnostics`; Developer runner create/edit/disable/delete/key/Test connection: `project:agent_runner:manage` plus action; Developer runner test task: `project:agent_task:use` plus `project:agent_runner:manage` plus `run_test_task`; managed runner mutation/config/default actions are not exposed in frontend/public project APIs | ordinary user run entrypoint, managed runner config, Chat/Notebook type, external/internal, docker/compose/k8s runtime choice |
| Endpoints | existing endpoint routes | Governed model capability: provider/model/policy/secret binding. | existing endpoint governance tokens | endpoint management remains governance-side | runner-owned model truth |

UI audiences such as Ordinary task user, Expert task creator, Runner maintainer, and Diagnostics viewer are derived from backend affordances and safe response shape. They are not role names and must not be used as authorization inputs.

## Runtime Contracts

### Chat

Target Chat contract:

1. Chat session create/read/patch/send/stream/stop/delete operates on Chat sessions and Endpoint/model capability.
2. Session storage keeps `endpoint_id`; provider/model display and attachment capability derive from backend Endpoint truth and file governance policy.
3. Audit and usage records are endpoint/model records and may snapshot resolved provider/model for evidence.
4. Chat does not query, display, filter, or dispatch Agent Runners.
5. Chat does not accept, store, expose, or copy forward `external_agent_id`; payloads containing it fail closed with `400 unsupported_field`.
6. Chat stream never emits or consumes `agent_runner`, `chat_runner`, or `interaction_kind` transport fields.
7. Chat creates no runner workspaces and stop/delete does not trigger runner teardown.
8. Active Chat storage assertions prove zero live dependency on old runner or Chat Agent bindings.
9. User-safe Chat errors describe model, endpoint, permission, quota/limit, network, content safety, or upstream state, not runner state.

### Agent Tasks

Target Agent task contract:

1. Agent task is not a Chat session. Task APIs do not expose public `interaction_kind` or Chat message semantics.
2. `CreateTask` binds the task runner. Omitting `bound_runner_id` binds the deployment default managed runner; authorized expert `bound_runner_id` binds the selected Developer runner. Payloads containing `runner_selection`, old `runner_id`, old `agent_id`, or old `agent_name` fail closed with `400 unsupported_field`.
3. `StartTaskRun` accepts no runner selection fields. `CreateTask` plus `StartTaskRun` is the canonical sequence for UI create-and-start.
4. The frontend has no ordinary runner picker, hidden default, URL override, local-storage preference, stale hidden form selector, advanced Agent selector, or Chat/Notebook type selector.
5. A permissioned expert may see runner binding only under Advanced settings during task creation, sourced from a backend binding-options response that returns the default managed runner plus authorized Developer runners. It must not use the full Agent Runner list or return secrets/full diagnostics.
6. Binding-options fetch requires `project:agent_task:use`. Developer runner options require backend row-level `project:agent_runner:manage` plus policy/capability/readiness/freshness. Final authorization is recomputed on `CreateTask`; the options response is advisory UX data.
7. If the actor has no expert binding authority, the UI uses the default managed path and must not leak hidden runner names, private diagnostics, endpoint details, or internal capability data.
8. Dispatch records `resolved_runner_id` on the run summary and audit evidence only after the task's bound runner is resolved successfully.
9. Task lifecycle and run status are separate. Activity and final answer are task/run state, not Chat messages.
10. The task workspace owns file edits, terminal sessions, inputs, context, credentials, activity, final answer, and artifact collection.
11. Terminal session creation uses the task's bound runner and persists `resolved_runner_id` on the terminal session. Reconnect/input/resize/close reuse the session runner and never re-resolve defaults or current runner list state.
12. Terminal creation uses the active run/test run's resolved runner when attached to a run; standalone task terminals use the task's bound runner and do not require an active run.
13. Terminal tickets, reconnects, input, resize, and close are task-scoped and must require `project:agent_task:use` plus `project:agent_task:terminal`; Developer-runner-bound terminals also revalidate `project:agent_runner:manage` plus backend bound-runner use affordance.
14. Ordinary users see productized Activity/Execution details summaries. Raw event view appears only when audit/diagnostics affordance allows it and must not display raw diagnostics, secrets, or internal paths.
15. Errors include user-safe messages plus typed error codes and diagnostic/audit ids where relevant; backend reason codes are mapped to audience-safe i18n copy rather than rendered directly.

### Task Runner Binding And Resolution

Backend binds the Agent Runner during task creation and resolves that immutable binding at run dispatch.

The default managed runner is deployment-level system configuration. It is projected into project/workspace UI as read-only status and is available across projects in this milestone. It must not be configured, created, deleted, or marked default from frontend/public project APIs. Model/endpoint access is resolved through the existing project Endpoint/model governance path, not through mutable frontend runner configuration.

Resolution behavior:

1. `bindRunnerForTask` resolves omitted `bound_runner_id` to the deployment default managed runner.
2. `bindRunnerForTask` validates explicit Developer runner binding with `project:agent_task:use`, `project:agent_runner:manage`, backend action affordance, readiness, freshness, policy, and capability checks.
3. The task stores immutable `bound_runner_id`, `bound_runner_kind`, `runner_binding_source`, `bound_at`, and `bound_by_user_id`.
4. `resolveBoundRunnerForRun` reads the task binding for start, retry, recovery, terminal creation, and pod/session recovery; Developer-runner-bound operations revalidate `project:agent_runner:manage` plus backend bound-runner use affordance.
5. No ready default managed runner fails with `409 agent_runner_unavailable`.
6. No usable project endpoint/model fails with `409 agent_runner_model_unconfigured`.
7. Capability mismatch fails with `409 agent_runner_capability_mismatch`.
8. Missing or invalid bound runner fails with a typed unavailable/configuration error.
9. Developer runner offline/stale/revoked state fails with a typed developer-runner unavailable error.
10. Run dispatch never falls back to another runner after binding failure.

### Agent Runners + SDK/Provider

Agent Runner records are task-only. The surface may show readiness, capabilities, diagnostics, connection state, and audit/usage links.

Public records must distinguish managed and Developer runner through stable public `kind`/source/action affordance concepts. Public create can create Developer runners only; it cannot create managed runners, set defaults, set endpoint/model ownership on managed runners, or issue/revoke keys for managed runners.

Display-safe diagnostics require `project:agent_runner:read` or `project:agent_runner:manage` plus `actions.view_diagnostics.allowed`. Test connection, connection key, one-time secret, and mutating connection actions require `project:agent_runner:manage` plus the matching action. Dedicated Developer runner test task requires `project:agent_task:use`, `project:agent_runner:manage`, and `actions.run_test_task.allowed` because it creates standard task/run evidence.

Connection keys, websocket/presence, diagnostics, and audit event names use `agent_runner` naming. Secrets, credentials, service keys, endpoint secrets, and token material are redacted.

Public SDK exports are task-centric:

1. `TaskRunner`, `RunnerContext`, task context/spec validators, and task event types.
2. Interfaces for inputs, artifacts, context, credentials, terminal, lifecycle, model access, diagnostics, and audit.

Forbidden public exports and wire concepts:

1. `AgentInteractionKind`, `ChatExecutionContext`, `NotebookExecutionContext`, and `CHAT_RUNNER_SPEC`.
2. Public `chat`/`notebook` workload discriminants.
3. Deployment-mode-specific mount paths as public contract.
4. Wire `interaction_kind`, wire `external_agent_id`, and wire `chat_runner`.

Provider rules:

1. `ManagedRunnerProvider` is the only provider enabled in formal deployment.
2. `DeveloperRunnerProvider` is enabled only by local development config or an equivalent development capability flag.
3. If the developer provider is not enabled, Developer runner create/action affordances are hidden or disabled by backend response and backend rejects direct calls.
4. Build/CI assertions prove developer provider registration is impossible in production, local-kind, existing-cluster, release, or formal deployment environments.
5. Providers hide environment differences from public SDK semantics.
6. Providers must not silently downgrade workspace, artifact, context, credential, terminal, lifecycle, stop, diagnostic, or model capabilities.
7. Missing capability returns an explicit capability response or typed error.

## Deployment Truth

| Line | Target truth | Removed / retained boundary |
| --- | --- | --- |
| Formal deployment | Managed Agent task runner execution only. | Developer mode and external docker runner deploy/runtime are absent from UI, env, manifests, bootstrap, release, and verify truth. |
| Unified deploy profiles | Managed runner execution through backend provider truth. | No developer provider, no manual runner service, no external-runner-only simple mode. |
| Developer local | Local debugging/testing for runner developers, sharing public SDK semantics with managed runner. | Local-real is an adapter/evidence line, not a runtime identity; Developer runner evidence is not formal deployment readiness or managed release proof. |
| External docker runner | Deploy/runtime path is removed. | Do not remove Docker/Compose/Kubernetes primitives used by local-kind, existing-cluster, integration, base images, sandbox, app packaging, or verification plumbing. |
| Naming | Runner image/package/release names use `agent-task` or `task-runner`. | No Chat runner or Notebook runner release names in active deployment truth. |
| Bootstrap | May seed Endpoints and one deployment default managed Agent Runner through system-side configuration when required. | Must not create Chat Agents, Notebook Agents, external/internal agent modes, Developer runner defaults, frontend-managed managed runners, or start an external docker runner. |

## One-Shot Cleanup, Audit, Data Closure

Chat removed bindings:

1. Export cleanup evidence for every active Chat session that has `external_agent_id` before clearing it.
2. Evidence includes session id, project id, removed field value, previous endpoint/model attribution when available, script version, actor, timestamp, reason, and affected counts.
3. Clear active bindings only after export; reruns are idempotent.
4. Removed Chat Agent records do not become Chat models.

Notebook and Agent removed data:

1. Existing Notebook task data is rewritten once into Agent task data or exported as cleanup evidence before release.
2. Removed task `agent_id` / `agent_name` may remain only in one-shot cleanup/assertion evidence.
3. Eligible old internal/k8s task-runner records are rewritten once into managed Agent Runner records after evidence is written.
4. External/docker runner records are removed from active seeds, deployment data, and runtime selection after evidence is written.

DB and retention closure:

1. Project-scoped unique default runner constraint and transaction are owned.
2. New task runs require `resolved_runner_id` after dispatch succeeds.
3. Removed fields are deleted from, or write-blocked in, active runtime.
4. Cleanup order is export-before-delete/rewrite/assert with rerun behavior and rollback boundary defined.
5. Archive location, retention, access control, PII redaction, secret redaction, and audit event schema are owned.
6. Final assertions prove active runtime no longer reads removed fields.

Required audit coverage:

1. Chat model send/stream/stop/delete.
2. Agent task create/run/cancel/fail/archive.
3. Runner resolution success/failure.
4. Agent Runner managed read-only status projection; public UI cannot edit underlying managed configuration.
5. Runner connection key issue/revoke/expiry and diagnostics/Test connection access.
6. Dedicated Developer runner test-task start, including standard task/run evidence marked `runner_test`, `resolved_runner_id`, and binding metadata.
7. Terminal create/open/reconnect/input/resize/close and task-bound terminal runner resolution.
8. Artifact scan.
9. Managed credential/context access.
10. Removed-field cleanup dry-run/apply/assertion.

Audit events include actor, timestamp, project/task/run/session/runner/endpoint ids as applicable, action, result/error code, diagnostic id, schema/script version, and redacted metadata. Secret redaction covers diagnostics and Test connection across ingress logging, storage, response serialization, and audit.

## Verification And Gates

Use focused evidence first for the touched slice. Heavy gates are phase closure, final PR closure, release signoff, or cross-module evidence.

| Change slice | Focused evidence | Closure |
| --- | --- | --- |
| Contracts and terminology | terminology, permission, route, OpenAPI/AsyncAPI, generated type, SDK export checks | `contracts:check`, OpenAPI/generated checks, forbidden scan |
| Chat | endpoint-only create/patch/read/send/stream/stop/delete; removed field rejection; active storage assertion | focused tests plus PR gate |
| Agent tasks | CreateTask default managed binding, expert Developer runner binding, old runner field rejection, StartTaskRun runner-field rejection, binding-options no-leak behavior, task-bound backend resolution, Activity/Execution details plus raw event gating, terminal session task-bound runner reuse and terminal permission gates, artifact scan proving `.artifacts` only and non-`.artifacts` workspace files are not collected/displayed as artifacts | focused unit/integration/e2e plus PR gate |
| Agent Runners, SDK, providers | Deployment managed read-only projection, public Developer-only mutation restrictions, managed create/edit/default/key rejection, display-safe diagnostics/read-or-manage affordance, Test connection redaction, one-active Developer key lifecycle, inline runner details, dedicated Developer runner test task with task-use plus runner-manage, SDK export scan, managed/developer provider behavior | focused runner tests plus PR gate |
| One-shot cleanup and audit | dry-run/apply/assertion, idempotency, retention/access/redaction, audit schema | cleanup evidence plus PR gate |
| Deployment truth | render/bundle/bootstrap/verify for changed unified deploy profiles, release, runner image, sandbox, or scripts | PR gate plus release gate |

Final PR closure requires authoritative contracts updated, OpenAPI/AsyncAPI and generated types aligned, SDK and deployment truth updated where relevant, forbidden scan clean with justified allowlist, focused evidence recorded for each changed slice, and `npm run verify -- --goal=pr --run`.

Release closure additionally requires `npm run release:ready` and managed-runner unified deploy evidence when deployment manifests, bootstrap, bundles, runner launch, sandbox, or release scripts change.

Raw low-level `test:*`, `gate:*`, `lane:*`, backend-real, and unified deploy commands are diagnostics or evidence producers; they do not replace final closure unless the owning contract says so.

Forbidden scan rules:

1. Block retired concepts in active product docs, user guides, navigation, route manifests, UI copy, i18n, test ids, search/index metadata, permissions, route gates, frontend/backend matrix, OpenAPI, AsyncAPI, generated types, public SDK exports, active frontend/backend runtime, deployment manifests, env renderers, bootstrap, verify, release inputs, package scripts, Makefile, CI workflows, and gate manifests.
2. Allow matches only in negative fixtures/tests, breaking allowlists, one-shot cleanup/assertion evidence, and audit evidence. Active runtime, API, UI, deployment truth, and gate manifests get no compatibility allowlist. Every allowlist entry must include owner, reason, scope, and review/expiry date.
3. Deployment/runtime scan blocks external runner deploy/runtime identifiers but must not block base image, sandbox, integration, local-kind, existing-cluster, app, or verification Docker primitives.

## Forbidden Workarounds And Non-goals

Forbidden workarounds:

1. Any Chat Agent compatibility mode, alias, bridge, double-read, fallback API, or removed Chat runner field read/write path.
2. Hidden runner picker, ordinary runner picker, local runner preference, URL runner override, or run-scoped runner selector in Agent task UI. The only allowed selector is expert task-creation runner binding sourced from backend binding options/affordance.
3. Frontend default auto-fill, hidden runner persistence, or silent runner guessing beyond backend task creation binding to the deployment default managed runner.
4. Public `interaction_kind` or chat/notebook runner SDK exports.
5. Developer mode in local-kind, existing-cluster, release, or formal deployment truth, or as deployment default / managed release proof.
6. External docker runner wrapper as production, local-kind, existing-cluster, or release path.
7. Runtime, API, UI, or route aliases for `/notebook` or `/agents`.
8. Role-name authorization, invented permission tokens, hook-short-circuit permission checks, unvalidated route params, or silent provider downgrade.

Non-goals: low-code agent builder, generic infrastructure operations console, multi-workload runner abstraction, file-level policy expansion, independent Chat/Agent quota model, hosted shell outside Agent task scope, E2E coverage that pretends to verify backend authorization, and removal of Docker/Compose/K8s infrastructure unrelated to external runner deploy/runtime.

## Appendix: Scope Inventory

This inventory guides audit scope; updated contracts remain the source of truth.

| Scope | Target areas | Current boundary |
| --- | --- | --- |
| Contracts | `product-terminology`, `auth-permission-model`, frontend/backend matrix, route gate checklist, Chat/Agent task/Agent Runner module maps, API guide, API entry map, agent execution protocol, OpenAPI/AsyncAPI, route kind map, deployment/address truth | Active contracts expose only the current Chat / Agent task / Agent Runner model. |
| Frontend UI | active `chat`, `agent-tasks`, `agent-runners` routes/components, route policy manifest, messages, mocks, visual/e2e fixtures, project navigation | Visible routes, copy, namespaces, and test ids follow the current product model. |
| Backend runtime | API entry handlers, Chat resource/service, task model/store/run coordination/terminal, Agent Runner profiles, project authz, generated API types | Runtime reads and writes current fields only. |
| Runner packages | `packages/agent-runner`, task runner package, builtin skills, terminal/session/workspace/artifact modules | Public exports are Agent task runner interfaces. |
| Deployment/gates | `infra/deploy/unified`, `infra/runner`, unified deploy scripts, contract/governance scans, workflows, `package.json`, `Makefile` | Unified deploy is the only deploy model. |
| Docs/evidence | user guides, troubleshooting, local runtime docs, audit/usage reports, release evidence | Docs and evidence point at current product and deploy truth. |
