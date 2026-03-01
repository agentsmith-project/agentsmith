# AI Ops Home Implementation Plan v1

更新时间：2026-03-01  
状态：`baseline-complete`

前置文档：

1. `docs/design/ai-ops-home-ux-strategy-v1.md`
2. `docs/项目宪法.md`
3. `docs/design/llm-runtime-product-decision-memo-v1.md`
4. `docs/user-guides/release-governance-control-plane.md`

---

## 1. 实施目标

本轮不是继续加一个页面，而是完成三件事：

1. 将 `Overview` 升级为 `AI Ops Home`
2. 将项目导航从平铺菜单升级为任务分组
3. 将 Runtime / Usage / Release 的核心状态语言和过滤语义收紧为统一模型

---

## 2. 工作包

### WP-01 `AI Ops Home` 首页重构

交付：

1. 新首页信息架构
2. 顶部状态条
3. Today Needs Attention 区块
4. Runtime / Cost / Release / Incident 四块摘要
5. drill-down 链接

门禁：

1. overview route browser e2e 通过
2. visual baseline 更新通过
3. 中英文文案完整

### WP-02 项目导航分组重构

交付：

1. `Home / Build / Govern / Operate` 分组
2. 导航分组标题与顺序调整
3. 页面标题与 subtitle 对齐任务语义

门禁：

1. sidebar e2e 通过
2. 无权限过滤仍正确
3. 不破坏现有 route

### WP-03 共享状态语言与过滤语义

交付：

1. shared status token 映射
2. shared badge / severity / ordering 规范
3. Runtime / Usage / Release 过滤语义统一

门禁：

1. 三页状态 badge 一致
2. 过滤 query / initial state 行为一致

### WP-04 Runtime Control Plane 信息分层

交付：

1. `Catalog / Routing / Release Readiness` 三段式布局
2. 现有 probe / compare / impact / guardrails 重组
3. 信息密度降低

门禁：

1. Runtime page visual e2e 通过
2. 关键操作 testid 不回退
3. 不破坏现有交互功能

---

## 3. 执行顺序

必须按这个顺序做：

1. `WP-01`
2. `WP-02`
3. `WP-03`
4. `WP-04`

原因：

1. 先有新的首页和任务模型
2. 再让导航跟着首页心智变化
3. 再收紧跨页面语义
4. 最后再处理重控制面的复杂布局

---

## 4. 技术改动面

主要涉及：

1. `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/page.tsx`
2. `src/components/app-shell/AppShellSidebar.tsx`
3. `src/components/runtime/RuntimeObservabilityConsole.tsx`
4. `src/components/audit-usage/UsagePage.tsx`
5. `src/components/settings/RuntimeControlPlanePanel.tsx`
6. `src/messages/en-US.json`
7. `src/messages/zh-CN.json`
8. `e2e/navigation.spec.ts`
9. `e2e/settings.spec.ts`
10. `e2e/visual.spec.ts`

---

## 5. 验收标准

### 用户层

1. 用户进入项目后，第一页可以直接看到运行、成本、发布、incident 四大状态
2. 用户不需要先理解模块结构，也能找到最优先待处理事项
3. 用户可以从首页一跳进入正确的深层上下文

### 设计层

1. 首页不堆满细节
2. 状态语言一致
3. 风险优先级清晰
4. 视觉层级明显优于当前 `Overview`

### 工程层

1. 不新增脆弱耦合
2. 不破坏权限模型
3. 不破坏现有 runtime / usage / release contract
4. visual / chromium e2e 必须更新并通过

---

## 6. 风险

1. 首页过度膨胀，变成另一张“大报表”
2. 导航改动影响老用户肌肉记忆
3. 共享状态语言收得不彻底，反而让页面混乱
4. Runtime Control Plane 分层不当，造成操作路径变长

对应策略：

1. 首页只做摘要和待办，不做全量明细
2. 先保留 route，不做大迁移
3. 先冻结状态词典，再改页面
4. 先做信息重组，不做功能重写

---

## 7. 建议节奏

建议按四次提交推进：

1. `ux: redesign overview into ai ops home`
2. `ux: regroup project navigation by task model`
3. `ux: unify runtime usage release state semantics`
4. `ux: restructure runtime control plane layout`

---

## 8. 完成情况

截至 2026-03-01，本计划已完成并收口。

已完成：

1. `WP-01 AI Ops Home`：完成
2. `WP-02 项目导航分组重构`：完成
3. `WP-03 共享状态语言与过滤语义`：完成
4. `WP-04 Runtime Control Plane 信息分层`：完成
5. `Build / Govern / Operate` 跨组页头动作统一：完成
6. `Overview / Settings / Alerts / Notebook task detail` 等入口与孤页补齐：完成

收口结论：

1. 本计划的结构性目标已达成
2. 剩余事项已降为低优先级 polish
3. 后续若继续做 UX，应视为新主线而不是本计划的延续
