# Contracts Index

当前仅保留现行合同与规范，不保留历史快照说明。

基线入口：

- [Current Baseline (Whitelist)](../CURRENT_BASELINE.md)

术语边界：

- 本目录若出现 `release` / `gate` 命名，默认指向项目研发治理流程，不等于产品 DevOps 功能。
- 机器可读规范中的字段命名可能包含后端内部或历史兼容术语，不单独构成前端产品能力承诺。

## 核心合同

1. `auth-permission-model.md`
2. `frontend-token-interaction-contract.md`
3. `frontend-resource-policy-governance-v1.md`
4. `frontend-backend-gating-matrix.md`
5. `route-gate-test-checklist.md`
6. `product-terminology.md`

## 模块合同

- `chat-frontend-module-map.md`
- `notebook-frontend-module-map.md`
- `files-frontend-module-map.md`
- `files-object-browser-contract.md`
- `endpoints-frontend-module-map.md`
- `endpoints-capability-contract.md`
- `endpoint-proxy-protocol-bridge-contract.md`
- `resource-policy-frontend-module-map.md`
- `projects-frontend-module-map.md`
- `api-entry-node-module-map.md`
- `agent-runtime-protocol.md`

## 机器可读规范

- `specs/openapi.yaml` / `specs/openapi.json`
- `specs/asyncapi.yaml` / `specs/asyncapi.json`

## 常用检查

- `npm run contracts:check`
- `npm run contracts:check-openapi`
- `npm run openapi:check-generated`
