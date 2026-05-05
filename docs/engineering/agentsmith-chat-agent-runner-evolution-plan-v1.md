# AgentSmith Chat, Agent Tasks, and Agent Runners Target Plan v1

Status: `current-target`
Owner: Product + Engineering
Last updated: 2026-05-05

## Status / Purpose / Blocking Contract Conflict

This is a pre-GA target plan, not a compatibility plan. Active product behavior, public contracts, route manifests, generated types, deployment truth, gates, user guides, and copy move directly to this model with no legacy aliases, bridges, double-read paths, fallback APIs, or compatibility views.

This plan is planning evidence only. Implementation may rely on target names, fields, permissions, deployment behavior, or gates only after authoritative contracts and generated artifacts are updated and passing.

Blocking contract conflict: `docs/contracts/product-terminology.md` currently says Chat selection must not be called `Model` and should be called `Execution target`. This target requires Chat selection to be `Model`, backed by an `Endpoint`. The terminology contract, permission model, module maps, OpenAPI/AsyncAPI specs, generated types, SDK exports, deployment truth, and gates must be updated before implementation treats `Model` as contract truth.

Legacy terms may appear only as negative evidence, forbidden-scan patterns, one-shot cleanup/assertion evidence, or archived-doc references. Those mentions prove removal; they do not define supported runtime or API behavior.

## Target Invariants

1. `Chat` is only conversation with an LLM/model. Users choose a `Model`; the Model is governed through an `Endpoint`, and backend Endpoint truth remains the capability and policy authority.
2. Chat-type Agent, Notebook-type Agent, and all Agent type selectors are gone. There is no Chat/Notebook workload choice in UI, API, SDK, or wire contracts.
3. `Notebook` becomes `Agent tasks`; current `Agents` becomes `Agent Runners`. Active routes are `/chat`, `/agent-tasks`, `/agent-tasks/[taskId]`, and `/agent-runners`.
4. `/notebook` and `/agents` are not target aliases.
5. Agent task create/run accepts task intent and optional inputs, not `runner_id`, old `agent_id`, or old `agent_name`. Users do not pick runners.
6. Backend dispatch resolves exactly one eligible default Agent Runner. Failure is a typed error plus audit evidence; user dispatch never silently auto-fills or guesses a runner.
7. Agent Runners are developer/governance-side task execution capability configuration. They are not a user execution entrypoint and expose no Chat/Notebook type, external/internal mode, or docker/k8s runtime choice.
8. Public runner SDK and wire contracts are task-only: no chat/notebook public contexts, no `interaction_kind`, no `external_agent_id`, and no `chat_runner`.
9. Developer mode is local debugging only. It shares public SDK semantics with managed runner execution, returns explicit typed errors/capability responses for unavailable local capabilities, and is absent from demo, cluster, release, and formal deployment truth.
10. Formal deployment uses managed runner execution only. External docker runner deploy/runtime is removed, while Docker/Compose/Kubernetes infrastructure for demo, cluster, integration, base images, sandbox, app, and verification is retained.
11. Artifacts are collected only from `.artifacts`. Other task workspace files may exist and be edited, but are not collected or displayed as artifacts.
12. Removed-data closure is export-before-delete/rewrite/assert, idempotent, retention/access/redaction-owned, audit-schema-owned, and proves active runtime no longer depends on old Chat Agent, Notebook Agent, external runner, `mode`, `runner_runtime`, `interaction_kind`, or `external_agent_id` fields.

## Product Surfaces, Routes, Permissions

Permission names below are target contract names. Code may use them only after `auth-permission-model`, route gates, frontend/backend matrix, and generated types own them.

Backend authorization is authoritative; frontend gates are routing and UX guards only. Route params remain URL truth and must be validated with the workspace/project validation helpers.

| Surface | Active route | Target meaning | Route gate | Mutation/action gate | Must not expose |
| --- | --- | --- | --- | --- | --- |
| Chat | `/chat` | Project LLM/model conversation. User-facing selector is `Model`, derived from Endpoint truth. | `project:endpoint:use` | send/stream/stop/delete: `project:endpoint:use` | Agent Runner picker, runner readiness, runner diagnostics, runner dispatch, legacy Chat Agent fields |
| Agent tasks | `/agent-tasks`, `/agent-tasks/[taskId]` | User task workspace with inputs, activity, final answer, terminal sessions, and artifacts. | `project:agent_task:use` | create/run/update/archive/cancel: `project:agent_task:use` | runner picker, hidden default, URL/local-storage runner override, Agent type selector |
| Agent task terminal | nested under task route | Task-scoped terminal session. | `project:agent_task:use` + `project:agent_task:terminal` | open/reconnect/input/resize/close: same | terminal outside task scope, backend-authz bypass |
| Agent Runners | `/agent-runners` | Developer/governance configuration for task execution capability. | `project:agent_runner:read` | create/update/delete/default/connection/diagnostics: `project:agent_runner:manage` | user run entrypoint, Chat/Notebook type, external/internal, docker/compose/k8s runtime choice |
| Endpoints | existing endpoint routes | Governed model capability: provider/model/policy/secret binding. | existing endpoint governance tokens | endpoint management remains governance-side | runner-owned model truth |

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
2. Task create/run payloads do not require or accept runner selection fields; payloads containing `runner_id`, old `agent_id`, or old `agent_name` fail closed with `400 unsupported_field`.
3. The frontend has no visible picker, hidden default, URL override, local-storage preference, advanced Agent selector, or Chat/Notebook type selector.
4. Dispatch records the selected `runner_id` on the run summary and audit evidence only after backend resolution succeeds.
5. Task lifecycle and run status are separate. Activity and final answer are task/run state, not Chat messages.
6. The task workspace owns file edits, terminal sessions, inputs, context, credentials, activity, final answer, and artifact collection.
7. Terminal tickets, reconnects, input, resize, and close are task-scoped and permission checked.
8. Errors include user-safe messages plus typed error codes and diagnostic/audit ids where relevant.

### Runner Resolution

Backend resolves the Agent Runner at run dispatch. A project must have exactly one eligible default managed Agent Runner.

Eligibility requires a project-scoped runner that is ready, marked default, has `default_endpoint_id`, points to a same-project enabled Endpoint, is policy-allowed for the actor/task, resolves to a usable provider/model, and satisfies requested input, terminal, artifact, context, credential, lifecycle, stop, diagnostic, and model capabilities.

Resolution behavior:

1. Backend enforces at most one `is_default=true` Agent Runner per project.
2. Setting a default atomically clears the previous default and writes audit.
3. Multiple active defaults fail with `409 agent_runner_default_conflict`.
4. No ready managed runner fails with `409 agent_runner_unavailable`.
5. No usable default endpoint/model fails with `409 agent_runner_model_unconfigured`.
6. Capability mismatch fails with `409 agent_runner_capability_mismatch`.
7. No eligible default fails with `409 agent_runner_selection_required`.
8. Ambiguous eligibility fails with `409 agent_runner_selection_ambiguous`.
9. Bootstrap and admin configuration may persist a default runner, but user run dispatch must fail closed instead of silently choosing one.

### Agent Runners + SDK/Provider

Agent Runner records are project-scoped and task-only. The surface may show readiness, default endpoint binding, capabilities, diagnostics, connection state, and audit/usage links.

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
2. `DeveloperRunnerProvider` is enabled only by local development config.
3. Build/CI assertions prove developer provider registration is impossible in production, demo, cluster, release, or formal deployment environments.
4. Providers hide environment differences from public SDK semantics.
5. Providers must not silently downgrade workspace, artifact, context, credential, terminal, lifecycle, stop, diagnostic, or model capabilities.
6. Missing capability returns an explicit capability response or typed error.

## Deployment Truth

| Line | Target truth | Removed / retained boundary |
| --- | --- | --- |
| Formal deployment | Managed Agent task runner execution only. | Developer mode and external docker runner deploy/runtime are absent from UI, env, manifests, bootstrap, release, and verify truth. |
| Demo and cluster | Managed runner execution through backend provider truth. | No developer provider, no manual runner service, no external-runner-only simple mode. |
| Developer local | Local debugging for runner developers, sharing public SDK semantics with managed runner. | Local-only config; not evidence for formal deployment readiness. |
| External docker runner | Deploy/runtime path is removed. | Do not remove Docker/Compose/Kubernetes primitives used by demo, cluster, integration, base images, sandbox, app packaging, or verification plumbing. |
| Naming | Runner image/package/release names use `agent-task` or `task-runner`. | No Chat runner or Notebook runner release names in active deployment truth. |
| Bootstrap | May seed Endpoints and one managed default Agent Runner when required. | Must not create Chat Agents, Notebook Agents, external/internal agent modes, or start an external docker runner. |

## One-Shot Cleanup, Audit, Data Closure

Chat legacy bindings:

1. Export historical evidence for every active Chat session that has `external_agent_id` before clearing it.
2. Evidence includes session id, project id, legacy id, previous endpoint/model attribution when available, script version, actor, timestamp, reason, and affected counts.
3. Clear active bindings only after export; reruns are idempotent.
4. Legacy Chat Agent records do not become Chat models.

Notebook and Agent legacy data:

1. Existing Notebook task data is rewritten once into Agent task data or exported as historical evidence before release.
2. Old task `agent_id` / `agent_name` may remain only in one-shot cleanup/assertion evidence or archived evidence.
3. Eligible old internal/k8s task-runner records are rewritten once into managed Agent Runner records after evidence is written.
4. External/docker runner records are removed from active seeds, deployment data, and runtime selection after evidence is written.

DB and retention closure:

1. Project-scoped unique default runner constraint and transaction are owned.
2. New task runs require `runner_id` after dispatch succeeds.
3. Legacy fields are removed from, or write-blocked in, active runtime.
4. Cleanup order is export-before-delete/rewrite/assert with rerun behavior and rollback boundary defined.
5. Archive location, retention, access control, PII redaction, secret redaction, and audit event schema are owned.
6. Final assertions prove active runtime no longer reads legacy fields.

Required audit coverage:

1. Chat model send/stream/stop/delete.
2. Agent task create/run/cancel/fail/archive.
3. Runner resolution success/failure.
4. Agent Runner default and default endpoint changes.
5. Runner connection key issue/revoke and diagnostics access.
6. Terminal open/reconnect/input/resize/close.
7. Artifact scan.
8. Managed credential/context access.
9. Removed-field cleanup dry-run/apply/assertion.

Audit events include actor, timestamp, project/task/run/session/runner/endpoint ids as applicable, action, result/error code, diagnostic id, schema/script version, and redacted metadata.

## Verification And Gates

Use focused evidence first for the touched slice. Heavy gates are phase closure, final PR closure, release signoff, or cross-module evidence.

| Change slice | Focused evidence | Closure |
| --- | --- | --- |
| Contracts and terminology | terminology, permission, route, OpenAPI/AsyncAPI, generated type, SDK export checks | `contracts:check`, OpenAPI/generated checks, forbidden scan |
| Chat | endpoint-only create/patch/read/send/stream/stop/delete; legacy field rejection; active storage assertion | focused tests plus PR gate |
| Agent tasks | create/run without runner selection; backend resolution; activity/final answer/SSE; terminal; artifact scan proving `.artifacts` only and non-`.artifacts` workspace files are not collected/displayed as artifacts | focused unit/integration/e2e plus PR gate |
| Agent Runners, SDK, providers | default uniqueness, endpoint validity, diagnostics, connection keys, SDK export scan, managed/developer provider behavior | focused runner tests plus PR gate |
| One-shot cleanup and audit | dry-run/apply/assertion, idempotency, retention/access/redaction, audit schema | cleanup evidence plus PR gate |
| Deployment truth | render/bundle/bootstrap/verify for changed demo, cluster, release, runner image, sandbox, or scripts | PR gate plus release gate |

Final PR closure requires authoritative contracts updated, OpenAPI/AsyncAPI and generated types aligned, SDK and deployment truth updated where relevant, forbidden scan clean with justified allowlist, focused evidence recorded for each changed slice, and `npm run verify -- --goal=pr --run`.

Release closure additionally requires `npm run release:ready` and managed-runner demo/cluster evidence when deployment manifests, bootstrap, bundles, runner launch, sandbox, or release scripts change.

Raw low-level `test:*`, `gate:*`, `lane:*`, backend-real, and rehearsal commands are diagnostics or evidence producers; they do not replace final closure unless the owning contract says so.

Forbidden scan rules:

1. Block retired concepts in active product docs, user guides, navigation, route manifests, UI copy, i18n, test ids, search/index metadata, permissions, route gates, frontend/backend matrix, OpenAPI, AsyncAPI, generated types, public SDK exports, active frontend/backend runtime, deployment manifests, env renderers, bootstrap, verify, release inputs, package scripts, Makefile, CI workflows, and gate manifests.
2. Allow matches only in negative fixtures/tests, breaking allowlists, one-shot cleanup/assertion evidence, audit evidence, and archived docs. Active runtime, API, UI, deployment truth, and gate manifests get no legacy compatibility allowlist. Every allowlist entry must include owner, reason, scope, and review/expiry date.
3. Deployment/runtime scan blocks external runner deploy/runtime identifiers but must not block base image, sandbox, integration, demo, cluster, app, or verification Docker primitives.

## Forbidden Workarounds And Non-goals

Forbidden workarounds:

1. Any Chat Agent compatibility mode, alias, bridge, double-read, fallback API, or Chat legacy runner field read/write path.
2. Hidden runner picker, local runner preference, or URL runner override in Agent task UI.
3. Dispatch-time default auto-fill or silent runner auto-selection in user run dispatch.
4. Public `interaction_kind` or chat/notebook runner SDK exports.
5. Developer mode in demo, cluster, release, or formal deployment truth.
6. External docker runner wrapper as production, demo, cluster, or release path.
7. Runtime, API, UI, or route aliases for `/notebook` or `/agents`.
8. Role-name authorization, invented permission tokens, hook-short-circuit permission checks, unvalidated route params, or silent provider downgrade.

Non-goals: low-code agent builder, generic infrastructure operations console, multi-workload runner abstraction, file-level policy expansion, independent Chat/Agent quota model, hosted shell outside Agent task scope, E2E coverage that pretends to verify backend authorization, and removal of Docker/Compose/K8s infrastructure unrelated to external runner deploy/runtime.

## Appendix: Scope Inventory / Legacy Boundaries

This inventory guides audit scope; updated contracts remain the source of truth.

| Scope | Target areas | Legacy boundary |
| --- | --- | --- |
| Contracts | `product-terminology`, `auth-permission-model`, frontend/backend matrix, route gate checklist, Chat/Agent task/Agent Runner module maps, API guide, API entry map, agent execution protocol, OpenAPI/AsyncAPI, route kind map, deployment/address truth | Old Notebook/Agents contract files are retired or archived, not active aliases. |
| Frontend UI | active `chat`, `agent-tasks`, `agent-runners` routes/components, route policy manifest, messages, mocks, visual/e2e fixtures, project navigation | Old route names, namespaces, test ids, and copy are blockers when visible or active. |
| Backend runtime | API entry handlers, Chat resource/service, task model/store/run coordination/terminal, Agent Runner profiles, project authz, generated API types | Old fields may exist only in one-shot cleanup/assertion evidence, archived evidence, or negative tests and must be unreadable by active runtime. |
| Runner packages | `packages/agent-runner`, task runner package, builtin skills, terminal/session/workspace/artifact modules | Public exports are task-only even if private filenames still mention old terms during cleanup. |
| Deployment/gates | `infra/deploy/demo`, `infra/deploy/cluster`, `infra/runner`, deploy scripts, contract/governance scans, workflows, `package.json`, `Makefile` | External runner deploy/runtime is gone; Docker infrastructure for retained platform paths stays. |
| Docs/evidence | user guides, troubleshooting, local runtime docs, audit/usage reports, release evidence | Legacy language is allowed only when explicitly negative, forbidden-scan, one-shot cleanup/assertion, audit evidence, or archived. |
