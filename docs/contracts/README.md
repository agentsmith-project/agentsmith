# Contracts Index

当前仅保留现行合同与规范，不保留历史快照说明。

基线入口：

- [Current Baseline (Whitelist)](../CURRENT_BASELINE.md)

术语边界：

- `release` 命名默认指向项目研发治理流程，不等于产品 DevOps 功能。
- `gate` 在本目录有两种语义，必须按上下文区分：
  - `permission gate`：前端路由/交互权限门禁（产品内能力约束）。
  - `engineering gate`：项目工程验收/检查门禁（研发流程约束）。
- 机器可读规范中的字段命名可能包含后端内部或历史兼容术语，不单独构成前端产品能力承诺。

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
