# LLM Runtime Product Decision Memo v1

更新时间：2026-02-28  
适用对象：产品、设计、架构、研发、测试

---

## 1. 这条产品线真正要解决什么

本期不是“再接几个 provider”，而是要解决 3 个产品层面的根问题：

1. 路由不可控
- 当前更像“配一个 endpoint 然后调用它”。
- 缺少“业务模型名 -> 路由策略 -> 实际 provider/model 命中”的稳定抽象。

2. 失败不可解释
- 上游 429、timeout、provider 抖动是常态，不是例外。
- 如果系统不能解释“已经自动切换”“为何切换”“最终命中谁”，用户会把正常弹性行为误解为系统故障。

3. 成本不可追责
- 只有 `requests/tokens` 不够。
- 必须能回答：钱花在哪个 provider/model、由谁花掉、按哪个价格版本算出来。

结论：
- 这条产品线的目标是 `可配置路由 + 可解释失败 + 可追责成本`。

---

## 2. 产品定位

建议正式命名为：

`AgentSmith Runtime Control Plane`

而不是：
- “Provider 管理”
- “Billing 系统”
- “Proxy 配置页”

原因：
1. 这不是单一配置页，而是运行时控制中心。
2. 后续可自然扩展到 health、budget、rollout、quality score，而不需要重命名。

---

## 3. 核心产品对象（冻结）

本期只保留 5 个一等对象，不再引入近义复杂对象。

1. `Connection`
- 定义：一个真实可调用的上游入口 + 凭证 + 优先级 + 健康状态。
- 回答的问题：请求最终通过哪个连接发出。

2. `Model`
- 定义：一个 provider 下的标准化模型定义，带能力、上下文、价格。
- 回答的问题：这个模型是什么、能做什么、理论价格是什么。

3. `Alias`
- 定义：一个稳定业务名，映射到单一 `provider/model`。
- 回答的问题：业务侧如何不感知底层 provider 变化。

4. `Combo`
- 定义：一个有顺序的候选模型链路 + fallback 规则。
- 回答的问题：主模型失败后系统如何切换。

5. `Pricing Rule`
- 定义：一个可版本化价格规则源。
- 回答的问题：这次成本是依据什么价格规则计算。

---

## 4. 信息架构决策

### 4.1 一级导航
1. `Runtime`
2. `Usage & Cost`
3. `Governance`

### 4.2 Runtime 下二级结构
1. `Connections`
2. `Models`
3. `Routing`
4. `Pricing`
5. `Observability`

决策理由：
1. `Connections/Models/Routing/Pricing` 是一个完整心智模型。
2. `Usage & Cost` 是高频运营入口，不应长期埋在 `Settings`。
3. `Governance` 保持独立，避免与路由配置混淆。

---

## 5. 用户角色与默认视角

### 5.1 用户角色
1. 平台管理员
- 接 provider、维护模型目录、设默认价格、看全局成本与失败趋势。

2. 项目管理员
- 配置 alias/combo、维护主备策略、设项目级价格覆盖、分析本项目成本。

3. 运营/值班
- 看异常峰值、看 fallback 是否生效、快速定位“为什么慢/为什么贵/为什么失败”。

### 5.2 默认产品视角
默认采用“运营视角”，而不是“配置视角”。

原因：
1. 产品真正价值不在“能配”，而在“能稳定运行并能解释”。
2. 如果首页只展示配置对象，产品会退化成后台表单工具。

---

## 6. 关键体验决策（必须做）

### 6.1 Routing Dry-run
输入：
1. `model string`
2. capability
3. project context

输出：
1. 命中 direct / alias / combo
2. 候选链路顺序
3. 预计使用的 connection
4. 预计价格区间
5. 当前治理状态提示

目标：
- 用户在保存前就知道系统将如何路由。

### 6.2 Impact Preview
当用户修改 alias/combo/pricing/priority 时，展示：
1. 近 7 天受影响请求比例
2. 预计路由变化
3. 预计成本增减

目标：
- 把配置页面升级为决策页面。

### 6.3 Fallback Timeline
独立组件展示：
1. primary model
2. 失败原因
3. hop 切换过程
4. 最终命中
5. 各 hop 耗时与总耗时

目标：
- 用户能快速理解自动修复发生了什么。

### 6.4 Cost Drill-down
钻取路径至少支持：
1. 总成本
2. provider
3. model
4. project
5. end_user
6. request detail

目标：
- 运营与值班能回答“是谁、在哪、为什么贵”。

---

## 7. 错误体验与文案决策

用户可见状态统一为 4 类：

1. `Normal`
- 正常完成。

2. `Recovered`
- 出现了上游/工具问题，但系统已自动恢复。
- UI 文案使用：
  - “已自动重试”
  - “已切换备用模型”
  - “结果已恢复”

3. `Action Needed`
- 不可恢复但原因明确。
- 例如：无权限、配额耗尽、无可用路由、价格规则缺失导致治理无法通过。

4. `System Fault`
- 仅平台内部真实故障使用。

设计原则：
1. 不要把可恢复行为渲染成红色“错误崩溃”。
2. 429/timeout/fallback 是运行时正常态的一部分。

---

## 8. 计费统计产品决策

### 8.1 成本是事实，不是前端估算
每次请求写 usage fact 时就落：
1. `provider`
2. `model`
3. `raw_usage_json`
4. normalized usage
5. `cost`
6. `pricing_version`
7. `calculation_version`

### 8.2 原始 usage 与归一化 usage 双轨存储
理由：
1. provider usage 字段不统一。
2. 后续扩 provider 或修正算法时，仍可重放和审计。

### 8.3 缺价不允许静默
缺失价格时必须：
1. 写 `missing_price`
2. 在 dashboard 顶部显示质量警告
3. 在 request detail 中明确标注

默认策略：
- 缺价不阻断请求，但纳入质量告警。

### 8.4 价格作用域优先级
默认优先级：
`project override > workspace default > global default`

### 8.5 金额精度
默认使用：
- 持久化 `micro_usd` 或 decimal
- 展示再格式化为美元

---

## 9. 路由与 fallback 产品决策

### 9.1 统一入口
决策：
- 统一 proxy 作为正式产品入口。
- 旧 endpoint proxy 不再作为正式长期入口。

### 9.2 Combo 默认可跳转错误
允许 fallback 的默认错误：
1. `429`
2. `timeout`
3. `network reset`
4. 明确 provider retryable `5xx`
5. 可配置 `system_error`

不允许 fallback 的错误：
1. 权限错误
2. policy reject
3. quota reject
4. 参数错误
5. provider 明确 non-retryable 错误

---

## 10. 发布成功标准（产品层）

1. 用户能在 15 分钟内完成首条可用路由上线。
2. 任意一条失败请求，3 次点击内能看到失败归因。
3. 任意一条高成本请求，3 次点击内能看到 provider/model/end_user 归因。
4. fallback 可追踪率达到 100%。
5. 缺价请求可见率达到 100%。

---

## 11. 本期不做

1. AI 自动学习路由
2. 多租户兼容迁移工具
3. 商业账单/发票系统
4. 黑盒“智能选模型”

理由：
1. 难解释
2. 难审计
3. 难验收
4. 会稀释本期要打牢的运行时基础

---

## 12. 结论

本期应把 AgentSmith 从：

`LLM endpoint 管理台`

升级为：

`面向内部生产运营的 Runtime 控制与成本治理平台`

后续所有工程计划、页面设计、契约与测试，都应围绕这一定义展开。
