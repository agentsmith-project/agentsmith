# Governance Real-Backend Phase 2 Plan (Post-RC)

## Current Status (What is already done)

### Mainline (Notebook / Agent / Files / InputRefs)

Release-critical closure is complete for the current internal release target:

- demo bootstrap / readiness / release smoke toolchain available
- Notebook + external agent mainline is stable and demoable
- input refs / artifact loop smoke included in release bundle
- governance smoke is bundled and token-expiry tolerant

Conclusion:
- There is no obvious remaining **mainline release blocker** for the current internal RC.

## Remaining Work (Non-blocking for current RC)

### Governance real-backend depth (Phase 2 focus)

- `Resource Policy` enforcement is still partial
  - only baseline allow-list and selected endpoint limits are enforced
  - agent governance currently focuses on access + request rate; token quota is endpoint-only
  - broader `rate_limits` / `quota_limits` across resource types are pending
- `Members` lifecycle / permission closure is still partial
  - backend authz integration is partial
  - richer membership lifecycle / suspension / revoke paths need hardening

### Platform / release hardening (accepted for internal release, still pending)

- SSE ticket-based auth exchange (replace JWT-in-query fallback)
- multi-instance runtime coordination (or formal sticky-routing deployment requirement enforcement)

## Phase 2 Goals

1. Expand real runtime enforcement coverage of governance config
2. Close member permission/lifecycle behavior gaps in backend + UI flows
3. Preserve release confidence by extending real-backend smoke coverage

## Scope (P0 / P1 / P2)

### P0 (recommended next sprint)

- Resource Policy: expand endpoint enforcement coverage beyond current baseline
  - enforce additional `rate_limits` / `quota_limits` fields used by UI/config
  - ensure enforcement behavior is visible in `Audit` / `Usage`
- Members: close lifecycle baseline
  - suspension / restore behavior (if UI exposes it)
  - revoke membership behavior and downstream effect validation
- Smoke: add/extend real-backend governance effect scenarios
  - member permission effect
  - member quota effect
  - policy restore/rollback assertions

### P1

- Resource Policy subject matching refinements
  - group + user precedence/merge semantics documented and tested
- Members authz model consistency
  - align route authz behavior with UI expectations and template/custom overrides
- Governance page UX hardening
  - consistent empty/loading/error states for remaining partial pages in real backend mode

### P2

- SSE ticket-based auth for streaming (remove JWT query fallback for non-internal release)
- deployment/runtime coordination improvements for multi-instance notebook runtime

## Delivery Strategy

### Step 1: Contract-first clarification

- Freeze current enforcement semantics in docs/tests before adding breadth
- Document precedence rules (member custom vs template vs group template vs resource policy)

### Step 2: Backend enforcement expansion

- Add enforcement incrementally by resource type / limit type
- Add focused unit/integration tests for each newly enforced rule

### Step 3: UI + evidence verification

- Ensure user-facing actions produce visible outcomes in `Audit` and `Usage`
- Prefer product error states and i18n strings for all new real-backend failure paths

### Step 4: Smoke coverage extension

- Bundle only high-signal scenarios into governance release smoke
- Keep runtime reasonable; move deeper combinatorics to targeted scripts/tests

## Acceptance Criteria (Phase 2 exit)

- `Members` and `Resource Policy` support one end-to-end real-backend workflow each with clear runtime effect
- Runtime effects are observable via `Audit` and/or `Usage`
- Governance real-backend smoke covers at least:
  - page open
  - basic interaction
  - one policy effect
  - one member-permission or member-limits effect
- No mock-only UX fallbacks remain on supported governance flows

## Notes

- Keep `docs/release/internal-release-capability-matrix.md` updated after each meaningful expansion.
- Maintain a clear distinction between:
  - internal-release accepted limitations
  - external-release blockers
