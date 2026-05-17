# Engineering Docs Index

<!-- markdownlint-disable MD013 -->

This directory holds engineering-side guidance, active implementation rationale, and closure records that support implementation and maintenance. It does not define product IA or UI style guidance.

Current guidance and implementation plans:

- [Current Engineering Governance Model](../current-engineering-governance-model.md) - current engineering governance truth; keep aligned with machine-readable manifests/contracts
- [Agent Task File Library HOME Runtime Implementation Plan](./agent-task-persistent-home-runtime-plan.md) - `current_implementation_plan`; current development plan for making a file-library-stable HOME root the Agent task HOME, enforcing durable one-file-library-per-undeleted-task binding, and keeping artifacts scoped to `workspace/.artifacts`
- [AFSCP File Library Runtime Rearchitecture Plan](./afscp-file-library-runtime-rearchitecture-plan.md) - `current_milestone_plan`; current plan for AFSCP shared-volume repos, save points, restore, templates, and workload mounts with AgentSmith as product authority
- [文件库版本管理下一步收敛改进计划 v1](./file-library-version-management-followup-plan-v1.md) - `handoff_ready`; next-step plan for stabilizing save point/restore/template UX, AgentSmith/AFSCP/JVS state contracts, and focused user-story evidence without expanding scope
- [Agent Task Terminal Runtime Recovery Engineering Guidance](./agent-task-terminal-runtime-recovery-guidance.md) - `current_engineering_guidance`; active guidance and implementation rationale for terminal runtime recovery, separating browser disconnect, runner transport recovery, closing tombstones, and typed terminal failures
- [AgentSmith Unified Deploy and Docker Substrate Milestone Plan v1](./agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md) - current deploy implementation plan for local-kind and existing-cluster profiles
- [Governance Lean Closure Plan v1](./governance-lean-closure-plan-v1.md) - `team_reviewed_handoff_ready`; convergent plan for reducing repeated governance work, clarifying clean entrypoints, and avoiding new governance lines
- [Governance Release Flow Simplification Plan v3](./governance-release-flow-simplification-plan-v3.md) - `team_reviewed_handoff_ready`; low-mind follow-up plan for reducing repeated release/bootstrap work while preserving release evidence authority
- [前端技术栈与国际化策略-v1](./前端技术栈与国际化策略-v1.md)

Decision-required analyses:

- [Internal Agent Terminal Pod Lifecycle Analysis v1](./internal-agent-terminal-pod-lifecycle-analysis-v1.md) - `decision_required_analysis`; current implementation review and options, not a current implementation plan
