# Enterprise Administration & Workspace Governance Priority Review v1

更新时间：2026-03-02  
状态：`baseline-complete`

前置参考：

1. `docs/design/project-maturity-productization-review-v1.md`
2. `docs/design/build-execution-reliability-trace-fidelity-closure-review-v1.md`
3. `docs/release/internal-release-capability-matrix.md`
4. `docs/项目宪法.md`

---

## 1. 当前判断

AgentSmith 当前已经完成了四条重主线：

1. `Runtime / Usage / Release Governance`
2. `AI Ops Home / Task-based UX`
3. `Governance Explainability & Effective Access`
4. `Build Execution Reliability & Trace Fidelity`

因此，当前最值得投入的新方向，不再是项目内执行链、发布控制或治理解释。

当前最大的产品化缺口已经转移到：

`企业级平台层的 workspace / cross-project administration`

---

## 2. 为什么下一步应该转向 Enterprise Administration

### 2.1 项目级已经强，平台级还弱

当前项目级能力已经可以回答：

1. 某个项目是否健康
2. 某个成员为什么被 deny
3. 某条 release 能否通过
4. 某次 build 失败发生在哪一层

但平台层还不够擅长回答：

1. 一个 workspace 下所有项目的治理状态是否一致
2. 哪些项目的成员/配额/策略正在偏离基线
3. workspace 管理员如何做跨项目治理和批量控制
4. workspace 设置页是否能承担真正的企业管理入口

### 2.2 当前代码与页面的现实边界

当前 workspace / admin 层有能力，但明显还是最小实现：

1. `workspace settings`
   - 只有 workspace 基本信息和成员 governance group 切换
2. `projects page`
   - 强在项目浏览与进入
   - 弱在 cross-project governance / bulk operations / risk summary
3. `workspace API`
   - 只有 workspace list/get、members、governance group update
4. 缺少明确的：
   - workspace-level governance overview
   - cross-project risk / quota / policy summary
   - workspace member lifecycle / effective access 视角
   - admin 批量动作与审计解释

一句话：

**AgentSmith 已经很像一个成熟的项目级 AI 平台，但还不像一个成熟的企业级 AI 管理平台。**

---

## 3. 现在最大的产品化缺口

当前最大的缺口不是“再补一个功能页”，而是：

**缺少平台级 administration console。**

具体表现：

1. workspace settings 仍是最小页，不是 admin control surface
2. project list 仍偏浏览页，不是 workspace operations 入口
3. 缺少 cross-project governance summary
4. 缺少 workspace-level explainability / effective governance 视图
5. 缺少针对企业管理员的任务流：
   - 查风险
   - 做批量治理
   - 验证效果
   - 看审计证据

---

## 4. 下一主线建议

建议下一主线定义为：

`Enterprise Administration & Workspace Governance`

中文建议：

`企业管理与工作区治理控制台`

这条主线的核心不是再做一页设置页，而是把当前强项目级能力提升到平台级治理能力。

---

## 5. 主线目标

这条主线完成后，系统应能直接回答：

1. 当前 workspace 下有哪些高风险项目
2. 哪些项目偏离成员/权限/配额/策略基线
3. workspace 管理员如何跨项目做治理动作
4. workspace 管理员如何验证这些动作的真实效果
5. 平台层能否形成统一的企业管理入口，而不是分散项目页

---

## 6. 建议工作包

### WP-01 Workspace Governance Overview

1. workspace-level risk / posture summary
2. project governance posture list
3. cross-project health / risk highlights

### WP-02 Workspace Member Administration

1. workspace member lifecycle
2. workspace-level effective governance / explainability
3. governance group / role / access summary

### WP-03 Cross-Project Governance Actions

1. 批量 project governance baseline apply
2. cross-project member / permission / quota actions
3. action preview / impact summary

### WP-04 Workspace Explainability & Audit

1. workspace-level policy / governance explain
2. cross-project deny / quota / drift evidence
3. admin-oriented audit drill-down

### WP-05 Workspace Governance Release Evidence

1. workspace administration critical flow smoke
2. cross-project governance effect evidence
3. release gate / report integration

---

## 7. 不建议优先做的方向

当前不建议优先投入：

1. 再扩 `Release Ops`
2. 再做新的 Build trace 细节增强
3. 继续零散 UX polish
4. 先做商业 billing / invoice

这些方向当前边际收益都低于平台层 administration 补齐。

---

## 8. 结论

当前项目成熟度已经进入一个新阶段：

1. 项目级产品能力已较成熟
2. 企业级平台层 administration 仍是明显短板

因此，下一主线最合理的是：

`Enterprise Administration & Workspace Governance`
