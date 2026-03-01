# Governance Explainability & Effective Access Console Plan v1

更新时间：2026-03-01  
状态：`baseline-complete`

前置文档：

1. `docs/design/project-maturity-productization-review-v1.md`
2. `docs/项目宪法.md`
3. `docs/release/internal-release-capability-matrix.md`
4. `docs/design/agentsmith-product-engineering-governance-methodology-v1.md`

---

## 1. 本计划的作用

这份计划用于冻结下一主线的执行边界：

1. 不再继续扩治理页面数量
2. 不再回到纯后端 effect 修补
3. 专注把已有治理执行结果产品化为 explainability 能力

一句话：

**把已经正确运行的治理后端，变成用户和运营人员能直接理解、验证、排障的控制台。**

---

## 2. 主线目标

本主线要完成四个结果：

1. `Members` 页面能展示 effective access，而不是只展示配置值
2. `Resource Policy` 页面能解释 matched policy 和 deny reason
3. 出现访问拒绝或 quota 超限时，用户可以直接定位到生效规则
4. `Audit / Usage / Govern / Operate` 之间形成统一的 explain drill-down

---

## 3. 范围冻结

### P0

1. Effective Access 解释模型
2. Members effective permission / membership explain
3. Resource Policy effective rule / matched policy explain
4. Quota explain 与超限原因展示
5. Explainability drill-down 与验证链路

### P1

1. Permission simulation
2. Subject precedence 可视化
3. Policy impact preview for govern changes

### Out of Scope

1. 新一轮大规模 runtime UI 增强
2. 商业计费/对外账单
3. 新审批流
4. 新一轮 release ops 大扩张

---

## 4. 工作包

### WP-01 Effective Access Contract（P0）

目标：

1. 冻结前端可消费的 explain contract
2. 统一这些后端事实的前端模型：
   - `membership_status`
   - `effective_permissions`
   - per-permission `decisions`
   - `matched_policy`
   - quota deny reason / quota key

交付：

1. typed API endpoint adapters
2. hooks
3. explainability DTO mapping
4. contract tests

门禁：

1. 前端不再直接消费零散 raw payload
2. explain contract 稳定进入 API 层

### WP-02 Members Effective Access Console（P0）

目标：

1. 在 `Members` 中加入 effective access view
2. 让管理员能看到某成员当前：
   - membership 状态
   - effective permissions
   - source detail
   - deny reason

交付：

1. member detail drawer explain tab
2. effective permission source badges
3. membership lifecycle explain panel
4. direct authorize check action

门禁：

1. 一个成员的 grant/deny 不需要读源码即可解释
2. suspend/restore/revoke 结果有可见差异

### WP-03 Resource Policy Explain Console（P0）

目标：

1. 在 `Resource Policy` 中加入 effective policy explain
2. 让管理员能看到：
   - 哪条 policy 生效
   - subject 为什么命中/没命中
   - 当前 access_mode 和 effective rule

交付：

1. resource detail explain panel
2. matched policy card
3. subject access check action
4. deny/allow explain summary

门禁：

1. endpoint/source_library/agent 三类资源都能 explain
2. policy precedence 可被直观看见

### WP-04 Quota Explain & Evidence Drill-down（P0）

目标：

1. 把 quota 超限从“错误码”提升成“可解释事件”
2. 让用户知道：
   - 命中了哪条 quota
   - 当前有效 quota 来自哪里
   - 有哪些相关审计和 usage 证据

交付：

1. quota explain card
2. quota evidence links to audit/usage
3. quota override effective summary

门禁：

1. `RESOURCE_POLICY_QUOTA_EXCEEDED` 能在 UI 上被直接解释
2. 证据 drill-down 不需要人工拼链路

### WP-05 Cross-Surface Explain Workflow（P0）

目标：

1. 建立跨页面 drill-down 工作流：
   - Govern -> Audit
   - Govern -> Usage
   - Govern -> Runtime / Release evidence when relevant
2. 统一 deny / allow / quota / membership 的状态语言和动作

交付：

1. shared explain filter context
2. cross-page links
3. targeted e2e scenarios
4. explainability closure report

门禁：

1. 从一个 deny 结果到定位 policy/member/quota 证据，路径不超过 3 步
2. 关键 explain workflow 有 e2e 覆盖

---

## 5. 执行顺序

必须按如下顺序推进：

1. `WP-01 Effective Access Contract`
2. `WP-02 Members Effective Access Console`
3. `WP-03 Resource Policy Explain Console`
4. `WP-04 Quota Explain & Evidence Drill-down`
5. `WP-05 Cross-Surface Explain Workflow`

原因：

1. 先固化 explain contract，避免 UI 继续直接绑 backend 内部形状
2. 先从 `Members` 做 effective access，因为这是最常见的治理排障入口
3. 再做 `Resource Policy`，补足规则解释
4. 再把 quota 事件和 evidence 连起来
5. 最后统一跨页面任务流

---

## 6. 主要改动面

预计涉及：

1. `src/lib/api/endpoints/members.ts`
2. 新的 governance explainability endpoint adapters / hooks
3. `src/components/members/*`
4. `src/components/resource-policy/*`
5. `src/components/audit-usage/*`
6. `src/lib/ops-filter-context.ts`
7. 相关 OpenAPI / contract tests / e2e

---

## 7. 验收标准

### 产品层

1. 成员访问拒绝能被 UI 直接解释
2. 资源策略命中路径能被 UI 直接解释
3. 配额超限能看到有效规则与证据

### 工程层

1. explain contract 有 typed API 和测试
2. 不继续在 UI 里散落后端细节判断
3. 关键 explain workflow 有 e2e 验收

### 运营层

1. 管理员定位一次 deny / quota 事件不再需要读 smoke 或源码
2. effective access 成为正式产品能力，而不是隐含 backend 能力

---

## 8. 结束条件

当以下条件全部满足时，本主线可视为完成：

1. `Members` 已具备 effective access explain
2. `Resource Policy` 已具备 matched policy explain
3. quota explain 与 evidence drill-down 已打通
4. cross-surface explain workflow 的 e2e 已通过
5. explainability 基线已写入文档

---

## 9. 完成状态

当前阶段已完成：

1. `WP-01 Effective Access Contract`
2. `WP-02 Members Effective Access Console`
3. `WP-03 Resource Policy Explain Console`
4. `WP-04 Quota Explain & Evidence Drill-down`
5. `WP-05 Cross-Surface Explain Workflow`

本轮已形成的正式基线：

1. `Members` 可以展示成员的 effective access、membership 状态、effective permissions 与 quota overrides
2. `Resource Policy` 可以对当前资源执行 subject access explain，并展示 matched policy / source / reason
3. `Usage / Audit` 对 quota exceeded、resource policy denied、route forbidden 已提供结构化治理证据展示
4. `Usage / Audit -> Members / Resource Policy` 的 explain drill-down 已带上下文打通
5. explainability 关键路径已经具备 typed contract、组件测试、目标 e2e 和 visual 回归验证

后续若继续推进，应视为 explainability 第二阶段，而不是继续沿用本计划作为活动主线。
