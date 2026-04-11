# Audit / Usage 角色化文案与动作映射 v1

Status: `active`
Depends on: [`DESIGN.md`](../../../DESIGN.md)
Scope: `interaction / product behavior`
Does not define: `global tokens / route truth / engineering gates`

> 边界与职责以《usage-audit-职责边界-v1》为准；本文聚焦文案与动作层级映射。

## 1. 目标

在不扩展产品范围的前提下，降低用户心智负担，明确两类页面的角色分工：
1. `Audit`：管理员治理与处置工作台
2. `Usage`：用户自助用量视图

## 2. 约束

1. 不新增治理对象，不引入 workspace 级治理能力。
2. 不新增 DevOps/发布管理相关产品能力。
3. 仅改文案、动作层级、默认视图策略与信息密度。
4. 保持 request/decision/trace 调查锚点链路可复制、可跳转、可复现。

## 3. 角色化信息架构

### Audit
- 标题和副标题强调治理与审计，不强调“个人用量”
- 默认显示治理高频列：`request_id`、`decision_id`、`trace_ref`
- 详情抽屉动作顺序：`Policy` -> `Members` -> `Usage`

### Usage
- 标题和副标题强调“我的用量”
- 固定使用单一用量视图
- 不展示审计/排障跳转动作；管理员分析统一走 `Audit`
- 限制区按 endpoint 分组，固定显示 `rate limit` 与 `spending limit`

## 4. 文案要求

- `usage.subtitle` 使用“我的用量”语义
- `audit.subtitle` 使用治理证据与处置追踪语义
- 所有治理对象使用当前正式产品名
