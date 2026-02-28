# LLM Provider / Proxy / Billing Plan Index

## Recommended Reading Order
1. `llm-provider-proxy-billing-prd-v1.md`
- 产品目标、范围、验收主要求（基线 PRD）

2. `llm-provider-proxy-billing-prd-v2-execution-blueprint.md`
- 工程执行蓝图（架构冻结、数据模型、里程碑、退出标准）

3. `llm-provider-proxy-billing-e2e-test-plan-v1.md`
- E2E 覆盖矩阵与关键业务链路测试计划

4. `llm-provider-proxy-billing-contract-integration-checklist-v1.md`
- 契约/集成检查清单（发布门禁）

## Governance Rule
1. 文档冲突时，以 `prd-v2-execution-blueprint` 的工程约束为准（一次性切换、成本事实落库、错误语义冻结）。
2. 任何 API 或数据模型变更必须同步更新 OpenAPI 与 checklist。
