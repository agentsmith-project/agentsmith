# Next Mainline Priority Review v3

更新时间：2026-03-02  
状态：`current-recommendation`

前置参考：

1. `docs/design/enterprise-administration-workspace-governance-closure-review-v1.md`
2. `docs/design/project-maturity-productization-review-v1.md`
3. `docs/release/internal-release-capability-matrix.md`
4. `docs/项目宪法.md`

---

## 1. 当前判断

AgentSmith 当前已经完成并收口了四条关键主线：

1. Runtime / Usage / Release Governance
2. Governance Explainability & Effective Access
3. Build Execution Reliability & Trace Fidelity
4. Enterprise Administration & Workspace Governance

因此，下一步不应继续在单 workspace 或单 project 层面做增量改动。

当前最明显的能力缺口已经转向：

`组织级（multi-workspace）治理汇总与企业运维总控`

---

## 2. 为什么下一步要做组织级治理

### 2.1 当前能力重心仍在 workspace/project

现在我们可以很好地回答：

1. 某个 project 是否可发布
2. 某个 workspace 的治理风险在哪里
3. 某个成员为什么被 deny

但还不够擅长回答：

1. 整个组织下哪些 workspace 正在偏离治理基线
2. 哪些 workspace 的 release risk 正在集中上升
3. 企业管理员该先处理哪个 workspace，为什么

### 2.2 企业管理还缺“总控入口”

当前已有：

1. 项目级 control plane
2. workspace settings governance console
3. release ops 与 evidence

当前缺少：

1. organization-level rollup posture
2. cross-workspace attention feed
3. workspace priority queue（先处理谁）
4. 组织级 release readiness 汇总

---

## 3. 下一主线建议

建议下一主线定义为：

`Organization Governance Rollup & Enterprise Ops Console`

中文建议：

`组织治理汇总与企业运维总控台`

这条主线目标不是“再做一层新后台”，而是把已经成熟的 project/workspace 能力提升到组织级运营决策层。

---

## 4. 主线目标

完成后应能直接回答：

1. 当前组织治理总体是否健康
2. 哪些 workspace 是高优先级治理对象
3. 哪些 workspace 的 release risk 正在恶化
4. 企业管理员应执行的 top actions 是什么
5. 组织级治理结果是否已进入 release evidence

---

## 5. 建议工作包

### WP-01 Organization Governance Overview

1. org-level posture summary
2. workspace risk ranking
3. org attention feed

### WP-02 Cross-Workspace Governance Views

1. workspace posture matrix
2. member/admin scope rollup
3. release readiness rollup

### WP-03 Enterprise Actions Queue

1. prioritized action queue
2. direct deep-link into target workspace/project
3. action status tracking

### WP-04 Organization Explainability & Evidence

1. cross-workspace blocker/warning explain
2. org-level audit slices
3. evidence drill-down to workspace/project

### WP-05 Organization Governance Release Evidence

1. org governance smoke
2. org evidence artifact
3. release-report integration + policy gating

---

## 6. 不建议优先做的方向

当前不建议优先投入：

1. 继续扩单 workspace 页面字段
2. 新一轮 release ops UI 扩张
3. 新一轮 build trace 细节优化
4. 纯视觉 polish

这些方向当前边际收益低于组织级治理总控补齐。

---

## 7. 结论

当前产品已经进入“企业内部平台化”的下一阶段。  
下一条主线最合理的是：

`Organization Governance Rollup & Enterprise Ops Console`

对应执行计划：

1. `docs/plans/organization-governance-rollup-enterprise-ops-console-plan-v1.md`
