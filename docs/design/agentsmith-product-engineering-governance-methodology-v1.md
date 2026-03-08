# AgentSmith 产品研发与治理方法论 v1

更新时间：2026-03-08  
状态：`current-baseline`

## 1. 方法论目标

这份文档定义的是“如何持续交付一个可运营、可治理、可追责的企业控制面”，不是阶段性项目总结。

核心目标：

1. 先定义产品对象与运行时真相
2. 再用合同和证据把系统收紧
3. 最后用控制面把治理闭环落到日常运行

## 2. 当前唯一主线

AgentSmith 当前只采用一条治理主线：

1. 项目级治理（project scope）
2. LLM endpoint 统一约束链路
3. Chat / Notebook / API 共用同一套约束与审计证据

约束对象：

1. rate limit
2. spending limit
3. policy audit evidence
4. usage evidence

## 3. 六层方法框架

1. Product Model
- 对象先行：endpoint、policy、usage fact、audit fact
- 页面是对象的投影，不是系统真相

2. Runtime Truth
- 只认运行时事实，不认配置想象
- 关注“请求最终如何被允许/拒绝、为何触发限流/限额、证据是否完整”

3. Contract First
- 先收紧 OpenAPI/AsyncAPI 与错误语义
- 前后端都从合同生成与消费，不做口头约定

4. Evidence Driven Delivery
- 所有关键链路必须可产出证据
- 验收基于证据，而非人工“看起来可用”

5. Governance by Control Plane
- 治理是产品能力，不是文档注释
- 策略生效、拒绝原因、用量事实都应在控制面可追踪

6. Operational Closure
- 每次问题必须进入 owner/SLA/处置闭环
- 治理异常应能定位、归因、复盘

## 4. 工程执行规则

1. 合同优先
- 任何 API 变更先改合同，再改实现，再改 UI

2. 分层收敛复杂度
- handler: 仅协议适配
- service: 业务编排
- domain: 规则与不变量
- store: 持久化边界

3. 拒绝补丁式修复
- 不为单测通过绕开结构问题
- 不保留过时 payload/路径

4. 证据是一等产物
- 审计证据、用量证据、策略命中证据必须可复核

## 5. 测试与验收

分层验证顺序：

1. type/contract
2. unit
3. integration
4. e2e
5. real-lane smoke

验收标准：

1. 关键合同检查通过
2. 关键治理链路有证据
3. 受保护路由门禁与参数校验通过

## 6. 文档治理规则

1. 只保留当前态规范，不保留过程性主线文档
2. 白名单见 `docs/CURRENT_BASELINE.md`
3. 文档冲突优先级：宪法 > 合同 > UXUI > 用户指南

## 7. 必读入口

1. `docs/CURRENT_BASELINE.md`
2. `docs/项目宪法.md`
3. `docs/contracts/README.md`
4. `docs/user-guides/README.md`
5. `docs/troubleshooting-guide-v1.md`
