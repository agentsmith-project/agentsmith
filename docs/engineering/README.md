# Engineering Docs Index

<!-- markdownlint-disable MD013 -->

This directory holds engineering-side guidance that supports implementation and maintenance. Product scope, IA, and UI style truth live elsewhere.

## Deployment Boundary

This index is not a deployment truth source; canonical deploy details stay in
the unified deploy contract and release-kit final GA gate. Current Docker-only
/ local-kind unified deploy is only a pre-GA focused diagnostic baseline, not
long-term deployment truth. AgentSmith does not give a deployment, package, or
operator release verdict. The release-kit repo owns online/airgap deployment
verdict through its own final GA gate and evidence; kind/local-kind remains
local diagnostic support only.

Current vs P0 handoff boundary: the Docker-only/local-kind unified deploy path
is the current pre-GA focused diagnostic baseline, not a long-term deployment
truth. `external_declared` in P0 is schema, fixture, validator, and evidence
boundary only. It does not mean P2/P3 completed real Kubernetes, cloud, or
airgap handoff support.

Current implementation docs may still mention `kit_provided` as a pre-GA
substrate pack/truth validation path. The active GA plan intentionally
collapses operator-facing language to `online` / `airgap` × `use_existing` /
`install_substrates`. During P0/P3, `kit_provided` must either become a
short-lived alias with a removal date, or be deleted from operator-facing
docs after the installer producer lands. It must not survive as a second
operator mental model.

旧命名、旧路径、旧职责默认删除或 fail fast；只允许带 owner、删除条件和验收证据的短期待删项，不作为长期兼容承诺。

Current active plan:

- [AgentSmith GA 发布交付计划 v1](./agentsmith-ga-release-plan-v1.md) - active implementation-ready GA plan for the AgentSmith project set release, release-kit GA verdict, runner/adopted image chain, operator runbooks, and deployment verification.

Current next focus:

- Execute the GA plan in small slices; keep AgentSmith product readiness, release-kit deployment/package/operator verdict, runner image adoption, and dependency image locks as separate responsibilities.
- Reduce active governance weight while implementing the GA plan: hide producer/adoption/candidate taxonomy from operator docs, keep owner diagnostics behind runbooks, and avoid new gate families unless they replace or delete old burden.
- release-kit scoped evidence and runner locked safety are completed focused/candidate items; they remain focused evidence, not deployment/package/operator verdict or release readiness.
- backend-real / full runtime semantics, formal verdict, and airgap readiness are release-kit GA implementation work, not AgentSmith product-side blockers.

Historical/reference note:

- [Release Kit 与 Runner Repo 拆分 KISS 工程计划 v1](./release-kit-and-runner-repo-split-kiss-plan-v1.md) - pre-GA reference for the release-kit / runner repo split and AgentSmith product-side boundary. Current GA scope and implementation order are owned by the active GA plan above.
- [AgentSmith Sandbox Control Plane release independence plan v1](./archive/agentsmith-sandbox-control-plane-release-independence-plan-v1.md) - historical reference for the ASBCP clean-cut migration and AgentSmith consumer-side boundary. Current AgentSmith ASBCP operation/adoption truth stays in `docs/contracts/unified-deploy-contract.md`.
- [AgentSmith Unified Deploy and Docker Substrate Milestone Plan v1](./archive/agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md) - historical reference for the earlier Docker substrate and unified-deploy diagnostic implementation. It is not the current active plan, and its `local-kind` / `existing-cluster` names are diagnostic evidence names only.
- Superseded release-governance plans/logs are historical references only: [release flow simplification v3](./archive/governance-release-flow-simplification-plan-v3.md), [verification runtime simplification v1](./archive/governance-verification-runtime-simplification-plan-v1.md), [release verification optimization plan](./archive/release-verification-governance-optimization-plan.md), and [release verification optimization log](./archive/release-verification-governance-optimization-log.md). Current release-kit / runner split boundaries stay in the active plan above.
