# LLM Provider / Proxy / Billing Plan Index

## Recommended Reading Order
1. `../design/llm-runtime-product-decision-memo-v1.md`
- 产品定位、对象定义、信息架构、UX 决策、错误语义、计费治理原则

2. `llm-runtime-final-implementation-plan-v2.md`
- 已确认决策下的最终实施计划（周节奏、冻结点、门禁、切换策略）

3. `llm-provider-proxy-billing-prd-v1.md`
- 产品目标、范围、验收主要求（基线 PRD）

4. `llm-provider-proxy-billing-prd-v2-execution-blueprint.md`
- 工程执行蓝图（架构冻结、数据模型、里程碑、退出标准）

5. `llm-runtime-detailed-work-plan-v1.md`
- 页面/API/测试/阶段性交付的详细工作计划

6. `llm-provider-proxy-billing-e2e-test-plan-v1.md`
- E2E 覆盖矩阵与关键业务链路测试计划

7. `llm-provider-proxy-billing-contract-integration-checklist-v1.md`
- 契约/集成检查清单（发布门禁）

## Governance Rule
1. 文档冲突时，先以 `llm-runtime-product-decision-memo-v1` 的产品决策为准，再以 `prd-v2-execution-blueprint` 的工程约束为准。
2. 任何 API 或数据模型变更必须同步更新 OpenAPI 与 checklist。
