# Notebook Run UX Rearchitecture Plan (MVP)

Date: 2026-03-06  
Scope: AgentSmith (frontend + api-entry-node + agent-codex-runner)  
Status: Ready for implementation

## 1. Background and Problem

Current notebook interaction has three user-facing gaps:

1. Users cannot reliably understand what the agent is doing in each run.
2. Running/completed/failed states are not explicit enough in the conversation bubble and page-level status.
3. While an agent turn is active, new user input behavior is unclear (queue semantics not first-class).

Additionally, advanced users request optional visibility into agent reasoning/diagnostic output (stderr-like streams), but this must remain low-noise by default.

## 2. Product Goals

1. **State clarity**: every run has explicit, visible lifecycle state.
2. **Completion clarity**: every run ends with a clear summary card.
3. **Low cognitive load**: default view is concise; deep internals are opt-in.
4. **Actionable debugging**: failures/stalls provide concrete reason and next action.
5. **Contract-first**: FE does not infer semantics from raw Codex lines.

## 3. Non-Goals (this phase)

1. Persistent long-term trace archival redesign.
2. New billing/governance dimensions beyond existing endpoint controls.
3. Full replay debugger.

## 4. Canonical Run State Model

Each user message maps to one run (`run_id`) with lifecycle:

`queued -> dispatching -> running -> streaming -> completed|failed|cancelled`

Rules:

1. `completed|failed|cancelled` are terminal.
2. UI must show exactly one current state per run.

## 5. Runtime Event Contract (unified envelope)

Introduce normalized task events consumed by FE:

1. `run.lifecycle`
2. `run.step`
3. `run.output`
4. `run.summary`
5. `run.error`

### 5.1 `run.lifecycle`

Required fields:

- `run_id`, `message_id`, `at`
- `phase`: queued|dispatching|running|streaming|completed|failed|cancelled
- `status`: running|success|error|cancelled
- `summary` (short text)

### 5.2 `run.step`

Required fields:

- `run_id`, `message_id`, `at`
- `kind`: tool|command|file|reasoning|network
- `title`
- `status`: running|success|error

Optional:

- `details` (structured object)

### 5.3 `run.output`

Required fields:

- `run_id`, `message_id`, `at`
- `channel`: assistant_text|reasoning|stderr|stdout
- `chunk`

### 5.4 `run.summary`

Required fields:

- `run_id`, `message_id`, `at`
- `final_status`: success|error|cancelled
- `duration_ms`
- `step_count`
- `tool_calls`
- `artifacts_count`

Optional:

- `token_usage`

### 5.5 `run.error`

Required fields:

- `run_id`, `message_id`, `at`
- `code`
- `message`
- `retryable`

Optional:

- `hint`

## 6. Runner-side Refactor (agent-codex-runner)

Add a normalization module between Codex raw stream and runtime protocol:

1. Parse codex item lifecycle (`item.started/updated/completed`).
2. Group command execution into one step track (start->update->end).
3. Emit `run.summary` once per terminal state.
4. Redact sensitive values in raw output channels.

Redaction minimum:

- bearer/api keys
- refresh/access tokens
- credential-like URL params

## 7. API/SSE Integration (api-entry-node)

1. Accept normalized events from runner as first-class trace records.
2. Preserve event ordering by `(run_id, seq)`.
3. Emit synthetic terminal lifecycle/error event if stream dispatch fails before any run event.
4. Keep task as reusable conversation container; terminal events close run, not task.

## 8. Frontend UX Rebuild (not patch)

## 8.1 Components

Refactor notebook message presentation into:

1. `RunStatusBar`
2. `RunTimeline`
3. `RunSummaryCard`

`MessageItem` becomes orchestration container only.

## 8.2 Visual priorities

1. Primary status pill (queued/running/completed/failed).
2. Per-run summary card at end.
3. Expandable timeline with steps.
4. Optional raw panel.

## 8.3 “Thinking visibility” controls

Two-level control:

1. User preference (profile): `hidden|summary|detailed|raw` (default `hidden`)
2. Task session override (toolbar toggle)

Behavior:

- `hidden`: no reasoning/raw output in bubble.
- `summary`: only structured step summaries.
- `detailed`: step details + reasoning channel summary.
- `raw`: show raw output panel (still redacted).

## 9. Pending Queue UX (input while busy)

When current run is non-terminal:

1. Send action enqueues message.
2. Queue panel shows pending items with order index.
3. User can edit/remove/reorder pending items.
4. Queue auto-drains when active run reaches terminal state.

## 10. Failure UX

1. If runner process is still alive, UI keeps `running` status and displays elapsed time + latest action summary.
2. On `failed`, show concise reason + retry guidance.
3. Remove oversized intrusive banners; keep inline and toast-level feedback.

## 11. Data & Storage Changes

1. Add `user_preferences` field(s) for thinking visibility default.
2. Extend task trace event schema for normalized run envelopes.
3. No compatibility fallback required for deprecated raw-only display path (`fail-fast`).

## 12. Contracts to Update

1. `docs/contracts/agent-runtime-protocol.md`
2. `docs/contracts/notebook-frontend-module-map.md`
3. OpenAPI/AsyncAPI snapshots for notebook task event payloads
4. i18n keys under `notebook.conversation` and profile/settings namespace

## 13. Test Matrix

## 13.1 Unit

1. Runner normalizer: codex raw -> `run.*` mapping.
2. FE status derivation: all lifecycle transitions.
3. Pending queue reducer: enqueue/edit/remove/reorder/drain.
4. Thinking visibility rendering gates.

## 13.2 Integration

1. SSE ordering under reconnect/gap-fill.
2. synthetic terminal event on dispatch failure.
3. long-running turn keeps `running` semantics until terminal event.

## 13.3 E2E smoke

1. Normal run ends with summary card.
2. Busy-time send enters queue and later auto-sends.
3. Toggle thinking visibility mid-session.
4. Failure run surfaces actionable inline state.

## 13.4 Visual

1. Status pill variants.
2. Summary card success/error variants.
3. Queue panel with edit mode.

## 14. Rollout Plan

1. Phase A: contract + runner normalizer + backend event plumbing.
2. Phase B: FE component refactor + queue UX + visibility toggles.
3. Phase C: test gates + docs sync + release evidence.

## 15. Acceptance Criteria (DoD)

1. Users can always identify current run state within 1 glance.
2. Every terminal run shows summary card with duration + outcome.
3. Default UX stays concise; advanced diagnostics are opt-in.
4. Busy-time input is queued with editable pending list.
5. Failures/stalls provide clear inline explanation and action.
6. Contract/tests/docs are all updated and passing.
