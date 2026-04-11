# Documentation Index

这个入口只负责一件事：帮助你快速找到 current 文档和对应的资料分区。

先读：
- [Current Baseline (Whitelist)](./CURRENT_BASELINE.md)

## 1. Current truth

- [项目宪法](./项目宪法.md)
  - 产品定位、范围边界、禁止漂移项
- [DESIGN.md](../DESIGN.md)
  - 当前唯一 UI 宪法与设计语言真相
- [Product Terminology Contract](./contracts/product-terminology.md)
  - 当前产品对象、页面名、IA 边界
- [Current Engineering Governance Model](./current-engineering-governance-model.md)
  - 当前命令模型、门禁、验证通道、发布语义

## 2. Current docs by category

### Contracts and specs
- [Contracts Index](./contracts/README.md)
- OpenAPI / AsyncAPI specs are indexed there

### User guides and operations
- [User Guides Index](./user-guides/README.md)
- [Troubleshooting Guide](./troubleshooting-guide-v1.md)
- [Notebook Codex Runner Runbook](./notebook-codex-runbook.md)
- [CI Integration Troubleshooting](./ci-integration-troubleshooting.md)

### UX and design
- [DESIGN.md](../DESIGN.md)
  - 唯一 UI 宪法与全局设计语言
- `docs/UXUI/`
  - active interaction/spec library；这里只补充模块交互规范、状态文案与行为边界

### Engineering and testing reference
- [Engineering Docs Index](./engineering/README.md)
- [Testing Docs Index](./testing/README.md)

### Background, proposals, and history
- [Product Engineering Governance Methodology](./design/agentsmith-product-engineering-governance-methodology-v1.md)
- [Archive Index](./archive/README.md)
- `docs/design/`

## 3. Runtime / deploy / rehearsal quick entry

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

### Product doc / artifacts helpers
- [File Library Client Mount](./user-guides/file-library-local-mount.md)
- [Product Doc Artifacts](./user-guides/product-doc-artifacts.md)

## 4. What is not current truth

下面这些类型默认不是 current 真相入口：
- `handoff`
- `refactor`
- `migration`
- `retro`
- `todo`
- 一次性 task / phase / temporary checklist

如果需要判断“当前到底该怎么做”，回到：
1. [Current Baseline (Whitelist)](./CURRENT_BASELINE.md)
2. [DESIGN.md](../DESIGN.md)
3. [Product Terminology Contract](./contracts/product-terminology.md)
4. [Current Engineering Governance Model](./current-engineering-governance-model.md)
