# Next Mainline Priority Review v2

更新时间：2026-03-01  
状态：`current-recommendation`

前置参考：

1. `docs/design/project-maturity-productization-review-v1.md`
2. `docs/design/governance-explainability-closure-review-v1.md`
3. `docs/design/ai-ops-home-ux-closure-review-v1.md`
4. `docs/release/internal-release-capability-matrix.md`
5. `docs/agent-codex-notebook-runbook.md`
6. `docs/plans/notebook-trace-fidelity-next-phase-plan.md`

---

## 1. 当前判断

AgentSmith 当前已经完成了三条重主线：

1. `Runtime / Usage / Release Governance`
2. `AI Ops Home / Task-based UX`
3. `Governance Explainability & Effective Access`

因此，下一步最合理的投入点已经不再是：

1. 继续扩治理页面
2. 继续做 Release Ops 看板
3. 继续做零散 UX polish

当前最明显的能力断层，已经转移到 `Build` 面。

---

## 2. 现在最大的产品化缺口

`Build` 面的核心问题不是“有没有页面”，而是“执行链是否足够稳定、可解释、可回放”。

具体表现：

1. Notebook / external agent / task SSE 已可用，但实时链路和 reconnect 语义仍偏工程态
2. Notebook trace 已有基础能力，但 trace fidelity 与可读性仍有明确下一阶段计划
3. 运行/治理面已经进入“控制台成熟度”，而 `Build` 面仍更像“可用的执行器界面”
4. 现有 runbook 里关于 trace/replay/reconnect 仍保留多处后续项

一句话：

**治理面已经基本产品化，构建与执行面还缺“执行可靠性 + 轨迹保真 + 实时恢复”这一层。**

---

## 3. 为什么下一主线应该转向 Build

### 3.1 产品重心需要重新平衡

当前系统已经非常擅长回答：

1. 是否可发布
2. 为什么被拒绝
3. 哪条治理规则生效
4. 哪个 provider/model/cost 出了问题

但还不够擅长回答：

1. Notebook 执行为什么断了
2. 断线重连后我丢了哪些上下文
3. trace 到底发生了什么
4. agent/tool/runtime 的失败该如何在构建面内快速定位

### 3.2 这已经成为新的成熟度短板

当前短板不再是治理执行，而是：

1. 实时执行链韧性
2. Notebook trace fidelity
3. Build surface 的可排障性

---

## 4. 下一主线建议

建议下一主线定义为：

`Build Execution Reliability & Trace Fidelity`

中文建议：

`构建执行可靠性与轨迹保真`

这条主线的核心不是再做一个新功能集合，而是把当前 `Chat / Notebook / External Agent / SSE / Trace` 这条执行链补到企业级内部产品标准。

---

## 5. 主线目标

下一主线完成后，系统应当能直接回答：

1. Notebook / Chat 的实时执行链是否稳定
2. 断线 / reconnect / replay 后用户还能不能可靠恢复上下文
3. trace 是否足够接近真实运行时语义，而不是过度摘要
4. 出现 agent/runtime/stream 错误时，构建面内能否低成本解释

---

## 6. 建议的工作包

### WP-01 Realtime Session Resilience

1. SSE reconnect / replay 语义收紧
2. ticket 生命周期与 reconnect 体验对齐
3. notebook/chat realtime 状态文案与恢复动作统一

### WP-02 Notebook Trace Fidelity

1. timeline / raw 双视图
2. trace copy/export
3. error highlight / first-failure jump
4. 保留原始事件语义，不做 AI 摘要化篡改

### WP-03 Build Failure Explainability

1. agent/runtime/tool/stream failure 分类与文案统一
2. notebook/chat 内直接解释失败源头
3. trace、artifact、task state 之间形成闭环

### WP-04 Cross-Surface Build Diagnostics

1. `Build -> Operate/Govern` 的诊断跳转
2. 从 trace / stream failure 进入 usage / runtime / governance 证据
3. 从 govern/operate 再返回 build 上下文

### WP-05 Release/Gate Coverage for Build Reliability

1. realtime/trace fidelity 关键路径进入验收与 gate
2. 把 notebook/chat 的 reconnect / trace / external-agent 关键流变成正式 evidence

---

## 7. 不建议优先做的方向

当前不建议优先投入：

1. 新一轮治理控制面增强
2. Release Ops 再扩张
3. 纯视觉 polish
4. 外部商业 billing

这些方向当前边际收益都低于 `Build` 面可靠性补齐。

---

## 8. 结论

当前项目成熟度已经到了一个新的阶段：

1. `Govern / Operate` 已经成熟
2. `Build` 需要补齐到同等级别

因此，下一主线最合理的是：

`Build Execution Reliability & Trace Fidelity`
