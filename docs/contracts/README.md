# Contracts Index

当前目录以现行合同与规范为主；少量 `handoff` / `refactor` 文档保留阶段性交接与迁移背景。

基线入口：

- [Current Baseline (Whitelist)](../CURRENT_BASELINE.md)

术语边界：

- `release` 命名默认指向项目研发治理流程，不等于产品 DevOps 功能。
- `gate` 在本目录有两种语义，必须按上下文区分：
  - `permission gate`：前端路由/交互权限门禁（产品内能力约束）。
  - `engineering gate`：项目工程验收/检查门禁（研发流程约束）。
- 机器可读规范中的字段命名可能包含后端内部或历史兼容术语，不单独构成前端产品能力承诺。
- 标题包含 `handoff` / `refactor` / `migration` 的合同文档，允许保留旧术语、兼容映射与迁移前后对照；current 决策应以其余现行合同为准。
- 文档治理检查默认要求这类文档进入 `docs/archive/`；只有被 current index 显式保留的少量迁移参考文档允许留在现行目录。

## 核心合同

1. `auth-permission-model.md`
2. `frontend-token-interaction-contract.md`
3. `frontend-resource-policy-governance-v1.md`
4. `frontend-backend-gating-matrix.md`
5. `usage-limits-summary-contract.md`
6. `route-gate-test-checklist.md`
7. `product-terminology.md`

## 参考与专题合同

- `API_GUIDE.md`（API 导航入口；具体接口以 OpenAPI/AsyncAPI 为准）
- `model-catalog-project-pricing-contract.md`（模型目录能力启用时适用）
- `backend-persistent-state-boundary.md`（后端主数据、共享运行态与进程内瞬态的边界）
- `backend-storage-architecture-matrix.md`（全系统后端数据真相、接口模块与存储模式总表）
- `backend-storage-maturity-checklist.md`（后端数据持久化成熟度改进清单）
- `cluster-deployment-spec-v1.md`（真实集群发布线：registry + install bundle + compose/k8s 边界）
- `substrate-governance-and-runtime-lines-v1.md`（substrate / app / scenario 运行线治理合同）
- `../archive/handoff/endpoint-upstream-protocol-refactor-handoff-v1.md`（已归档的 endpoint 上游协议历史交接文档；仅保留 legacy -> current 术语映射作为历史上下文）

## 模块合同

- `chat-frontend-module-map.md`
- `notebook-frontend-module-map.md`
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
