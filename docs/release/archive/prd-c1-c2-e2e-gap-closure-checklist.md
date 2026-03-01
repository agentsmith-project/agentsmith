# PRD C1/C2 E2E Gap Closure Checklist

**Date**: 2026-02-27  
**PRD**: `docs/plans/next-release-product-roadmap-prd-v1.md`  
**Goal**: Close blocking gaps for "full PRD E2E coverage" release gate.

---

## Scope

1. C1 成本与配额看板（趋势/Top/异常/联动钻取）
2. C2 告警中心（规则 CRUD + 防抖 + 恢复通知 + webhook）

---

## Current Baseline

1. 已有 E2E
- `e2e/usage.spec.ts`：usage 列表/KPI/筛选基础交互
- `e2e/alerts.spec.ts`：alerts 页面可见性与部分交互

2. 主要缺口
- C1 缺验收级“分析+联动钻取”闭环
- C2 缺“真实行为效果”闭环（防抖/恢复/webhook）

## Progress Update

1. ✅ 2026-02-27: 已补 `C2-1` 的请求契约断言（create/update/delete）
- Evidence: `e2e/alerts.spec.ts`
- Verify: `BASE_URL=http://localhost:3001 npm run test:e2e -- e2e/alerts.spec.ts --project=chromium --workers=1` -> 13 passed, 1 skipped
2. ✅ 2026-02-27: 已补 `C1-1/2/3`（趋势过滤、Top 钻取、异常钻取）
- Evidence: `e2e/cost-quota-dashboard.spec.ts`, `src/components/dashboard/CostDashboardPage.tsx`
3. ✅ 2026-02-27: 已补 `C2-2/3/4`（防抖可见性、恢复通知、webhook 投递证据）
- Evidence: `e2e/alerts.spec.ts`, `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/alerts/page.tsx`, `src/components/alerts/AlertNotificationsPanel.tsx`
4. ✅ 当前状态：C1/C2 收口完成

---

## C1 Minimum Test Set

### C1-1 Trend filter drives API query and chart refresh
- New test: `e2e/cost-quota-dashboard.spec.ts` -> `trend supports workspace/project/resource_type filters`
- Status: ✅ Done
- Assertions:
  1. 切换过滤项后，发起 `GET /usage/timeseries`（含 `resource_type` 查询参数）
  2. 趋势图 `dashboard-trend-chart` 更新（等待请求后可见且非 loading）
- Dependency:
  - 页面需实际挂载 `CostDashboardPage` 或等价趋势容器
  - 前端需接 `usage/timeseries` 接口
- Estimate: 0.5 day

### C1-2 Top users/resources list render and drill-down
- New test: `e2e/cost-quota-dashboard.spec.ts` -> `top lists support drill-down to filtered usage detail`
- Status: ✅ Done
- Assertions:
  1. Top Users / Top Resources 列表可见
  2. 点击一行后，明细列表出现对应过滤条件（例如 `resource_id` 或 `end_user_id`）
- Dependency:
  - 列表行具备稳定 testid（建议：`dashboard-top-users__row-*`, `dashboard-top-resources__row-*`）
- Estimate: 0.5 day

### C1-3 Anomaly card links to usage detail slice
- New test: `e2e/cost-quota-dashboard.spec.ts` -> `anomaly click opens scoped detail slice`
- Status: ✅ Done
- Assertions:
  1. 异常面板 `dashboard-anomalies` 可见
  2. 点击异常项后，明细区被限定到该异常关联资源/时间片
- Dependency:
  - `AnomalyAlertsPanel` 点击事件需驱动过滤状态
- Estimate: 0.5 day

### C1 Exit Criteria

1. 至少 3 条 C1 验收级 E2E 全绿  
2. 覆盖 PRD 的过滤、趋势、Top、异常、钻取链路

---

## C2 Minimum Test Set

### C2-1 Rule create/update/delete sends correct payload and refreshes list
- Update file: `e2e/alerts.spec.ts`
- Status: ✅ Done (request payload/contract assertions added)
- Assertions:
  1. 创建规则触发 `POST /alert-rules` 且 payload 含 `trigger/channels/behavior`
  2. 编辑规则触发 `PUT /alert-rules/:id` 且开关状态变更生效
  3. 删除规则触发 `DELETE /alert-rules/:id` 且列表移除
- Dependency:
  - Rule card/action menu 增加稳定 testid（建议：`alert-rule-card__menu`, `alert-rule-card__delete`）
- Estimate: 0.5 day

### C2-2 Debounce behavior prevents duplicate notifications in window
- New test: `e2e/alerts-delivery.spec.ts`
- Status: ✅ Done (implemented in `e2e/alerts.spec.ts`)
- Assertions:
  1. 在 `debounce_minutes` 窗口内重复触发，仅产生一次通知（或后端返回 suppressed）
  2. 通知列表中无重复 firing 记录
- Dependency:
  - 需要可控触发源（mock handler 或测试专用后端端点）
- Estimate: 1.0 day

### C2-3 Recovery notification is emitted after metric returns below threshold
- New test: `e2e/alerts-delivery.spec.ts`
- Status: ✅ Done (implemented in `e2e/alerts.spec.ts`)
- Assertions:
  1. 先触发 firing，再触发恢复
  2. 通知列表出现 recovery 状态（或 equivalent event）
- Dependency:
  - 后端需提供可控状态切换数据
- Estimate: 0.5 day

### C2-4 Webhook delivery evidence is recorded
- New test: `e2e/alerts-delivery.spec.ts`
- Status: ✅ Done (implemented in `e2e/alerts.spec.ts`)
- Assertions:
  1. webhook channel 配置后触发告警，通知记录中 `delivery.webhook_sent=true`
  2. 失败时有 `webhook_status`/`webhook_error`
- Dependency:
  - mock webhook receiver 或 integration 环境回环地址
- Estimate: 1.0 day

### C2 Exit Criteria

1. 规则 CRUD 与触发效果分层覆盖（UI + API effect）  
2. 防抖/恢复/webhook 三类关键行为各至少 1 条通过用例

---

## Execution Order

1. P0: `C2-1`（最快补齐现有 alerts.spec 的契约断言）  
2. P0: `C1-1`（确保趋势过滤接口与图表更新闭环）  
3. P1: `C1-2` + `C1-3`  
4. P1: `C2-2` + `C2-3` + `C2-4`

---

## Effort and Owner Suggestion

1. Total estimate: **4.5 days**（单人，含调试与稳定化）
2. Suggested split:
- FE E2E owner: C1-1/2/3, C2-1
- Integration owner: C2-2/3/4（需要后端触发能力）

---

## Blocking Dependencies

1. C1 页面接线：`CostDashboardPage` 需挂载并接入 `usage/timeseries` / `quota/summary`
2. C2 触发源：需要可重复、可控制的触发与恢复输入
3. Test ID 补齐：alert rule card/menu/action 与 dashboard drill-down 元素

---

## Done Definition

1. 新增/更新 E2E 用例通过（本地 + CI）  
2. `docs/release/conclusion-report.md` 覆盖矩阵状态更新为 C1/C2 "已覆盖"  
3. 发布结论可切换到 “full PRD E2E coverage = GO”
