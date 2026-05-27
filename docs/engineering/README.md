# Engineering Docs Index

<!-- markdownlint-disable MD013 -->

This directory holds engineering-side guidance that supports implementation and maintenance. Product scope, IA, and UI style truth live elsewhere.

## Deployment Boundary

This index is not a deployment truth source; canonical deploy details stay in
the unified deploy contract and release-kit split plan. Current Docker-only /
local-kind unified deploy is only a pre-GA focused diagnostic baseline, not
long-term deployment truth. In P0, `external_declared` is only the schema,
fixture, validator, and evidence boundary; it does not mean P2/P3 real
Kubernetes, cloud, or airgap handoff is complete. AgentSmith does not give a
release verdict, and the release-kit repo owns online/airgap deployment
verdict through its own gates and evidence; kind/local-kind remains local
diagnostic support only. Operator-facing release language is `online` /
`airgap` × `use_existing` / `install_substrates`; `install_substrates` is a
release-kit-owned minimal/adjacent substrate pack capability, not AgentSmith
substrate deployment and not provider matrix expansion.
Pre-GA 口径：旧命名、旧路径、旧职责默认删除或 fail fast；只允许带
owner、删除条件和验收证据的短期待删项，不作为长期兼容承诺。

Current active plan:

- [Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1](./release-kit-and-runner-repo-split-kiss-plan-v1.md) - active pre-GA plan for the release-kit / runner repo split and AgentSmith product-side boundary.

Current next blocker:

- P3 airgap image load/import focused diagnostic, P3 substrate pack focused gate, and AgentSmith runner support API / projection contract consistency are complete. `--substrate-pack-check` only validates minimal substrate pack manifest + matching kit-installed substrate truth for `existing_kubernetes/kit_installed/online|airgap`; it is not an installer, cloud provisioning, DB/bucket/realm creation, deploy/rollout/smoke, package, airgap, or release readiness.
- Remaining work is offline install/deploy smoke, operator/deployment adoption, and runner runtime/backend-real/task execution/Codex smoke; this is still not release readiness, airgap readiness, or sibling-repo runtime handoff readiness.

Historical/reference note:

- [AgentSmith Unified Deploy and Docker Substrate Milestone Plan v1](./agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md) - historical reference for the earlier Docker substrate and unified-deploy diagnostic implementation. It is not the current active plan, and its `local-kind` / `existing-cluster` names are diagnostic evidence names only.
