# AgentSmith 产品研发与治理方法论 v1

更新时间：2026-03-12  
状态：`current-baseline`

## 1. 方法论目标

这份文档定义的是“如何持续交付一个可运营、可治理、可追责的企业控制面”，不是阶段性项目总结。

核心目标：

1. 先定义产品对象、租户边界与身份真相
2. 再用合同和证据把系统收紧
3. 最后用控制面把治理闭环落到日常运行

## 2. 当前唯一主线

AgentSmith 当前只采用一条治理主线：

1. 项目级治理（project scope）
2. LLM endpoint 统一约束链路
3. Chat / Notebook / API 共用同一套约束与审计证据

约束对象：

1. rate limit
2. spending limit
3. policy audit evidence
4. usage evidence

补充边界：

1. `release` / `engineering gate` 只属于 AgentSmith 自身研发流程与工程验收语境。
2. 产品能力不提供 DevOps 发布编排、发布门禁或外部发布运营对象。
3. 当前 MVP 对外产品面只有 `Usage` 与 `Audit`。
4. 若必须描述底层技术职责，应使用更具体的词，例如 `agent execution`、`notebook execution`、`model request execution`、`model catalog sync`、`project pricing config`；不再用 `Runtime` 这种大词兜底，也不再把它扩张成独立产品面。
5. 系统超级管理员入口与 workspace 业务入口必须分离。
6. Authn 由 workspace 绑定的 IdP 提供；Authz 由 AgentSmith 执行。
7. workspace 生命周期只归系统超级管理员管理。

## 3. 六层方法框架

1. Product Model
- 对象先行：`Resource`、`UsageRecord`、`LimitRecord`、`ConfigurationChange`、`SystemEvent`
- 系统级对象补充：`SystemAdmin`、`Workspace`、`WorkspaceAdmin`、`IdentityProviderConfig`、`WorkspaceDataConfig`
- 页面是对象的投影，不是系统真相
- 不把实现细节对象抬升为产品对象

2. Runtime Truth
- 只认运行时事实，不认配置想象
- 关注“请求最终如何被允许/拒绝、为何触发限流/限额、证据是否完整”
- 这里强调的是系统运行事实，不是独立产品模块；落到实现时应尽量拆成具体职责名，而不是继续使用模糊的 `runtime` 大词

补充发布与部署真相：
- 地址、身份主键、执行方访问 contract 都属于 Runtime Truth，不属于“配置想象”
- 配置只表达稳定角色，不表达 docker bridge、临时 IP、宿主机偶然网络细节
- 同一关键真相必须在开发 gate、本地预检、部署后 verify 三层逐步证明
- deploy verify 是最终兜底，不是第一次发现设计漏洞的地方

补充身份真相：
- Authn 来源于 workspace IdP。
- Authz 来源于 AgentSmith permission token 与授权关系。
- workspace 成员来源不在 AgentSmith 内重复管理。

3. Contract First
- 先收紧 OpenAPI/AsyncAPI 与错误语义
- 前后端都从合同生成与消费，不做口头约定

4. Evidence Driven Delivery
- 所有关键链路必须可产出证据
- 验收基于证据，而非人工“看起来可用”

5. Governance by Control Plane
- 治理是产品能力，不是文档注释
- 当前 MVP 中治理能力落在 `Audit`，不是多控制台并存
- 系统级 workspace 生命周期与配置管理落在独立系统管理面，不与项目业务治理面混杂

6. Operational Closure
- 每次问题必须进入 owner/SLA/处置闭环
- 治理异常应能定位、归因、复盘

## 4. 工程执行规则

1. 合同优先
- 任何 API 变更先改合同，再改实现，再改 UI

2. 分层收敛复杂度
- handler: 仅协议适配
- service: 业务编排
- domain: 规则与不变量
- store: 持久化边界

3. 拒绝补丁式修复
- 不为单测通过绕开结构问题
- 不保留过时 payload/路径

4. 证据是一等产物
- 审计证据、用量证据、策略命中证据必须可复核

## 5. 测试与验收

分层验证顺序：

1. type/contract
2. unit
3. integration
4. e2e
5. real-lane

补充发布验证原则：
- 对真实发布最脆弱的检查点，必须更早在开发 gate 和本地预检中做一遍
- 最终 deploy verify 不做轻量化，继续完整兜底真实部署环境问题
- external runner 的开发直跑、手动 docker、compose 托管，以及 internal k8s 执行，必须共享同一业务代码与同一地址真相方法

验收标准：

1. 关键合同检查通过
2. 关键治理链路有证据
3. 受保护路由门禁与参数校验通过

## 6. 文档治理规则

1. 只保留当前态规范，不保留过程性主线文档
2. 白名单见 `docs/CURRENT_BASELINE.md`
3. 文档冲突优先级：宪法 > 合同 > UXUI > 用户指南

## 7. 必读入口

1. `docs/CURRENT_BASELINE.md`
2. `docs/项目宪法.md`
3. `docs/UXUI/01-通用规范/usage-audit-职责边界-v1.md`
4. `docs/UXUI/01-通用规范/usage-audit-mvp-功能与uxui-v1.md`
5. `docs/contracts/README.md`
6. `docs/user-guides/README.md`
7. `docs/troubleshooting-guide-v1.md`
