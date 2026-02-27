# LLM Runtime 合约并入清单（v1）

更新时间：2026-02-27  
目标：将 `llm-provider-proxy-billing-openapi-draft-v1.yaml` 并入现有合约与生成链路。

---

## 1. 并入范围

需要并入主合约文件：
1. `docs/contracts/specs/openapi.yaml`
2. `docs/contracts/specs/openapi.json`（由规范流程生成/同步）
3. `docs/contracts/specs/openapi-route-kind-map.json`

需保持通过的检查：
1. `npm run openapi:generate`
2. `npm run openapi:check-generated`
3. `npm run contracts:check-openapi-core`
4. `npm run contracts:check-openapi-route-kinds`
5. `npm run contracts:check-openapi-breaking`

---

## 2. 合约增量（P0）

## 2.1 新增路径

1. `POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/llm/chat/completions`
2. `GET/POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/runtime/providers`
3. `PUT/DELETE /api/v1/workspaces/{workspaceId}/projects/{projectId}/runtime/providers/{providerConnectionId}`
4. `GET/POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/runtime/models`
5. `GET/POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/runtime/routing/aliases`
6. `GET/POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/runtime/routing/combos`
7. `GET/PATCH /api/v1/workspaces/{workspaceId}/projects/{projectId}/runtime/pricing`

## 2.2 增强已有路径（若保留原接口语义）

1. `GET /usage`：支持 provider/model/cost 维度过滤与返回。
2. `GET /usage/kpi`：支持成本 KPI。
3. `GET /usage/timeseries`：支持 cost 维度。
4. `GET /quota/summary`：与成本视图联动字段一致。

---

## 3. route-kind map 变更点

在 `packages/api-entry-node/src/projects-route-match.ts` 新增 route kind 后，需同步维护：

1. `llmUnifiedChat` -> `POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/llm/chat/completions`
2. `runtimeProviders` -> `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/runtime/providers`
3. `runtimeProviderItem` -> `PUT /api/v1/workspaces/{workspaceId}/projects/{projectId}/runtime/providers/{providerConnectionId}`
4. `runtimeModels` -> `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/runtime/models`
5. `runtimeRoutingAliases` -> `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/runtime/routing/aliases`
6. `runtimeRoutingCombos` -> `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/runtime/routing/combos`
7. `runtimePricing` -> `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/runtime/pricing`

说明：
- map 只记录每个 kind 的“主方法”；其余方法在 OpenAPI 路径对象中补齐。

---

## 4. 执行顺序（推荐）

1. 先改 `projects-route-match.ts` 与对应 handler skeleton。
2. 同步改 `openapi.yaml` 路径与 schema。
3. 同步改 `openapi-route-kind-map.json`。
4. 运行 `npm run openapi:generate`。
5. 运行 contracts 三项检查。
6. 修复 breaking/coverage 后再进入实现开发。

---

## 5. DoD

1. 新增路径均可在 `/api/v1/openapi.json` 中查询到。
2. `src/lib/api/types.generated.ts` 已更新且通过 check-generated。
3. route-kind coverage 检查无 missing/stale。
4. 无未批准的 breaking change。

---

## 6. 典型失败与处理

1. 失败：`check-openapi-route-kind-coverage` 报 missing kind。
- 处理：补 `openapi-route-kind-map.json`。

2. 失败：`check-openapi-core-coverage` 报缺少核心路径。
- 处理：补 `openapi.yaml` 对应 path/method。

3. 失败：`check-openapi-breaking` 报不兼容。
- 处理：确认是否可接受；若不可接受，改为新增字段/路径而非变更旧字段语义。

