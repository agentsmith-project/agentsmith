# AI Ops Home UX Strategy v1

更新时间：2026-03-01  
状态：`baseline-complete`

---

## 1. 这份文档解决什么问题

当前 AgentSmith 已经具备三类成熟能力：

1. AI 智能体使用与管理
2. AI 资源与成本治理
3. 运行与发布治理

问题不在于能力缺失，而在于这些能力仍然主要按模块分布：

1. `Overview`
2. `Usage`
3. `Runtime Observability`
4. `Runtime Control Plane`
5. `Release Ops`

这会带来典型的企业平台 UX 问题：

1. 首页过轻，无法承接项目级运营入口
2. 用户需要先理解系统结构，才能完成任务
3. 运行、成本、发布三条治理线虽然强，但缺少统一任务入口
4. 控制面能力持续增长后，认知负担会继续上升

本策略的目标是把 AgentSmith 从“多个强模块页面的集合”，收成“统一的企业 AI 运营控制台”。

---

## 2. 结论

下一条 UX/UI 主线应聚焦两件事：

1. 建立统一的项目级运营首页：`AI Ops Home`
2. 将当前导航从“模块平铺”重构为“任务分层”

这不是换皮，也不是加一个 dashboard。  
这是把当前已经成熟的 runtime / usage / release 能力收成统一心智。

### 2.1 本轮讨论补充结论

2026-03-01 这轮讨论进一步确认了两点：

1. AgentSmith 的顶层产品定位不应使用容易被误解为独立工程平台的表述
2. `Runtime Control Plane` 与 `Release Ops` 仍然是模块名，不等于顶层产品名

因此在产品定位上，统一使用：

1. **企业级 AI 智能体使用与管理平台**
2. **AI 资源治理平台**
3. **运行与发布治理控制面**

而不是把顶层产品叙事直接写成单独的 `Runtime / Release Control Plane` 产品。

这也进一步说明：

1. `AI Ops Home` 的目标不是把 AgentSmith 做成通用运维平台
2. 而是把 AI 智能体使用、资源治理、运行控制和发布治理收成统一的项目级运营入口

---

## 3. 当前问题判断

### 3.1 `Overview` 已落后于产品实际复杂度

当前 `Overview` 仍是轻量 KPI + quick access + activity timeline。

它没有回答项目负责人最关心的四个问题：

1. 当前运行是否健康
2. 当前成本是否异常
3. 当前是否具备发布条件
4. 当前有哪些待处理 incident / escalation

因此它不再是合格的项目首页。

### 3.2 当前导航更像系统目录，不像任务入口

当前项目导航同时混合了：

1. 使用面：`Chat`、`Notebook`
2. 资源面：`Files`、`Agents`、`Endpoints`
3. 治理面：`Usage`、`Runtime Observability`
4. 发布面：`Release Ops`
5. 管理面：`Members`、`Credentials`、`Settings`

这符合内部实现结构，但不符合用户任务结构。

### 3.3 治理能力已经完整，但体验仍偏“专家系统”

当前系统已经有：

1. runtime guardrails
2. impact preview
3. usage operations
4. release policy / override / escalation / incident

这些能力是对的，但入口和层级还不够克制。  
继续沿着“每有一个能力就加一个模块区块”推进，会让平台逐步变成高复杂度工具箱。

---

## 4. 目标体验

### 4.1 项目首页应回答的四个问题

`AI Ops Home` 必须让用户在第一页回答：

1. 项目今天运行是否健康
2. 项目今天成本是否异常
3. 当前 release 是否可放行
4. 现在最需要我处理的事情是什么

### 4.2 操作路径应从“看页面”变成“做任务”

用户不应该先想：

1. 去哪个模块
2. 哪个页面有哪个图
3. 哪个页面能处理这件事

而应该直接看到：

1. `Investigate runtime issue`
2. `Review cost anomaly`
3. `Resolve release blocker`
4. `Handle incident`

### 4.3 控制面必须分层，而不是堆叠

控制面不是越全越好，而是：

1. 先给决策信号
2. 再给解释
3. 最后给编辑与动作

这应成为 Runtime、Usage、Release 三个面的共同交互原则。

---

## 5. 建议的信息架构

### 5.1 一级项目导航

建议将项目导航调整为四组心智：

1. `Home`
2. `Build`
3. `Govern`
4. `Operate`

### 5.2 分组建议

#### `Home`

1. `AI Ops Home`

#### `Build`

1. `Chat`
2. `Notebook`
3. `Files`
4. `Agents`
5. `Endpoints`

#### `Govern`

1. `Resource Policy`
2. `Usage`
3. `Credentials`
4. `Members`
5. `Audit`

#### `Operate`

1. `Runtime`
2. `Release Ops`
3. `Alerts`
4. `Settings`

说明：

1. 不建议现在强行改掉所有现有 route 名
2. 先重构导航层和页面标题层
3. 模块能力不变，心智先调整

---

## 6. `AI Ops Home` 页面定义

### 6.1 页面定位

`AI Ops Home` 是项目级统一运营首页，不是另一个 KPI 面板。

它负责：

1. 汇总关键状态
2. 暴露待处理事项
3. 指向正确的下一步动作
4. 作为项目级“开工首页”

### 6.2 页面区块

#### 区块 A：Project Status Strip

顶部状态条，只展示最重要结论：

1. Runtime health
2. Cost health
3. Release readiness
4. Open incidents

要求：

1. 一屏可见
2. 强状态语言
3. 每项都可点击进入详情

#### 区块 B：Today Needs Attention

按优先级列出当前最需要处理的事项：

1. blocked release
2. overdue escalation
3. cost spike
4. fallback surge
5. missing price coverage

这是首页最关键的区块。  
它必须是“待办驱动”，不是“报表驱动”。

#### 区块 C：Runtime Snapshot

只看最关键的运行态：

1. request volume
2. error rate
3. fallback rate
4. top provider/model issue

要求：

1. 轻量展示
2. 不复制完整 observability 页面
3. 提供 drill-down 入口

#### 区块 D：Cost Snapshot

只展示：

1. 今日成本
2. 成本变化趋势
3. 异常目标 provider/model
4. missing price 信号

#### 区块 E：Release Readiness

展示：

1. current enforcement
2. blockers / warnings 数
3. latest run
4. open override / escalation

该区块应直接链接到 `Release Ops` 的对应上下文。

#### 区块 F：Ownership / Incident

展示：

1. 当前 open incidents
2. owner / assignee
3. SLA 状态
4. 需要交接或即将逾期的事项

---

## 7. Runtime / Usage / Release 的共享 UX 规则

### 7.1 统一过滤语义

三者共用：

1. 时间范围
2. provider
3. model
4. result
5. error_class

### 7.2 统一状态语言

全平台统一：

1. `ready`
2. `warning`
3. `blocked`
4. `recovered`
5. `terminal`
6. `pending_override`
7. `releasable_with_override`
8. `due_soon`
9. `overdue`

要求：

1. 同一状态必须使用同一 badge 语义
2. 同一状态必须有一致动作文案
3. 同一状态排序优先级保持一致

### 7.3 统一 drill-down 模型

所有大盘都应遵循：

1. summary
2. breakdown
3. request / run / incident detail

不要为每个模块发明不同的展开逻辑。

---

## 8. Runtime Control Plane 的 UX 重构方向

当前 `Runtime Control Plane` 能力完整，但需要更明确分层。

建议拆为三个区：

1. `Catalog`
2. `Routing`
3. `Release Readiness`

### 8.1 Catalog

1. Providers
2. Models
3. Pricing versions

### 8.2 Routing

1. Alias
2. Combo
3. Dry-run
4. Compare

### 8.3 Release Readiness

1. Guardrails
2. Recovery Probe
3. Impact Preview
4. Publish / activate actions

这能显著降低单页认知密度。

---

## 9. 设计原则

### 9.1 首页只做判断，不做全部展示

首页要回答：

1. 是否健康
2. 是否异常
3. 是否可发布
4. 应处理什么

不要把所有明细直接堆进首页。

### 9.2 页面要有“下一步动作”

每个高优先级状态旁边都应有明确动作：

1. investigate
2. review
3. assign
4. rerun
5. approve / reject

### 9.3 页面应支持从全局到局部

用户路径应是：

1. 首页看状态
2. 点击进入专题页
3. drill-down 到 request/run/incident
4. 完成动作

---

## 10. 本阶段不做什么

1. 不重命名所有现有路由
2. 不大规模重做设计系统 token
3. 不新增复杂图表库
4. 不一次性推翻现有 Runtime / Usage / Release 页
5. 不把首页做成过度可配置的 BI 仪表板

---

## 11. 推荐实施顺序

1. `AI Ops Home` 定义与首页重构
2. 导航分组与页面标题体系重构
3. Runtime / Usage / Release 共享过滤与状态语义统一
4. Runtime Control Plane 分层重构

---

## 12. 预期结果

完成后，AgentSmith 在 UX 上应从：

`多个成熟模块的组合`

升级为：

`面向企业 AI 运营、治理和发布的统一任务控制台`

---

## 13. 收口说明

截至 2026-03-01，这份策略文档定义的主线已经完成第一阶段落地，并形成正式 UX 基线。

对应收口文档：

1. `docs/design/ai-ops-home-ux-closure-review-v1.md`

当前建议：

1. 不再把这条 UX 主线继续作为主要开发目标
2. 将后续零散视觉优化降级为日常维护
3. 主线资源回到新的产品/工程能力建设
