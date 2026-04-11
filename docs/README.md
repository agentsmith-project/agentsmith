# Documentation Index

当前文档入口只做一件事：

- 帮你快速找到“当前真相该看哪里”

它不是第二份产品定义，也不是第二份工程命令说明。

先读：

- [Current Baseline (Whitelist)](./CURRENT_BASELINE.md)

## 1. 当前真相从哪里读

### 产品边界与治理主线

- [项目宪法](./项目宪法.md)

用途：

- 产品定位
- 范围边界
- 禁止漂移项
- 权限与治理原则

### 当前产品对象名与页面 IA

- [Product Terminology Contract](./contracts/product-terminology.md)

用途：

- 当前正式产品面
- 当前正式治理对象
- 页面命名
- IA 边界
- 用户可见术语

### 当前工程命令、门禁与验证通道

- [Current Engineering Governance Model](./current-engineering-governance-model.md)
- machine-readable workflow source: [`scripts/governance/current-workflow-manifest.ts`](../scripts/governance/current-workflow-manifest.ts)
- machine-readable gate source: [`scripts/governance/current-gate-manifest.ts`](../scripts/governance/current-gate-manifest.ts)

用途：

- 当前命令模型
- gate / lane 语义
- visual / backend-real / release 验证边界

## 2. 按任务找入口

### 我想理解当前产品和页面结构

读：

1. [项目宪法](./项目宪法.md)
2. [Product Terminology Contract](./contracts/product-terminology.md)
3. [Contracts Index](./contracts/README.md)

### 我想实现或评审功能

读：

1. [Contracts Index](./contracts/README.md)
2. [Product Terminology Contract](./contracts/product-terminology.md)
3. [Current Engineering Governance Model](./current-engineering-governance-model.md)

### 我想运行、排障、发布或做排演

读：

1. [User Guides Index](./user-guides/README.md)
2. [Troubleshooting Guide](./troubleshooting-guide-v1.md)
3. [Notebook Codex Runner Runbook](./notebook-codex-runbook.md)

## 3. 当前文档分区

### Current truth

- [Current Baseline (Whitelist)](./CURRENT_BASELINE.md)
- [项目宪法](./项目宪法.md)
- [Current Engineering Governance Model](./current-engineering-governance-model.md)
- [Contracts Index](./contracts/README.md)
- [User Guides Index](./user-guides/README.md)

### Contracts and specs

- [Contracts Index](./contracts/README.md)
- OpenAPI / AsyncAPI specs are listed there

### User guides and operations

- [User Guides Index](./user-guides/README.md)
- [Troubleshooting Guide](./troubleshooting-guide-v1.md)
- [Notebook Codex Runner Runbook](./notebook-codex-runbook.md)
- [CI Integration Troubleshooting](./ci-integration-troubleshooting.md)

### UX and design system

- `docs/UXUI/`

说明：

- 这里是设计系统、交互规范与视觉基线策略
- 产品当前对象名与页面边界仍以 terminology contract 为准

### Background / design / history

- [产品研发与治理方法论](./design/agentsmith-product-engineering-governance-methodology-v1.md)
- `docs/design/`
- `docs/archive/`

说明：

- `design/` 里可能包含方法论文档、提案、复盘或阶段性 checklist
- `archive/` 只保留历史 handoff / refactor / env-specific 示例
- 这些文档用于背景理解，不直接覆盖 current 真相

## 4. Runtime / Deploy / Rehearsal 快速入口

如果你关心的是运行链路而不是页面合同，直接从这里走：

<!-- current-runtime-lines:docs-index:start -->
- [Local Runtime Flows](./user-guides/local-runtime-flows.md)
  - 由 `scripts/governance/current-runtime-line-manifest.ts` 生成；当前本机最短运行手册。
- [Runtime Lines Matrix](./user-guides/runtime-lines-matrix.md)
  - 当前 local / rehearsal / deploy 运行线总表。
- [Demo Deploy Operations](./user-guides/demo-deploy-operations.md)
  - 目标主机上的 demo 发布线，不再承担本机 rehearsal 真相说明。
- [Cluster Deploy Operations](./user-guides/cluster-deploy-operations.md)
  - 目标主机上的 real-cluster 发布线，不再承担本机 rehearsal 真相说明。
<!-- current-runtime-lines:docs-index:end -->

- [Release Readiness Checklist](./user-guides/release-readiness-checklist.md)
- [Cluster Upgrade Operations](./user-guides/cluster-upgrade-operations.md)
- [Cluster Admin Runbook](./user-guides/cluster-admin-runbook.md)

### Notebook / Runner / 排障

- [Notebook Codex Runner Runbook](./notebook-codex-runbook.md)
- [Troubleshooting Guide](./troubleshooting-guide-v1.md)
- [CI Integration Troubleshooting](./ci-integration-troubleshooting.md)

## 5. 什么不应该再当 current 入口

下面这些文档类型默认不是 current 真相入口：

- `handoff`
- `refactor`
- `migration`
- `retro`
- `todo`
- 一次性 task / phase / temporary checklist

如果需要判断“当前到底该怎么做”，不要从这些文档开始。  
先回到：

1. [Current Baseline (Whitelist)](./CURRENT_BASELINE.md)
2. [Product Terminology Contract](./contracts/product-terminology.md)
3. [Current Engineering Governance Model](./current-engineering-governance-model.md)

## 6. 相关入口

- [Archive Index](./archive/README.md)
- [Marketing Assets](../marketing/README.md)
