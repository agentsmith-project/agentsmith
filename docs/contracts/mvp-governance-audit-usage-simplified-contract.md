# MVP 治理/审计/用量简化 Contract（KISS）

Last updated: 2026-03-04
Status: Proposed (for immediate implementation)

## 1. 目标与边界

本 Contract 仅覆盖以下 MVP 能力：

1. Endpoint 资源策略：`rate limit` + `spending limit`（滚动 `1m/5h/1d`）
2. 审计（仅 `project:manage` 可见）
3. 用量（所有成员仅可见“自己”）
4. 48 小时查询与聚合窗口
5. 精简系统级/资源级告警

不在本次范围：

1. 多资源类型复杂计费（先只做 endpoint）
2. 超过 48h 的历史 OLAP/报表
3. 多层告警编排（升级链路/自动抑制策略中心）
4. 角色模板驱动的审计查询差异化

---

## 2. 权限模型（强约束）

1. `project:manage`
   - 可读：全量审计、用户维度统计、资源维度统计、告警全量
   - 可写：资源策略（endpoint rate/spending）
2. `project:endpoint:use`
   - 可读：仅“我的用量”
   - 不可读：他人用量、全量审计、资源策略编辑

后端必须强制，不依赖前端隐藏。

---

## 3. 资源策略 Contract（Endpoint）

## 3.1 Rule Key

`rate`:

- `endpoint.requests_per_minute`
- `endpoint.requests_per_5_hours`
- `endpoint.requests_per_day`

`spending` (USD):

- `endpoint.spending_usd_per_minute`
- `endpoint.spending_usd_per_5_hours`
- `endpoint.spending_usd_per_day`

兼容保留（可选）：

- `endpoint.daily_token_limit`（若已在线上数据使用）

## 3.2 Rule 结构

```json
{
  "key": "endpoint.spending_usd_per_5_hours",
  "value": 12.5,
  "window": null
}
```

说明：

1. `rate` 支持正整数。
2. `spending` 支持正浮点（最多 3 位小数）。
3. 时间窗语义固定为 rolling window，不使用自然日/整点窗口。

## 3.3 Policy 对象

```json
{
  "resource_type": "endpoint",
  "resource_id": "ep_xxx",
  "access_mode": "allow_all_members|allow_list",
  "allowed_subjects": [
    {
      "subject_type": "user|group",
      "subject_id": "u_1",
      "rate_limits": { "rules": [] },
      "quota_limits": { "rules": [] }
    }
  ],
  "rate_limits": { "rules": [] },
  "quota_limits": { "rules": [] }
}
```

优先级：`user > group > policy-root`。

---

## 4. 审计 Contract（project manager）

## 4.1 审计事件最小模型

```json
{
  "id": "aud_xxx",
  "timestamp": "2026-03-04T07:00:00.000Z",
  "workspace_id": "ws_default",
  "project_id": "proj_x",
  "actor_type": "user|agent|plugin",
  "actor_id": "u_x",
  "action": "project.updated|agent.updated|project.permission.updated|resource_policy.updated|resource_policy.rate_limited|resource_policy.spending_limited|resource_policy.access_denied",
  "resource_type": "project|agent|endpoint|resource_policy",
  "resource_id": "xxx",
  "result": "ok|error",
  "error_code": "RESOURCE_POLICY_DENIED|RESOURCE_POLICY_RATE_LIMITED|RESOURCE_POLICY_SPENDING_LIMITED",
  "metadata_json": {}
}
```

## 4.2 查询接口

`GET /audit`

必须要求：

1. `start_time` / `end_time`
2. 最大跨度 `<= 48h`
3. 返回分页与 total

过滤支持：

1. project 操作
2. agent 操作
3. project 级权限变更
4. resource 级权限变更

---

## 5. 用量 Contract（用户只读子集）

## 5.1 原则

1. 用量是审计/usage facts 的子集视图，不重复计算链路。
2. 非 `project:manage` 调用时，后端强制 `end_user_id = current_user_id`。
3. 时间窗同样限制 `<= 48h`。

## 5.2 记录维度

`用户维度`（我的访问）：

1. requests
2. errors
3. rate_limited count
4. spending_limited count
5. permission_denied count
6. spending_usd（若可计算）

`资源维度`（manager 可见）：

1. 单 endpoint 的上述同类指标
2. 分钟级最小粒度

## 5.3 错误分类（固定 3 类）

1. `permission_denied`
2. `rate_limited`
3. `spending_limited`

## 5.4 统一 LLM Gateway（单 Base URL）

统一客户端出口（同一个 Base URL，支持多协议入口）：

- `POST /api/v1/workspaces/{workspace}/projects/{project}/llm-gateway/chat/completions`
- `POST /api/v1/workspaces/{workspace}/projects/{project}/llm-gateway/responses`
- `POST /api/v1/workspaces/{workspace}/projects/{project}/llm-gateway/messages`
- `POST /api/v1/workspaces/{workspace}/projects/{project}/llm-gateway/messages/count_tokens`

路由与治理要求：

1. 默认按请求体 `model` 路由到项目 endpoint。
2. 允许通过 `x-agentsmith-endpoint-id` 显式指定 endpoint（用于调试/灰度）。
3. 路由完成后必须执行 endpoint 级治理链路：
   - allow-list 权限
   - rate limit（1m/5h/1d）
   - spending limit（1m/5h/1d）
   - usage facts + audit events

失败码（最小集合）：

- `422 gateway_model_or_endpoint_required`
- `422 gateway_model_not_routable`
- `409 gateway_model_ambiguous`
- `422 gateway_proxy_path_not_supported`

---

## 6. 告警 Contract（精简）

仅保留两类：

1. 系统级：例如上游连续失败率过高
2. 资源级：某 endpoint 连续触发 rate/spending limit

字段最小集：

```json
{
  "id": "alt_x",
  "scope": "system|resource",
  "resource_type": "endpoint",
  "resource_id": "ep_x",
  "kind": "rate_limit_hotspot|spending_limit_hotspot|upstream_error_spike",
  "severity": "low|medium|high",
  "status": "open|resolved",
  "message": "..."
}
```

---

## 7. API 最小集合（建议）

1. `GET/PATCH /resources/endpoint/{id}/policy`
2. `GET /audit`
3. `GET /usage`
4. `GET /usage/kpi`
5. `GET /usage/facts`
6. `GET /alerts`

说明：

1. `usage` 默认支持 `group_by=minute`
2. 导出与报表调度不纳入本轮 MVP（可后置）

---

## 8. 清理建议（必须）

应清理的冗余：

1. 审计与用量重复的多套聚合逻辑
2. 非 endpoint 资源的复杂用量图表
3. 超过 48h 的筛选与展示控件
4. 面向普通用户的全局/他人用量入口
5. 不直接服务本轮 MVP 的高级运维报表/调度入口

---

## 9. 验收标准

1. resource policy 可配置并生效：
   - rate: 1m/5h/1d
   - spending: 1m/5h/1d
2. 审计页只有 `project:manage` 可见
3. 普通用户 usage 页只看到自己
4. 48h 以外查询返回明确错误（非静默空数据）
5. UI 中错误分类仅 3 类，字段含义可读且一致
