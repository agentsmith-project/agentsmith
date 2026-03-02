# Organization Governance Rollup & Enterprise Ops Console Plan v1

更新时间：2026-03-02  
状态：`in-progress`

前置文档：

1. `docs/design/next-mainline-priority-review-v3.md`
2. `docs/design/enterprise-administration-workspace-governance-closure-review-v1.md`
3. `docs/release/internal-release-capability-matrix.md`
4. `docs/项目宪法.md`

---

## 1. 本计划的作用

这份计划用于冻结下一条产品/工程主线：

`组织治理汇总与企业运维总控台`

一句话：

**把当前成熟的 project/workspace 能力提升到组织级运营决策层，形成 enterprise operations control plane。**

---

## 2. 主线目标

本主线要完成五个结果：

1. 组织级治理态势（posture）可见
2. 跨 workspace 风险排序与优先级清晰
3. 企业管理员动作队列可执行、可追踪
4. 组织级 explainability / evidence drill-down 成形
5. 组织级关键流进入 release gate evidence

---

## 3. 范围冻结

### P0

1. Organization governance overview
2. Cross-workspace governance views
3. Enterprise actions queue
4. Organization explainability & evidence
5. Organization governance release evidence

### P1

1. workspace 趋势预测与风险提前预警
2. richer org-level timeline playback
3. automation recommendation engine

### Out of Scope

1. 对外商业 billing / invoice
2. 新一轮 provider routing 扩展
3. 新一轮 notebook/build trace 深化
4. 纯视觉层面改版

---

## 4. 工作包

### WP-01 Organization Governance Overview（P0）

目标：

1. 让企业管理员在一个页面看清组织治理健康度

交付：

1. org posture summary（健康、警告、阻塞）
2. workspace risk ranking（按 risk score 与趋势）
3. org attention feed（需要优先处理的治理事件）

门禁：

1. 可在 1 页内识别 top-risk workspace
2. 风险排序与状态标签一致且可解释

### WP-02 Cross-Workspace Governance Views（P0）

目标：

1. 提供跨 workspace 的治理矩阵，而非逐个进入 workspace 查看

交付：

1. workspace posture matrix
2. member/admin scope rollup
3. release readiness rollup

门禁：

1. 至少覆盖 posture、成员治理、release readiness 三类视图
2. 支持从组织层跳转到具体 workspace/project

### WP-03 Enterprise Actions Queue（P0）

目标：

1. 将治理动作从“看板阅读”升级为“任务执行”

交付：

1. prioritized actions queue
2. action detail + impact summary
3. 执行动作后的状态回写（pending/running/done/blocked）

门禁：

1. 能在总控台完成至少一类跨 workspace 治理动作闭环
2. 动作状态可被审计和复盘

### WP-04 Organization Explainability & Evidence（P0）

目标：

1. 让组织级 blocker/warning 可解释，并可下钻到证据层

交付：

1. org blocker/warning explain panel
2. cross-workspace audit slices
3. evidence drill-down（org -> workspace -> project）

门禁：

1. 主要 blocker 不需读日志即可解释
2. 下钻路径不超过 3 步

### WP-05 Organization Governance Release Evidence（P0）

目标：

1. 将组织级治理能力纳入正式发布验收

交付：

1. org governance smoke
2. org evidence artifact
3. release report integration + policy gating

门禁：

1. org governance 不再依赖手工 demo 验收
2. release report 可对组织级阻塞项执行 hard fail

---

## 5. 执行顺序

必须按如下顺序推进：

1. `WP-01 Organization Governance Overview`
2. `WP-02 Cross-Workspace Governance Views`
3. `WP-03 Enterprise Actions Queue`
4. `WP-04 Organization Explainability & Evidence`
5. `WP-05 Organization Governance Release Evidence`

原因：

1. 先建立组织态势与风险优先级
2. 再补跨 workspace 视图和下钻路径
3. 然后把运营动作做成可执行队列
4. 最后将 explainability 与发布验收接入正式 gate

---

## 6. 结束条件

当以下条件全部满足时，本主线可视为完成：

1. org posture summary 与 workspace risk ranking 正式上线
2. cross-workspace governance views 第一阶段完成
3. enterprise actions queue 可用于日常治理任务
4. organization explainability / evidence drill-down 打通
5. org governance evidence 已进入 release gate

---

## 7. 当前进展（2026-03-02）

已完成：

1. `WP-01` 第一阶段落地：登录后 workspace 选择页已增加组织级治理总览模块
2. 已形成 org summary、workspace risk ranking、attention feed 三个核心视图
3. 已补充 rollup 纯函数与页面渲染单测，并通过 `make gate-l0`
4. `WP-02` 第一阶段落地：新增 `workspaces/overview` 组织级治理矩阵页面（posture matrix + cross-workspace attention）
5. `WP-03` 第一阶段落地：在组织总览页增加 prioritized actions queue，并打通 settings/release-ops 快捷动作

待完成：

1. `WP-01` 第二阶段：与 workspace settings / release readiness 建立更强联动
2. `WP-02` 第二阶段：矩阵筛选、排序、批量动作预览
3. `WP-03` 第二阶段：动作状态回写与执行审计闭环
4. `WP-04` 组织级 explainability drill-down 完整链路
5. `WP-05` 组织级 release evidence 与 gate 集成
