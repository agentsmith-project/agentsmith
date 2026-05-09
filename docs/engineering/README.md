# Engineering Docs Index

This directory holds engineering-side guidance, active implementation rationale, and closure records that support implementation and maintenance. It does not define product IA or UI style guidance.

Current guidance, rationale, and closure records:
- [Current Engineering Governance Model](../current-engineering-governance-model.md) - current engineering governance truth; keep aligned with machine-readable manifests/contracts
- [Agent Task Persistent HOME Runtime Plan](./agent-task-persistent-home-runtime-plan.md) - `handoff_plan_ready`; next development plan for sharing one task-bound persistent HOME between Agent task terminal and agent runtime while keeping artifacts scoped to `workspace/.artifacts`
- [Agent Task Terminal Close and Recovery Handoff](./agent-task-terminal-close-recovery-handoff.md) - `handoff_plan_ready`; focused next-step handoff for managed/internal and Developer terminal close/recovery, close ack convergence, real process-tree termination, and real UX gate evidence
- [Agent Task Terminal Runtime Recovery Hardening Plan](./agent-task-terminal-runtime-recovery-hardening-plan.md) - `handoff_plan_ready`; next development plan for terminal refresh/navigation recovery, runner reconnect/adopt semantics, close tombstones, typed failures, and Developer runner local task HOME path hardening
- [Agent Task Terminal Runtime Recovery Engineering Guidance](./agent-task-terminal-runtime-recovery-guidance.md) - `current_engineering_guidance`; active guidance and implementation rationale for terminal runtime recovery, separating browser disconnect, runner transport recovery, closing tombstones, and typed terminal failures
- [Agent Task Model Setting Milestone Plan v1](./agent-task-execution-model-settings-milestone-plan-v1.md) - `handoff_plan_ready`; product/contract plan for choosing which Endpoint/default model Agent tasks use without moving model configuration into Agent Runners
- [AgentSmith Unified Deploy and Docker Substrate Milestone Plan v1](./agentsmith-unified-deploy-and-docker-substrate-milestone-plan-v1.md) - current deploy implementation plan for local-kind and existing-cluster profiles
- [前端技术栈与国际化策略-v1](./前端技术栈与国际化策略-v1.md)

Decision-required analyses:
- [Internal Agent Terminal Pod Lifecycle Analysis v1](./internal-agent-terminal-pod-lifecycle-analysis-v1.md) - `decision_required_analysis`; current implementation review and options, not a current implementation plan
