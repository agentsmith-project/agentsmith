# User Guides

这里只保留当前有效的操作指南、运行线说明和发布/排障入口。

如果你在找的是产品对象名、IA、权限合同或接口合同，先回到：
- [Current Baseline (Whitelist)](../CURRENT_BASELINE.md)
- [Product Terminology Contract](../contracts/product-terminology.md)
- [Contracts Index](../contracts/README.md)

## 1. 先从哪开始

先选入口：

- `ui_only`: 如果只是前端 UI、文案、mock 交互，先回到 [README](../../README.md) 和 [Diagnostic Catalog v1](../testing/diagnostic-catalog-v1.md)，不要从 release runbook 开始。
- `local_manual`: 如果要真实本地 API / Web / Agent tasks / Terminal / runner 行为，从 [Local Runtime Flows](./local-runtime-flows.md) 开始。
- `release_grade`: 如果要做 AgentSmith 产品侧 readiness / handoff input completeness 复核或大改动收口，从 `npm run product:ready`、`npm run product:status`、[Release Readiness Checklist](./release-readiness-checklist.md) 和 [Verification Campaigns v1](../testing/verification-campaigns-v1.md) 开始。
- 如果要按 `DESIGN.md`、`docs/UXUI/` 和真实/visual 证据做重复性人工界面审查，从 [UX/UI Review Runbook](./uxui-review-runbook.md) 开始。

### 日常运行与切线
<!-- current-runtime-lines:user-guides-index:start -->
- [Local Runtime Flows](./local-runtime-flows.md)
  - 由 `scripts/governance/current-runtime-line-manifest.ts` 生成；当前本机操作基线与切线手册。
- [Runtime Lines Matrix](./runtime-lines-matrix.md)
  - 当前 local-real 与统一部署 diagnostic entry 的总表。
- [Unified Deploy Operations](./unified-deploy-operations.md)
  - Maintainer deploy diagnostics and AgentSmith-owned post-deploy smoke producer reference; GA operator-facing release paths are `online` / `airgap` × `use_existing` / `install_substrates` in the release-kit runbook.
<!-- current-runtime-lines:user-guides-index:end -->

runtime-line 当前状态目录统一收敛到 `artifacts/runtime/lines/<line>/current`；具体 line 列表与 machine-readable truth 以 `scripts/governance/current-runtime-line-manifest.ts` 为准。

### 发布与部署
- [Release Readiness Checklist](./release-readiness-checklist.md)
  - human product-side readiness / handoff input completeness entrypoint: `npm run product:ready`
- [Unified Deploy Operations](./unified-deploy-operations.md)
  - maintainer deploy diagnostics and AgentSmith-owned post-deploy smoke producer reference; GA operator-facing release paths are `online` / `airgap` × `use_existing` / `install_substrates` in the release-kit runbook

### 日常排障
- [Troubleshooting Guide](../troubleshooting-guide-v1.md)
- [CI Integration Troubleshooting](../ci-integration-troubleshooting.md)
- Agent task runner diagnostics are covered by [Local Runtime Flows](./local-runtime-flows.md) and product readiness evidence in [Release Readiness Checklist](./release-readiness-checklist.md).

## 2. Product operations

### 治理与身份
- [Identity & Permission Model](./identity-and-permission-model.md)
- [Workspace Isolation Model](./workspace-isolation-model.md)
- [Audit & Usage](./audit-usage-reports.md)
- [Alert Center](./alert-center.md) - project operational signals and notifications support surface
- [Personal Connections](./personal-connections.md)

### Files / libraries
- [File Library Access Model](./file-library-access-model.md)

## 3. Evidence and doc helpers

- [Test & Evidence Directory Model](./test-and-evidence-directory-model.md)
- [Product Doc Artifacts](./product-doc-artifacts.md)
- [UX/UI Review Runbook](./uxui-review-runbook.md)
- [UX/UI Review Record Template](./uxui-review-record-template.md)

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
