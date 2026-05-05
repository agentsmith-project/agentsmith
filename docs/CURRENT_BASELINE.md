# Current Baseline (Whitelist)

更新时间：2026-04-29
状态：`authoritative`

本文件是唯一的人类 current truth router。它回答两件事：
1. 现在到底以什么为准
2. 哪些文档不再属于 current docs

## 1. 当前真相源阅读顺序

1. [项目宪法](./项目宪法.md)
2. [DESIGN.md](../DESIGN.md)（UI design guide）
3. [Product Terminology Contract](./contracts/product-terminology.md)
4. [Current Engineering Governance Model](./current-engineering-governance-model.md)
5. [Contracts Index](./contracts/README.md)
6. [User Guides Index](./user-guides/README.md)
7. [Agent Task Runner Runbook](./agent-task-runner-runbook.md)

Governance v2 closure pointer: [Engineering Governance Developer Flow Optimization v2](./engineering/governance-developer-flow-optimization-v2.md) is `first_scope_closed_2026-04-29`; remaining items are backlog/reference, not current marching orders.

## 2. 不再属于 current docs 的内容

以下内容一律不再作为 current docs 保留：
- handoff / refactor / migration / retro / todo
- 一次性 task / phase / completed checklist
- 历史 evidence / release snapshot 说明文档
- 任何只承担跳转、占位或兼容说明作用的文档

Git 历史足够承担追溯职责；current docs 只保留今天仍需要被阅读、维护和校验的资料。

## 3. 当前文档怎么用

### 理解产品与 UI
1. [项目宪法](./项目宪法.md)
2. [DESIGN.md](../DESIGN.md)（UI design guide）
3. [Product Terminology Contract](./contracts/product-terminology.md)

### 实现或评审功能
1. [Contracts Index](./contracts/README.md)
2. [Product Terminology Contract](./contracts/product-terminology.md)
3. [DESIGN.md](../DESIGN.md)（UI design guide）
4. [Current Engineering Governance Model](./current-engineering-governance-model.md)
5. [Testing Docs Index](./testing/README.md)

### 运行、排障、发布、排演
1. [User Guides Index](./user-guides/README.md)
2. [Current Engineering Governance Model](./current-engineering-governance-model.md)
3. [Diagnostic Catalog v1](./testing/diagnostic-catalog-v1.md)
4. [Troubleshooting Guide](./troubleshooting-guide-v1.md)
5. [Agent Task Runner Runbook](./agent-task-runner-runbook.md)
6. [Verification Campaigns v1](./testing/verification-campaigns-v1.md)

## 4. 冲突时按谁为准

优先级固定为：
1. 宪法
2. 产品对象与合同边界
3. UI 风格与视觉实现指导（`DESIGN.md`）
4. 当前工程治理模型与 machine-readable manifests
5. 用户指南 / runbook

补充说明：
- 产品对象名、页面 IA、用户可见命名冲突时，以 [Product Terminology Contract](./contracts/product-terminology.md) 为准。
- UI 风格、视觉语言与实现偏好冲突时，以 [DESIGN.md](../DESIGN.md) 为准；产品对象与 IA 不由 `DESIGN.md` 定义。
- 工程命令、gate、验证通道、发布流程冲突时，以 [Current Engineering Governance Model](./current-engineering-governance-model.md) 和 machine-readable manifests 为准。
- release-grade automated verification 的面向人入口是 `npm run release:ready`；precheck 通过后使用其背后的 internal adapter `release:campaign:full`。证据完整性、aggregate-only `gate:release:full` 复核语义和常见误区，参考 [Verification Campaigns v1](./testing/verification-campaigns-v1.md)；若与 contracts 冲突，仍以 contracts 和 manifests 为准。
