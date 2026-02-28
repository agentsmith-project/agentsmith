# AgentSmith 下一周期产品分析与改进报告（LLM Provider / Proxy / Billing）

状态：`archived-reference-only`
当前权威文档：
- `docs/design/llm-runtime-product-decision-memo-v1.md`
- `docs/plans/llm-runtime-final-implementation-plan-v2.md`

## 1. 执行摘要

基于 `docs/design/archive/llm-provider-proxy-billing-integration-reference.md`，并对照 `../9router` 与 `../openclaw` 实际实现，建议 AgentSmith 下个 PRD 周期聚焦一个统一目标：

1. 建立“模型路由控制面”（Provider Connection + Model Catalog + Alias/Combo）。
2. 建立“统一推理数据面”（单入口 proxy，支持 alias/combo fallback）。
3. 建立“真实计费闭环”（按请求记录 provider/model/tokens/cost，驱动治理与看板）。

核心判断：
- AgentSmith 当前在“多租户治理（workspace/project + policy/quota/audit）”上比 9router/openclaw 更强。
- 但在“模型路由抽象”和“成本事实（cost fact）”上明显不足，导致成本治理、模型策略与运营分析难以形成闭环。

## 2. 证据与对标范围

已核对的关键实现：

- AgentSmith
  - `packages/api-entry-node/src/resource-models.ts`
  - `packages/api-entry-node/src/endpoint-route-handler.ts`
  - `packages/api-entry-node/src/endpoint-protocol-router.ts`
  - `packages/api-entry-node/src/audit-usage-store.ts`
  - `packages/api-entry-node/src/audit-usage-recorders.ts`
  - `src/lib/endpoints/provider-catalog.ts`
- 9router
  - `../9router/src/lib/localDb.js`
  - `../9router/open-sse/services/model.js`
  - `../9router/open-sse/services/combo.js`
  - `../9router/src/lib/usageDb.js`
  - `../9router/src/shared/constants/pricing.js`
  - `../9router/src/app/api/pricing/route.js`
- openclaw
  - `../openclaw/src/config/types.models.ts`
  - `../openclaw/src/agents/model-catalog.ts`

## 3. AgentSmith 当前现状（产品与架构）

### 3.1 已有优势（应保留）

1. 强治理骨架：`project/workspace` 隔离、resource policy、quota、audit/usage 证据链已在线。
2. Endpoint 具备能力维度（chat/rerank/image/video）与协议标注（openai_compatible/google/glm/dashscope）。
3. 请求前置治理完整：访问控制、速率、配额校验及审计都在 proxy 前执行。

### 3.2 关键缺口（下周期必须补齐）

1. 路由抽象不足：
- 当前是“按 endpoint_id 调用”模式（`/endpoints/{id}/proxy/...`），缺少“按 model string 自动解析”的统一入口。
- 无一等公民的 model alias/combo（仅 endpoint defaults/models）。

2. 成本事实缺失：
- usage fact 仅有 tokens/requests，无 `provider/model/cost` 一等字段。
- 无 pricing 配置层（默认价 + 覆盖价 + 生效范围）。

3. 配置体系割裂：
- 前端 provider catalog 主要是静态运行时目录 (`models-catalog.runtime.json`)。
- 后端 endpoint 配置偏“连接实例”，缺少“模型定义目录 + 计费属性”的统一模型。

4. 契约风险：
- 前端已接入 `usage/timeseries`、`quota/summary` 语义；在 `api-entry-node` 中暂未发现对应路由实现（可能由其他服务承载），需在下周期前明确单一责任边界并收敛契约来源。

## 4. 参考项目可迁移能力

### 4.1 来自 9router（优先吸收）

1. provider connection / node 的数据驱动管理。
2. model alias + combo（fallback 语义清晰，失败自动切换）。
3. pricing API（GET/PATCH/DELETE）+ default pricing map。
4. usage 按请求落库并实时聚合（provider/model/cost 维度）。

### 4.2 来自 openclaw（优先吸收）

1. `ModelProviderConfig + ModelDefinitionConfig` 明确 schema。
2. model catalog 的“配置 + 发现 + 合并”机制。
3. cost 字段直接挂在 model definition 上，便于统一估算/展示。

### 4.3 AgentSmith 应坚持不抄的部分

1. 不采用 9router 的“单租户本地 lowdb”方式作为主数据面。
2. 不牺牲现有 project-scoped 权限/配额/审计链路。
3. 不把 fallback 策略做成纯前端能力，必须后端可审计、可治理。

## 5. 目标产品蓝图（建议作为 PRD 主线）

### 5.1 控制面：Provider/Model Registry

新增三层实体：

1. `ProviderConnection`（项目级，凭证与可用性）
- provider, auth_mode, base_url, credential_ref, priority, status

2. `ModelCatalogEntry`（全局模板 + 项目覆盖）
- provider, model_id, display_name, capabilities, context_window, max_tokens
- pricing: input/output/cached/reasoning/cache_creation

3. `ModelRoutingRule`（项目级策略）
- alias -> provider/model
- combo -> [provider/model ...] + fallback_policy
- 可选：tenant tags / cost tier / allowlist

### 5.2 数据面：Unified Proxy

新增统一入口（项目级）：

- `POST /api/v1/workspaces/{ws}/projects/{project}/llm/chat/completions`

请求中 `model` 可为：
1. 直连：`provider/model`
2. alias：`coding-fast`
3. combo：`combo:cheap-first`

路由流程：
1. 解析 model string -> routing target。
2. 读取治理策略（allow/rate/quota）。
3. 选择 provider connection（优先级 + 健康状态）。
4. 发起上游请求（支持 fallback）。
5. 回写 usage/cost/audit 事实。

### 5.3 计费与用量闭环

在 usage fact 增补一等字段：
- `provider`, `model`, `pricing_version`, `cost_usd`

计费规则：
- 先取项目覆盖价，再取全局默认价。
- 按 token 维度计算（input/output/cached/reasoning/cache_creation）。
- 若缺价格，记录 `cost_status=missing_price`，而不是 silently 置 0。

### 5.4 前端能力

1. Endpoint 管理升级为“Provider Connections + Routing Rules + Model Catalog”。
2. Cost & Quota 页面新增 provider/model 维度筛选与分组。
3. 增加“fallback 可视化诊断”：本次命中了哪个 combo、第几跳成功、失败原因分类。

## 6. 分阶段发布建议（PRD 结构）

### Phase A（基础设施，2-3 周）

1. 数据模型落地：ProviderConnection/ModelCatalog/RoutingRule/PriceRule。
2. UsageFact 扩展：provider/model/cost 字段。
3. Pricing API + 默认价机制（含版本化）。
4. 契约收敛：统一 `/usage`、`/usage/kpi`、`/usage/timeseries`、`/quota/summary` 的真实后端实现与文档。

验收闸门：
- 类型/契约测试通过；
- 旧 endpoint proxy 不回归；
- 能在日志中看到 cost fact。

### Phase B（统一路由，2-3 周）

1. 新增 unified proxy chat 入口。
2. 实现 alias/combo fallback（含 retryable 分类）。
3. 打通审计事件：记录路由决策与 fallback 轨迹。

验收闸门：
- combo 场景 e2e 可稳定复现主备切换；
- fallback 不绕过 policy/quota；
- 失败分类可观测。

### Phase C（产品化与治理，2 周）

1. 控制台页面与操作流完善。
2. 成本告警（budget threshold / abnormal spike）。
3. 报表导出与运营视图（provider/model/end_user/time bucket）。

验收闸门：
- PM/运营可独立完成定价调整、路由策略调整与成本追踪；
- 全链路审计可复盘。

## 7. 关键架构原则（避免“头疼医头”）

1. 控制面与数据面分离：配置变更不直接耦合请求路径。
2. 成本是“事实”不是“估算 UI 字段”：优先在写入 usage fact 时计算并落库。
3. 策略执行前置：fallback 不能绕过任何治理检查。
4. 契约单一来源：OpenAPI + route matcher + handler 必须同源生成或至少同 PR 原子变更。
5. 一次性切换：发布窗口内完成新路由切换并下线旧路径，避免长期双轨复杂度。

## 8. 当前阻塞项与非阻塞项

### 阻塞项（进入下个 PRD 前要确认）

1. API 契约与实现不一致风险：`usage/timeseries`、`quota/summary` 的后端实际落点需要统一并补齐证据。
2. 定价来源权威未定义：默认价由产品维护还是运营后台维护，需要明确 owner 与发布流程。
3. 模型命名规范缺失：provider/model、alias、combo 的命名规则需要冻结，否则后续治理与统计会碎片化。

### 非阻塞项（可并行迭代）

1. CSV/JSON 导出。
2. 更细粒度成本归因（tool 调用、文件处理子任务分摊）。
3. 智能路由（按延迟/成功率/成本动态切换）可放在后续增强。

## 9. 建议 KPI（下周期验收）

1. 路由成功率（含 combo fallback 后）>= 99.5%。
2. 具备成本字段的 usage 占比 >= 99%。
3. 价格缺失请求占比 < 0.5%。
4. 成本报表与请求事实可追溯率 100%。
5. 回归测试：endpoint 既有能力零回退。

## 10. 建议你和 PM 本周先定的决策

1. 是否采用“一次性切换”发布策略（推荐是，且发布后移除旧路径）。
2. pricing 的权威来源：代码默认 + 控制台覆盖，还是仅控制台维护。
3. combo fallback 的标准错误分类（429/5xx/timeout/network/auth）及最大跳数。
4. provider/model 命名规范与 alias/combo 命名规范。

---

## 11. UX/UI 增强建议（下周期并行主线）

目标：把“可配置”升级为“可理解、可预测、可追责”的运营体验，降低配置门槛与误操作成本。

### 11.1 信息架构重构

当前建议将相关能力从“Endpoint 视角”升级为“LLM Runtime 视角”，一级导航可考虑：

1. `Connections`：管理 provider 连接与健康状态。
2. `Models`：查看模型目录、能力与价格。
3. `Routing`：配置 alias/combo/fallback 策略。
4. `Usage & Cost`：按 provider/model/user 的成本与用量分析。
5. `Governance`：配额、策略、告警与审计联动。

### 11.2 关键交互改进

1. 路由预演（Dry-run）：
- 输入 model 字符串，实时展示“将命中哪个 provider/model、可能的 fallback 路径、预计成本区间”。

2. 策略变更影响预估：
- 修改 pricing / combo 前显示“受影响请求比例、成本变化估算、潜在风险”。

3. Fallback 可视化时间线：
- 每次请求可查看第几跳成功、每跳失败原因、重试耗时，避免用户误判为系统故障。

4. 成本异常解释卡片：
- 当出现成本峰值，页面直接给出“主要贡献 provider/model/end_user + 时间段”的解释与钻取入口。

### 11.3 表单与防错机制

1. 所有关键配置页支持“草稿 + 显式发布”。
2. Alias/Combo 命名冲突、循环引用、空路由必须前置校验。
3. 高风险操作（删除默认路由、重置价格）增加二次确认与影响提示。
4. 所有保存动作输出可追踪审计 ID，支持一键跳转审计事件。

### 11.4 设计系统与一致性要求

1. 统一状态语义：`healthy/degraded/failed`、`active/disabled`、`missing_price` 等状态文案与颜色一致。
2. 统一反馈层级：信息提示、可恢复错误、阻断错误分层展示，避免把可恢复的模型/tool 错误显示为“系统故障”。
3. 默认视图优先展示运营关键信息：成功率、fallback 率、成本、异常数。

### 11.5 UX 验收标准（建议纳入 PRD DoD）

1. 新用户在 15 分钟内可完成：新增连接 -> 配 alias/combo -> 发起一次路由验证。
2. 90% 以上策略错误在保存前被前端校验拦截。
3. 发生 fallback 时，用户可在 30 秒内定位失败跳点与原因。
4. 运营可在 3 次点击内定位成本异常的主要贡献模型。

---

## 附：建议的最小 PRD 范围（可直接立项）

1. 后端：
- Provider/Model/Routing/Pricing 四类资源 API。
- Unified proxy chat + alias/combo fallback。
- UsageFact 扩展并记录 cost。

2. 前端：
- Provider Connections 页面。
- Routing Rules（alias/combo）页面。
- Cost Dashboard provider/model 维度增强。

3. 测试与治理：
- 契约测试（OpenAPI 与 route-handler 对齐）。
- e2e：直连/alias/combo 三条主链路。
- 账单准确性测试（金样例 token -> cost）。

---

## 12. 自查修订（遗漏与风险补充）

以下为本报告二次审查后补充的关键点，用于避免后续“方案正确但落地失真”。

### 12.1 计费准确性治理（此前覆盖不足）

1. 计费应保留“原始 usage 快照”与“归一化 usage 字段”双轨存储：
- 原始快照用于对账与追溯；
- 归一化字段用于查询与看板聚合。

2. 成本计算必须版本化：
- 每条 usage fact 记录 `pricing_version`、`pricing_source`、`calculation_version`；
- 禁止因后续价格调整而覆盖历史请求成本。

3. 明确金额精度策略：
- 存储建议使用定点精度（如 micro-USD 或 decimal 字符串），避免浮点累计误差。

### 12.2 一次性切换与回退安全阀（此前不够明确）

1. 一次性切换前必须完成全量预发布验证：
- 覆盖直连/alias/combo、成功/失败/限流、成本核算准确性金样例。

2. 发布策略采用 Big Bang：
- 发布窗口内切换到 unified proxy，并同步移除旧入口对外暴露。

3. 明确回滚路径：
- 任一质量门槛不达标时，按发布预案快速回退到上一稳定版本（非双轨兼容运行）。

### 12.3 兼容层与协议适配（此前描述偏抽象）

1. 需定义统一的 provider adapter contract：
- 输入：标准 chat request + routing context；
- 输出：标准响应 + usage 明细 + provider 原始错误分类。

2. 明确错误分层：
- `governance_reject`（内部策略拒绝）
- `provider_retryable`（可 fallback）
- `provider_non_retryable`（不可 fallback）
- `system_error`（平台异常）

3. 避免“API 形态耦合”：
- `responses` 与 `chat/completions` 统一在 adapter 层转换，业务层只处理统一语义。

### 12.4 运营与合规（此前遗漏）

1. Key 与凭证治理：
- 明确最小权限、轮换周期、审计可见性与脱敏策略。

2. 成本告警闭环：
- 告警不只提示异常，还应绑定建议动作（降级 combo、限流、切换低价模型）。

3. 数据保留策略：
- usage/audit 明细保留周期、归档策略、导出权限模型需提前定义。
