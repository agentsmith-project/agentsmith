# Next Mainline Execution Hold Plan v1

更新时间：2026-03-03  
状态：`planned-not-started`

关联文档：

1. `docs/design/next-mainline-priority-review-v3.md`
2. `docs/design/agentsmith-product-engineering-governance-methodology-v1.md`
3. `docs/项目宪法.md`

---

## 1. 目的

在不立即启动编码的前提下，冻结下一条主线的执行安排，保证后续启动时具备统一目标、统一边界和统一验收口径。

本计划按“纯运维平台”口径执行：  
不引入开发管理心智，不把开发调试能力作为主界面核心能力。

下一主线名称：

`Organization Governance Rollup & Enterprise Ops Console`  
（组织治理汇总与企业运维总控台）

---

## 2. 执行状态约束

当前阶段明确约束：

1. 仅允许规划、评审、文档化
2. 不启动功能开发
3. 不引入新的 runtime 行为变更
4. 不调整现网验收口径

切换到执行态前，必须把状态从 `planned-not-started` 更新为 `active-execution`。

---

## 3. 目标与范围

目标（执行启动后）：

1. 收敛 Operate 信息架构为“运行控制 / 运行监控 / 发布治理”三层，不重复、不混淆
2. 建立组织级治理总览（posture/risk/readiness）
3. 建立跨 workspace 的治理优先级队列与行动闭环
4. 建立组织级 explainability 与 evidence 下钻链路
5. 将组织级结果接入 release governance 证据体系

范围内：

1. Operate 菜单与页面职责重构（去重、去开发化、统一术语）
2. 组织级汇总视图与 drill-down
3. 企业管理员行动队列与状态跟踪
4. 组织级治理证据与 gate 集成
5. 对应 contract、测试、runbook、release 文档

范围外（本主线不做）：

1. 与当前主线无关的视觉重构
2. 单页面字段扩展型需求
3. 无治理增益的局部优化
4. 面向开发调试的管理能力（如把开发工具暴露为运维主流程）

---

## 4. 前置门禁（启动前必须满足）

1. 当前主线 gate 基线稳定（L0/L1/L2 可重复通过）
2. Operate 三页面职责边界冻结（Runtime / Runtime Ops / Release Ops）
3. 组织级对象模型冻结（至少包含 posture/risk/action/evidence）
4. 组织级 contract 草案冻结并评审通过
5. 验收矩阵冻结（type/contract/smoke/e2e/visual/real-lane）
6. 角色与职责明确（Product/Tech/QA/Ops）
7. 运行手册草案准备完成（包括上游不稳定场景）

---

## 5. 执行分包（启动后）

1. `WP-00` Operate IA 收敛（纯运维口径、页面去重、权限与动作分层）
2. `WP-01` Organization Posture & Risk Rollup
3. `WP-02` Cross-Workspace Governance Views
4. `WP-03` Enterprise Action Queue
5. `WP-04` Explainability & Evidence Drill-down
6. `WP-05` Release Integration & Gates

每个 WP 必须同时产出：

1. contract 变更
2. 自动化测试
3. 文档更新
4. 收口证据

---

## 6. 启动触发条件

满足以下全部条件后才能启动开发：

1. 产品与技术负责人共同确认主线优先级不变
2. 前置门禁全部勾选完成
3. 执行计划已拆分到可交付 WP 级别
4. 首个里程碑验收标准已冻结

---

## 7. 暂停与回滚规则

出现以下任一情况，主线进入暂停评审：

1. contract 发生高频反复变更
2. gate 连续失败且无法归因
3. evidence 无法闭环到 policy/enforcement
4. 关键角色职责缺位导致决策失效

暂停后只允许做：

1. 根因排查
2. 计划重整
3. 风险收敛

---

## 8. 启动前检查清单

1. 是否明确组织级对象与术语
2. 是否明确统一 contract 边界
3. 是否明确可执行 gates 与 evidence
4. 是否明确 incident/escalation/override 连接关系
5. 是否明确 UX 表达“可恢复失败”而非泛化错误
6. 是否移除开发语义入口，避免与运维语义混淆
7. 是否明确文档和代码的同步更新责任

---

## 9. 当前结论

下一条主线已完成规划冻结；当前不执行编码。  
执行启动后的第一里程碑为 `WP-00 Operate IA 收敛`，先解决“纯运维平台”语义一致性，再继续组织级治理扩展。  
后续以本文档作为启动基线，待触发条件满足后切换到执行态。
