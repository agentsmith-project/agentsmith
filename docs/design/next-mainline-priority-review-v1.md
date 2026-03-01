# Next Mainline Priority Review v1

更新时间：2026-03-01  
状态：`current-recommendation`

前置参考：

1. `README.md`
2. `docs/项目宪法.md`
3. `docs/release/internal-release-capability-matrix.md`
4. `docs/release/internal-release-note-2026-02-28-closure.md`
5. `docs/plans/next-release-product-roadmap-prd-v1.md`
6. `docs/plans/governance-real-backend-phase2-plan.md`
7. `docs/design/agentsmith-product-engineering-governance-methodology-v1.md`

---

## 1. 这份评估要回答什么

当前需要回答的不是“还能做什么功能”，而是：

1. 在当前代码和产品基线下，最应该投入的下一条主线是什么
2. 哪些能力已经足够成熟，不应继续占用主线预算
3. 哪些能力虽然重要，但现在还不应排在最前面

---

## 2. 当前产品基线判断

### 2.1 没有发生产品初衷漂移

当前代码、文档和项目宪章仍然围绕同一个核心：

1. 企业级 AI 智能体使用与管理
2. AI 资源治理
3. 运行与发布治理

也就是说，产品没有偏成：

1. 纯工程发布工具
2. 纯 AI playground
3. 纯 BI 看板

方向是稳定的。

### 2.2 已经成熟的主线

以下主线当前不应再继续作为下一阶段最高优先级：

1. Runtime Control Plane
2. Usage / Cost Operations
3. Release Governance Control Plane
4. AI Ops Home 与任务化 UX 重构

这些能力仍可继续优化，但继续投入的边际收益已经下降。

---

## 3. 当前真正的主线空白

### 3.1 治理后端执行深度仍未闭环

这是当前最明确的产品与工程空白。

根据现有基线：

1. `Members` 后端权限/生命周期仍是 partial
2. `Resource Policy` enforcement 仍是 partial
3. 本地 real-backend route authz 仍未完全按成员模板 / 自定义权限 / 分组权限 / 资源策略统一决策

这意味着：

1. 前端治理控制面已经很强
2. 但部分治理配置还没有成为后端唯一权威行为

这与项目宪章里“后端为唯一权威”的原则仍有差距。

### 3.2 SSE 安全链路仍有正式外发阻塞

虽然 `/api/v1/sse-ticket` contract 和前端链路已经存在，但当前基线仍保留：

1. `ticket` 实际上仍可能等于 bearer token
2. JWT query fallback 仍未完全移除

这对内部阶段可接受，但对更高标准发布不够。

这不是表面安全项，而是明确的主线级技术债。

### 3.3 治理证据已经比治理执行更成熟

当前系统在以下方面已经很强：

1. release evidence
2. runtime evidence
3. usage evidence
4. incident / escalation / override / SLA

但执行层还存在：

1. policy 只部分真实生效
2. member authz 与 UI 预期不完全一致
3. policy precedence 还没完全通过后端统一引擎收口

这是一种典型不平衡：

1. 治理可观测性已很成熟
2. 治理执行权威还没完全补齐

下一主线应优先修复这个失衡。

---

## 4. 下一条主线建议

建议下一主线正式定义为：

`Governance Execution Closure & Security Hardening`

中文可表述为：

`治理执行闭环与安全链路收口`

这条主线的目标不是再做治理页面，而是把“治理配置 -> 后端执行 -> 审计/用量证据 -> 发布门禁”彻底打通。

---

## 5. 为什么它是第一优先级

### 5.1 它直接关系到产品是否真正企业级

企业级平台不能停留在：

1. 可以配置
2. 可以看证据
3. 可以做发布治理

而必须达到：

1. 配置必然进入真实后端决策
2. 决策可解释
3. 行为可审计
4. 安全链路不依赖临时 fallback

### 5.2 它比继续做 Runtime / UX / Release 更有价值

当前继续做以下方向，优先级都不应高于它：

1. 继续扩 `Release Ops` 页面
2. 继续做 UX polish
3. 继续加 runtime compare / dashboard 新卡片
4. 继续做商业计费 / invoice

原因很简单：

1. 这些能力大多已经“够用且成体系”
2. 而治理执行深度仍然是平台可信度的真实短板

### 5.3 它也最符合现有 PRD 的未完成部分

当前最早的下一期路线图里，真正还没彻底完成的 P0，核心就是：

1. 治理执行一致性
2. SSE ticket 安全收口
3. 治理证据与发布门禁的外发级可信度

所以这不是新话题，而是回到尚未完全完成的主产品承诺。

---

## 6. 推荐拆分

### Track A：统一后端授权与治理决策链（P0）

目标：

1. 统一 member template / custom permission / group permission / resource policy precedence
2. 让 route authz 不再依赖简化 owner/operator resolver
3. 每次判定可 explain

关键结果：

1. UI 与 backend authz 语义一致
2. 成员治理不再只是表单系统

### Track B：Resource Policy Enforcement 扩面（P0）

目标：

1. 将当前 baseline enforcement 扩展到 UI 已配置的关键 `rate_limits / quota_limits`
2. 覆盖 endpoint / source_library / agent 的一致行为
3. 行为进入 Audit / Usage 证据

关键结果：

1. policy 不是“部分支持”
2. 策略变更可被真实证明

### Track C：Members Lifecycle Closure（P0）

目标：

1. suspension / restore / revoke 行为补齐
2. downstream effect 验证补齐
3. 与权限模板、配额模板、分组应用形成一致闭环

关键结果：

1. 成员生命周期不再停留在 UI 操作层
2. 撤销/恢复对真实资源访问有可见后果

### Track D：SSE Ticket Hardening（P0）

目标：

1. `/sse-ticket` 产生真正的短期 ticket
2. 关闭 JWT query fallback
3. 新增专项 smoke：连接、重连、续期、失败分类

关键结果：

1. 安全链路达到正式对外交付标准
2. 安全项不再停留在“内部接受”

### Track E：Release Gate Extension（P1）

目标：

1. 把 governance execution effect 纳入 release gate
2. 区分 transient 与 structural governance failure
3. 强化 capability matrix 与 closure 文档

关键结果：

1. 发布门禁真正覆盖治理执行深度
2. 不会只验证页面存在，而忽略后端实际行为

---

## 7. 当前不建议优先做的方向

### 7.1 不建议继续把 `Release Ops` 当主线

原因：

1. 当前已具备 policy / override / run / escalation / incident / SLA
2. 再做更多页面层能力，无法替代治理执行深度

### 7.2 不建议继续把 UX polish 当主线

原因：

1. 结构债已收口
2. 继续做只是低优先级视觉收益

### 7.3 不建议现在做商业 billing/invoice

原因：

1. 当前成本治理已经足够支持内部运营
2. 企业级治理闭环仍未完全打透
3. 过早做商业计费会分散核心资源

### 7.4 不建议现在把多实例 runtime 协调排到 P0

原因：

1. 这是重要问题，但当前 capability matrix 显示更真实的短板仍在治理执行与 SSE 安全
2. 多实例更适合在上述闭环完成后进入下一阶段基础设施主线

---

## 8. 推荐的执行顺序

建议按以下顺序进入下一主线：

1. `Track A 统一后端授权与治理决策链`
2. `Track B Resource Policy Enforcement 扩面`
3. `Track C Members Lifecycle Closure`
4. `Track D SSE Ticket Hardening`
5. `Track E Release Gate Extension`

原因：

1. 先统一语义和决策边界
2. 再扩 enforcement breadth
3. 再补 lifecycle effect
4. 再收安全链路
5. 最后把这些真实能力接进正式门禁

---

## 9. 建议的主线名称

建议下一主线在文档和任务拆分中统一使用：

`Governance Execution Closure & Security Hardening`

如果用中文，建议写为：

`治理执行闭环与安全链路收口`

这个名字比“governance phase 2”更准确，因为它同时覆盖：

1. 授权执行
2. 资源策略执行
3. 成员生命周期
4. SSE 安全链路
5. 发布门禁扩展

---

## 10. 最终建议

从当前基线出发，下一条最合理的产品/工程主线不是再做新的控制面，而是：

**把治理从“控制面很强、证据很强”推进到“后端执行完全可信、安全链路正式收口”。**

这才是当前阶段最值得投入的主线。
