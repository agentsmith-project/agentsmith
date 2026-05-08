# Documentation Index

这个入口只负责 current 文档导航，不再承担历史材料、archive 目录或 redirect 文档的说明职责。

先读：
- [Current Baseline (Whitelist)](./CURRENT_BASELINE.md)

## 1. Current truth

- [项目宪法](./项目宪法.md)
- [DESIGN.md](../DESIGN.md)（UI design guide）
- [Product Terminology Contract](./contracts/product-terminology.md)
- [Current Engineering Governance Model](./current-engineering-governance-model.md)

## 2. Current docs by category

### Contracts and specs
- [Contracts Index](./contracts/README.md)

### User guides and operations
- [User Guides Index](./user-guides/README.md)
- [UX/UI Review Runbook](./user-guides/uxui-review-runbook.md)
- 统一的人工 UX/UI 审查入口；把 `DESIGN.md`、`docs/UXUI/`、visual evidence 和 backend-real 审查收成一套可重复执行的方法
- [UX/UI Review Record Template](./user-guides/uxui-review-record-template.md)
- 可复制填写的标准审查记录模板；用于把 scene-level review 结论收成统一格式
- [Troubleshooting Guide](./troubleshooting-guide-v1.md)
- [Agent Task Runner Runbook](./agent-task-runner-runbook.md)
- [CI Integration Troubleshooting](./ci-integration-troubleshooting.md)

### UX and design
- [DESIGN.md](../DESIGN.md)
  - 官方安装的 UI design guide；只负责风格方向和实现偏好
- `docs/UXUI/`
  - active interaction/spec library；这里只保留参考 `DESIGN.md` 的模块交互规范

### Engineering and testing reference
- [Engineering Docs Index](./engineering/README.md)
- [AgentSmith Unified Deploy and Docker Substrate Milestone Plan v1](./engineering/agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md)
  - current plan for one deploy model with local-kind and existing-cluster profiles
- [Testing Docs Index](./testing/README.md)
- [Diagnostic Catalog v1](./testing/diagnostic-catalog-v1.md)
  - choose `ui_only`, `local_manual`, or `release_grade`
  - pick the smallest diagnostic command before an expensive gate
- [Verification Campaigns v1](./testing/verification-campaigns-v1.md)
  - release-grade automated verification campaign guide
  - human release entrypoint: `npm run release:ready`
  - internal adapter `release:campaign:full` behind `npm run release:ready`
  - use this when you need the current testing principles, evidence model, and execution advice

### Methodology reference
- [Product Engineering Governance Methodology](./design/agentsmith-product-engineering-governance-methodology-v1.md)

## 3. Runtime / Deploy Quick Entry

- [User Guides Index](./user-guides/README.md)
- [Release Readiness Checklist](./user-guides/release-readiness-checklist.md)
- [Unified Deploy Operations](./user-guides/unified-deploy-operations.md)

## 4. Product doc / artifacts helpers

- [File Library Client Mount](./user-guides/file-library-local-mount.md)
- [Product Doc Artifacts](./user-guides/product-doc-artifacts.md)

## 5. What Is Outside This Index

这个入口只导航当前可执行、可验收的产品与工程真相。临时分析、一次性任务记录、已删除入口和过期过程材料不进入这里。

如果判断某份资料是否 still current，回到：
1. [Current Baseline (Whitelist)](./CURRENT_BASELINE.md)
2. [DESIGN.md](../DESIGN.md)（UI design guide）
3. [Product Terminology Contract](./contracts/product-terminology.md)
4. [Current Engineering Governance Model](./current-engineering-governance-model.md)
