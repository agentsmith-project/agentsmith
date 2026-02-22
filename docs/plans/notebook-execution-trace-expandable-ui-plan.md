# Notebook Message Expandable Execution Details Plan (Codex / External Agent)

Last updated: 2026-02-22
Owner: Product + Frontend + Backend

## Summary

Goal: make Notebook task messages behave like a "deep research" UI:

- default view stays simple (final answer first)
- each agent message can expand to show execution details (steps/tools/errors/progress)
- backend and runner send structured execution telemetry
- frontend decides whether/how to present that telemetry

## Product Decisions (locked)

- Default UX: compact status + expandable details
- Retention: execution details are tied to each agent message and should be persisted (MVP may use in-memory storage in local backend)
- Detail scope: steps, tool logs, progress, warnings/errors, artifacts; no model reasoning text by default

## MVP Scope (Phase 1)

### Runtime/Runner
- Add `agent.response.event` WS frame (structured execution event)
- Keep existing `agent.response.delta/done/error` frames for compatibility
- Emit minimal trace events from:
  - codex stdout JSON lifecycle events
  - stderr warnings/errors (sanitized)
  - runner process lifecycle (start/timeout/cancel/close)

### Backend (api-entry-node)
- Accept and validate `agent.response.event`
- Forward it through runtime stream (`type: "event"`)
- Bind notebook trace events to current `assistantMessage.id` + `run_id`
- Emit `trace_event` in task SSE
- Store task trace events in memory with cap and truncation warning

### Frontend (Notebook)
- Extend `useTaskSSE` to consume `trace_event`
- Aggregate trace events by `message_id`
- Add expandable execution details panel on `MessageItem`
- Default collapsed; show status summary line in the message bubble
- Keep compatibility with existing Codex JSON-text decoding for old messages

## Core Data Contracts

### Agent Runtime WS (agent -> server)
`agent.response.event` payload:

```json
{
  "sequence": 1,
  "at": "2026-02-22T00:00:00.000Z",
  "category": "progress",
  "phase": "start",
  "status": "running",
  "name": "codex.exec",
  "summary": "Starting Codex execution",
  "details": {}
}
```

### Task SSE (server -> frontend)
`trace_event` payload shape:

- `id`
- `task_id`
- `message_id`
- `run_id`
- `seq`
- `at`
- `category`
- `phase?`
- `status?`
- `name`
- `summary`
- `details?`

## Security / Safety Requirements

- Never send tokens/credentials to frontend in trace details
- Sanitize stderr and command details server-side (runner first, backend defensive)
- Treat trace details as task-level protected data (same permission boundary as task messages)

## Reliability Requirements

- Execution details are bound to `message_id`, not task-global UI state
- Running state should rely on run terminal events (success/error/cancelled), not only `task_update`
- SSE reconnect must not silently drop all execution details (MVP can replay in-memory traces on connect; later add event-id replay and/or traces REST)

## Test Matrix (MVP)

- Runner emits `agent.response.event` with valid schema
- Runtime service parses and forwards `event`
- Notebook task path emits `trace_event` SSE bound to the correct `assistantMessage.id`
- Frontend renders expandable execution details for an agent message
- Multi-turn task: traces do not cross messages
- Input disabled while current run is active; re-enabled when run finishes

## Phase 2 / 3 (not part of MVP implementation)

- Persist traces in DB
- `GET /tasks/{taskId}/traces` REST API
- SSE `Last-Event-ID` replay for traces/messages
- Trace aggregation UI polish (step folding, duration, filters, raw/debug view)
