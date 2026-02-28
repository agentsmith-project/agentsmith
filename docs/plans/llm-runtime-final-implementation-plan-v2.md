# LLM Runtime Final Implementation Plan v2

更新时间：2026-02-28  
状态：`approved-baseline`  
前置确认：
1. 一级导航正式引入 `Runtime`
2. Unified proxy 作为正式入口
3. Combo 默认 fallback 错误集合按产品决策稿冻结
4. 价格优先级按 `project > workspace > global`
5. 缺价策略按“允许请求通过，但强告警”

前置文档：
- `docs/design/llm-runtime-product-decision-memo-v1.md`
- `docs/plans/llm-provider-proxy-billing-prd-v2-execution-blueprint.md`
- `docs/plans/llm-runtime-detailed-work-plan-v1.md`

---

## 1. 本计划的作用

这是一份进入编码前的最终实施基线，用于：
1. 冻结范围
2. 明确阶段顺序
3. 明确每周产出
4. 明确门禁
5. 明确谁可以改什么

原则：
1. 不再讨论产品对象定义
2. 不再讨论是否采用 unified proxy
3. 不再保留长期兼容路径

---

## 2. 范围冻结（P0 / P1）

### P0（本期必须完成）
1. Runtime 控制面对象：Connection / Model / Alias / Combo / Pricing Rule
2. Unified proxy：direct / alias / combo
3. fallback 分类与执行
4. usage fact 扩展：provider/model/cost/pricing_version/calculation_version/raw_usage_json
5. Usage & Cost 基础分析能力
6. Request diagnostics：fallback timeline + route resolution summary
7. 契约/集成/e2e/visual/real-lane release gate

### P1（本期如有余力）
1. Routing Dry-run
2. Impact Preview
3. Price Version Compare
4. Export（CSV/JSON）

### Out of Scope
1. 智能自动路由
2. 商业 billing / invoice
3. 多租户兼容迁移工具
4. 长期双入口并存

---

## 3. 技术与产品冻结项

### Freeze-01 产品对象
1. `Connection`
2. `Model`
3. `Alias`
4. `Combo`
5. `Pricing Rule`

### Freeze-02 错误分类
1. `governance_reject`
2. `provider_retryable`
3. `provider_non_retryable`
4. `system_error`

### Freeze-03 fallback 规则
允许：
1. 429
2. timeout
3. network reset
4. retryable 5xx
5. 可配置 system error

禁止：
1. policy reject
2. quota reject
3. permission reject
4. 参数错误
5. provider non-retryable

### Freeze-04 成本规则
1. 写 usage 时计算 cost
2. 历史绑定 `pricing_version`
3. 缺价写 `missing_price`
4. 金额使用定点精度

### Freeze-05 导航
1. `Runtime`
2. `Usage & Cost`
3. `Governance`

---

## 4. 周计划（建议 8 周）

### Week 1：架构冻结
交付：
1. 数据模型最终版
2. OpenAPI 最终版
3. route kind 与错误码字典
4. 金额精度与 pricing version 策略

门禁：
1. 架构评审通过
2. OpenAPI 草案通过
3. 决策稿无未决问题

### Week 2：Runtime Domain & Control Plane BE
交付：
1. providers/models/aliases/combos/pricing repository
2. CRUD API
3. 审计事件
4. 基础 contract tests

门禁：
1. item-level CRUD 跑通
2. alias/combo 校验跑通
3. contracts 全绿

### Week 3：Unified Proxy Core
交付：
1. model parser
2. routing planner
3. connection selector
4. unified proxy route skeleton

门禁：
1. direct route 集成测试通过
2. alias route 集成测试通过

### Week 4：Fallback & Governance
交付：
1. combo fallback executor
2. retryable classifier
3. governance 前置接入
4. 审计与每跳证据

门禁：
1. combo path 跑通
2. governance reject 不 fallback
3. fallback hop evidence 完整

### Week 5：Cost Engine & Usage Facts
交付：
1. usage normalize
2. cost calculator
3. pricing resolver
4. usage fact 扩展写入

门禁：
1. 金样例 token->cost 100% 通过
2. missing price 质量告警跑通
3. 历史价格不被覆盖

### Week 6：Frontend Runtime Control Plane
交付：
1. Runtime 页面与子页
2. Connections/Models/Routing/Pricing CRUD UI
3. 高风险确认与表单校验

门禁：
1. 控制面 CRUD E2E 通过
2. i18n/testid 完整

### Week 7：Usage & Diagnostics UI
交付：
1. Usage & Cost 页面增强
2. Request detail drawer
3. Fallback timeline
4. anomaly cards

门禁：
1. 高成本钻取 E2E 通过
2. 失败归因 E2E 通过
3. visual baseline 更新通过

### Week 8：收口与发布演练
交付：
1. real-lane integration 回归
2. visual 回归
3. release smoke
4. governance smoke
5. release report

门禁：
1. `make notebook-agent-release-smoke-full`
2. `make governance-release-smoke`
3. `npm run release:report -- --name <name>`
4. 连续两次 `PASS`

---

## 5. 模块实施顺序（必须遵守）

1. 先做 `BE domain / storage / contracts`
2. 再做 `unified proxy core`
3. 再做 `fallback + governance`
4. 再做 `cost engine + usage facts`
5. 再做 `Runtime UI`
6. 再做 `Usage & Diagnostics UI`
7. 最后做 `dry-run / impact preview`

原因：
1. 不允许前端先造空壳页面倒逼后端结构
2. 不允许 cost 晚于 proxy 很久落地，否则后续事实污染

---

## 6. 团队分工建议

### Backend Squad A
1. repository
2. runtime CRUD
3. contracts

### Backend Squad B
1. unified proxy
2. fallback
3. governance integration
4. usage facts / cost

### Frontend Squad A
1. Runtime IA
2. Connections / Models / Routing / Pricing

### Frontend Squad B
1. Usage & Cost
2. diagnostics
3. visual states

### QA / Release
1. contract validation
2. integration
3. e2e
4. visual
5. release gate

---

## 7. 测试门禁矩阵

### Gate A：Schema / Contract
1. `npm run ws:typecheck`
2. `npm run contracts:check-openapi`
3. `npm run openapi:check-generated`

### Gate B：Backend Integration
1. direct
2. alias
3. combo
4. combo full fail
5. governance reject
6. missing price
7. token->cost golden cases

### Gate C：Frontend E2E
1. Runtime CRUD
2. Unified proxy success path
3. fallback path UI
4. Usage & Cost drill-down
5. request diagnostics

### Gate D：Visual
1. Runtime main
2. Routing editor
3. Pricing page
4. Usage & Cost
5. Request diagnostics drawer

### Gate E：Release
1. notebook-agent real-lane smoke
2. governance release smoke
3. release report PASS

---

## 8. 发布与切换策略

### 8.1 切换原则
1. Big Bang
2. 旧 endpoint proxy 不再作为正式入口
3. 发布后进入 7 天观察窗口

### 8.2 观察指标
1. runtime route success rate
2. fallback rate
3. missing price rate
4. provider retryable error rate
5. cost fact completeness

### 8.3 回退条件
任一满足即回退：
1. non-transient backend failure blocking core request path
2. cost fact completeness 明显低于门槛
3. governance path regression
4. release gate 连续失败且非上游 transient

---

## 9. 关键验收标准（最终）

1. 用户 15 分钟内可完成首条有效路由上线
2. 失败请求 3 次点击内可见归因
3. 高成本请求 3 次点击内可见归因
4. fallback 可追踪率 100%
5. missing price 可见率 100%
6. release report 连续两次 `PASS`

---

## 10. 下一步执行命令

编码启动顺序：
1. `WP-01 Runtime Domain & Storage`
2. `WP-02 Unified Proxy Planner & Executor`
3. `WP-03 Cost Engine & Usage Facts`

进入编码前只允许再改：
1. OpenAPI 字段细节
2. 测试数据夹具
3. 页面文案细节

不再允许再改：
1. 产品对象定义
2. 一级导航结构
3. unified proxy 主入口决策
4. fallback 默认错误集合
