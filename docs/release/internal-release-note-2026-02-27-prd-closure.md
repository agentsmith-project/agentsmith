# Internal Release Note (PRD Closure)

**Date**: 2026-02-27  
**Scope**: `docs/plans/next-release-product-roadmap-prd-v1.md`  
**Status**: CONDITIONAL (Blocked on E2E baseline mode alignment)

---

## Highlights

1. PRD release coverage closure completed for C1/C2:
- C1 成本与配额看板：趋势、资源过滤、Top 列表、异常钻取已形成可执行 E2E 闭环。
- C2 告警中心：规则 CRUD 契约、通知防抖可见性、恢复通知、webhook 投递证据已形成可执行 E2E 闭环。

2. Key release gates passed (local MSW baseline):
- `npm run lint`
- `npm run ws:typecheck`
- `make verify-contracts`
- `npm run test:run -- src/lib/api/__tests__/sse-client.test.ts` (21/21)
- `BASE_URL=http://localhost:3002 npx playwright test --project=smoke e2e/smoke.spec.ts --workers=1` (26/26)
- `BASE_URL=http://localhost:3002 npx playwright test --project=chromium e2e/governance.spec.ts e2e/resource-policy.spec.ts e2e/epic-b-security.spec.ts e2e/cost-quota-dashboard.spec.ts e2e/alerts.spec.ts --workers=1` (62/62)
- `BASE_URL=http://localhost:3001 make governance-release-smoke`（PASS）

3. Structured release report generated (PASS):
- `artifacts/release-reports/release-closure-20260227.json`
- `artifacts/release-reports/release-closure-20260227.md`

4. Full Playwright matrix re-run (2026-02-27, manual real-backend env, `BASE_URL=http://localhost:3001`):
- `npx playwright test --project=smoke` -> **6 passed / 20 failed**
- `npx playwright test --project=chromium` -> **25 passed / 252 failed**
- `npx playwright test --project=visual` -> **8 passed / 25 failed**
- Failure pattern is systemic and consistent with **test baseline mode mismatch**:
  - Most tests assume MSW fixture IDs/routes (`ws_default/proj_001/task_001`) and stable mock UI states.
  - Current run targets real backend demo data, so selectors and expected page states diverge.

---

## User-Visible Changes

1. Usage 页面新增看板视图切换（Usage / Cost & Quota Dashboard）。
2. 看板支持：
- `resource_type` 过滤驱动趋势数据刷新；
- Top Resources / Top Users 点击后回填 Usage 过滤条件；
- 异常项点击后联动到 Usage 明细过滤。
3. 告警通知增强：
- 重复 firing 通知去重展示（debounce 语义）；
- 恢复状态（resolved）可见；
- webhook 投递状态/错误信息可见。

---

## Evidence

1. Closure report:
- `docs/release/conclusion-report.md`
2. C1/C2 gap closure checklist:
- `docs/release/prd-c1-c2-e2e-gap-closure-checklist.md`
3. New/updated E2E specs:
- `e2e/cost-quota-dashboard.spec.ts`
- `e2e/alerts.spec.ts`

---

## Residual Non-Blocking Risks

1. Keycloak client 回调地址存在端口白名单约束（`3001` 可用，`3002` 会报 `Invalid parameter: redirect_uri`），执行 real-backend smoke 时需保持一致。
2. 真实后端 smoke 对联调环境可用性敏感，建议保留日志与截图产物用于审计与排障。

---

## Blocking Items (Latest Re-Verification)

1. **E2E baseline split is not enforced at gate level**
- Full Playwright matrix currently mixes assumptions:
  - MSW/mock baseline assertions
  - real-backend runtime execution
- Without explicit lane separation, the release gate is not reproducible.

2. **Visual baseline not updated for current rendering/runtime context**
- `visual` project shows broad snapshot mismatch (size/layout/content deltas).
- Needs explicit decision: maintain MSW visual baseline only, or create dedicated real-backend visual baseline lane.

---

## Release Operator Decision

1. For **real-backend manual demo**: GO (core notebook streaming and runtime chain verified).
2. For **full Playwright matrix gate**: NO-GO until baseline mode alignment is completed and rerun passes in the chosen lane.

---

## Release Operator Notes

1. Ensure Keycloak env vars are present for governance real-backend smoke:
- `NEXT_PUBLIC_KEYCLOAK_URL`
- `NEXT_PUBLIC_KEYCLOAK_REALM`
- `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID`
2. Recommended pre-tag command:
- `make verify-release`
3. Archive release report artifacts with the release tag for audit trail.
