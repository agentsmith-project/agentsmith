# LLM Provider Proxy Billing Closure Progress (2026-02-27)

## Scope
- PRD: `docs/plans/llm-provider-proxy-billing-prd-v1.md`
- Baseline branch: `main`
- Verification time: 2026-02-27

## Executive Verdict
- Current status: `PARTIAL (not release-ready)`
- Reason: backend contract and core runtime path are available and tested at unit/type/contract level, but PRD-level end-to-end acceptance is not yet closed.

## Code State
- Implemented:
1. Unified proxy entry: `POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/llm/chat/completions`
2. Runtime control-plane APIs:
- `runtime/providers` + `runtime/providers/{providerConnectionId}`
- `runtime/models` + `runtime/models/{modelId}`
- `runtime/routing/aliases` + `runtime/routing/aliases/{alias}`
- `runtime/routing/combos` + `runtime/routing/combos/{combo}`
- `runtime/pricing`
3. Usage expansion:
- `usage/timeseries`
- `quota/summary`
4. Runtime fallback behavior:
- combo fallback now enforces `retryable_error_classes` and `max_hops`
- direct/alias/combo path writes usage facts with runtime metadata and estimated cost

## Key Automation Check
- Passed:
1. `npm run ws:typecheck`
2. `npm run contracts:check-openapi`
3. `npm run openapi:check-generated`
4. `npm run test:run -- packages/api-entry-node/src/runtime-route-handler.test.ts packages/api-entry-node/src/projects-route-match.test.ts`
5. `npm run test:e2e:integration:runtime-proxy-billing:with-api` (1 passed)

## E2E Coverage Against This PRD
- Current state:
1. Added real-backend integration e2e spec:
- `e2e/integration-runtime-proxy-billing.spec.ts`
- coverage: provider setup + alias/combo routing + unified chat + usage/timeseries/quota endpoints
2. Local execution evidence captured:
- Command: `npm run test:e2e:integration:runtime-proxy-billing:with-api`
- Result: `1 passed (4.6s)` on 2026-02-27

- Conclusion:
1. E2E acceptance for runtime proxy billing backend chain is `covered` at integration-e2e level.
2. Remaining gap is frontend operator workflow (runtime control-plane UI) acceptance coverage.

## Docs Consistency
- Consistent:
1. OpenAPI authoritative spec and generated TS types are in sync.
2. Route-kind map is aligned with added runtime endpoints.

- Inconsistencies or shortfalls:
1. PRD asks full-chain closure (`type/contract/integration/e2e/visual`), while current evidence is missing e2e and visual coverage for runtime module.

## Blocking Items
1. Frontend runtime control-plane pages are not yet validated as production-grade operator workflow.

## Non-Blocking Items
1. Upstream provider volatility (429/timeout) still requires robust replay/idempotency strategy in later hardening.
2. Streaming path quality gates are not yet benchmarked under sustained load.
3. Runtime observability dimensions (error-class distribution, fallback hop histogram) need dedicated dashboards/alerts.

## Technical Debt Scan (Obvious)
1. Runtime handler currently centralizes multiple responsibilities (routing policy, upstream call, usage recording); service decomposition is pending.
2. Retry/error taxonomy is partially enforced in code but lacks complete contract-level test matrix.
3. Absence of runtime feature-level visual snapshots means UX regressions may slip through.

## Recommended Closure Sequence (Best-Practice)
1. Complete API surface parity first: add item-level CRUD for models/aliases/combos with strict validation and contract tests.
2. Add Playwright E2E pack for PRD critical chains using fixed fixtures and deterministic mock lanes.
3. Add runtime visual baseline coverage for control-plane pages.
4. Split runtime handler into focused modules (route validation, routing planner, upstream executor, usage writer) and keep tests at module boundaries.
5. Re-run release gate and update closure verdict only after full-chain evidence is green.
