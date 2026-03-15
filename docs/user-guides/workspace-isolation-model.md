# Workspace Isolation Model

当前 MVP 的工作区隔离以“共享基础设施上的命名空间和作用域边界”为核心，不是每个工作区独立一套数据库实例、用户名或密码。

## 当前真实隔离方式

### PostgreSQL
- 共享 `DATABASE_URL`
- 共享 database 和共享连接凭据
- 主要通过 `workspace_id` / `project_id` 做作用域隔离

### Mongo
- 共享 `MONGO_DB_NAME`
- 工作区私有主链主要通过 `collection_prefix + baseCollection` 做隔离

### Redis
- 共享 `REDIS_URL`
- 主要通过 cache key 中的 `workspaceId / projectId` 做隔离

### 对象存储
- 共享 bucket
- 主要通过 object key 路径前缀隔离，例如 `workspaces/{workspaceId}/projects/{projectId}/...`

### Agent WebSocket
- 通过 agent key 绑定的 `workspace_id / project_id` 做边界控制
- 运行时请求会再次校验工作区与项目作用域

## 生成的工作区命名空间配置

`system 管理侧` 会生成一组工作区命名空间配置：

- `database_name`
- `collection_prefix`
- `key_prefix`

它们当前的真实含义是：

- `database_name`
  - 数据库命名结果
  - 不是“已创建的独立数据库”
- `collection_prefix`
  - Mongo 工作区 collection 前缀
  - 是当前工作区私有 Mongo 主链最主要的命名空间边界
- `key_prefix`
  - 缓存与运行时 key 的命名规则
  - 当前表示命名意图，但尚未在所有缓存路径里统一消费

## 主要实体的当前隔离方式

| Storage | Entity | Isolation mode | Prefixed collection | Notes |
| --- | --- | --- | --- | --- |
| Mongo | `provider_connections` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `project_model_entries` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `project_pricing_maps` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `credentials` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `credential_secrets` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `endpoints` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `chat_sessions` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `chat_messages` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `chat_attachments` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `agents` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `agent_service_keys` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `project_audit_events` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `project_usage_facts` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `notebook_tasks` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `notebook_task_messages` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `notebook_task_artifacts` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `notebook_task_trace_events` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| Mongo | `governance_policy_overrides` | `collection_prefix + baseCollection` | Yes | Workspace-scoped collection |
| PostgreSQL | `projects` | `workspace_id` / `project_id` | No | Shared database, shared table |
| Mongo | `source_libraries` | `workspace_id` / `project_id` | No | Shared collection |
| Mongo | `sources` | `workspace_id` / `project_id` | No | Shared collection |
| Mongo | `ai_ready_jobs` | `workspace_id` / `project_id` | No | Shared collection |
| PostgreSQL / pgvector | `source_embeddings` | `workspace_id` / `project_id` | No | Shared database, shared table |
| Object storage | `workspaces/{workspaceId}/projects/{projectId}/...` | Path prefix | N/A | Shared bucket |

## 发布与排障建议

- 不要把当前工作区隔离理解成“每工作区独立数据库资源”
- 当前最重要的边界信息是：
  - `workspace_id`
  - `project_id`
  - `collection_prefix`
  - agent key 对应的 `workspace_id / project_id`
- 如需排查数据落点，先确认实体属于：
  - 工作区前缀 collection
  - 还是共享 collection / shared table + 作用域字段
