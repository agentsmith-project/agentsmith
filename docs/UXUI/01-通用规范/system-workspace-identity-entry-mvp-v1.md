# System / Workspace Identity & Entry MVP v1

## 1. 目标

定义当前 MVP 的系统级管理、workspace 入口、身份边界与登录流，防止系统级管理能力与 workspace 业务面混杂。

## 2. 核心原则

1. 系统超级管理员入口与 workspace 业务入口必须完全分离。
2. Authn 由 IdP 提供；当前每个 workspace 绑定独立 Keycloak。
3. Authz 由 AgentSmith 提供并执行。
4. workspace 是真实多租户边界，不是单纯前端分组概念。
5. workspace 底层租户配置由系统自动生成隔离命名，不要求人工输入数据库名、collection 名或 prefix。

## 3. 角色模型

### 3.1 SystemAdmin

唯一系统级高权限角色。

系统启动前通过配置注入默认账户：

1. username: `mbos-admin`
2. password: `mbos-admin`

允许：

1. 创建 workspace
2. 停用 / 删除 workspace
3. 配置 workspace 数据服务参数
4. 配置 workspace 绑定的 IdP
5. 指定 workspace 管理员
6. 查看系统依赖服务与租户命名结果

不允许：

1. 直接代替 workspace 管理员做 project 业务管理作为默认路径

### 3.2 WorkspaceAdmin

workspace 内部业务管理角色。

允许：

1. 在 workspace 下创建 project
2. 指定 project 管理员
3. 查看该 workspace 下项目列表与基本业务入口

不允许：

1. 管理 workspace 生命周期
2. 修改 workspace 底层数据隔离配置
3. 修改 workspace 绑定的 IdP
4. 管理 workspace 成员来源

### 3.3 ProjectAdmin

允许：

1. 管理 project 内资源、凭据、策略与审计相关业务
2. 在当前 MVP 中，与 `owner` 共享同一组 project-scope 治理入口与 `project:manage` 权限

不允许：

1. 管理 workspace 生命周期
2. 管理 workspace 绑定的 IdP
3. 管理 system 级配置

### 3.4 Member

允许：

1. 使用 project 内被授权的业务能力

## 4. 成员与身份边界

1. AgentSmith 不管理 workspace 成员生命周期。
2. 只要用户存在于该 workspace 绑定的 IdP 中，即视为合法认证用户。
3. AgentSmith 只管理授权结果：
   - 是否为 workspace 管理员
   - 是否为 project 管理员
   - 是否具备具体 permission token

## 5. 登录与入口流

### 5.1 系统超级管理员入口

系统级独立入口，必须与业务入口分离。

建议路径：

1. `/system/login`
2. `/system/workspaces`
3. `/system/info`

说明：

1. `/system/info` 只对系统超级管理员开放。
2. 该页用于查看依赖服务完整 URL、服务名、substrate 信息与租户隔离结果。

### 5.2 普通业务入口

必须先进入 workspace 语境，再登录。

允许两种入口：

1. 公开 workspace 选择页
   - 用户先选择 workspace，再进入该 workspace 登录页

2. 直接访问某个 workspace URL
   - 用户直接进入该 workspace 的登录页

### 5.3 统一约束

1. 除系统超级管理员外，其他所有用户都不能先走全局登录再决定 workspace。
2. workspace 登录页必须使用该 workspace 绑定的 IdP 配置。

## 6. Workspace 配置模型

### 6.1 WorkspaceDataConfig

用于描述该 workspace 对应的底层多租户隔离配置。

包含：

1. substrate 类型
2. 自动生成的数据库名 / namespace / collection 前缀
3. 其他租户隔离标识

约束：

1. 这些值应依据系统预配置规则自动生成。
2. 基础依赖服务地址、系统级 substrate 信息应在系统运行层提前配置（例如环境变量）。
3. 系统超级管理员只做选择与确认，不手工拼接底层命名。

### 6.2 IdentityProviderConfig

当前 MVP 只支持 Keycloak。

至少包含：

1. IdP 类型：`keycloak`
2. URL
3. realm
4. client id
5. secret key

## 7. 页面与 UX 约束

### 7.1 Workspace Overview

workspace overview 只应承担：

1. 工作区入口
2. 项目导航
3. 工作区上下文确认

不应承担：

1. 无真实后台支撑的指标大盘
2. 系统运营总览
3. 伪业务 KPI 展示

### 7.2 System Info

系统信息页只面向系统超级管理员。

允许展示：

1. 依赖服务完整 URL
2. 服务名
3. 当前 substrate 信息
4. workspace 隔离命名规则
5. workspace 实际生成出的隔离标识

不应演化为：

1. 运维监控大盘
2. 发布编排面板

## 8. MVP 实施约束

当前 MVP 要先完成：

1. 系统超级管理员独立入口
2. workspace 选择 / workspace 登录分离
3. workspace 创建与配置最小表单
4. workspace 数据配置自动生成
5. workspace IdP（Keycloak）配置
6. workspace 管理员与 project 管理员授权关系

当前 MVP 不进入：

1. 多 IdP 编排 UI
2. workspace 成员生命周期管理
3. 系统级运营大盘
4. 复杂租户迁移与重命名工具
