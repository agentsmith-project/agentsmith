# MVP 审计/用量/资源策略 UX 简化方案（KISS）

Last updated: 2026-03-04
Status: Proposed

## 1. 信息架构（精简后）

## Govern

1. `Resource Policy`
2. `Audit`（仅 manager）
3. `Alerts`

## Use

1. `Usage`（我的用量，只读）
2. `CLI 接入手册`（新增）

## Operate

1. `AI Ops Home`（改为聚合入口，不做复杂控制台）

---

## 2. 资源策略页（Endpoint）

目标：最少步骤配置 rate/spending。

布局：

1. 左侧资源列表（仅 endpoint）
2. 右侧策略编辑

右侧编辑分区：

1. 访问控制：`allow_all_members / allow_list`
2. Rate Limit（3 个输入）
   - 每分钟请求数
   - 每5小时请求数
   - 每天请求数
3. Spending Limit（3 个输入）
   - 每分钟 USD
   - 每5小时 USD
   - 每天 USD
4. 主体覆盖（可选）：
   - 用户/组覆盖同样 6 项，默认折叠

交互规则：

1. 空值=不限制
2. 输入即校验
3. `Save` 单按钮提交
4. 保存后展示“生效摘要”（最终生效值 + 来源 root/user/group）

---

## 3. 审计页（仅 project:manage）

目标：快速定位治理变更与拒绝原因。

默认仅展示 48h。

Tab（最多 2 个）：

1. 事件流（Event List）
2. 统计（Stats）

事件流过滤（最小）：

1. 时间（24h / 自定义<=48h）
2. 事件类型：
   - project operation
   - agent operation
   - project permission change
   - resource permission/policy change
3. 结果（ok/error）

统计页（分钟级）：

1. 用户维度资源访问统计
2. 资源维度访问统计
3. 错误分类分布：
   - permission_denied
   - rate_limited
   - spending_limited

---

## 4. 用量页（所有用户，只读，我的）

目标：用户只看自己，不做治理操作。

页面元素：

1. 顶部 KPI（我的请求数、错误数、估算费用）
2. 分钟级趋势（48h）
3. 我的 endpoint 资源明细表

过滤最小集：

1. 时间（24h / 自定义<=48h）
2. endpoint
3. 结果（ok/error）

移除：

1. 项目级全量视图切换
2. 其他用户 ID 过滤输入
3. 报表调度与高级运营面板

---

## 5. CLI 接入手册（Use 新增模块）

页面目标：降低用户接入成本。

内容结构：

1. 申请个人 API Key（步骤 + 按钮跳转）
2. 查看项目可用 endpoints（只读列表）
3. 快速复制配置片段：
   - Codex CLI
   - Claude Code CLI
   - Cloud Code
4. 常见错误（401/429/rate/spending）与处理建议

设计要求：

1. 一屏内看完核心步骤
2. 每个步骤有“复制命令”按钮
3. 不出现治理术语（避免普通用户负担）

---

## 6. AI Ops Home（精简）

目标：经理入口页，不是复杂控制台。

区块：

1. 当前 48h 核心健康摘要
2. 告警摘要（系统级 / 资源级）
3. 快捷入口：
   - Audit
   - Resource Policy
   - Alerts
4. “近期风险资源 Top N endpoint”

移除：

1. 深层多图联动
2. 非 MVP 运维控制项
3. 高阶报表编排入口

---

## 7. 可用性与文案原则

1. 文案统一用业务语义：
   - “每5小时请求上限”
   - “每5小时费用上限（USD）”
2. 统一解释 rolling window。
3. 错误提示可操作：
   - 超限时显示当前值/上限/建议等待时间。

---

## 8. MVP 清理清单（UX）

1. 删除审计/用量重复图表
2. 删除用量页“项目全量切换/他人视角”
3. 删除超出 48h 的时间预设
4. 删除不服务当前目标的高阶运营区块
5. 删除无 owner 的过期入口（旧 runtime console 子块）

