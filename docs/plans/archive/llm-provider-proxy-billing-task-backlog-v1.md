# LLM Runtime 任务 Backlog（可直接分配）

状态：`archived-superseded`
当前执行基线：
- `docs/plans/llm-runtime-final-implementation-plan-v2.md`
- `docs/plans/llm-runtime-detailed-work-plan-v1.md`

更新时间：2026-02-27  
关联：
- PRD: `docs/plans/llm-provider-proxy-billing-prd-v1.md`
- WBS: `docs/plans/archive/llm-provider-proxy-billing-workbreakdown-v1.md`

---

## 1. P0 任务（必须）

### BE-01 定义 runtime 领域模型与存储
- 类型：Backend
- 优先级：P0
- 依赖：无
- 产出：Provider/Model/Alias/Combo/Pricing 存储与校验。
- 验收：迁移脚本通过，单测通过。

### BE-02 新增 route kinds 与 handler skeleton
- 类型：Backend
- 优先级：P0
- 依赖：BE-01
- 产出：projects-route-match + request-handler + runtime route handler。
- 验收：路由可命中，返回标准错误码。

### BE-03 实现 unified proxy（direct/alias/combo）
- 类型：Backend
- 优先级：P0
- 依赖：BE-02
- 产出：`/llm/chat/completions` 实现。
- 验收：集成测试覆盖 direct/alias/combo。

### BE-04 实现 fallback 错误分类与策略执行
- 类型：Backend
- 优先级：P0
- 依赖：BE-03
- 产出：retryable/non-retryable 分类与 max_hops。
- 验收：错误分类测试通过。

### BE-05 接入治理前置链路
- 类型：Backend
- 优先级：P0
- 依赖：BE-03
- 产出：policy/quota/rate-limit 在 unified proxy 生效。
- 验收：治理回归用例通过。

### BE-06 成本计算与 usage fact 扩展
- 类型：Backend
- 优先级：P0
- 依赖：BE-01, BE-03
- 产出：provider/model/cost/pricing_version/calculation_version/raw_usage_json。
- 验收：金样例对账通过。

### BE-07 Usage 聚合接口增强
- 类型：Backend
- 优先级：P0
- 依赖：BE-06
- 产出：`/usage` `/usage/kpi` `/usage/timeseries` `/quota/summary` 对齐。
- 验收：与前端筛选/图表联调通过。

### FE-01 IA 改造与页面骨架
- 类型：Frontend
- 优先级：P0
- 依赖：BE-02（可并行）
- 产出：Connections/Models/Routing/Usage&Cost 页面入口。
- 验收：页面导航与路由通过。

### FE-02 Connections/Models/Routing/Pricing CRUD
- 类型：Frontend
- 优先级：P0
- 依赖：FE-01, BE-01/BE-02
- 产出：核心配置页与表单校验。
- 验收：E2E CRUD 通过。

### FE-03 Unified proxy 联调与诊断 UI
- 类型：Frontend
- 优先级：P0
- 依赖：BE-03, BE-04
- 产出：路由预演、fallback 时间线。
- 验收：异常定位场景通过。

### FE-04 Usage & Cost 看板增强
- 类型：Frontend
- 优先级：P0
- 依赖：BE-07
- 产出：provider/model 维度筛选、钻取、异常解释卡片。
- 验收：E2E 场景通过。

### QA-01 契约测试与生成链路
- 类型：QA/Backend
- 优先级：P0
- 依赖：BE-02
- 产出：OpenAPI + route-kind coverage 通过。
- 验收：contracts 检查全绿。

### QA-02 E2E 主链路测试集
- 类型：QA
- 优先级：P0
- 依赖：FE-04, BE-07
- 产出：smoke/regression/data-correctness/visual。
- 验收：发布门禁全绿。

---

## 2. P1 任务（增强）

### FE-05 策略变更影响预估
- 类型：Frontend
- 优先级：P1
- 依赖：BE-07
- 产出：影响请求比例与成本变化预估 UI。

### BE-08 告警动作建议
- 类型：Backend
- 优先级：P1
- 依赖：BE-07
- 产出：成本异常建议动作（降级/限流/切换模型）。

### FE-06 导出能力（CSV/JSON）
- 类型：Frontend
- 优先级：P1
- 依赖：BE-07
- 产出：usage/cost 报表导出。

---

## 3. 建议分工

1. 后端小队 A：BE-01~BE-04
2. 后端小队 B：BE-05~BE-07
3. 前端小队 A：FE-01~FE-03
4. 前端小队 B：FE-04~FE-06
5. 测试小队：QA-01~QA-02

---

## 4. 每周同步节奏

1. 周一：契约与接口变更评审。
2. 周三：联调阻塞清单清零。
3. 周五：门禁回归结果与风险复盘。
