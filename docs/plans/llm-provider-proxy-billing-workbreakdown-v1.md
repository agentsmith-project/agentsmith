# LLM Provider / Proxy / Billing 执行拆解（WBS v1）

更新时间：2026-02-27  
关联 PRD：`docs/plans/llm-provider-proxy-billing-prd-v1.md`

---

## 1. 目标

将 PRD 拆为可并行执行的工程任务包，明确：
1. 优先级（P0/P1）
2. 依赖关系
3. 交付物
4. 完成定义（DoD）

---

## 2. 里程碑与任务包

## M1（第 1-2 周）：契约与骨架冻结（P0）

### WP-1 领域模型与存储设计
- Owner：后端
- 内容：定义 `provider_connection`、`model_catalog_entry`、`model_routing_alias`、`model_routing_combo`、`usage_fact` 扩展字段。
- 交付物：数据结构定义、迁移脚本、校验器。
- DoD：类型检查通过；迁移在干净库和已有库均可执行。

### WP-2 API 契约冻结
- Owner：后端 + 前端
- 内容：冻结 Runtime 控制面 API + Unified Proxy API + Usage/Cost API。
- 交付物：OpenAPI 草案、错误码字典、示例请求响应。
- DoD：契约评审通过；无冲突字段。

### WP-3 错误分类与成本精度规范
- Owner：架构/后端
- 内容：冻结错误分类（governance_reject/provider_retryable/provider_non_retryable/system_error）与金额精度策略。
- 交付物：规范文档、代码常量定义。
- DoD：核心模块统一使用同一枚举与金额类型。

## M2（第 3-5 周）：P0 主体研发

### WP-4 Runtime 控制面后端
- Owner：后端
- 内容：provider/model/routing/pricing CRUD。
- 依赖：WP-1、WP-2。
- DoD：单测通过；审计事件完整。

### WP-5 Unified Proxy 后端
- Owner：后端
- 内容：`/llm/chat/completions`、model 解析、combo fallback、治理前置。
- 依赖：WP-2、WP-3、WP-4。
- DoD：集成测试覆盖 direct/alias/combo 成功与失败路径。

### WP-6 Billing 事实写入
- Owner：后端
- 内容：token 成本计算、pricing version、usage 原始快照与归一化字段双写。
- 依赖：WP-1、WP-3、WP-5。
- DoD：金样例对账通过；历史成本不可被回写。

### WP-7 前端 IA 与控制台页面
- Owner：前端
- 内容：Connections/Models/Routing/Pricing 页面；草稿发布；高风险确认。
- 依赖：WP-2、WP-4。
- DoD：关键交互通过自测；i18n key 完整。

## M3（第 6-7 周）：联调与体验收敛

### WP-8 Usage & Cost 看板增强
- Owner：前端
- 内容：provider/model 维度筛选、fallback 时间线、异常解释卡片。
- 依赖：WP-6、WP-7。
- DoD：联调通过；无断链请求。

### WP-9 端到端质量门禁
- Owner：测试 + 前后端
- 内容：type/contract/integration/e2e/visual 全链路。
- 依赖：WP-4~WP-8。
- DoD：发布门禁指标全部达标。

## M4（第 8-10 周）：发布演练与上线

### WP-10 发布与回退演练
- Owner：运维 + 研发
- 内容：一次性切换 runbook、回退演练、UAT。
- 依赖：WP-9。
- DoD：演练通过并留档。

---

## 3. 依赖关系（简版）

1. `WP-1 -> WP-4 -> WP-5 -> WP-6 -> WP-8 -> WP-9 -> WP-10`
2. `WP-2 -> WP-4/WP-5/WP-7`
3. `WP-3 -> WP-5/WP-6`
4. `WP-7 -> WP-8`

---

## 4. 风险点与前置控制

1. 契约漂移风险
- 控制：OpenAPI 与路由实现 CI 对齐校验。

2. 成本误差风险
- 控制：金样例测试 + 每日抽样对账。

3. fallback 误配置风险
- 控制：前后端双重校验 + 路由预演。

4. 一次性切换风险
- 控制：发布窗口全量演练 + 版本级回退预案。

---

## 5. 发布前 Checklist（必须全勾）

1. P0 功能完成且代码冻结。
2. 契约/类型/集成/e2e/visual 通过。
3. 金样例对账通过并归档。
4. UAT 关键路径通过。
5. 切换与回退演练完成并签字。

