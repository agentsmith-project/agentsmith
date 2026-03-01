# Governance Execution Closure & Security Hardening Plan v1

更新时间：2026-03-01  
状态：`approved-recommendation`

前置文档：

1. `docs/design/next-mainline-priority-review-v1.md`
2. `docs/plans/next-release-product-roadmap-prd-v1.md`
3. `docs/plans/governance-real-backend-phase2-plan.md`
4. `docs/release/internal-release-capability-matrix.md`
5. `docs/项目宪法.md`

---

## 1. 本计划的作用

这是一份下一主线的执行基线，用于：

1. 冻结范围
2. 明确优先级
3. 规定工作包顺序
4. 规定验收门禁
5. 防止再次回到“前端控制面继续扩张、后端执行深度滞后”的失衡状态

这条主线不是继续做治理页面，而是把治理配置真正推进到：

1. 后端统一决策
2. 真实运行时生效
3. 有审计和用量证据
4. 能进入正式 release gate

---

## 2. 主线目标

本主线要完成四个结果：

1. `Members / Resource Policy` 不再是 partial backend depth
2. route authz 与 UI 权限/策略语义一致
3. SSE 链路不再依赖 JWT query fallback
4. release gate 能验证治理执行效果，而不是只验证页面与表单

一句话：

**把治理从“可配置、可观测”推进到“可执行、可证明、可发布”。**

---

## 3. 范围冻结

### P0（本期必须完成）

1. 统一后端授权与治理决策链
2. Resource Policy enforcement 扩面
3. Members lifecycle closure
4. SSE ticket hardening
5. governance effect release gate 扩展

### P1（本期如有余力）

1. 更细的 subject precedence explain UI
2. 更多治理 effect 组合 smoke
3. 更系统的 capability matrix 视图化

### Out of Scope

1. 商业 billing / invoice
2. 多云多区域调度
3. 多级审批工作流
4. 新一轮大规模 UX 改版
5. 多实例 runtime 协调作为 P0 目标

---

## 4. 工作包

### WP-01 统一后端授权与治理决策链（P0）

目标：

1. 用统一授权引擎替换简化 owner/operator resolver
2. 冻结 precedence：
   - member custom
   - permission template
   - group template
   - resource policy
3. 所有关键 route authz 返回 explainable decision

交付：

1. backend authz decision service
2. precedence contract 文档
3. route authz integration tests
4. explain payload / audit snapshot

门禁：

1. deny -> grant -> allow -> rollback 全链路集成测试通过
2. UI 与 backend authz 语义一致
3. simplified resolver 不再作为正式主路径

### WP-02 Resource Policy Enforcement 扩面（P0）

目标：

1. 将 UI 已配置的重要 `rate_limits / quota_limits` 变成真实 runtime 行为
2. 补齐 endpoint / source_library / agent 三类资源的一致性
3. 行为进入 `Audit` / `Usage`

交付：

1. policy enforcement matrix
2. effect tests by resource type / limit type
3. policy rollback restore tests
4. evidence mapping into audit/usage

门禁：

1. policy 命中行为可证明
2. deny / rate / quota 三类效果均有证据
3. 关键 UI 配置项不再是“可配但不生效”

### WP-03 Members Lifecycle Closure（P0）

目标：

1. 补齐 suspension / restore / revoke
2. 补齐 membership downstream effect
3. 让 permissions / quota / groups / lifecycle 成为一个闭环

交付：

1. lifecycle route hardening
2. revoke/suspend/restore effect tests
3. membership audit completeness
4. member-related governance smoke 扩展

门禁：

1. suspension 后访问效果正确
2. restore 后行为恢复正确
3. revoke 后下游资源访问被真实收回

### WP-04 SSE Ticket Hardening（P0）

目标：

1. `/api/v1/sse-ticket` 产生真正的短期 ticket
2. ticket 独立于 JWT，本身不可作为长期 bearer 复用
3. 关闭 JWT query fallback

交付：

1. short-lived ticket backend implementation
2. single-use / expiry semantics
3. reconnect / renewal policy
4. dedicated smoke and integration tests

门禁：

1. SSE ticket 覆盖率 100%
2. fallback 关闭后主线与治理 smoke 全通过
3. 安全扫描不再命中 JWT query 风险项

### WP-05 Governance Effect Release Gate（P0）

目标：

1. release gate 不只看页面和现有 smoke
2. 还要验证治理 effect 是否真实生效
3. capability matrix 和 closure note 反映新的 backend depth

交付：

1. governance effect smoke 扩展
2. release report 分类增强
3. capability matrix 更新机制
4. structural vs transient governance failure 分类

门禁：

1. governance real-backend smoke 至少覆盖：
   - page open
   - basic interaction
   - one policy effect
   - one member permission or quota effect
2. release report 明确区分 governance structural failures
3. capability matrix 不再标注关键 path 为 partial

---

## 5. 执行顺序

必须按这个顺序执行：

1. `WP-01`
2. `WP-02`
3. `WP-03`
4. `WP-04`
5. `WP-05`

原因：

1. 先统一 authz 与 precedence，避免后续 enforcement 建在错误语义上
2. 再扩 policy enforcement breadth
3. 再补成员生命周期 effect
4. 再收 SSE 安全链路
5. 最后把这些能力接进正式 release gate

不允许的逆序：

1. 不允许先补页面 explain，再没有真实 backend explain
2. 不允许先加更多 governance 页面，再没有 effect closure
3. 不允许在 JWT fallback 仍长期存在时宣称外发级安全闭环

---

## 6. 技术改动面

预计主要涉及：

1. `packages/api-entry-node/src/auth.ts`
2. `packages/api-entry-node/src/request-handler.ts`
3. `packages/api-entry-node/src/*members*`
4. `packages/api-entry-node/src/*resource-policy*`
5. `packages/api-entry-node/src/*audit*`
6. `packages/api-entry-node/src/*usage*`
7. `src/lib/api/sse-client.ts`
8. governance smoke scripts
9. release report / capability matrix 文档链路

---

## 7. 验收标准

### 产品层

1. 平台管理员配置治理策略后，后端真实行为与 UI 预期一致
2. 管理员可以通过 Audit / Usage 证明治理已经生效
3. SSE 链路达到正式安全标准

### 工程层

1. contract / integration / e2e / release gate 各层验证闭环
2. governance effect 不再主要依赖 mock 解释
3. 关键 capability matrix 描述与真实代码一致

### 发布层

1. governance structural failures 能阻断 release
2. transient failures 能正确分类
3. release report / closure note 可直接反映治理执行深度

---

## 8. 风险

### 风险 1：统一 authz 引擎引发历史行为变化

应对：

1. 先冻结 precedence contract
2. 先补 explain / integration tests
3. 增量接入 route，而不是一次性全切

### 风险 2：policy enforcement 扩面后暴露大量历史配置不一致

应对：

1. 先做 capability matrix 清点
2. 先覆盖高价值 path
3. 对不兼容配置提供明确错误与回滚验证

### 风险 3：SSE ticket 切换引发现有流式链路不稳定

应对：

1. 先实现独立 ticket 与 expiry
2. 先跑专项 smoke
3. 再关闭 fallback

### 风险 4：release gate runtime 增长过快

应对：

1. 把深组合留给 targeted integration tests
2. 只把高信号 scenario 放进 default gate

---

## 9. 退出条件

本主线可以收口的条件是：

1. `Members` 与 `Resource Policy` 不再被 capability matrix 标记为关键 partial path
2. governance effect smoke 覆盖 page + interaction + effect
3. SSE ticket fallback 移除后，主线与治理 smoke 连续通过
4. release report 可以明确展示 governance execution 结果
5. 宪章中“后端为唯一权威”的原则在关键治理 path 上被真实满足

---

## 10. 建议提交节奏

建议至少拆成五组提交：

1. `governance: unify backend authz decision chain`
2. `governance: expand resource policy enforcement coverage`
3. `members: close lifecycle effect paths`
4. `security: harden sse ticket flow`
5. `release: gate governance execution effects`

这样便于：

1. 单独回归
2. 单独审查
3. 单独回滚

---

## 11. 最终建议

从现在开始，下一主线不应再围绕“控制面再增强”，而应围绕：

**治理是否真正生效，安全链路是否真正可发布。**

这条计划就是接下来编码工作的正式基线。
