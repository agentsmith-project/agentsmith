# User Guides

这里只保留当前有效的操作指南、运行线说明和发布/排障入口。

如果你在找的是产品对象名、IA、权限合同或接口合同，先回到：
- [Current Baseline (Whitelist)](../CURRENT_BASELINE.md)
- [Product Terminology Contract](../contracts/product-terminology.md)
- [Contracts Index](../contracts/README.md)

## 1. 先从哪开始

### 日常运行与切线
<!-- current-runtime-lines:user-guides-index:start -->
- [Local Runtime Flows](./local-runtime-flows.md)
  - 由 `scripts/governance/current-runtime-line-manifest.ts` 生成；当前本机操作基线与切线手册。
- [Runtime Lines Matrix](./runtime-lines-matrix.md)
  - 当前 runtime / deploy / rehearsal 线与 mode 边界的总表。
- [Demo Deploy Operations](./demo-deploy-operations.md)
  - 目标主机上的 demo 发布线：release root、生命周期命令，以及 `full` 模式下的 local `kind` sandbox 仿真。
- [Cluster Deploy Operations](./cluster-deploy-operations.md)
  - 目标主机上的 real-cluster 发布线：registry-backed bundle release、target-host install flow、namespace-only automation model。
<!-- current-runtime-lines:user-guides-index:end -->

runtime-line 当前状态目录统一收敛到 `artifacts/runtime/lines/<line>/current`；具体 line 列表与 machine-readable truth 以 `scripts/governance/current-runtime-line-manifest.ts` 为准。

### 发布与排演
- [Release Readiness Checklist](./release-readiness-checklist.md)
- [Cluster Upgrade Operations](./cluster-upgrade-operations.md)
- [Cluster Admin Runbook](./cluster-admin-runbook.md)

### 日常排障
- [Troubleshooting Guide](../troubleshooting-guide-v1.md)
- [CI Integration Troubleshooting](../ci-integration-troubleshooting.md)
- [Notebook Codex Runner Runbook](../notebook-codex-runbook.md)

## 2. Product operations

### 治理与身份
- [Identity & Permission Model](./identity-and-permission-model.md)
- [Workspace Isolation Model](./workspace-isolation-model.md)
- [Audit & Usage](./audit-usage-reports.md)
- [Alert Center](./alert-center.md)
- [Personal Connections & Workspace Integrations](./third-party-accounts-feishu.md)

### Files / libraries
- [File Library Client Mount](./file-library-local-mount.md)

## 3. Evidence and doc helpers

- [Test & Evidence Directory Model](./test-and-evidence-directory-model.md)
- [Product Doc Artifacts](./product-doc-artifacts.md)

## 4. Related references

- [Contracts Index](../contracts/README.md)
- [Documentation Index](../README.md)
- [Current Baseline (Whitelist)](../CURRENT_BASELINE.md)

## 5. What no longer belongs here

以下内容不再留在 user guides：
- 历史过程材料与兼容说明
- handoff / refactor / migration / retro
- 一次性 task / completed checklist
- todo / backlog 文档
