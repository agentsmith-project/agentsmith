# System / Workspace Provisioning MVP Analysis v1

> 历史分析稿，仅供背景参考，不作为当前实现真相。

## 1. 目的

本文件用于确认 `system / workspace / project` 主线下，workspace 创建、配置、初始化、隔离与系统信息展示的正式分析结论与后续开发计划。

本文件回答三类问题：

1. 当前需求是否合理、是否符合最佳实践
2. 当前项目真实实现到了哪里，缺口在哪里
3. 后续应如何分阶段开发，避免范围再次扩张

## 2. 结论摘要

结论：

1. 当前需求合理
2. 当前方向符合企业控制面与多租户系统的最佳实践
3. 当前项目已经具备 `system workspace control plane` 骨架
4. 当前项目尚未完成真正的 `workspace provisioning` 闭环
5. 下一阶段重点不应是继续做新页面，而应把 `workspace create` 从“登记配置”升级成“保存 draft -> 发布 -> 同步初始化 -> 状态可见”的完整控制面动作

一句话定义：

当前项目已经实现了 `system/workspace` 管理骨架，但尚未完成 `后台基础配置自动化 + 数据初始化 + 严格租户隔离闭环`。

## 3. 需求合理性与最佳实践判断

### 3.1 合理的部分

以下需求判断为合理，且符合最佳实践方向：

1. 系统超级管理员入口与 workspace 业务入口完全分离
2. workspace 是真实租户边界，而不是前端分组概念
3. 每个 workspace 绑定独立 IdP；当前只支持 Keycloak
4. Authn 由 IdP 提供，Authz 由 AgentSmith 执行
5. workspace 底层租户隔离命名自动生成，不要求手工拼接数据库名、collection、prefix
6. system admin 在创建 workspace 时可保存 draft
7. system admin 在发布 workspace 时，必须同步等待后台基础资源初始化结束
8. system info 只展示系统级基础运行信息，不展示业务或性能指标

### 3.2 为什么符合最佳实践

符合最佳实践的原因如下：

1. 多租户系统中，tenant provisioning 与 tenant entry 应分离
2. 底层隔离命名应由系统统一生成，避免人工输入造成漂移与误配置
3. 身份认证应按 tenant / workspace 隔离，不应继续依赖全局统一业务登录入口
4. provisioning 过程必须有明确状态，不能只是一条配置记录
5. system info 应是“系统依赖与初始化状态查看页”，而不是大盘化监控页

## 4. 当前项目真实状态

### 4.1 已完成的部分

当前已经完成：

1. system admin 入口
- `/system/login`
- `/system/workspaces`
- `/system/info`

2. workspace 业务入口
- `/login`
- `/login/workspace`
- `/workspaces/{workspace}/login`
- `/workspaces/{workspace}`

3. system workspace 基础配置模型
- workspace basics
- workspace administrator
- IdP config
- generated tenant configuration preview

4. workspace registry 持久化
- 当前基于 registry 文件保存 workspace 配置

5. 租户隔离命名自动生成
- `database_name`
- `collection_prefix`
- `key_prefix`

6. system info 最小结构
- system admin
- api service
- workspace registry
- data service
- default workspace
- default IdP
- tenant naming rules

### 4.2 当前未完成的关键部分

当前尚未完成：

1. workspace provisioning 状态机
- 没有 `draft / ready / failed / disabled`

2. 发布动作驱动的后台初始化闭环
- 当前创建 workspace 更像“登记配置”
- 不是“发布并同步完成初始化”

3. 初始化结果的系统级反馈
- 没有 `last_initialized_at`
- 没有 `last_init_status`
- 没有 `last_init_error`

4. 数据面严格隔离闭环
- 当前 tenant config 已生成
- 但尚未证明所有数据访问都系统性消费并执行该 tenant config

5. IdP 配置验证闭环
- 当前可以保存 Keycloak 配置
- 但没有最小的连接/配置可用性验证状态

6. workspace 生命周期语义
- 当前更像 `exists / deleted`
- 尚未明确定义 `draft / ready / disabled`

## 5. 正式产品与实现边界

### 5.1 System Workspaces

`System Workspaces` 是系统超级管理员的控制面。

它负责：

1. 创建 workspace draft
2. 编辑 workspace draft
3. 发布 workspace
4. 禁用 workspace
5. 删除未启用或明确允许删除的 workspace
6. 指定 workspace administrator
7. 配置 workspace IdP
8. 查看生成出的 tenant configuration

它不负责：

1. 业务指标展示
2. 业务 KPI
3. 性能与运营看板
4. project 级治理操作

### 5.2 System Info

`System Info` 只展示系统级基础运行状态。

允许展示：

1. API service 地址
2. workspace registry 路径
3. 数据服务类型与地址
4. 默认 workspace / 默认 IdP 配置
5. tenant naming rules
6. workspace provisioning 基础状态汇总
- 是否初始化完成
- 最近初始化结果
- 最近初始化错误摘要

不允许展示：

1. 使用量趋势
2. 成本指标
3. 审计业务指标
4. 资源性能指标
5. 业务页级 KPI

### 5.3 Workspace Provisioning

`Workspace Provisioning` 是 system admin 面下的控制面动作，不是业务面动作。

正式目标语义：

1. `Save Draft`
- 保存 workspace 基础配置
- 不要求底层资源已经完成初始化

2. `Publish Workspace`
- 同步执行后台初始化
- 必须等待初始化流程完成
- 只有初始化成功，workspace 才进入 `ready`

3. `Disable Workspace`
- 停止对该 workspace 提供业务入口
- 不等于立即销毁底层数据

## 6. 推荐的正式状态模型

推荐引入 `WorkspaceProvisioningStatus`：

1. `draft`
- 已保存配置
- 未发布
- 不提供业务登录入口

2. `provisioning`
- 正在同步初始化后台资源
- system admin 必须看到明确状态

3. `ready`
- 初始化完成
- 可对外提供 workspace 登录与业务入口

4. `failed`
- 初始化失败
- 需要 system admin 查看错误并重试

5. `disabled`
- workspace 已禁用
- 配置保留
- 业务入口关闭

## 7. 推荐的配置对象模型

### 7.1 WorkspaceDraft

字段建议：

1. `name`
2. `workspace_admin`
3. `project_creators`
4. `idp`
5. `tenant_preview`
6. `status`
7. `created_at`
8. `updated_at`

### 7.2 WorkspaceProvisioningRecord

字段建议：

1. `workspace_id`
2. `status`
3. `last_initialized_at`
4. `last_init_status`
5. `last_init_error`
6. `data_config_applied`
7. `idp_config_applied`
8. `tenant_materialized`

### 7.3 SystemInfoSnapshot

继续保持克制，只补系统级基础状态：

1. system admin username
2. api service
3. workspace registry
4. data service
5. default workspace
6. default IdP
7. tenant naming rules
8. provisioning summary
- total workspaces
- draft count
- ready count
- failed count
- disabled count

## 8. 推荐的交互行为

### 8.1 Create Workspace

1. system admin 输入：
- workspace basics
- workspace administrator
- IdP config

2. 页面自动生成：
- tenant preview

3. 保存为 draft

### 8.2 Publish Workspace

1. 用户点击 `Publish Workspace`
2. 页面进入 `provisioning`
3. 同步等待：
- tenant config materialization
- backend resource initialization
- workspace registry finalization
- IdP config application checks

4. 完成后：
- 成功 -> `ready`
- 失败 -> `failed`

### 8.3 Workspace List Cards

每张卡应继续保持克制，只展示：

1. workspace name / id
2. workspace administrator
3. identity provider
4. tenant configuration
5. provisioning status
6. last initialized result

## 9. 技术开发计划

### 阶段 1：Provisioning 状态模型落地

目标：
- 让 workspace 不再只是 registry 记录

任务：

1. 引入 `WorkspaceProvisioningStatus`
2. 扩展 system workspace registry 模型
3. 扩展 system workspace API：
- create draft
- update draft
- publish
- disable
- delete
4. 在 system workspaces 页面显示 status / last init summary

### 阶段 2：后台初始化闭环

目标：
- `Publish Workspace` 真正执行后台初始化

任务：

1. 定义 `workspace provisioning service`
2. 同步执行：
- tenant naming materialization
- data service initialization
- initial registry/data records creation
- IdP configuration validation
3. 记录初始化结果
4. 失败时返回可展示的 error summary

### 阶段 3：严格租户隔离接入数据面

目标：
- tenant config 不只存在于控制面，而是真正进入数据访问面

任务：

1. 梳理当前 workspace-scoped store / route / handler
2. 确认数据访问统一消费 tenant config
3. 禁止 workspace 之间共享 collection/prefix 访问路径
4. 增加最小集成验证，证明 tenant 隔离生效

### 阶段 4：System Info 克制增强

目标：
- 展示“系统级基础运行状态”，不走向大盘化

任务：

1. 增加 provisioning summary
2. 增加 workspace init status snapshot
3. 增加 data/IdP connectivity 基础状态
4. 明确禁止加入业务 KPI 和性能图表

### 阶段 5：IdP 配置验证闭环

目标：
- system admin 能知道 workspace 登录配置是否可用

任务：

1. 提供最小 Keycloak config validation
2. 展示 `configured / invalid / unreachable`
3. 失败时提供最小错误摘要

## 10. 当前建议的开发顺序

建议按以下顺序推进：

1. `WorkspaceProvisioningStatus` 和 registry 扩展
2. `Publish Workspace` 动作与同步初始化闭环
3. `system workspaces` 卡片状态反馈
4. `system info` provisioning summary
5. tenant config 接入数据面隔离验证
6. IdP config validation

## 11. 当前不进入的范围

本阶段不做：

1. 系统级业务大盘
2. 运营 KPI
3. 性能指标图表
4. 多 IdP 编排 UI
5. 复杂租户迁移/重命名
6. 自动化数据迁移面板

## 12. 最终判断

当前需求：

1. 合理
2. 符合最佳实践
3. 与当前项目已形成的 `system / workspace / project` 主线兼容

但当前实现仍处于：

`system workspace configuration skeleton`

而不是：

`full workspace provisioning control plane`

下一阶段必须把：

`保存配置`

升级成：

`保存 draft -> 发布 -> 同步初始化 -> 状态可见 -> 租户隔离可验证`

这才算真正完成 system admin 这一层 MVP。
