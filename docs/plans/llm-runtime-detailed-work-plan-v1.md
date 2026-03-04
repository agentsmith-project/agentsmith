# LLM Runtime Detailed Work Plan v1

更新时间：2026-02-28  
前置文档：
- `docs/design/llm-runtime-product-decision-memo-v1.md`
- `docs/plans/llm-provider-proxy-billing-prd-v2-execution-blueprint.md`

---

## 1. 目标

把“产品决策”转成可以执行的工作计划，明确：
1. 每个模块做什么
2. 页面做到什么程度
3. API 到什么粒度
4. 测试如何覆盖
5. 哪些是 P0，哪些可以后置

---

## 2. Phase 划分

### Phase 1：Runtime 最小闭环（P0）
目标：
1. 能配置
2. 能路由
3. 能 fallback
4. 能写成本事实
5. 能解释一次请求怎么走

包含：
1. Connections / Models / Routing / Pricing 基础 CRUD
2. Unified Proxy direct / alias / combo
3. usage fact 扩展：provider/model/cost/pricing_version
4. request detail 中的 fallback timeline

### Phase 2：运营闭环（P0）
目标：
1. 能追责
2. 能排障
3. 能看成本异常

包含：
1. Usage & Cost drill-down
2. Runtime observability
3. Cost anomaly explanation
4. 质量警告（missing price / fallback spikes）

### Phase 3：决策增强（P1）
目标：
1. 降低变更风险
2. 把配置升级为决策

包含：
1. Routing dry-run
2. Impact preview
3. Price version compare
4. Rollout guardrail

---

## 3. 模块级工作拆分

### WP-01 Runtime Domain & Storage（P0）
目标：
- 冻结 5 个核心对象：Connection / Model / Alias / Combo / Pricing Rule

后端工作：
1. 定义 repository 与类型
2. 增加校验器
3. 增加持久化与查询接口

验收：
1. 不允许 alias/combo 命名冲突
2. 不允许空 combo
3. 不允许循环引用
4. 价格规则支持版本号

### WP-02 Unified Proxy Planner & Executor（P0）
目标：
- 把一次请求从 model string 解析到最终执行

后端工作：
1. 解析 `provider/model`
2. 解析 alias
3. 解析 combo
4. 选择 connection
5. 执行 fallback
6. 标准化错误分类

验收：
1. retryable 才能 fallback
2. governance reject 永不 fallback
3. 每一跳都有 audit/usage 证据

### WP-03 Cost Engine & Usage Facts（P0）
目标：
- 成本成为请求级一等事实

后端工作：
1. provider usage 标准化
2. token -> cost 计算
3. 价格版本解析
4. 写 usage fact

验收：
1. 金样例 token->cost 100% 通过
2. 缺价请求写 `missing_price`
3. 历史记录不受调价影响

### WP-04 Runtime Control Plane UI（P0）
目标：
- 让项目管理员能独立完成配置

页面：
1. `Connections`
2. `Models`
3. `Routing`
4. `Pricing`

关键交互：
1. 表格 + 详情抽屉
2. 创建/编辑弹窗
3. 高风险确认（删除/停用/改主路由）
4. 保存前校验提示

验收：
1. 15 分钟内完成首条可用路由上线
2. 表单错误在保存前尽量拦截

### WP-05 Request Diagnostics UI（P0）
目标：
- 让值班和运营解释一次请求发生了什么

页面/组件：
1. Request Detail Drawer
2. Fallback Timeline
3. Error Classification Badge
4. Route Resolution Summary

验收：
1. 3 次点击内看到一次失败请求为何失败
2. 3 次点击内看到一次 fallback 是如何发生的

### WP-06 Usage & Cost UI（P0）
目标：
- 让成本和用量可视化并可钻取

页面：
1. Cost KPI cards
2. provider/model breakdown
3. end_user breakdown
4. anomaly cards
5. detail table

筛选：
1. time range
2. provider
3. model
4. project
5. end_user
6. route mode

验收：
1. 3 次点击内定位高成本来源
2. 支持 provider/model drill-down

### WP-07 Routing Dry-run & Impact Preview（P1）
目标：
- 降低配置变更风险

页面能力：
1. 输入 model string 看解析结果
2. 查看 fallback path
3. 修改 routing/pricing 前查看影响范围与成本变化

验收：
1. 关键策略变更前有明确预演
2. 用户能看懂“会影响哪些请求”

---

## 4. 页面级交付清单

### Runtime / Connections
1. 连接列表
2. 健康状态
3. 启停控制
4. priority 编辑

### Runtime / Models
1. 模型列表
2. capability tags
3. context/max tokens
4. 价格摘要

### Runtime / Routing
1. alias 列表
2. combo 列表
3. fallback policy 展示
4. dry-run 入口

### Runtime / Pricing
1. 默认价
2. 项目覆盖价
3. 版本历史
4. missing price quality banner

### Usage & Cost
1. KPI
2. trend
3. provider/model tables
4. anomaly cards
5. request detail drawer

---

## 5. API 级交付清单

### Runtime Control Plane
1. `GET/POST /runtime/providers`
2. `GET/PUT/DELETE /runtime/providers/{id}`
3. `GET/POST /runtime/models`
4. `GET/PUT/DELETE /runtime/models/{id}`
5. `GET/POST /runtime/routing/aliases`
6. `GET/PUT/DELETE /runtime/routing/aliases/{alias}`
7. `GET/POST /runtime/routing/combos`
8. `GET/PUT/DELETE /runtime/routing/combos/{combo}`
9. `GET/PATCH/DELETE /runtime/pricing`

### Data Plane
1. `POST /llm/chat/completions`

### Observability / Usage
1. `GET /usage`
2. `GET /usage/kpi`
3. `GET /usage/timeseries`
4. `GET /limits/summary`
5. `GET /usage/runtime-observability`

---

## 6. UX 文案与状态规则

### 正常态
1. `Completed`

### 自动恢复态
1. `Retried automatically`
2. `Switched to backup model`
3. `Recovered`

### 需处理态
1. `Permission required`
2. `Quota exhausted`
3. `No valid route`
4. `Pricing configuration incomplete`

### 系统故障态
1. `Platform issue`

规则：
1. 不把 tool error / upstream retryable 直接显示成阻断错误态
2. 所有这些状态必须进入 i18n 与 testid 规范

---

## 7. 测试计划映射

### 类型/契约
1. `ws:typecheck`
2. `contracts:check-openapi`
3. `openapi:check-generated`

### 单元测试
1. routing parser
2. fallback classifier
3. cost calculator
4. pricing resolver

### 集成测试
1. direct route
2. alias route
3. combo route
4. combo full failure
5. governance reject in combo path
6. missing price path

### E2E
1. Connections CRUD
2. Models CRUD
3. Alias/Combo CRUD
4. Pricing CRUD
5. Unified proxy request success
6. Fallback timeline visible
7. Usage & Cost filters and drill-down

### Visual
1. Runtime main page
2. Routing editor
3. Pricing page
4. Usage & Cost page
5. Request detail drawer

---

## 8. 里程碑门禁

### Gate A：架构冻结
1. 数据模型冻结
2. 错误分类冻结
3. 价格精度与版本策略冻结

### Gate B：后端闭环
1. Unified proxy direct/alias/combo 跑通
2. usage fact 成本字段落库

### Gate C：前端闭环
1. 控制面可用
2. request diagnostics 可用
3. Usage & Cost 可钻取

### Gate D：发布闭环
1. 真实链路 smoke PASS
2. governance smoke PASS
3. release report PASS

---

## 9. 建议执行顺序

1. 先做 `WP-01 + WP-02 + WP-03`
- 没有稳定 runtime 内核，前端都是空壳。

2. 再做 `WP-04 + WP-05`
- 先确保用户能配、能看懂。

3. 再做 `WP-06`
- 运营视角补全。

4. 最后做 `WP-07`
- 决策增强不应阻塞主闭环。

---

## 10. 最终退出标准

1. 产品对象定义与页面 IA 不再摇摆。
2. Runtime 主链路 direct/alias/combo 全部可用。
3. 成本事实完整、可追责、可钻取。
4. 用户不会把可恢复错误误解为系统故障。
5. 发布门禁与真实链路验证连续通过。
