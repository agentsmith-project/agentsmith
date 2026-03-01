# AgentSmith 产品研发与治理方法论 v1

更新时间：2026-03-01  
状态：`current-baseline`

---

## 1. 这份文档解决什么问题

这不是一份功能说明，也不是单次 PRD 文档。  
它回答的是：

1. 我们如何定义一个内部产品
2. 我们如何把产品设计、工程实现、测试、发布、治理收成一套体系
3. 为什么这套体系能复制到别的团队和别的产品线
4. 团队成员应该学习什么理论和实践框架

目标不是“写一堆规范”，而是形成一种可复制的工作方法。

---

## 2. 我们的方法论总纲

一句话概括：

**先把产品对象和运行时真相定义清楚，再用合约、证据、门禁和治理控制把系统收成可运营、可发布、可追责的产品。**

这套方法论由六层组成：

1. `Product Model`
2. `Runtime Truth`
3. `Contract First`
4. `Evidence Driven Delivery`
5. `Governance by Control Plane`
6. `Operational Closure`

它的核心思想不是“功能交付”，而是：

1. 功能必须进入真实运行态
2. 运行态必须有证据
3. 证据必须进入治理系统
4. 治理系统必须能反过来控制发布行为

---

## 3. 产品方法论

### 3.1 先定义对象，不先堆页面

我们不从“页面列表”开始，而从产品对象开始。

在 runtime 主线里，我们先冻结：

1. `Connection`
2. `Model`
3. `Alias`
4. `Combo`
5. `Pricing Rule`

在 release governance 主线里，我们先冻结：

1. `Release Report`
2. `Gate Run`
3. `Policy Issue`
4. `Override`
5. `Escalation`
6. `Incident`

原因：

1. 页面只是对象的可视化，不应成为系统真相
2. 如果对象定义模糊，后面 API、测试、UX、报表都会互相打架

### 3.2 先定义运行时真相，不先定义后台配置

一个系统真正的产品价值，不在“能配”，而在“配了之后会如何运行”。

所以我们优先关注：

1. 请求最终命中谁
2. 为什么 fallback
3. 为什么失败
4. 这次成本怎么来的
5. 这次发布为什么被阻断

这就是我们反复强调的 `runtime truth`。

### 3.3 把“异常”重新定义为产品正常态的一部分

在 LLM / provider / proxy / governance 这类系统里：

1. 429
2. timeout
3. token 失效
4. session 恢复
5. webhook 投递失败

都不是罕见异常，而是正常运行态的一部分。

所以产品设计上：

1. 不把所有失败都呈现为“系统出错”
2. 把“可恢复失败”设计成系统正常工作的一部分
3. 把“恢复过程”和“最终结果”一起显式展示

这直接影响 UX、日志、状态机和验收标准。

### 3.4 默认从运营视角设计，而不是配置视角

我们做的不是静态后台，而是内部运营系统。

所以一个页面必须回答：

1. 现在发生了什么
2. 为什么发生
3. 谁负责
4. 是否阻断发布
5. 下一步该做什么

如果一个页面只能“编辑配置”，那只是后台；不是控制面。

---

## 4. 工程方法论

### 4.1 Contract First，而不是 UI First

我们的顺序是：

1. 冻结产品对象
2. 冻结 contract / schema / error semantics
3. 搭 domain / storage / service
4. 再接 UI

而不是：

1. 先做一个页面
2. 再让后端“配合一下”

原因：

1. contract 是团队协作边界
2. contract 是测试边界
3. contract 是长期演进边界

### 4.2 分层不是为了好看，是为了收敛复杂度

我们采用的分层原则很简单：

1. `handler` 只做 HTTP 适配和 request/response 编排
2. `service` 负责业务流程编排
3. `domain` 负责约束和不变量
4. `store/repository` 负责持久化边界

如果 handler 里同时有：

1. 领域校验
2. 跨对象约束
3. 持久化细节
4. fallback 流程
5. response 拼装

那后续一定会失控。

### 4.3 不接受“脚疼医脚”的补丁式修复

我们在主线上一直避免：

1. 为了通过单个测试临时绕过结构问题
2. 继续保留过时 payload path
3. 在 UI 上掩盖后端不一致
4. 在 mock 里伪造和真实 contract 不一致的行为

最佳实践是：

1. 找到统一语义
2. 找到共享 contract
3. 找到正确的系统边界
4. 一次收紧整条链路

### 4.4 把“证据”作为一等产物

我们不把测试当成“跑一下就完了”的过程。

我们把这些东西当成正式产物：

1. runtime evidence
2. usage evidence
3. release reports
4. gate runs
5. escalations

这意味着：

1. 测试结果不是临时输出，而是治理输入
2. 验收不靠口头描述，而靠 artifact

---

## 5. 测试与验证方法论

### 5.1 采用分层验证，而不是单一大回归

我们的验证层级是：

1. type / contract
2. unit
3. integration
4. browser e2e
5. visual e2e
6. real-lane smoke
7. release report

每一层的职责不同：

1. type / contract：防止语义漂移
2. unit：验证局部逻辑和状态机
3. integration：验证服务与持久化边界
4. browser e2e：验证用户流程
5. visual：验证界面稳定性
6. real-lane：验证真实外部依赖
7. report：汇总成治理结论

### 5.2 Mock lane 与 Real lane 必须分离

这是很关键的一条经验。

我们明确区分：

1. `Mock lane`
2. `Real lane`

原因：

1. mock lane 负责稳定、快速、可重复的 UI/contract 验收
2. real lane 负责真实后端/真实 provider/真实认证/真实网络行为

如果混在一起：

1. 验收会不稳定
2. 问题会难以归因
3. 团队会开始怀疑测试体系本身

### 5.3 真实链路不稳定是产品前提，不是测试借口

上游不稳定并不意味着测试可以放弃。

正确做法是：

1. 在产品和测试里都承认上游不稳定
2. 把 transient failure 与 structural failure 分开
3. 对 transient failure 允许 retry / rerun / self-heal
4. 对 structural failure 保持 blocker 语义

也就是说：

**不是“因为上游不稳定，所以不测”；而是“因为上游不稳定，所以要测系统如何应对这种不稳定”。**

### 5.4 验收必须有 formal gate

我们不接受“功能差不多了、人工看过了”的发布方式。

一个主线最终必须进入：

1. smoke
2. report
3. evidence
4. policy
5. enforcement

这就是为什么后面会有：

1. `release report`
2. `release policy`
3. `gate runner`
4. `Release Ops`

---

## 6. 治理方法论

### 6.1 治理不是文档，是控制面

传统团队常见问题：

1. 有很多规范文档
2. 但系统本身并不会执行这些规范

我们的做法是把治理变成产品能力：

1. policy engine
2. override workflow
3. gate run history
4. escalation workflow
5. incident linkage
6. ownership / SLA

所以治理不是“说应该怎样”，而是“系统能强制、能追踪、能审计”。

### 6.2 统一策略，而不是分散判断

一个系统里最危险的事情之一，是每个页面、脚本、流程都自己判断“能不能发”。

所以我们做了统一 `Release Policy Engine`。

它的作用：

1. 把 execution/runtime/usage/governance 信号统一收敛
2. 给出统一 decision
3. 给出 blocker / warning 分类
4. 再进入 enforcement

这能避免：

1. 页面 A 说能发
2. 报告 B 说不能发
3. 运营 C 说先发再说

### 6.3 允许例外，但例外必须被治理

成熟系统不是“绝不允许例外”，而是：

1. 允许例外
2. 但例外必须可审计、可过期、可批准、可追责

这就是 override 工作流的意义。

一个好的 override 体系至少要有：

1. reason
2. reason category
3. expiry
4. approver
5. self-approval prohibition
6. effect on enforcement

### 6.4 Incident 是治理主键

如果系统没有 `incident` 概念，就会出现：

1. run 一份
2. escalation 一份
3. override 一份
4. 人工在脑子里把它们连起来

这不可扩展。

所以我们引入 `incident_id`，把：

1. report
2. gate run
3. escalation
4. override
5. handoff history

收进一条线。

这背后的思想是：

**治理不是看对象列表，而是管理问题生命周期。**

### 6.5 Ownership 和 SLA 是治理闭环的最后一层

如果只有 blocker，但没有：

1. owner
2. due time
3. reassignment history
4. resolution category

那治理只是“报警”，不是“处置系统”。

所以我们把 escalation 继续推进到：

1. assignment
2. SLA state
3. incident summary
4. handoff history

---

## 7. 过程治理方法论

### 7.1 基线冻结

每条主线都要有：

1. decision memo
2. implementation plan
3. closure note
4. runbook

它们的作用不同：

1. `decision memo`：冻结为什么这么做
2. `implementation plan`：冻结怎么分阶段做
3. `closure note`：冻结验收结论
4. `runbook`：冻结怎么运行和处置

### 7.2 文档必须与系统一同演化

常见错误是：

1. 代码改完
2. 文档落后几周

我们这里的规则是：

当以下任一项变化时，必须同步更新文档基线：

1. contract semantics
2. release governance logic
3. operator workflow
4. acceptance rule

### 7.3 以工作包推进，而不是无边界迭代

我们把复杂主线拆成：

1. `WP-08` 到 `WP-16`

这样做的意义是：

1. 每个工作包有清晰目标
2. 每个工作包有清晰门禁
3. 每个工作包完成后能形成稳定基线

这比“持续优化一下”更容易收口，也更容易让团队学习。

### 7.4 先收口，再换主线

我们强调：

1. 功能做完不等于主线完成
2. 要把自动化、文档、门禁、治理都补齐
3. 收口完成后再切下一条主线

否则团队会不断背历史债。

---

## 8. 这套方法论参考什么理论

这套方法论不是直接照搬单一本书，但它和一些成熟理论高度一致。

### 8.1 Domain-Driven Design（DDD）

建议学习重点：

1. `domain model`
2. `bounded context`
3. `ubiquitous language`
4. `aggregates / invariants`

为什么相关：

1. 我们先冻结对象
2. 我们强调领域不变量
3. 我们把 handler/service/domain/store 分开

适合学习：

1. Eric Evans《Domain-Driven Design》
2. Vaughn Vernon《Implementing Domain-Driven Design》

### 8.2 Lean Product / Product Discovery

建议学习重点：

1. 先定义问题和对象
2. 区分产品价值与功能堆叠
3. 关注运营闭环

为什么相关：

1. 我们不是为了“接更多 provider”
2. 而是为了“可控、可解释、可追责”

适合学习：

1. Marty Cagan《Inspired》
2. Teresa Torres《Continuous Discovery Habits》

### 8.3 Site Reliability Engineering（SRE）

建议学习重点：

1. 错误预算
2. 可恢复失败
3. 运行证据
4. 事件管理

为什么相关：

1. 我们把 transient failure 当成系统正常态的一部分
2. 我们强调 evidence、SLA、incident、runbook

适合学习：

1. Google SRE Book
2. The Site Reliability Workbook

### 8.4 Policy-as-Code / Governance-as-Code

建议学习重点：

1. 把策略变成可执行系统能力
2. 统一 decision，而不是文档口号

为什么相关：

1. 我们有 `Release Policy Engine`
2. 我们把治理转化成 control plane

可以延展了解：

1. OPA / Rego 的思想
2. GitOps 中的策略控制思路

### 8.5 Accelerate / DevOps 研究

建议学习重点：

1. 交付速度与稳定性并不矛盾
2. 小步验证、自动化门禁、可观测性

为什么相关：

1. 我们不是牺牲质量换速度
2. 而是通过 gates、evidence、runbook 提升稳定交付能力

建议学习：

1. 《Accelerate》
2. 《Team Topologies》

### 8.6 Incident Management / Operational Excellence

建议学习重点：

1. 事件分级
2. ownership
3. handoff
4. resolution taxonomy
5. audit trail

为什么相关：

1. 我们后面做的 escalation / incident / handoff history，本质上就是轻量事件管理系统

---

## 9. 团队如何复制这套经验

如果要把这套经验复制到别的团队，建议按这个顺序：

### 第一步：统一语言

先统一产品对象和运行时术语。

要求：

1. 同一个词只有一个意思
2. 一个对象只有一个主语义
3. 页面、API、测试、文档都用同一套词

### 第二步：统一合约

不要先做页面，先冻结：

1. 对象 schema
2. 状态机
3. 错误语义
4. 验收语义

### 第三步：建立分层验证

最少要有：

1. type / contract
2. integration
3. browser e2e
4. visual
5. release report

### 第四步：把证据写成产物

不要让测试结果只存在日志里。

要把它们变成：

1. artifact
2. summary
3. policy input

### 第五步：把治理做成产品能力

最少要有：

1. policy engine
2. override
3. run history
4. escalation
5. incident

### 第六步：补 runbook 和基线文档

否则知识只存在个别工程师脑子里，无法复制。

---

## 10. 我们最重要的经验教训

1. 先定义运行时真相，比先画后台页面重要
2. contract 的统一比局部功能完成更重要
3. mock lane 和 real lane 必须严格分离
4. “上游不稳定”不是不做治理的理由
5. release report 必须进入 control plane，而不是停留在文件系统
6. 允许 exception，但 exception 必须被治理
7. incident 是治理系统的真正主键
8. handoff history 和 SLA 是把“报警系统”升级成“处置系统”的关键
9. 文档必须和系统一起收口，否则经验无法复制
10. 一条主线必须完成“功能 + 自动化 + 治理 + runbook”后，才算真正完成

---

## 11. 对团队成员的学习建议

如果是产品经理，优先学习：

1. 如何定义对象和状态机
2. 如何把异常设计成正常运行态的一部分
3. 如何从配置视角转到运营视角

如果是开发工程师，优先学习：

1. DDD 的对象与不变量思想
2. contract-first 开发
3. 分层架构与证据化测试

如果是测试/QA/发布工程师，优先学习：

1. lane-based verification
2. evidence-driven acceptance
3. transient vs structural failure classification

如果是团队负责人，优先学习：

1. 如何建立统一产品语言
2. 如何把治理做成系统能力
3. 如何让每条主线都有明确收口标准

---

## 12. 本文档的维护规则

当以下任一项发生变化时，应更新本文档：

1. 产品方法论发生根本变化
2. release governance 机制发生变化
3. incident / override / policy 的治理模型变化
4. 团队把这套方法复制到新产品线，并形成新的稳定经验

相关基线文档：

1. `docs/plans/llm-runtime-final-implementation-plan-v2.md`
2. `docs/user-guides/release-verification.md`
3. `docs/user-guides/release-governance-control-plane.md`
4. `docs/release/internal-release-note-2026-02-28-closure.md`
5. `docs/项目宪法.md`
