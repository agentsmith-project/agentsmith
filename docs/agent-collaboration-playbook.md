# Agent Collaboration Playbook (Contract-First, Documentation-Synchronized)

## 1. Purpose

This document defines a reusable engineering workflow for human + LLM agent collaboration.

Goals:
- Keep delivery fast while preventing architectural drift.
- Keep code, tests, and documentation synchronized.
- Use explicit API/interface contracts to constrain frontend/backend evolution.
- Reduce handoff risk across sessions and across different agents.

This playbook is domain-agnostic and can be adopted by any software project.

## 2. Core Principles

- Contract-first: Design or update API/interface contracts before or with implementation changes.
- Single source of truth: Canonical docs must be updated in place; avoid parallel or temporary truth sources.
- Fast failure: Do not add long-lived compatibility fallbacks that hide integration issues.
- Small-step delivery: Prefer incremental, reversible commits over large opaque rewrites.
- Verification-driven progress: Each meaningful change must include explicit checks.
- Documentation as runtime control: Docs are not commentary; they constrain behavior and implementation boundaries.

## 3. Collaboration Protocol (Human ↔ Agent)

### 3.1 Task handshake

At the start of each task, align on:
- Objective and explicit success criteria.
- In-scope and out-of-scope boundaries.
- Constraints (time, quality bar, architecture rules, forbidden patterns).
- Expected evidence of completion (tests, logs, docs, contract checks).

### 3.2 Execution rhythm

Use this loop repeatedly:
1. Explore current state with non-destructive inspection.
2. Implement one coherent slice.
3. Validate with targeted tests/checks.
4. Commit with a precise message.
5. Update canonical docs immediately.
6. Report outcome and next step.

### 3.3 Communication style

- Progress updates are short and factual.
- State what is being changed, why, and what was validated.
- Highlight uncertainty early.
- Prefer explicit tradeoff statements over implicit assumptions.

## 4. Contract-First Engineering Model

### 4.1 Required contract layers

Maintain explicit contracts for:
- External APIs (routes, methods, payload schema, status codes, error codes).
- Internal module interfaces (public exports, ownership boundaries).
- Runtime semantics (state machines, lifecycle events, idempotency behavior).
- Operational semantics (timeouts, retries, observability fields).

### 4.2 Contract update triggers

Update contracts whenever any of the following changes:
- API path, request, or response shape.
- State transition behavior.
- Error semantics.
- Pagination/defaults/bounds.
- Security/auth behavior.
- Cross-module responsibility boundaries.

### 4.3 Canonical contract management

- Keep one canonical contract document per concern.
- Merge temporary notes into canonical docs quickly.
- Delete temporary tracking docs after merge.
- Ensure tests and implementation reference canonical behavior, not ad hoc notes.

## 5. Documentation Synchronization Discipline

### 5.1 Non-negotiable rule

A code change that alters behavior is incomplete without doc updates.

### 5.2 Sync sequence

For each behavior-affecting change:
1. Update or add contract/module-map docs.
2. Update test scope docs/runbooks if execution or assertions changed.
3. Confirm no stale docs remain that conflict with current behavior.
4. Commit doc changes either with code or immediately after as a dedicated commit.

### 5.3 Documentation categories

Use a clear split:
- Contract docs: API and runtime semantics.
- Module-map docs: file/module ownership and extension guardrails.
- Runbooks: how to run/verify/debug.
- Temporary notes: short-lived and mandatory merge/delete lifecycle.

## 6. Implementation Strategy

### 6.1 Refactoring pattern

For large files or mixed concerns:
- Extract pure logic first (formatters, mappers, builders).
- Extract UI or adapter components next.
- Extract orchestration hooks/services last.
- Keep entrypoint/page/controller files focused on wiring.

### 6.2 Boundary rules

- Business logic belongs in domain/use-case/service/hook layers.
- Presentation components should be mostly stateless or locally stateful.
- Entrypoints should orchestrate, not embed heavy logic.
- Error mapping should be centralized, not repeated in handlers.

### 6.3 Anti-patterns to avoid

- Large fallback matrices that mask contract breaks.
- Silent behavior changes without contract updates.
- Massive single commits across many concerns.
- “Temporary” files left as permanent truth.

## 7. Testing and Verification Policy

### 7.1 Test pyramid per change

- Unit tests: pure logic and state transformation rules.
- Integration/API tests: contract semantics and error behavior.
- End-to-end tests: key user/runtime flows and recovery scenarios.

### 7.2 Required evidence per slice

Each slice should include:
- Type check pass.
- Lint pass.
- Targeted tests for touched behavior.
- Optional broader suites when risk is high.

### 7.3 Contract-sensitive scenarios

Prioritize tests for:
- Recovery after refresh/reconnect.
- Idempotent stop/cancel/retry paths.
- Pagination boundaries and invalid inputs.
- Concurrency invariants.
- Permission-denied and validation-error paths.

## 8. Commit and Branch Workflow

### 8.1 Branch policy

- Use focused feature/refactor branches.
- Keep branch intent narrow and explicit.

### 8.2 Commit policy

Prefer many small commits with clear scope:
- `refactor(...)`: structural change without behavior change.
- `test(...)`: added/updated verification.
- `docs(...)`: contract/runbook/module-map updates.

### 8.3 Commit ordering for trust

Typical sequence:
1. Structural refactor commit.
2. Test coverage commit.
3. Documentation synchronization commit.

This ordering makes review and rollback straightforward.

## 9. Session Continuity Across Agents

### 9.1 Handoff bundle

At handoff, provide:
- Current branch and cleanliness status.
- Last meaningful commits and intent.
- Remaining backlog with priority labels.
- Validation already executed and pending.
- Known risks/open decisions.

### 9.2 Session-safe defaults

- Assume context may be lost between sessions.
- Keep decisions recorded in canonical docs, not chat memory.
- Treat docs as the continuity backbone.

## 10. Practical Checklists

### 10.1 Before implementation

- Objective and success criteria are explicit.
- Contract impact identified.
- Existing module boundaries understood.
- Validation plan selected.

### 10.2 Before each commit

- Scope is single-concern.
- Tests for touched behavior pass.
- Contract/docs updated if needed.
- Commit message reflects intent precisely.

### 10.3 Before declaring done

- No temporary docs left unmerged.
- Canonical docs reflect final behavior.
- Working tree is clean.
- Next-step backlog is explicit.

## 11. Recommended Minimal Artifact Set

Maintain at least:
- `AGENTS.md` (execution rules and constraints).
- Contract index and canonical contract docs.
- Module-map docs for critical subsystems.
- Verification runbook.
- Temporary backlog doc template with mandatory merge/delete policy.

## 12. Operating Philosophy

The highest-leverage pattern is:
- strict contracts,
- strict synchronization between code/tests/docs,
- small verified increments,
- and explicit module boundaries.

This combination consistently improves delivery speed, reduces regressions, and enables safe multi-agent collaboration.
