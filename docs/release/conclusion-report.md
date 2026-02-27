# Release Closure Conclusion Report

**Date**: 2026-02-27  
**Scope**: PRD `docs/plans/next-release-product-roadmap-prd-v1.md` closure verification (E2E coverage, code state, key automation, docs consistency, tech debt)

---

## Executive Conclusion

**结论（按“当前代码修复与手动 demo 可用性”口径）**: **GO（internal/controlled）**  
原因：Notebook 流式阻塞根因已修复（`/sse-ticket` + ticket 契约），关键类型/单测通过，真实后端手动链路可用。

**结论（按“全量 Playwright 矩阵门禁”口径）**: **NO-GO（当前阻塞）**  
原因：2026-02-27 复跑全量矩阵失败，且失败呈系统性模式，主要为 MSW 基线假设与 real-backend 运行模式混用导致。

---

## Re-Verification Snapshot

- `git status --short`: **dirty worktree**（包含本轮收口修改与未归档 artifacts）
- `npm run lint` ✅
- `npm run ws:typecheck` ✅
- `make verify-contracts` ✅
- `npm run test:run -- src/lib/api/__tests__/sse-client.test.ts` ✅（21 passed）
- `BASE_URL=http://localhost:3001 npx playwright test --project=smoke` ❌（6 passed / 20 failed）
- `BASE_URL=http://localhost:3001 npx playwright test --project=chromium` ❌（25 passed / 252 failed）
- `BASE_URL=http://localhost:3001 npx playwright test --project=visual` ❌（8 passed / 25 failed）
- `BASE_URL=http://localhost:3001 make governance-release-smoke` ✅（页面/交互/策略/成员生命周期 smoke 全通过）

---

## PRD Coverage Matrix (A/B/C/D)

1. **A1 权限决策链统一**（E2E 覆盖：**较完整**）
- 证据：`e2e/governance.spec.ts`（权限来源展示、变更即时生效、审计联动）
- 判定：核心验收已覆盖，但 explain 字段结构级断言更多在脚本/接口侧。

2. **A2 资源策略执行补齐**（E2E 覆盖：**较完整**）
- 证据：`e2e/resource-policy.spec.ts`（endpoint/source_library/agent payload 断言）；`e2e/governance.spec.ts`
- 判定：deny/rate/quota 行为有较强覆盖；优先级稳定性仍以治理 smoke 脚本证据为主。

3. **B1 SSE ticket 化**（E2E 覆盖：**部分**）
- 证据：`e2e/epic-b-security.spec.ts`（URL 不含 JWT query 风险项）；SSE 客户端测试覆盖 strict/fallback
- 判定：风险项回归有覆盖；“100% ticket”更偏接口/实现契约验证，不完全依赖 UI E2E。

4. **B2 审计字段标准化**（E2E 覆盖：**部分**）
- 证据：`e2e/epic-b-security.spec.ts`（审计页面字段、筛选、权限）
- 判定：页面展示覆盖较好；“关键治理动作 100% 写审计 + 可导出”未见完整验收级 E2E 闭环。

5. **C1 成本与配额看板**（E2E 覆盖：**已覆盖**）
- 证据：`e2e/cost-quota-dashboard.spec.ts`（趋势图、resource_type 过滤触发 `usage/timeseries`、Top/异常钻取回填 usage 过滤）；`src/components/dashboard/CostDashboardPage.tsx` 已接入 `usage/kpi`、`usage/timeseries`、`quota/summary`。
- 判定：过滤、趋势、Top、异常、联动钻取链路已形成可执行验收闭环。

6. **C2 告警中心（基础版）**（E2E 覆盖：**已覆盖**）
- 证据：`e2e/alerts.spec.ts`（规则 CRUD 请求契约断言 + 防抖去重可见性 + 恢复状态可见性 + webhook 投递结果可见性）。
- 判定：规则管理与通知行为（debounce/recovery/webhook）具备 E2E 验证证据。

7. **D1 发布报告自动化**（E2E 覆盖：**非 UI E2E 为主**）
- 证据：`scripts/release/verify-release-report.ts` + 对应测试 + 用户文档。
- 判定：能力存在并可执行，但属于脚本/流水线验证，不是浏览器用户流 E2E。

8. **D2 故障分类与排障手册**（E2E 覆盖：**非 UI E2E 为主**）
- 证据：`scripts/release/failure-classifier.ts` + `scripts/release/__tests__/failure-classifier.test.ts` + troubleshooting 文档。
- 判定：实现与测试齐备；“命中率 >=90%”需持续统计数据，不是单次 E2E 能直接证明。

---

## Blocking Items (for full matrix release gate)

1. **E2E 基线模式未分离（阻塞）**
- 当前全量 Playwright 用例大量依赖 MSW fixture 页面结构与稳定数据；
- 本次复验在 real-backend 手动 demo 环境运行，导致系统性 selector/state 断言失败；
- 需明确并固化双 lane：
  - `mock-lane`: MSW + 全量 UI/visual 基线
  - `real-lane`: real backend + 关键路径 smoke/contracts

2. **Visual 基线与运行上下文未对齐（阻塞）**
- `visual` 项目大量 snapshot mismatch（含页面高度、布局与内容差异）；
- 需决定并执行以下其一：
  - 仅在 MSW lane 维护视觉基线；
  - 增设 real-backend 视觉基线并独立存档。

---

## Non-Blocking Items

1. **工作区非干净**：`git status` 显示当前仍有修改/未跟踪文件。
2. **外部依赖敏感**：治理真实后端 smoke 仍依赖 Keycloak 与后端联调环境稳定可用。
3. **Keycloak 回调端口约束**：`agentsmith` client 当前仅放行 `http://localhost:3001/.../login/callback`，若切换到 `3002` 会触发 `Invalid parameter: redirect_uri`。

---

## Decision Recommendation

1. **若目标是“真实后端手动演示与关键链路可用”**：可 **GO（internal/controlled）**。  
2. **若目标是“全量 Playwright 矩阵作为发布门禁”**：当前 **NO-GO**，先完成 baseline lane 对齐并复跑通过。

---

## Next Actions

1. 固化测试分层：
- `mock-lane`: `NEXT_PUBLIC_USE_MSW=true` + `playwright --project=smoke/chromium/visual`
- `real-lane`: `governance-release-smoke` + notebook/contract key smokes
2. 将当前 full-matrix 失败结果归档为本次 gate 证据，并在 PRD 收口表中标注阻塞状态。
3. lane 对齐后复跑全量矩阵，再决定 release tag。
