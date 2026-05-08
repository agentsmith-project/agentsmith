# Contracts Index

本目录保留 current contracts、明确标注的 target contracts、协议说明和 machine-readable specs 的导航入口。

`docs/CURRENT_BASELINE.md` 是唯一的人类 current truth router。本 README 负责
contract 导航和 current-v1 / target-v2 分区，不能单独把 target contract 提升为
current runtime truth。

部分 current contract 文件可能包含明确标注的 backlog/reference 小节。那些小节只用于保留未来设计方向或历史决策上下文，不是当前发布工作顺序，也不是必须执行的 gate 清单。

基线入口：
- [Current Baseline (Whitelist)](../CURRENT_BASELINE.md)

术语边界：
- `release` 默认指向项目研发治理流程，不等于产品 DevOps 功能。
- `gate` 在本目录里有两类语义：
  - `permission gate`：产品权限门禁
  - `engineering gate`：工程验收门禁
- `product-terminology.md` 是当前产品对象、正式命名、IA 边界的真相源。
- 当前产品文档与 UI 统一使用 `Model` 作为 Chat 选择器、`Agent tasks` 作为任务执行入口、`Agent Runners` 作为任务执行能力配置面，并使用 `Shared context` 作为共享上下文对象名。
- target deploy terms in `product-terminology.md` are target-v2 vocabulary only
  until current-baseline routing and implementation evidence switch.

## Deployment Contracts: Current-v1 Active Truth

这些文件仍是 current-v1 active runtime truth，直到 scripts、manifests、gates、
runbooks、release evidence 和 `docs/CURRENT_BASELINE.md` 切换到 unified deploy
v2：

- `deployment-spec-v1.md`
- `cluster-deployment-spec-v1.md`
- `substrate-governance-and-runtime-lines-v1.md`
- `address-truth-and-release-governance-v1.md`
- `universal-proxy-integration-v1.md`

这些 v1 文件可以继续描述 `demo-deploy`、`cluster-deploy`、Compose app/data
services、current universal-proxy placement 等当前事实。target-v2 文档不得要求
current-v1 文档在切换前移除这些当前事实。

## Deployment Contract: Target-v2

- `unified-deploy-contract-v2.md`

状态：`target_v2_contract` / `not_current_runtime_truth`。

该合同定义目标拓扑：one `AgentSmith deploy`、`local-kind` /
`existing-cluster` profiles、Docker-only substrate、Keycloak substrate、
app-managed K8s `llmup`、`api replicas=1`、`/api/v1 -> api`、`/api/public`
和 `/api/system -> web`，且不做 execution-gateway 或 K8s substrate。

在 v2 证据闭环前，它只能作为实现目标和评审边界，不能覆盖 current-v1 runtime
truth。

## 核心合同

1. `auth-permission-model.md`
2. `frontend-token-interaction-contract.md`
3. `frontend-resource-policy-governance-v1.md`
4. `frontend-backend-gating-matrix.md`
5. `usage-limits-summary-contract.md`
6. `route-gate-test-checklist.md`
7. `product-terminology.md`
8. `current-gate-manifest-contract.md`
9. `current-gate-result-schema-contract.md`
10. `current-governance-observability-contract.md`
11. `user-story-contract-v1.md`

## 参考与专题合同

- `API_GUIDE.md`
- `model-catalog-project-pricing-contract.md`
- `backend-persistent-state-boundary.md`
- `backend-storage-architecture-matrix.md`
- `cluster-deployment-spec-v1.md`
- `substrate-governance-and-runtime-lines-v1.md`
- `unified-deploy-contract-v2.md`

## 模块合同

- `chat-frontend-module-map.md`
- `agent-task-frontend-module-map.md`
- `agent-runners-frontend-module-map.md`
- `files-frontend-module-map.md`
- `endpoints-frontend-module-map.md`
- `endpoints-capability-contract.md`
- `endpoint-proxy-protocol-bridge-contract.md`
- `resource-policy-frontend-module-map.md`
- `projects-frontend-module-map.md`
- `api-entry-node-module-map.md`
- `agent-execution-protocol.md`

## 机器可读规范

- `specs/openapi.yaml` / `specs/openapi.json`
- `specs/asyncapi.yaml` / `specs/asyncapi.json`

## 常用检查

- `npm run contracts:check`
- `npm run contracts:check-openapi`
- `npm run openapi:check-generated`

## Testing / verification 相关入口

- `current-gate-manifest-contract.md`
  - stable gate ids、visual ownership、backend-real ownership、story evidence ownership
- `current-gate-result-schema-contract.md`
  - canonical `result.json` location、snake_case schema、gate-level `failure_class`
- `current-governance-observability-contract.md`
  - status projection、run diagnostics artifacts、sentinel preflight、lease status shadow、redaction boundary
- `user-story-contract-v1.md`
  - executable story truth、generated spec drift rules、story fingerprint semantics
- `../testing/verification-campaigns-v1.md`
  - 面向开发者的 release-grade automated verification guidance
