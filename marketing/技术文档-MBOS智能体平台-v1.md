# MBOS 智能体平台 - 技术文档 v1

> 基于权威设计文档与前端实现整理  
> 日期：2026-02-03

---

## 1. 系统概述

MBOS（Microservices-based Agent Platform）是一套面向智能体（Agent）管理、发布与使用的企业级平台，采用 **Project 治理中心** 架构，将资源管理、访问控制、配额/限流、用量结算、Agent 接入统一收敛到 Project 维度。

### 1.1 核心定位

- **SaaS 多租户** + **企业私有化部署**（Docker/K8s）
- **Workspace = 租户**，Project = 治理单元
- 支持 External Agent（外网 WS 接入）与 Internal Agent（平台托管 Pod）
- 统一安全边界：多租户隔离、最小权限、审计与用量

### 1.2 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| 前端 | Next.js 15 + React 19 | App Router, Turbopack |
| 状态 | Zustand + Persist | 本地持久化登录态 |
| 国际化 | next-intl | 中英双语 |
| API | MSW (Mock) / Fetch | 开发期 Mock，生产对接 Edge |
| 存储 | PostgreSQL + MongoDB | PG 关键数据，Mongo 动态配置 |

---

## 2. 架构设计亮点

### 2.1 两层权限点架构

系统采用 **平台层 + 资源层** 双层权限点，职责清晰分离：

**平台层（Edge 入口拦截）**
- 粗粒度控制，避免大量无权限请求打到 Backend
- 存储：Redis Set
- 命名：`{domain}:{object}:{verb}`（如 `project:settings:manage`）

**资源层（Backend 最终裁决）**
- 细粒度控制，支持 **deny wins**
- 存储：`project_resource_acl` 表（PostgreSQL）
- 命名：`{resource_type}:{action}`（如 `endpoint:use`）

**授权流程**：
```
用户请求 → Edge: AuthN + Membership → Edge: 平台层权限点 → Backend: 资源层 ACL → 执行 + 审计
```

### 2.2 角色模板体系

| 角色 | 特性 | 平台层权限数 |
|------|------|-------------|
| **Owner** | 不可转移，拥有所有权限 | 46 |
| **Admin** | 除 project:settings:manage 外全部 | 45 |
| **Developer** | 可开发、签发 agent key、写 UserData | 28 |
| **User** | 只读 + 基础使用，受限配额 | 15 |

### 2.3 资源控制（Limit / Limits / Governance）

**Governance（治理规则）**
- 每成员配额（limits）
- 限流（rate_limits）
- 护栏（guardrails）
- 能力开关

**Limits（资源限制）**
- Project 级资源上限
- 可 JSON 配置，支持动态调整

**Limit 覆盖**
- 项目策略提供默认配额
- 成员级 **Limit Override** 可为单用户定制
- 支持完整审计追溯

### 2.4 多维限流

**基础层**（所有请求）：`workspace_id + actor_type + actor_id`  
**高风险层**（UserData / Chat / Agent WS）：`workspace_id + project_id + actor_type + actor_id`

默认阈值（可配置）：
- User：120 rpm / 10k rpd（基础层）
- Agent：按 project policy 控制

### 2.5 AgentThread 可信上下文

- `agent_thread_id` 是端到端可信锚点
- 绑定：`(workspace_id, project_id, end_user_id, current_agent_id)`
- **Agent 不能自报 end_user**：必须由 agent_thread 推导
- UserData 代理请求必须携带 `X-Agent-Thread-ID`

### 2.6 UserData 能力（仅 Agent 可访问）

| 类型 | 说明 | Scope |
|------|------|-------|
| DocDB | Mongo 文档存储 | global / thread |
| VectorDB | Milvus 向量检索 | global / thread |
| Storage | MinIO/S3 对象存储 | global / thread |

**强约束**：同 Project 内不同 end_user 永不共享可写 UserData。

---

## 3. 前端功能模块

### 3.1 页面清单

| 路径 | 功能 | 截图 |
|------|------|------|
| `/zh-CN/login` | 登录入口 | 01-login-page.png |
| `/workspaces/{ws}/projects` | 项目列表 | 03-projects-list.png |
| `.../overview` | 项目概览、KPI、快捷入口 | 05-overview.png |
| `.../chat` | 对话工作区（OpenAI SDK） | 06-chat.png |
| `.../studio` | AI Studio 任务工作区 | 07-studio.png |
| `.../agents` | Agent 管理、Keys 签发 | 08-agents.png |
| `.../endpoints` | 共享 Endpoint 管理 | 09-endpoints.png |
| `.../members` | 成员、权限、配额 | 10-members-list.png |
| `.../audit` | 审计日志 | 11-audit.png |
| `.../usage` | 用量统计 | 12-usage.png |
| `.../settings` | 常规、治理、限额 | 13-settings-general.png |
| `.../sources` | 文件管理、AIReady | 14-sources.png |
| `.../credentials` | 项目凭据、API Key | 15-credentials.png |
| `/user/profile` | 用户资料 | 16-user-profile.png |
| `/user/api-keys` | 用户 API Key（usk-） | 17-user-api-keys.png |

### 3.2 成员管理子功能

- **权限配置**：模板（owner/admin/developer/user）或自定义权限点
- **配额覆盖**：按用户覆盖默认配额
- **资源 ACL**：KB/Endpoint 资源级权限

### 3.3 设置子功能

- **常规**：项目名称、可见性、加入策略
- **运行偏好**：Runtime Preferences（JSON）
- **治理规则**：Governance JSON（配额、限流、护栏）
- **资源限制**：Limits JSON

### 3.4 凭据与 Token

- **项目凭据**：Endpoint 密钥、插件密钥等
- **用户 API Key**：`usk-` 前缀，用于 SDK/脚本
- **Agent Service Key**：`ask-` 前缀，归属 Agent 下签发

---

## 4. 权限点速查（平台层）

### Workspace
- `workspace:read`、`workspace:project:create`

### Project
- `project:endpoint:use`、`project:settings:manage`、`project:settings:manage`、`project:settings:manage`

### Membership
- `project:join:request`、`project:join:approve`、`project:settings:manage`、`project:settings:manage`

### Policy & Governance
- `project:policy:read`、`project:policy:update`、`project:audit:read`、`project:usage:read`

### Sources
- `project:endpoint:use`、`project:endpoint:manage`、`project:endpoint:manage`、`project:endpoint:use`

### Agent
- `agent:read`、`agent:manage`、`agent:key:issue`、`agent:key:revoke`

### AgentThread
- `agent_thread:create`、`agent_thread:read`、`agent_thread:handoff`、`agent_thread:cancel`

### UserData（12 个细粒度）
- `userdata:docdb:read|write|delete|clear`
- `userdata:vectordb:search|upsert|delete`
- `userdata:storage:read|write|delete|clear`

---

## 5. 截图索引（分类组织）

E2E 脚本生成到 `test-results/screenshots/`（临时）。用于 marketing 时手动拷贝到 `marketing/screenshots/`。

| 分类 | 路径 | 说明 |
|------|------|------|
| 01-auth | login.png, workspace-select.png | 登录入口 |
| 02-projects | projects-list.png | 项目列表 |
| 03-overview | overview.png | 项目概览、KPI |
| 04-chat | chat.png | 对话工作区 |
| 05-studio | studio.png | AI Studio |
| 06-agents | agents.png | 智能体管理 |
| 07-endpoints | endpoints.png | 端点管理 |
| 08-members | members-list.png, member-detail-overview.png, member-permissions-template.png, member-permissions-advanced.png, member-limits.png, member-resource-acl.png | 成员、权限配置详情、配额覆盖、资源 ACL |
| 09-audit | audit.png | 审计日志 |
| 10-usage | usage.png | 用量统计 |
| 11-settings | settings-general.png, settings-runtime-with-tokens.png, settings-governance-with-tokens.png, settings-limits-with-tokens.png | 常规、运行偏好、治理规则、资源限制（含全部 token） |
| 12-sources | sources.png | 文件管理 |
| 13-credentials | credentials-list.png, create-credential-dialog.png | 凭据、创建对话框 |
| 14-user | profile.png, api-keys.png | 用户资料、API Key |

---

## 6. 参考文档

- `文档/权威设计/00-总览/系统架构总览-v1.md`
- `文档/权威设计/01-认证授权/权限点标准规范-v1.md`
- `文档/权威设计/02-Edge服务/限流与计量-v1.md`
- `文档/权威设计/04-Agent与会话/AgentThread状态机-v1.md`
- `文档/权威设计/09-产品文档/智能体平台PRD-v1.md`
