# Usage Limits 命名重构任务（零兼容）

Last updated: 2026-03-08  
Owner: Frontend + Backend

## 目标

彻底消除 `total_limit` / `limit_total` 等易混淆命名，统一为可直接理解的层级语义，并在未上线阶段一次性完成无兼容切换。

## 命名与数据模型（最终版）

### 1) 规则级（窗口限制）

1. `kind`: `rate_limit | spending_limit`
2. `window`: `minute | 5h | day | current`
3. `metric`: `requests | usd`
4. `policy_key`: string
5. `used`: number
6. `max`: number
7. `remaining`: number
8. `usage_pct`: number
9. `reset_at`: string (date-time)

### 2) Endpoint 级

1. `endpoint_id`: string
2. `endpoint_name`: string
3. `limits`: `LimitRuleSnapshot[]`

### 3) 项目汇总级

1. `project_used`: number
2. `project_max`: number
3. `project_remaining`: number
4. `project_usage_pct`: number

## API 结构（最终版）

`GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/limits/summary`

返回：

1. `endpoints: EndpointLimitSummary[]`
2. `project_summary: ProjectLimitSummary`

## 实施范围

1. 合同与 OpenAPI：
   - `docs/contracts/usage-limits-summary-contract.md`
   - `docs/contracts/specs/openapi.yaml`
   - `docs/contracts/specs/openapi.json`
2. 生成类型：
   - `src/lib/api/types.generated.ts`
3. 前端解析与页面：
   - `src/lib/api/endpoints/audit-usage.ts`
   - `src/components/audit-usage/UsagePage.tsx`
   - `src/components/audit-usage/UsageView.tsx`
4. Mock 与测试：
   - `src/mocks/handlers/usage.ts`
   - `src/lib/api/__tests__/audit-usage-api.test.ts`
   - `src/components/audit-usage/__tests__/UsagePage.test.tsx`
5. 用户文档：
   - `docs/user-guides/audit-usage-reports.md`
   - `docs/user-guides/usage-limits-summary-backend-alignment-checklist.md`

## 非目标

1. 不做旧字段兼容读取。
2. 不做 workspace 级治理扩展。
3. 不引入新的治理对象或 DevOps 语义。

## 验收标准

1. 代码中不再存在 `limit_total/total_limit/limit_limit/total_limit_limit` 作为 limits summary 字段。
2. Usage 页面按 endpoint -> rate/spending -> window 渲染正常。
3. 合同、OpenAPI、mock、测试、用户文档表述一致。
4. 通过：`contracts:check-limit-naming`、`contracts:check-openapi`、`openapi:check-generated`、`lint`、`tsc`、相关单测。
