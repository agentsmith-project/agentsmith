# Enterprise Administration & Workspace Governance Plan v1

更新时间：2026-03-02  
状态：`approved-recommendation`

前置文档：

1. `docs/design/enterprise-administration-workspace-governance-priority-review-v1.md`
2. `docs/release/internal-release-capability-matrix.md`
3. `docs/项目宪法.md`

---

## 1. 本计划的作用

这份计划用于冻结下一条产品/工程主线：

`企业管理与工作区治理控制台`

一句话：

**把当前强项目级能力，提升为 workspace / cross-project 级别的企业管理能力。**

---

## 2. 主线目标

本主线要完成五个结果：

1. workspace-level governance posture 可见
2. workspace member administration 成为正式控制台
3. cross-project governance actions 可执行
4. workspace explainability / audit drill-down 成形
5. workspace governance 关键流进入 release gate evidence

---

## 3. 范围冻结

### P0

1. Workspace governance overview
2. Workspace member administration
3. Cross-project governance actions
4. Workspace explainability & audit
5. Workspace governance release evidence

### P1

1. richer bulk operations preview
2. workspace governance trend analytics
3. organization-level multi-workspace rollup

### Out of Scope

1. 商业 billing / invoice
2. 新一轮 runtime routing 扩展
3. 新一轮 build trace 深化
4. 新一轮 release governance workflow 扩张

---

## 4. 工作包

### WP-01 Workspace Governance Overview（P0）

目标：

1. 让 workspace 页面能回答“现在哪些项目有治理风险”

交付：

1. workspace posture summary
2. project governance posture list
3. high-risk / drift highlights

门禁：

1. workspace 级别不再只是 name + members
2. 管理员可在 1 页内看到高风险项目

### WP-02 Workspace Member Administration（P0）

目标：

1. 让 workspace 成员治理具备正式产品能力

交付：

1. workspace member effective governance summary
2. lifecycle / governance group / access explain
3. admin task-oriented UI

门禁：

1. workspace member 管理不再只是 governance group 切换

### WP-03 Cross-Project Governance Actions（P0）

目标：

1. 提供跨项目治理动作，而不是逐项目点击

交付：

1. bulk baseline apply
2. cross-project permission / quota / policy actions
3. action preview / impact summary

门禁：

1. 至少一类 cross-project bulk governance 流正式落地

### WP-04 Workspace Explainability & Audit（P0）

目标：

1. 让 workspace 管理员能解释跨项目治理结果

交付：

1. workspace-level explainability panels
2. cross-project deny / quota / drift evidence drill-down
3. admin audit views

门禁：

1. workspace 管理员不需要逐项目翻日志才能解释主要治理结果

### WP-05 Workspace Governance Release Evidence（P0）

目标：

1. 把企业管理层关键流纳入正式发布验收

交付：

1. workspace governance smoke
2. cross-project governance effect evidence
3. release report integration

门禁：

1. workspace administration 不再只靠手工 demo 验收

---

## 5. 执行顺序

必须按如下顺序推进：

1. `WP-01 Workspace Governance Overview`
2. `WP-02 Workspace Member Administration`
3. `WP-03 Cross-Project Governance Actions`
4. `WP-04 Workspace Explainability & Audit`
5. `WP-05 Workspace Governance Release Evidence`

原因：

1. 先建立 workspace posture 视角
2. 再补 workspace member 管理
3. 再做 cross-project actions
4. 然后把 explainability / audit 串起来
5. 最后再接入正式 gate

---

## 6. 结束条件

当以下条件全部满足时，本主线可视为完成：

1. workspace posture summary 已成形
2. workspace member administration 第一阶段完成
3. 至少一类 cross-project governance bulk action 已落地
4. workspace explainability / audit drill-down 已打通
5. workspace governance evidence 已进入 release gate
