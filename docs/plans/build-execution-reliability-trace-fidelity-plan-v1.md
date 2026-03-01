# Build Execution Reliability & Trace Fidelity Plan v1

更新时间：2026-03-01  
状态：`approved-recommendation`

前置文档：

1. `docs/design/next-mainline-priority-review-v2.md`
2. `docs/agent-codex-notebook-runbook.md`
3. `docs/plans/notebook-trace-fidelity-next-phase-plan.md`
4. `docs/项目宪法.md`

---

## 1. 本计划的作用

这份计划用于冻结下一条产品/工程主线：

`构建执行可靠性与轨迹保真`

一句话：

**把当前可用的 Chat / Notebook / External Agent 执行链，补到企业级内部产品的可靠性、可解释性和可回放标准。**

---

## 2. 主线目标

本主线要完成五个结果：

1. realtime 断线 / reconnect / replay 行为可预测
2. Notebook trace fidelity 接近真实运行时语义
3. Build 面失败分类和解释足够稳定
4. Build / Operate / Govern 之间形成正式诊断工作流
5. 关键 build reliability 路径进入 release gate evidence

---

## 3. 范围冻结

### P0

1. Realtime session resilience
2. Notebook trace fidelity
3. Build failure explainability
4. Cross-surface build diagnostics
5. Build reliability release evidence

### P1

1. richer trace filtering / export
2. persistent multi-run trace comparison
3. deeper external-agent performance diagnostics

### Out of Scope

1. 新一轮 release governance 页面增强
2. 新一轮治理审批流
3. 商业 billing / invoice
4. 大规模新的 runtime routing 功能

---

## 4. 工作包

### WP-01 Realtime Session Resilience（P0）

目标：

1. 收紧 notebook/chat 的 reconnect / replay 语义
2. 降低用户对“刷新后才出现内容”类问题的感知

交付：

1. realtime state contract review
2. reconnect / replay 策略实现
3. realtime state UI 文案统一
4. targeted e2e

门禁：

1. reconnect 后状态恢复可预测
2. 不再依赖页面刷新才能看到内容

### WP-02 Notebook Trace Fidelity（P0）

目标：

1. trace 保持原始语义
2. 同时让调试和阅读足够快

交付：

1. timeline / raw 视图
2. copy trace
3. error highlight / jump
4. trace 文档与 contract 同步

门禁：

1. trace 不再只是内部事件列表
2. 调试速度高于当前版本

### WP-03 Build Failure Explainability（P0）

目标：

1. 让 Chat / Notebook / External Agent 内的失败可直接解释

交付：

1. failure taxonomy
2. build-surface explain panel
3. stream / agent / tool / runtime 错误映射

门禁：

1. 常见失败不需要读日志才能理解

### WP-04 Cross-Surface Build Diagnostics（P0）

目标：

1. 从 Build 面直接跳到 Operate / Govern 证据
2. 再能带上下文返回

交付：

1. shared diagnostics query contract
2. trace -> runtime/usage/governance drill-down
3. targeted workflow tests

门禁：

1. build failure 到治理/运行证据的路径不超过 3 步

### WP-05 Build Reliability Release Evidence（P0）

目标：

1. 把 build reliability 真正纳入发布验收

交付：

1. notebook/chat realtime evidence
2. trace fidelity acceptance checks
3. gate/report 集成

门禁：

1. build reliability 不再只是手动体验判断

---

## 5. 执行顺序

必须按如下顺序推进：

1. `WP-01 Realtime Session Resilience`
2. `WP-02 Notebook Trace Fidelity`
3. `WP-03 Build Failure Explainability`
4. `WP-04 Cross-Surface Build Diagnostics`
5. `WP-05 Build Reliability Release Evidence`

原因：

1. 先修实时链路可靠性，避免 trace/UI 建在脆弱基础上
2. 再提升 trace fidelity
3. 然后把失败解释做成正式能力
4. 最后串跨页面诊断和 gate evidence

---

## 6. 结束条件

当以下条件全部满足时，本主线可视为完成：

1. realtime reconnect / replay 行为已稳定
2. notebook trace fidelity 第一阶段完成
3. build failure explain 已进入正式产品界面
4. build -> operate/govern diagnostics 工作流已打通
5. build reliability evidence 已进入 release gate
