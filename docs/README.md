# Documentation Index

当前仅保留可执行、可维护、与现行产品结构一致的文档。

术语边界：文档中的 `release` / `engineering gate` 相关命令名若出现，默认是本项目工程校验与验收流程命名；`permission gate` 则是产品权限门禁语义。两者均不代表 AgentSmith 提供 DevOps 发布管理能力。

先读：

- [Current Baseline (Whitelist)](./CURRENT_BASELINE.md)

## 核心

- [项目宪法](./项目宪法.md)
- [Usage / Audit MVP 职责边界](./UXUI/01-通用规范/usage-audit-职责边界-v1.md)
- [Usage / Audit MVP 功能与 UX 定义](./UXUI/01-通用规范/usage-audit-mvp-功能与uxui-v1.md)
- [System / Workspace Identity & Entry MVP](./UXUI/01-通用规范/system-workspace-identity-entry-mvp-v1.md)
- [System / Workspace Provisioning MVP Analysis](./UXUI/01-通用规范/system-workspace-provisioning-mvp-analysis-v1.md)
- [System Visual State Coverage TODO](./UXUI/01-通用规范/system-visual-state-coverage-todo-v1.md)
- [Usage / Audit MVP Engineering Checklist](./user-guides/usage-audit-engineering-checklist.md)
- [Workspace / Project Default Engineering Gate Checklist](./user-guides/workspace-project-default-engineering-gate-checklist.md)
- [Governance Default Engineering Gate Checklist](./user-guides/governance-default-engineering-gate-checklist.md)
- [Release Readiness Checklist](./user-guides/release-readiness-checklist.md)
- [Remote Deploy Operations](./user-guides/remote-deploy-operations.md)
- [Cluster Deploy Operations](./user-guides/cluster-deploy-operations.md)
- Real visual review artifacts are generated locally under `artifacts/release-real-visual/<run-id>/`
- [Test & Evidence Directory Model](./user-guides/test-and-evidence-directory-model.md)
- [Visual Baseline Policy](./UXUI/01-通用规范/visual-baseline-policy-v1.md)
- [Contracts Index](./contracts/README.md)
- [Cluster Deployment Spec](./contracts/cluster-deployment-spec-v1.md)
- [产品研发与治理方法论](./design/agentsmith-product-engineering-governance-methodology-v1.md)
- `UXUI/`（设计系统与交互规范）
- [User Guides Index](./user-guides/README.md)
- [Usage Limits Summary Backend Alignment Checklist](./user-guides/usage-limits-summary-backend-alignment-checklist.md)
- [Usage Limits Naming Refactor Task](./user-guides/usage-limits-naming-refactor-task.md)
- [Troubleshooting Guide](./troubleshooting-guide-v1.md)

## 运行与协作

- [Agent Codex Notebook Runbook](./agent-codex-notebook-runbook.md)
- [CI Integration Troubleshooting](./ci-integration-troubleshooting.md)

## 说明

1. 历史方案、过程评审、阶段计划、旧版发布资料已移除。
2. 当前治理结构以“项目级 + LLM endpoint 统一约束链路”为唯一主线。
