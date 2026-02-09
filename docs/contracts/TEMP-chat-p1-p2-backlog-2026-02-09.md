# TEMP DOC - Chat P1/P2 Remaining Backlog (Temporary)

> Temporary working note. This file is for short-term tracking and should be merged into formal docs later.

## Scope
- Module: chat runtime + API contracts + integration verification
- Goal: keep architecture session-first + stream-granular, with recoverability after refresh/switch

## P1 (High Priority)

1. Add E2E for stream recovery after refresh/switch
- Status: partial (API-level coverage done, browser-level E2E pending)
- Verify `GET /chat/sessions/{sessionId}/streams` can recover active `stream_id`.
- Verify stop works after refresh when frontend had no in-memory `stream_id`.
- Cover both stop paths:
  - session-level stop (`/sessions/{sessionId}/stop`)
  - stream-level stop (`/messages/streams/{streamId}/stop`)

2. Enforce and document stream concurrency invariant
- Status: done
- Decide and enforce one of:
  - single active stream per session (current practical behavior), or
  - multi-active streams per session (future mode)
- Add explicit checks in `api-entry-node` tests and contract docs.
- If multi-active is deferred, fail fast with deterministic error when violated.

3. Fix integration script route contract drift
- Status: done
- `scripts/integration-test.sh` currently has route assertions that can produce false negatives.
- Align paths and labels with current route contract and fixtures.
- Ensure script reflects actual runtime assumptions (project id, locale route behavior, page existence).

4. Add API-level contract test for `chat/sessions/{id}/streams`
- Status: done
- Cases:
  - returns active streams while running
  - returns empty after completion/stopped
  - 404 for unknown session

## P2 (Important)

1. Split oversized chat entry file (`packages/api-entry-node/src/index.ts`)
- Extract route matching, chat handlers, endpoint proxy handlers, auth/middleware, and stream runtime helpers into separate files.
- Keep `index.ts` as composition/bootstrap only.

2. Split oversized chat page file (`src/app/.../chat/page.tsx`)
- Extract concerns:
  - stream orchestration hook
  - thread/session management hook
  - message branch/variant state hook
  - attachment upload orchestration hook
- Keep page component focused on wiring + layout.

3. Add observability fields for stream lifecycle
- Status: done
- Standardize logging fields:
  - `workspace_id`, `project_id`, `session_id`, `stream_id`, `endpoint_id`, `status`, `duration_ms`.
- Ensure stop reason is explicit (`user_stop`, `session_stop`, `upstream_error`, `timeout`).

4. Tighten pagination defaults consistency
- Status: done
- Align FE request defaults and BE defaults for sessions/messages.
- Add tests for boundary cases (`page=0`, `page_size>max`, invalid query types).

5. Merge temporary docs into formal contract docs
- Move this file’s accepted items into:
  - `docs/contracts/cf-private-hybrid-architecture-guide-v1.md`
  - route/test runbook docs where appropriate
- Remove temporary file after merge.

## Done recently (for context)
- Added session-level stop API.
- Added recoverable stream discovery API (`GET .../sessions/{sessionId}/streams`).
- Updated chat contract docs with dual control semantics.
