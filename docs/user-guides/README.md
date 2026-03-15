# User Guides

仅保留当前有效的用户操作指南。

术语边界：若出现 `release` / `engineering gate` 命令命名，默认是工程验收与排障脚本；`permission gate` 仅表示产品权限门禁语义，不代表产品 DevOps 能力。

基线入口：

- [Current Baseline (Whitelist)](../CURRENT_BASELINE.md)

| Guide | Description |
|-------|-------------|
| [MVP Core Smoke Runbook](./mvp-core-smoke-runbook.md) | Real-backend MVP core regression path (chat/notebook/endpoint policy). |
| [Workspace / Project Mainline Engineering Checklist](./workspace-project-mainline-engineering-checklist.md) | Strict gate for `system 管理侧 -> 工作区发布 -> 用户访问入口 -> 项目创建` mainline. |
| [Governance Mainline Engineering Checklist](./governance-mainline-engineering-checklist.md) | Strict gate for `members -> resource policy -> audit/alerts` governance judgment workflow. |
| [Release Readiness Checklist](./release-readiness-checklist.md) | Final release verification order for contracts, strict gates, real notebook flow, and full visual coverage. |
| Real Visual Review Artifacts | Generated locally under `artifacts/release-real-visual/<run-id>/` by `npm run test:visual:real:review`. |
| [Identity & Permission Model](./identity-and-permission-model.md) | Current identity model baseline: email for selection, `user_id` for persisted permissions. |
| [Workspace Isolation Model](./workspace-isolation-model.md) | Current MVP workspace isolation baseline: shared infrastructure with namespace and scope boundaries. |
| [Test & Evidence Directory Model](./test-and-evidence-directory-model.md) | Directory contract for test code, temporary test output, mock visual baselines, and long-term release evidence. |
| [Audit & Usage](./audit-usage-reports.md) | Audit review and usage workflows under the current Usage/Audit MVP baseline. |
| [Alert Center](./alert-center.md) | Alert rules and notification operations. |
| [Usage Limits Summary Backend Alignment Checklist](./usage-limits-summary-backend-alignment-checklist.md) | Contract-to-implementation checklist for `/limits/summary` endpoint matrix payload. |
| [Third-Party Accounts & Feishu OAuth](./third-party-accounts-feishu.md) | User third-party account binding and Feishu OAuth callback flow. |

Quick links:

- [Documentation Index](../README.md)
- [Troubleshooting](../troubleshooting-guide-v1.md)
