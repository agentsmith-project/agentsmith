# Internal Agent Terminal Pod Lifecycle Analysis v1

Last updated: 2026-04-23  
Status: `decision_required_analysis`

> Stop: this is an engineering analysis for terminal/pod lifecycle decisions, not a current implementation plan.
> Do not start the suggested phases directly from this document. Current implementation truth remains in the contracts
> listed below and the code they reference; reopen this analysis only after a product/engineering decision records the
> intended terminal lifecycle model.

> Historical naming note: this analysis predates the ASBCP naming cleanup.
> Older sandbox execution owner wording here refers to the internal sandbox
> execution service now named `agentsmith-sandbox-control-plane` (ASBCP), and
> must not be used as active env, Kubernetes identity, or source-build guidance.

## 1. Scope

This document summarizes the current implementation truth of AgentSmith internal-agent terminal mode, evaluates whether the current pod reclamation behavior matches the product model, and records decision options for the development team.

This is an engineering analysis document. It is not an authoritative product contract and does not replace:

- `docs/contracts/agent-execution-protocol.md`
- `docs/contracts/notebook-frontend-module-map.md`
- `docs/contracts/auth-permission-model.md`

## 2. Executive Summary

Current behavior is only partially aligned with the intended product model.

What is already correct:

- internal workloads are bounded by explicit `idle_timeout_sec` and `max_lifetime_sec`
- notebook runs and terminal sessions do not leak unbounded server-side capacity
- live terminal sessions explicitly block notebook runs and task deletion
- terminal access is governed by its own permission scope: `project:terminal:use`

What is not fully aligned:

- the system does not currently define one clear lifecycle owner for an internal task pod
- notebook runs actively keep the pod alive, but terminal mode does not
- terminal session lifetime, task lifetime, and pod lifetime are governed by different timers that are not structurally unified
- the current behavior can produce a user-visible mismatch: a terminal session may still be considered conceptually open while the underlying pod is reclaimed by substrate policy

Bottom line:

- the current design is acceptable as a conservative substrate-protection mechanism
- it is not yet a fully coherent product-grade lifecycle model for a first-class terminal feature

## 3. Current Implementation Truth

### 3.1 Pod creation and substrate limits

Internal agent pods are created through `InternalAgentPodManagerImpl.ensureAgentReady()`.

Relevant implementation:

- `packages/api-entry-node/src/internal-agent-pod-manager.ts`
- `packages/contracts/src/index.ts`
- `packages/api-entry-node/src/agent-route-handler.ts`

Current defaults and minimums:

- `INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS = 300`
- `INTERNAL_AGENT_MAX_LIFETIME_DEFAULT_SECONDS = 3600`
- `INTERNAL_AGENT_IDLE_TIMEOUT_MIN_SECONDS = 180`
- `INTERNAL_AGENT_MAX_LIFETIME_MIN_SECONDS = 600`

When the pod is created, AgentSmith passes both values to ASBCP:

- `idle_timeout_sec`
- `max_lifetime_sec`

This means substrate-level reclamation is an explicit part of the design, not an accident.

### 3.2 Notebook run lifecycle

Notebook execution starts the internal workload and then actively keeps it alive.

Relevant implementation:

- `packages/api-entry-node/src/notebook-execution-orchestrator.ts`

Current behavior:

- notebook run calls `internalAgentPodManager.ensureAgentReady(...)`
- after dispatch succeeds, notebook run starts a repeating keepalive timer
- keepalive interval is based on `INTERNAL_AGENT_KEEPALIVE_INTERVAL_SECONDS = 60`

This means notebook run is currently a formal lifecycle holder of the pod.

### 3.3 Chat lifecycle

Chat internal execution follows the same substrate pattern as notebook runs.

Relevant implementation:

- `packages/api-entry-node/src/chat-stream-handler.ts`

Current behavior:

- internal chat ensures the pod is ready
- active chat streaming also issues pod keepalive

This means chat also acts as a formal lifecycle holder of the pod during active work.

### 3.4 Terminal session lifecycle

Terminal mode is implemented as a separate session model.

Relevant implementation:

- `packages/api-entry-node/src/task-route-handler.ts`
- `packages/api-entry-node/src/notebook-terminal-service.ts`
- `packages/api-entry-node/src/agent-execution-service.ts`

Current behavior:

- creating a terminal session for an internal agent first ensures the internal pod is ready
- terminal session state is tracked in `NotebookTerminalService`
- live terminal sessions block notebook runs on the same task
- live terminal sessions block task deletion
- terminal service itself does not issue pod keepalive through `internalAgentPodManager.keepalive(...)`

This is the most important implementation asymmetry in the current design.

### 3.5 Terminal session timers

Terminal sessions have their own runtime protection timers inside `AgentExecutionService`.

Current defaults:

- terminal first-event timeout: `45s`
- terminal idle timeout: `30min`
- terminal max runtime: `24h`

Relevant implementation:

- `packages/api-entry-node/src/agent-execution-service.ts`
- `docs/contracts/agent-execution-protocol.md`

These timers protect server-side terminal capacity, but they do not structurally own the sandbox pod.

### 3.6 Task semantics

Current tests and contracts establish the following product truth:

- a task is a reusable working container
- live terminal sessions block new notebook runs
- live terminal sessions block task deletion
- after the last terminal session ends, the task becomes usable again

Relevant references:

- `packages/api-entry-node/src/__integration__/notebook-tasks.integration.test.ts`
- `docs/contracts/notebook-frontend-module-map.md`

Important nuance:

- current implementation clearly releases task-level blocking after terminal sessions end
- current implementation does not clearly establish that “last terminal session ended” is the authoritative moment to release the internal pod

## 4. Findings

### Finding 1: lifecycle ownership is split across three different models

There are currently three different lifecycle models in play:

1. product-facing terminal session lifecycle
2. AgentSmith execution-layer terminal pending/idle/max-runtime lifecycle
3. ASBCP pod idle/max-lifetime lifecycle

These three models are related, but not unified.

Impact:

- the user thinks in terms of “my terminal is still open”
- the execution layer thinks in terms of “my terminal stream is still valid”
- the substrate thinks in terms of “this pod has reached idle or absolute lifetime”

This is a design smell for a control-plane product because the same user-visible object is backed by multiple unsynchronized authority sources.

### Finding 2: notebook/chat formally hold pod liveness, terminal currently does not

Notebook and chat explicitly call sandbox keepalive.

Terminal currently does not.

Impact:

- notebook/chat behavior is closer to a true lease-based runtime model
- terminal behavior is closer to “best effort until substrate policy wins”

This inconsistency is hard to justify once terminal mode is a first-class feature instead of a diagnostic add-on.

### Finding 3: timer values are semantically inconsistent

Current defaults imply:

- pod idle default: `5 min`
- pod max lifetime default: `1 h`
- terminal idle default: `30 min`
- terminal max runtime default: `24 h`

This means the terminal object is allowed to conceptually outlive the pod by a large margin.

Impact:

- the product surface may present terminal as a durable working context
- the substrate can reclaim the actual execution environment much earlier

Even if ASBCP internally refreshes activity based on runner behavior, that is not expressed as an AgentSmith contract and therefore remains a hidden coupling.

### Finding 4: current behavior is safer for infrastructure than for product coherence

The present strategy strongly protects cluster hygiene:

- pods are bounded
- server maps are bounded
- stale terminal sessions are cleaned up

This is good infrastructure discipline.

But product-grade terminal behavior requires more than safety:

- users need predictable terminal continuity semantics
- developers need one clear lifecycle truth
- operators need an explainable recovery model

Current behavior optimizes for substrate safety first, and product coherence second.

### Finding 5: “last terminal session released” is task truth, not clearly pod truth

The integration tests validate task-level unblocking after the last terminal session ends.

They do not clearly establish a product contract that says:

- when the last live terminal session ends
- and there is no active notebook/chat holder
- the internal workload must be explicitly released immediately

Today, that outcome appears to be mostly delegated to substrate timeout policy unless task archive/delete happens.

## 5. Product and Best-Practice Assessment

### 5.1 Does the current design fit AgentSmith product logic?

Partially.

It fits the product logic in these ways:

- AgentSmith is a control-plane product, so bounded runtime resources are correct
- internal execution should never be permanently pinned by forgotten browser tabs
- task, run, and terminal are distinct product objects, which is correctly reflected in the API

It does not fully fit the product logic in these ways:

- terminal is now a real user-facing work mode, not merely an internal transport detail
- a first-class work mode should have a first-class runtime ownership model
- the current design still treats pod lifetime as primarily run-oriented, not terminal-oriented

### 5.2 Does the current design match best-practice product behavior?

Not fully.

Best practice for a first-class terminal feature is usually:

- define a single workload ownership model
- make all runtime holders explicit
- treat substrate TTLs as safety rails, not the main product truth

For AgentSmith, the most coherent holder model would be:

- `notebook_run:<run_id>`
- `chat_stream:<session_id>`
- `terminal_session:<terminal_session_id>`

As long as at least one holder exists, the workload remains alive by product truth.

When the last holder disappears, AgentSmith explicitly releases the workload.

In that model:

- ASBCP `idle_timeout_sec` and `max_lifetime_sec` still exist
- but they act as substrate guardrails and failure containment
- they do not silently replace the product lifecycle contract

## 6. Risks If Left Unchanged

### Product risks

- terminal users may observe session breakage that feels arbitrary
- UI semantics and runtime semantics can drift apart
- future UX work around “reconnect”, “resume shell”, or “long-running terminal workflow” will remain fragile

### Engineering risks

- more edge cases around reload, reconnect, and pod replacement
- hard-to-debug bugs where terminal is “alive” in one subsystem and “gone” in another
- ad hoc fixes may accumulate separately in API, runner, and substrate layers

### Operational risks

- support incidents become difficult to explain
- operators cannot clearly answer “why was this pod reclaimed while the terminal still existed?”
- troubleshooting depends too much on substrate-specific behavior

## 7. Recommended Follow-Up Work

### Recommendation 1: introduce an explicit workload-holder model

Define one shared internal workload ownership abstraction for task-scoped workloads.

Suggested holders:

- notebook run
- chat stream
- terminal session

Required outcome:

- workload stays alive while at least one holder exists
- workload release is explicit when the last holder is removed

This is the most important structural fix.

### Recommendation 2: align terminal semantics with pod semantics

Terminal should either:

- explicitly participate in pod keepalive while it is a live holder

or

- be contractually documented as a short-lived substrate-bounded shell that may be reclaimed independently

The first option is more coherent for a first-class terminal feature.

The second option is acceptable only if the UI and product copy clearly communicate the limitation.

### Recommendation 3: unify timeout policy by design intent

Current timeout families should be intentionally aligned:

- terminal idle
- terminal max runtime
- pod idle
- pod max lifetime

They do not have to be equal, but they should reflect a documented product policy.

Example of a coherent policy:

- terminal live holder refreshes pod idle
- terminal idle timeout is shorter than pod max lifetime
- pod max lifetime remains the hard safety rail

### Recommendation 4: document terminal continuity semantics explicitly

The contract should answer:

- if browser disconnects, what grace window exists?
- if the page reloads, can terminal reconnect?
- if terminal stays idle, when does it close?
- if pod hits max lifetime, what user-visible terminal state should appear?

Without this, implementation details will continue to leak into product behavior.

### Recommendation 5: add lifecycle acceptance tests at the workload level

Add tests that verify the full holder model, not just task-blocking behavior.

Examples:

- terminal live holder prevents pod reclamation during allowed lifetime
- last terminal holder removed triggers explicit workload release
- notebook run and terminal holder coexist with clear precedence
- pod max lifetime produces deterministic terminal failure state and recoverable UX

## 8. Decision-Gated Delivery Reference

This section is only a reference for a future approved lifecycle change. It is not a current marching order.

### Reference step 1: contract and model clarification

- define the authoritative workload-holder model
- decide whether terminal is a formal pod holder
- define expected behavior for idle, disconnect, and absolute lifetime

### Reference step 2: backend lifecycle convergence

- implement shared holder registration/release
- route notebook/chat/terminal through the same workload ownership layer
- make explicit release happen when the last holder is removed

### Reference step 3: UX and recovery alignment

- ensure terminal UI exposes the correct lifecycle semantics
- show deterministic reasons for terminal closure or reclaim
- make reconnect/reopen behavior match backend truth

### Reference step 4: governance and regression coverage

- add contract tests
- add integration coverage for workload holder transitions
- add backend-real smoke scenarios for internal terminal lifecycle

## 9. Open Questions Requiring Product/Engineering Decision

1. Is terminal mode intended to be a first-class long-lived work surface, or a short-lived debugging surface?
2. Should a live terminal session formally own pod liveness?
3. Should task-scoped internal workloads be explicitly released when the last holder ends?
4. Is `max_lifetime_sec` intended to be visible as a user-facing terminal boundary, or only an operator safety rail?

These questions should be answered before implementation work begins, otherwise engineering will continue optimizing local symptoms rather than converging the runtime model.

## 10. Final Assessment

Current design is defensible as a conservative infrastructure-first implementation.

It is not yet the cleanest product-grade model for a first-class internal terminal capability.

The core issue is not “missing timeout tuning”.  
The core issue is that AgentSmith has not yet fully defined who owns internal task workload lifetime once terminal becomes a real product surface.

The recommended direction is:

- move from timer-centric incidental behavior
- toward explicit workload-holder truth owned by AgentSmith

That direction best matches the project’s control-plane philosophy, contract-first engineering method, and long-term maintainability goals.
