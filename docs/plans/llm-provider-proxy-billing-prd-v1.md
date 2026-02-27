# AgentSmith LLM Provider / Proxy / Billing PRD（v1）

更新时间：2026-02-27  
适用周期：下一发布周期（建议 8-10 周）  
目标读者：产品、研发、测试、运维、内部业务团队

---

## 1. 背景与目标

当前 AgentSmith 已具备：
- 项目级治理骨架（policy/quota/audit/usage）
- Endpoint 代理调用能力（按 endpoint_id）
- 基础用量统计（requests/tokens）

当前关键不足：
- 缺少按 `model string` 的统一路由入口
- 缺少 alias/combo fallback 策略能力
- 缺少可运营的计费闭环（provider/model/cost 一等事实）

本期目标：
1. 建立 LLM Runtime 控制面（Connections / Models / Routing / Pricing）。
2. 建立 Unified Proxy 数据面（model 解析 + fallback + 治理前置）。
3. 建立真实计费闭环（按请求记录与聚合 cost）。
4. 建立面向内部运营的 UX/UI（可理解、可预测、可追责）。

---

## 2. 产品原则（本期约束）

1. 一次性切换（Big Bang）：
- 开发完成后一次性升级，不保留长期兼容路径。

2. 内部用户优先：
- 优先工程正确性、治理可追踪性与运营效率。

3. 治理前置不妥协：
- fallback 不能绕过 policy/quota/rate-limit。

4. 成本是事实：
- cost 在请求写入时计算并落库，不依赖前端临时估算。

---

## 3. 北极星与成功指标

北极星：
- 从“可调用多个模型端点”升级为“可治理、可运营、可追责的 LLM Runtime 平台”。

发布成功门槛：
1. 路由成功率（含 fallback）>= 99.5%。
2. 成本字段完整率（usage_fact 含 cost）>= 99%。
3. 价格缺失请求占比 < 0.5%。
4. 成本追溯准确率（抽样对账）= 100%。
5. PRD 关键 e2e 用例通过率 = 100%。

---

## 4. 目标用户与核心场景

用户角色：
1. 平台管理员（Platform Admin）
2. 项目管理员（Project Admin）
3. 内部运营（Ops）

核心场景：
1. 配置 provider 连接和模型目录，快速上线可用路由。
2. 使用 alias/combo 控制主备模型与成本策略。
3. 发生上游异常时自动 fallback，并可审计复盘。
4. 运营按 provider/model/user 追踪成本、异常与预算风险。

---

## 5. 范围（In / Out）

In Scope（本期必须）：
1. 控制面：Provider Connections / Model Catalog / Routing Rules / Pricing Rules。
2. 数据面：Unified Proxy Chat（支持 direct/alias/combo）。
3. Billing：按请求写 usage + cost + pricing version。
4. 观测面：Usage & Cost 分析与 fallback 诊断。
5. UX/UI：信息架构升级、路由预演、策略变更影响预估、防错机制。

Out of Scope（本期不做）：
1. 外部租户兼容迁移方案。
2. 商业账单/发票系统对接。
3. 智能自适应路由（按实时 SLA 自动学习）。

---

## 6. 功能需求（Epic 级）

### Epic A：Runtime 控制面（P0）

A1. Provider Connections
- 创建/编辑/启停 provider 连接（含凭证引用、优先级、健康状态）。
- 支持按项目隔离。

A2. Model Catalog
- 管理模型定义（provider、model_id、capabilities、context、max_tokens）。
- 挂载价格字段（input/output/cached/reasoning/cache_creation）。

A3. Routing Rules
- alias: `alias -> provider/model`
- combo: `combo -> ordered [provider/model] + fallback_policy`
- 校验：命名冲突、空链路、循环引用。

验收标准：
1. 控制台可完成增删改查与启停。
2. 任一规则变更可审计（actor/action/diff/request_id）。
3. 非法规则在保存前拦截（前后端双校验）。

### Epic B：Unified Proxy（P0）

B1. 统一入口
- `POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/llm/chat/completions`

B2. model 解析
- 支持 `provider/model`、`alias`、`combo:<name>`。

B3. fallback 执行
- retryable 错误自动跳转下一候选模型。
- 不可重试错误立即失败。

B4. 治理前置
- 继续走现有 policy/quota/rate-limit 决策链。

验收标准：
1. direct/alias/combo 三条链路都可稳定执行。
2. fallback 全程审计可追踪（每跳原因、耗时、最终命中）。
3. 治理拒绝与上游错误可区分展示与归因。

### Epic C：Billing 与 Usage Fact（P0）

C1. 计费规则
- 按 token 维度计算成本。
- 支持项目覆盖价 + 默认价。

C2. 事实落库
- usage_fact 新增：`provider`、`model`、`cost_usd`、`pricing_version`、`calculation_version`。
- 同时保存原始 usage 快照用于对账。

C3. 聚合分析
- 支持按 provider/model/end_user/time_bucket 聚合。

验收标准：
1. 金样例 token->cost 对账通过。
2. 历史事实不可被新价格回写污染。
3. 看板与导出结果与事实库一致。

### Epic D：UX/UI 运营体验（P1）

D1. IA 升级
- 一级导航：`Connections`、`Models`、`Routing`、`Usage & Cost`、`Governance`。

D2. 关键交互
- 路由预演（Dry-run）。
- 策略变更影响预估（影响请求比例、成本变化）。
- fallback 时间线可视化。
- 成本异常解释卡片。

D3. 防错与反馈
- 草稿态 + 发布态。
- 高风险操作二次确认。
- 错误分级：可恢复/不可恢复/系统异常。

验收标准：
1. 新用户 15 分钟内完成首条路由上线。
2. 90% 策略错误在保存前拦截。
3. 异常定位路径 <= 3 次点击。

---

## 7. 用户故事（示例）

1. 作为项目管理员，我希望通过 alias 把业务模型名映射到具体 provider/model，以便业务端调用不感知底层变更。
2. 作为平台管理员，我希望配置 combo 主备链路，让 429/5xx/timeout 时自动切换，提高可用性。
3. 作为运营，我希望看到每次请求的 provider/model/cost，以便做成本审计与预算管理。
4. 作为值班同学，我希望快速看到 fallback 每一跳失败原因，避免把可恢复错误误判为平台故障。

---

## 8. 关键 API 契约（v1 草案）

### 8.1 Unified Proxy

`POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/llm/chat/completions`

请求示例：
```json
{
  "model": "combo:prod-chat",
  "messages": [
    { "role": "user", "content": "hello" }
  ],
  "stream": true
}
```

响应要求：
- 遵循统一的 chat 响应协议，满足当前产品 UI 消费需求。
- 在响应 metadata/审计中可追溯最终命中 provider/model。

### 8.2 Runtime 控制面

1. `GET/POST /runtime/providers`
2. `GET/PUT/DELETE /runtime/providers/{providerId}`
3. `GET/POST /runtime/models`
4. `GET/PUT/DELETE /runtime/models/{modelId}`
5. `GET/POST /runtime/routing/aliases`
6. `GET/PUT/DELETE /runtime/routing/aliases/{alias}`
7. `GET/POST /runtime/routing/combos`
8. `GET/PUT/DELETE /runtime/routing/combos/{combo}`
9. `GET/PATCH/DELETE /runtime/pricing`

### 8.3 Usage & Cost

1. `GET /usage`（增强聚合维度）
2. `GET /usage/kpi`（增强成本 KPI）
3. `GET /usage/timeseries`（requests/tokens/cost）
4. `GET /quota/summary`（与成本视图联动）

---

## 9. 数据模型要求（最小集合）

1. `provider_connection`
- id, workspace_id, project_id, provider, auth_mode, base_url, credential_ref, priority, status, health, created_at, updated_at

2. `model_catalog_entry`
- id, provider, model_id, display_name, capabilities, context_window, max_tokens, pricing_json, status

3. `model_routing_alias`
- alias, target_provider, target_model, status

4. `model_routing_combo`
- combo_name, ordered_targets_json, fallback_policy_json, status

5. `usage_fact`（扩展）
- ...existing
- provider, model, cost_usd, pricing_version, calculation_version, raw_usage_json

---

## 10. 技术与架构约束

1. 禁止长期双轨：
- 新版本发布后，旧 proxy 路径不再作为正式入口。

2. 错误分类标准化：
- `governance_reject`
- `provider_retryable`
- `provider_non_retryable`
- `system_error`

3. 金额精度：
- 使用定点策略（micro-USD 或 decimal）进行持久化。

4. 审计完整性：
- 所有配置变更与路由决策必须可追踪。

---

## 11. 测试与验收矩阵（必须通过）

### 11.1 类型/契约

1. OpenAPI 与 route-handler 一致性检查。
2. TS 类型检查与 lint 全绿。
3. 合约测试覆盖 runtime 新增 API。

### 11.2 后端集成

1. direct/alias/combo 解析正确。
2. fallback 仅在 retryable 错误触发。
3. policy/quota/rate-limit 在 fallback 场景仍有效。
4. token->cost 金样例对账通过。

### 11.3 E2E（核心业务）

1. Connections/Models/Routing/Pricing 全流程 CRUD。
2. Unified proxy direct 请求成功。
3. alias 路由成功。
4. combo 主模型失败 -> 备模型成功。
5. combo 全失败 -> 正确错误分类与提示。
6. Usage & Cost 看板可按 provider/model 筛选并钻取。
7. fallback 时间线可见且内容正确。

### 11.4 视觉与交互

1. 关键页面视觉回归通过（desktop/mobile）。
2. 错误分级文案与状态视觉一致。
3. 高风险操作确认弹窗行为正确。

---

## 12. 里程碑（建议 8-10 周）

M1（第 1-2 周）架构冻结
1. 数据模型与 API 契约冻结。
2. 错误分类与成本精度策略冻结。

M2（第 3-5 周）P0 开发
1. Runtime 控制面 API + 存储。
2. Unified proxy + routing + fallback。
3. usage_fact 成本扩展。

M3（第 6-7 周）联调与质量收敛
1. 前端控制台与看板接线。
2. 契约/集成/e2e/visual 全量收敛。

M4（第 8-10 周）发布准备
1. UAT 与运营演练。
2. 一次性切换发布与回退演练。

---

## 13. 发布策略（一次性切换）

1. 发布前置门禁：
- 所有 P0 用例通过；
- 金样例对账通过；
- 关键页面视觉回归通过。

2. 发布动作：
- 在发布窗口切换到 unified proxy 正式入口；
- 同步下线旧路径正式能力。

3. 回退策略：
- 若触发阻塞故障，回退至上一稳定版本（版本级回退）。

---

## 14. 风险与缓解

1. 风险：成本计算误差。
- 缓解：金样例+对账任务+定点精度。

2. 风险：fallback 误触发导致不可控成本上升。
- 缓解：fallback policy 强约束（最大跳数、可重试错误白名单）。

3. 风险：规则配置复杂导致误操作。
- 缓解：路由预演、影响预估、草稿发布与二次确认。

4. 风险：契约漂移。
- 缓解：OpenAPI 与后端路由的 CI 一致性检查。

---

## 15. 交付物清单（DoD）

1. PRD、技术设计、API 文档（同版本）。
2. 控制面与 proxy 代码实现。
3. usage/cost 数据模型与聚合接口。
4. 前端新 IA 页面与关键交互。
5. 全量测试报告（type/contract/integration/e2e/visual）。
6. 发布与回退 runbook。
