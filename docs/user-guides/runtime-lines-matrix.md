# Runtime Lines Matrix

This page is the current map for AgentSmith development, verification, release, and deploy runtime lines.

Detailed commands live in:

- [Local Runtime Flows](./local-runtime-flows.md)
- [Unified Deploy Operations](./unified-deploy-operations.md)

<!-- current-runtime-lines:runtime-matrix:start -->
## 当前本机操作基线

1. `local-real` 是开发机上的正式人类入口；`local-manual` 只保留为底层 maintainer adapter。
2. `local-real` 与 unified deploy substrate 共享默认本地 substrate 端口，在同一开发机上必须串行切换。

可复制的人类操作入口统一看 [Local Runtime Flows](./local-runtime-flows.md) 与 [Unified Deploy Operations](./unified-deploy-operations.md)；本矩阵只说明 topology、profile 边界和运行线归属。

## 持续生效的 runtime contract

1. 只有一个 AgentSmith deploy 模型；`local-kind` 与 `existing-cluster` 是 profile，不是两套产品。
2. Substrates 保持在 app namespace 外部，由 Docker 或运维提供的服务承载；AgentSmith app 工作负载运行在 Kubernetes。
3. 当前里程碑 `api replicas=1`，直到引入明确的多副本 execution routing 设计。

## Current vs P0 Handoff Boundary

Current Docker-only local-kind unified deploy remains the current mainline.
`external_declared` in P0 is schema, fixture, validator, and evidence boundary only; it does not mean P2/P3 completed real Kubernetes, cloud, or airgap handoff support.

AgentSmith deploy 只有 unified deploy 证据链；运行线矩阵不再拆成多套部署入口。

## 运行线矩阵

| 运行线 | 当前正式命名 | 主要用途 | App runtime | substrate | 备注 |
|-------|-------------|---------|-------------|----------|------|
| 本地真实开发线 | `local-manual` | Daily development, real-backend manual validation, and focused Agent task / Files checks through the local-real entrypoint. | Host API/Web/runner processes. | Local Docker development substrate. | local-real is the product-facing developer path; local-manual is the adapter identity and runtime evidence root. |
| 统一部署本机 profile | `unified-deploy local-kind` | Local Kubernetes deploy proof on a developer machine. | Kubernetes workloads in local kind. | Docker substrate registered into Kubernetes Services and EndpointSlices. | Use focused product flows after rollout to prove Files and managed runner behavior. |
| 统一部署既有集群 profile | `unified-deploy existing-cluster` | Deploy smoke against an operator-owned Kubernetes cluster and declared external substrate truth. | Kubernetes workloads in an operator-owned cluster. | Operator-provided external substrate truth. | Route smoke proves deploy wiring; focused product flows still prove Files and managed runner behavior. |

## 当前证据路径

- local-real / local-manual runtime state: `artifacts/runtime/lines/local-manual/current`
- unified deploy evidence: `artifacts/unified-deploy/`
<!-- current-runtime-lines:runtime-matrix:end -->

## Short Rule

Use `local-real` to develop and manually test. Use unified deploy profiles to prove deployment. Use focused product flows to prove file library and managed runner task behavior without running a heavy release campaign.
