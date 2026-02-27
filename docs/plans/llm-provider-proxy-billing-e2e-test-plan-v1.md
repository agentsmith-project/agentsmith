# LLM Provider / Proxy / Billing E2E 测试计划（v1）

更新时间：2026-02-27  
关联 PRD：`docs/plans/llm-provider-proxy-billing-prd-v1.md`

---

## 1. 测试目标

验证本期 P0/P1 能力在真实产品流中的可用性与稳定性：
1. Runtime 控制面可正确配置并生效。
2. Unified proxy 在 direct/alias/combo 场景行为正确。
3. fallback 仅在预期错误触发。
4. usage/cost 数据完整、准确、可钻取。
5. UX 关键交互可用，防错机制有效。

---

## 2. 测试环境与前置

1. 前后端服务手动启动。
2. 使用真实后端数据库（与发布一致配置）。
3. 清理代理环境变量后运行。
4. Playwright 使用固定 `BASE_URL`。

建议前置数据：
1. 至少 2 个 provider connection（主/备）。
2. 至少 3 个模型（高质量/低成本/备用）。
3. 一条 alias 规则、一条 combo 规则。
4. 一组 pricing override。

---

## 3. 用例分层

## 3.1 Smoke（发布阻塞）

### S-01 控制面最小闭环
1. 新建 provider connection。
2. 新建 model catalog entry。
3. 新建 alias。
4. 新建 combo。
5. 保存并发布成功。

通过条件：页面状态正确，后端返回 2xx，审计可见。

### S-02 Unified proxy direct
1. 调用 unified proxy，model=`provider/model`。
2. 收到正常响应。

通过条件：返回成功，usage_fact 记录 provider/model/tokens/cost。

### S-03 Unified proxy alias
1. 调用 unified proxy，model=`alias`。
2. 路由到 alias 指向模型。

通过条件：响应成功且 resolved_model 与 alias 目标一致。

### S-04 Unified proxy combo fallback
1. 主模型模拟 retryable 错误（429/timeout）。
2. 备模型成功响应。

通过条件：fallback_hops>0；fallback 时间线可见；最终成功。

### S-05 Cost 看板筛选
1. 打开 Usage & Cost 页面。
2. 按 provider/model 筛选。
3. 验证图表与明细联动。

通过条件：筛选结果正确，数据与 usage 接口一致。

## 3.2 Regression（核心回归）

### R-01 非 retryable 错误不 fallback
1. 主模型返回认证错误（401/403）。
2. 验证不切到备模型。

通过条件：请求失败并给出正确错误分类。

### R-02 治理前置在 fallback 场景有效
1. 设置超配额策略。
2. 触发 combo 请求。

通过条件：被治理层拦截，不进入上游 fallback。

### R-03 Pricing override 生效
1. 修改特定 model 价格。
2. 发起请求并比对 cost。

通过条件：cost 与新价格一致；pricing_version 正确。

### R-04 配置防错
1. 提交循环 combo。
2. 提交重复 alias 名称。

通过条件：前端拦截 + 后端拒绝。

### R-05 高风险操作确认
1. 删除正在被 combo 引用的模型。
2. 触发确认流程。

通过条件：必须二次确认，审计记录完整。

## 3.3 UX（体验验收）

### U-01 路由预演
1. 输入 `combo:prod-chat`。
2. 查看预演命中路径与预估成本。

通过条件：路径与实际执行一致。

### U-02 Fallback 诊断可读性
1. 构造一跳失败一跳成功。
2. 查看时间线。

通过条件：可在 30 秒内定位失败跳点与原因。

### U-03 异常解释卡片
1. 构造短时成本峰值。
2. 验证页面解释与钻取入口。

通过条件：3 次点击内定位主贡献模型。

---

## 4. 数据正确性专项（阻塞项）

### B-01 成本金样例对账
1. 固定 token 输入（含 cached/reasoning/cache_creation）。
2. 预期 cost 与系统计算对比。

通过条件：误差为 0（按定点规则）。

### B-02 历史事实不可回写
1. 记录请求 A 成本。
2. 修改 pricing。
3. 检查请求 A 历史成本。

通过条件：历史不变，新请求按新价。

### B-03 原始 usage 快照可追溯
1. 随机抽样请求。
2. 对比 raw usage 与归一化字段。

通过条件：字段可还原、无丢失。

---

## 5. 视觉回归（UI 改动必测）

1. Connections 页面。
2. Models 页面。
3. Routing 页面。
4. Usage & Cost 页面。
5. Fallback 时间线详情弹层。

通过条件：无非预期快照差异；移动端与桌面端均通过。

---

## 6. 失败分级与归因

1. `governance_reject`
2. `provider_retryable`
3. `provider_non_retryable`
4. `system_error`

要求：所有 e2e 失败输出必须带归因类别。

---

## 7. 发布门禁（必须全部通过）

1. Smoke 全通过。
2. Regression 全通过。
3. 数据正确性专项全通过。
4. 视觉回归通过。
5. 无 P0/P1 未关闭缺陷。

