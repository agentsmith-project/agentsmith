# User Guides

这里的内容只保留两类文档：

1. 当前有效的操作指南
2. 当前有效的工程检查与运行入口说明

如果你要找的是“产品对象名、页面 IA、权限合同、接口合同”，先回到：

- [Current Baseline (Whitelist)](../CURRENT_BASELINE.md)
- [Product Terminology Contract](../contracts/product-terminology.md)
- [Contracts Index](../contracts/README.md)

术语边界：

- `release` / `engineering gate` 命令名默认指向项目工程验收与排障流程
- `permission gate` 只表示产品权限门禁语义
- 这些命名都不代表 AgentSmith 提供 DevOps 发布管理能力

## 1. 从这里开始

### 默认工程门禁与发布验收

- [Workspace / Project Default Engineering Gate Checklist](./workspace-project-default-engineering-gate-checklist.md)
  - 默认业务链 gate
- [Governance Default Engineering Gate Checklist](./governance-default-engineering-gate-checklist.md)
  - 默认治理链 gate
- [Release Readiness Checklist](./release-readiness-checklist.md)
  - 发布前完整执行顺序

### 日常排障

- [Troubleshooting Guide](../troubleshooting-guide-v1.md)
- [CI Integration Troubleshooting](../ci-integration-troubleshooting.md)

### Notebook / Runner 主链

- [Notebook Codex Runner Runbook](../notebook-codex-runbook.md)

## 2. Runtime / Deploy / Rehearsal

<!-- current-runtime-lines:user-guides-index:start -->
- [Local Runtime Flows](./local-runtime-flows.md)
  - 由 `scripts/governance/current-runtime-line-manifest.ts` 生成；共享 substrate + 一次只跑一条本地工作线的最短手册。
- [Runtime Lines Matrix](./runtime-lines-matrix.md)
  - 当前 runtime / deploy / rehearsal 线与 mode 边界的总表。
- [Demo Deploy Operations](./demo-deploy-operations.md)
  - 目标主机上的 demo 发布线：release root、生命周期命令，以及 `full` 模式下的 local `kind` sandbox 仿真。
- [Cluster Deploy Operations](./cluster-deploy-operations.md)
  - 目标主机上的 real-cluster 发布线：registry-backed bundle release、target-host install flow、namespace-only automation model。
<!-- current-runtime-lines:user-guides-index:end -->

- [Cluster Upgrade Operations](./cluster-upgrade-operations.md)
- [Cluster Admin Runbook](./cluster-admin-runbook.md)

## 3. Product Operations

### 治理与身份

- [Identity & Permission Model](./identity-and-permission-model.md)
- [Workspace Isolation Model](./workspace-isolation-model.md)
- [Audit & Usage](./audit-usage-reports.md)
- [Alert Center](./alert-center.md)
- [Personal Connections & Workspace Feishu](./third-party-accounts-feishu.md)

### Files / Libraries

- [File Library Client Mount](./file-library-local-mount.md)

## 4. Evidence And Review

- [Test & Evidence Directory Model](./test-and-evidence-directory-model.md)
  - 测试源码、临时结果、mock visual baseline、长期证据的目录合同
- [Product Doc Artifacts](./product-doc-artifacts.md)
  - 生成产品文档截图与 Markdown 包

说明：

- 真实后端截图巡检产物默认在 `artifacts/backend-real-visual/<run-id>/`
- 这是 evidence 入口，不是单独的 guide 文档

## 5. Related Engineering References

下面这些内容和 user guides 强相关，但它们不是操作指南本体：

### Contract references

- [Contracts Index](../contracts/README.md)
- [Backend Persistent State Boundary](../contracts/backend-persistent-state-boundary.md)
- [Backend Storage Architecture Matrix](../contracts/backend-storage-architecture-matrix.md)
- [Backend Storage Maturity Checklist](../contracts/backend-storage-maturity-checklist.md)

### Product and doc-support outputs

- [Marketing Assets](../../marketing/README.md)

## 6. What Does Not Belong Here

下面这些内容不应再被理解为 current user guide：

- handoff / refactor / migration / retro 文档
- 一次性 task 文档
- 机器可读接口规范
- archive 内的环境特定示例

当前 archived example：

- [mbos.imotion.ai Demo Deploy Runbook](../archive/env-specific/demo-deploy-mbos-imotion-ai.md)

## 7. Quick links

- [Documentation Index](../README.md)
- [Current Baseline (Whitelist)](../CURRENT_BASELINE.md)
