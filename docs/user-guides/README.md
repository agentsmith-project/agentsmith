# User Guides

仅保留当前有效的用户操作指南。

术语边界：若出现 `release` / `engineering gate` 命令命名，默认是工程验收与排障脚本；`permission gate` 仅表示产品权限门禁语义，不代表产品 DevOps 能力。

基线入口：

- [Current Baseline (Whitelist)](../CURRENT_BASELINE.md)

| Guide | Description |
|-------|-------------|
| [MVP Core Smoke Runbook](./mvp-core-smoke-runbook.md) | Real-backend MVP core regression path (chat/notebook/endpoint policy). |
| [Workspace / Project Default Engineering Gate Checklist](./workspace-project-default-engineering-gate-checklist.md) | Default engineering gate for `system 管理侧 -> 工作区发布 -> 用户访问入口 -> 项目创建`. |
| [Governance Default Engineering Gate Checklist](./governance-default-engineering-gate-checklist.md) | Default governance gate for `members -> resource policy -> audit/alerts`. |
| [Backend Persistent State Boundary](../contracts/backend-persistent-state-boundary.md) | Which backend data must survive API restarts, and which state is allowed to stay in memory. |
| [Backend Storage Architecture Matrix](../contracts/backend-storage-architecture-matrix.md) | Current backend module, interface, storage mode, and maturity matrix for product-grade persistence review. |
| [Backend Storage Maturity Checklist](../contracts/backend-storage-maturity-checklist.md) | Next-step improvement checklist after main data truth has been productized. |
| [Release Readiness Checklist](./release-readiness-checklist.md) | Final release verification order for contracts, default gates, real notebook flow, and full visual coverage. |
| [Local Runtime Flows](./local-runtime-flows.md) | The shortest local runbook: one shared substrate, one active flow at a time, and how to switch between `local-manual`, `demo-rehearsal`, and `cluster-rehearsal`. |
| [Demo Deploy Operations](./demo-deploy-operations.md) | Demo / single-host deployment line: host deployment root, lifecycle commands, address model, and local `kind` sandbox verification flow. |
| [Cluster Deploy Operations](./cluster-deploy-operations.md) | Real-cluster deployment line: registry-backed bundle release, target-host install flow, manager ingress, and namespace-only automation model. |
| [Cluster Upgrade Operations](./cluster-upgrade-operations.md) | Existing production install version-update line: upgrade app services and namespaced sandbox resources without touching substrate or data. |
| [Cluster Admin Runbook](./cluster-admin-runbook.md) | Cluster-scope prerequisites for the real-cluster line only: namespace, JuiceFS CSI, storage class, manager runtime kubeconfig, and ingress preparation. |
| Real Visual Review Artifacts | Generated locally under `artifacts/backend-real-visual/<run-id>/` by `npm run test:visual:backend-real:review`. |
| [Identity & Permission Model](./identity-and-permission-model.md) | Current identity model baseline: email for selection, `user_id` for persisted permissions. |
| [Workspace Isolation Model](./workspace-isolation-model.md) | Current MVP workspace isolation baseline: shared infrastructure with namespace and scope boundaries. |
| [Test & Evidence Directory Model](./test-and-evidence-directory-model.md) | Directory contract for test code, temporary test output, mock visual baselines, and long-term release evidence. |
| [Audit & Usage](./audit-usage-reports.md) | Audit review and usage workflows under the current Usage/Audit MVP baseline. |
| [Alert Center](./alert-center.md) | Alert rules and notification operations. |
| [Usage Limits Summary Backend Alignment Checklist](./usage-limits-summary-backend-alignment-checklist.md) | Contract-to-implementation checklist for `/limits/summary` endpoint matrix payload. |
| [Third-Party Accounts & Workspace Feishu](./third-party-accounts-feishu.md) | Current split between personal third-party credentials and workspace-scoped Feishu integration. |
| [File Library Client Mount](./file-library-local-mount.md) | Local JuiceFS mount instructions and sync validation path for project file libraries. |
| [Product Doc Artifacts](./product-doc-artifacts.md) | Generate screenshot + Markdown bundles for product-facing documentation artifacts. |
| [Marketing Assets](../../marketing/README.md) | Generate and refresh marketing screenshot assets under `marketing/screenshots/`. |

Archived environment-specific examples:

- [mbos.imotion.ai Demo Deploy Runbook](../archive/env-specific/demo-deploy-mbos-imotion-ai.md)

Quick links:

- [Documentation Index](../README.md)
- [Troubleshooting](../troubleshooting-guide-v1.md)
