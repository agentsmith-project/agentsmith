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
5. Frontend runtime control-plane workflow (settings runtime tab):
- provider/model/alias/combo/pricing operation panel
- API hooks aligned to item-level endpoints (`GET/PUT/DELETE`)

## Key Automation Check
- Passed:
1. `npm run ws:typecheck`
2. `npm run contracts:check-openapi`
3. `npm run openapi:check-generated`
4. `npm run test:run -- packages/api-entry-node/src/runtime-route-handler.test.ts packages/api-entry-node/src/projects-route-match.test.ts`
5. `npm run test:e2e:integration:runtime-proxy-billing:with-api` (1 passed)
6. `BASE_URL=http://localhost:3002 npx playwright test e2e/runtime-proxy-billing.spec.ts --project=chromium --workers=1` (1 passed, MSW lane)
7. `BASE_URL=http://localhost:3002 npx playwright test e2e/settings.spec.ts --project=chromium --workers=1` (11 passed)
8. `BASE_URL=http://localhost:3002 npx playwright test e2e/visual.spec.ts --project=visual --workers=1` (33 passed)
9. `npm run test:run -- src/components/settings/__tests__/RuntimeControlPlanePanel.test.tsx` (2 passed)

## E2E Coverage Against This PRD
- Current state:
1. Added real-backend integration e2e spec:
- `e2e/integration-runtime-proxy-billing.spec.ts`
- coverage: provider setup + alias/combo routing + unified chat + usage/timeseries/quota endpoints
2. Local execution evidence captured:
- Command: `npm run test:e2e:integration:runtime-proxy-billing:with-api`
- Result: `1 passed (4.6s)` on 2026-02-27
3. Mock-lane browser evidence captured:
- Command: `BASE_URL=http://localhost:3002 npx playwright test e2e/runtime-proxy-billing.spec.ts --project=chromium --workers=1`
- Result: `1 passed (6.7s)` on 2026-02-27
4. Runtime settings control-plane UI evidence captured:
- Command: `BASE_URL=http://localhost:3002 npx playwright test e2e/settings.spec.ts --project=chromium --workers=1`
- Result: `11 passed (20.8s)` on 2026-02-27
- New assertion: `runtime control plane can create provider via API`

- Conclusion:
1. E2E acceptance for runtime proxy billing API chain is `covered` in both real-backend and mock-browser lanes.
2. Runtime control-plane UI workflow has baseline acceptance coverage in settings runtime tab.

## Docs Consistency
- Consistent:
1. OpenAPI authoritative spec and generated TS types are in sync.
2. Route-kind map is aligned with added runtime endpoints.

- Inconsistencies or shortfalls:
1. PRD asks full-chain closure (`type/contract/integration/e2e/visual`), while current evidence is missing e2e and visual coverage for runtime module.

## Blocking Items
1. No blocking item found in current closure scope.

## Non-Blocking Items
1. Upstream provider volatility (429/timeout) still requires robust replay/idempotency strategy in later hardening.
2. Streaming path quality gates are not yet benchmarked under sustained load.
3. Runtime observability dimensions (error-class distribution, fallback hop histogram) need dedicated dashboards/alerts.
4. Runtime control-plane UI is currently in settings tab and should be split into dedicated pages/module in next iteration.

## Technical Debt Scan (Obvious)
1. Runtime handler decomposition has started:
- extracted pure routing-policy module `runtime-routing.ts` with dedicated tests.
2. Retry/error taxonomy is enforced for runtime routing path and covered by unit tests, but cross-provider classification matrix can be expanded.
3. Runtime feature-level visual baseline currently relies on settings page baseline; dedicated runtime module visual snapshots are still pending.

## Recommended Closure Sequence (Best-Practice)
1. Complete API surface parity first: add item-level CRUD for models/aliases/combos with strict validation and contract tests.
2. Add Playwright E2E pack for PRD critical chains using fixed fixtures and deterministic mock lanes.
3. Add runtime visual baseline coverage for control-plane pages.
4. Split runtime handler into focused modules (route validation, routing planner, upstream executor, usage writer) and keep tests at module boundaries.
5. Re-run release gate and update closure verdict only after full-chain evidence is green.
