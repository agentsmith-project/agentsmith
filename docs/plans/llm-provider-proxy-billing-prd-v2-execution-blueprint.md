# LLM Provider / Proxy / Billing PRD v2 Execution Blueprint

更新时间：2026-02-28  
适用范围：AgentSmith 下一发布周期（一次性切换，内部用户）

---

## 1. 目标与边界

目标：
1. 把 AgentSmith 从“endpoint 直连代理”升级为“统一路由 + 成本事实 + 运营治理”平台。
2. 保持现有 policy/quota/audit 强治理能力，并纳入 alias/combo fallback 路径。
3. 成本作为一等事实写入 usage，不允许仅在前端估算。

边界（强约束）：
1. Big Bang 发布，不保留长期兼容。
2. 内部用户场景优先，追求正确性和可追责性。
3. fallback 不得绕过任何治理前置决策。

---

## 2. 目标架构（控制面 / 数据面 / 观测面）

控制面（Control Plane）：
1. `runtime/providers`：连接管理（provider、base_url、credential_ref、priority、status、health）。
2. `runtime/models`：模型目录（provider/model/capabilities/context/pricing）。
3. `runtime/routing/aliases`：别名映射。
4. `runtime/routing/combos`：主备链路 + fallback 策略。
5. `runtime/pricing`：默认价 + 项目覆盖价 + 版本化。

数据面（Data Plane）：
1. 统一入口：`POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/llm/chat/completions`
2. 路由解析：`provider/model | alias | combo:<name>`
3. fallback 执行：仅 retryable 错误触发跳转。
4. 成本落库：每次请求写 usage fact（provider/model/tokens/cost/pricing_version）。

观测面（Observability）：
1. `usage/runtime-observability`：错误分类、fallback hops、成本分布。
2. `usage/timeseries` 与 `quota/summary`：纳入 provider/model/cost 维度。
3. 可钻取审计：每次 fallback 跳转与命中路径可追踪。

---

## 3. 数据模型冻结（v2）

### 3.1 核心实体
1. `provider_connection`
- `id, workspace_id, project_id, provider, auth_mode, base_url, credential_ref, priority, status, health, created_at, updated_at`

2. `model_catalog_entry`
- `id, provider, model_id, display_name, capabilities, context_window, max_tokens, pricing_json, status`

3. `model_routing_alias`
- `alias, target_provider, target_model, status, created_at, updated_at`

4. `model_routing_combo`
- `combo_name, ordered_targets_json, fallback_policy_json, status, created_at, updated_at`

5. `usage_fact`（扩展字段）
- `provider, model, cost_usd, pricing_version, calculation_version, raw_usage_json, route_mode(direct|alias|combo), fallback_hops`

### 3.2 金额与版本策略
1. `cost_usd` 持久化采用定点（micro-USD）或 decimal，不用浮点裸存。
2. 每条 usage 绑定 `pricing_version`，价格变更不回写历史事实。
3. 缺失价格时写 `cost_status=missing_price`，不可 silently 置 0。

---

## 4. 统一路由与错误语义

### 4.1 路由流程（强制）
1. 解析 model 字符串。
2. 执行治理前置（policy/quota/rate-limit/member）。
3. 选定 provider connection（priority + health + availability）。
4. 发起上游请求。
5. 若 retryable 错误且为 combo，按策略 fallback。
6. 写 usage_fact + audit 证据。

### 4.2 错误分类（冻结）
1. `governance_reject`
2. `provider_retryable`
3. `provider_non_retryable`
4. `system_error`

### 4.3 Fallback 规则
1. 仅 `provider_retryable` 与可配置 `system_error` 触发 fallback。
2. 达到 `max_hops` 后立即终止，返回标准化错误。
3. 每一跳必须记录：`from -> to`, `error_class`, `latency_ms`。

---

## 5. UX/UI v2（运营可用）

### 5.1 信息架构
1. `Connections`
2. `Models`
3. `Routing`
4. `Usage & Cost`
5. `Governance`

### 5.2 关键交互（必须有）
1. Routing Dry-run：输入 model，预览命中路径和 fallback 路径。
2. Policy/Route 变更影响预估：展示受影响请求比例、预计成本变化。
3. Fallback Timeline：每跳错误原因与最终命中。
4. Cost Anomaly 卡片：给出主要贡献 provider/model/end_user 与时间段。

### 5.3 文案与状态规范
1. 工具调用失败、上游429、可恢复超时显示为“系统已自动重试/切换”，不显示“程序错误”。
2. 仅 `system_error` 和不可恢复故障显示阻断级错误态。
3. 所有状态文案遵循 i18n 词条与 testid 规范。

---

## 6. 测试与验收矩阵（发布门禁）

### 6.1 类型/契约
1. `npm run ws:typecheck`
2. `npm run contracts:check-openapi`
3. `npm run openapi:check-generated`

### 6.2 后端集成
1. direct/alias/combo 解析正确。
2. fallback 仅对 retryable 错误触发。
3. fallback 场景中 policy/quota/rate-limit 仍生效。
4. token->cost 金样例对账 100% 通过。

### 6.3 E2E（真实链路 + mock）
1. 控制面 CRUD（providers/models/aliases/combos/pricing）全覆盖。
2. unified proxy direct/alias/combo 全覆盖。
3. combo 全失败时错误分类与 UI 展示正确。
4. Usage & Cost 支持 provider/model 过滤、钻取、导出。
5. 可视化基线覆盖 runtime 模块页面（desktop/mobile）。

### 6.4 发布收口
1. `make notebook-agent-release-smoke-full`
2. `make governance-release-smoke`
3. `npm run release:report -- --name <release-name>`
4. 报告状态必须 `PASS`。

---

## 7. 实施里程碑（建议 4 阶段）

### M1（架构冻结）
1. 数据模型、API、错误分类、金额精度策略冻结。
2. 迁移计划（Big Bang）与回退演练脚本冻结。

### M2（P0 核心开发）
1. 控制面 API 与存储实现。
2. unified proxy + routing planner + fallback executor 实现。
3. usage_fact 成本扩展与写入链路实现。

### M3（联调与质量）
1. 前端控制面与 Usage & Cost 页面接线。
2. 契约/集成/e2e/visual 收敛到绿。
3. 真实链路稳定性基线（429/timeout 可恢复行为）验证。

### M4（发布准备）
1. 业务演练（高峰 + 上游抖动 + fallback）。
2. 收口报告 PASS 后一次性切换。
3. 切换后 7 天每日 release gate 观察窗口。

---

## 8. 工作包拆分（可直接排期）

1. `WP-01` Runtime schema 与 repository 层（providers/models/routing/pricing）
2. `WP-02` Unified proxy route + planner + executor + fallback
3. `WP-03` Usage cost engine（pricing resolver + calculator + versioning）
4. `WP-04` Usage/Quota API 扩展（provider/model/cost 维度）
5. `WP-05` Runtime UI（Connections/Models/Routing/Pricing）
6. `WP-06` Usage & Cost UI（filters/drill-down/anomaly/timeline/export）
7. `WP-07` 合约、集成、e2e、visual 与 release gate 收口

---

## 9. 退出标准（Release Exit Criteria）

1. P0 工作包全部完成并通过验收矩阵。
2. 真实链路 release report 连续两次 `PASS`。
3. 关键业务路径在上游 429/timeout 下可恢复，且 UI 不误导用户为系统故障。
4. 文档、OpenAPI、测试证据与实际实现一致。
