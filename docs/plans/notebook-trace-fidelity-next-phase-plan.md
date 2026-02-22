# Notebook Execution Trace Fidelity (Codex CLI-Oriented) Next Phase Plan

## Goal

Keep Notebook execution details as close as possible to Codex CLI console output while preserving Notebook UX:

- default: result-first, complexity hidden
- optional: expandable execution details
- detail view: high-fidelity trace/events, not rewritten semantics

## Product Direction

The execution detail panel is a "workbench" view, not a summarized AI narrative.

Design principles:
- Preserve original event semantics
- Improve readability without changing meaning
- Keep raw view always available
- Make debugging fast (copy/export/filter)

## Scope (P0/P1/P2)

### P0 (implement first)
- Timeline / Raw view toggle inside message trace panel
- Copy trace logs (current message loaded range) to clipboard
- Keep existing pagination / loading / empty states

### P1
- Local filtering (`all`, `progress`, `tool`, `warning/error`, `debug`)
- Panel summary stats (event count, duration, truncated state)
- Error highlighting + jump to first error

### P2
- Persistent traces in DB
- Export trace logs (JSON / text)
- Optional stdout/stderr console-style sub-view (in addition to structured events)

## Technical Notes

### Frontend
- Add view mode switch in `MessageItem` trace panel (`timeline` / `raw`)
- Reuse same `traceEvents` source; only presentation differs
- Raw view shows event fields directly: `at`, `seq`, `category`, `phase`, `status`, `name`, `summary`, `details`
- Add `Copy trace logs` action using `navigator.clipboard`

### Backend / Runner
- Continue preserving sanitized `details` payloads
- Prefer carrying source/original event type fields in `details` (when safe)
- Do not move filtering/sanitization to frontend

### Security
- Preserve server-side sanitization as mandatory
- Do not expose tokens, credential values, or full env dumps in `details/raw`

## Docs / Contracts
- Keep `docs/agent-codex-notebook-runbook.md` updated with trace panel capabilities
- Keep `docs/contracts/agent-runtime-protocol.md` aligned with `agent.response.event`
- If generated OpenAPI/AsyncAPI specs do not yet include notebook task routes, document scope limitations and maintain a notebook traces contract supplement in `docs/contracts/specs/`

## Acceptance Criteria
- User can switch between Timeline and Raw trace views for a message
- User can copy current message trace logs as JSON
- Existing trace pagination (`Load earlier logs`) still works
- Unit tests cover view toggle + copy action
- Runbook and contract docs reflect implemented behavior
