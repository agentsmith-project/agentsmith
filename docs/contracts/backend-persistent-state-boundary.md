# 后端主数据与运行态边界

Last updated: 2026-03-18  
Owner: API entry  
Audience: 后端、前端、测试、发布负责人

## 1. 目的

本文件定义 AgentSmith 后端中：

- 哪些数据属于**产品主数据**，必须持久化
- 哪些数据属于**运行态缓存**，允许停留在内存

这份文档用于避免再次出现“API 重启后主数据丢失，但运行记录仍在”的双真相问题。

## 2. 当前持久化主数据真相

以下对象现在必须以 `docStore` / Mongo 为唯一真相：

### 2.1 文件与工作空间

- file library catalog
- file library backend mapping
- file library mount access
- notebook task 的 `workspace_file_library_id/name`

要求：

- API 重启后 file library 仍可列出、读取、使用
- task 的 workspace access 只能读取当前 task 绑定的 file library
- 若历史 task 绑定的 file library 已丢失，必须显式失败，不自动补建

### 2.2 治理与权限

- project resource policy
- project memberships
- project groups
- project permission templates
- project member custom permissions
- project member change history
- project join requests

要求：

- API 重启后，治理判断、成员状态、组、模板、join request 不丢
- 路由鉴权、`/authorize`、resource policy、usage summary 读取同一套持久化真相

### 2.3 用户态数据

- user profile
- notifications / unread state

要求：

- API 重启后，通知列表和已读状态保留
- 通知与治理/审计行为保持一致

## 3. 允许保留内存的运行态

以下对象允许继续使用进程内状态：

- SSE ticket / 短 TTL 认证票据
- notebook active runs
- notebook SSE 历史缓存
- notebook trace 热缓存
- 其他只为当前进程运行效率服务、且重启后可安全重建的状态

判断标准：

- 如果数据丢失会影响产品真相、治理判断、用户历史或后续操作，就不能只留在内存
- 如果数据只是当前进程的瞬态加速层，且可从持久化真相重建，则允许留在内存

## 4. 当前实现边界

### 已收敛到持久化真相

- file library 主路径
- project resource policy 主路径
- project join request 主路径
- me notifications / profile 主路径
- project member governance 主路径

### 仍保留但不应再作为生产主路径

下面这些旧 store 仍可能存在于代码中，用于：

- 类型定义
- 旧测试兼容
- 过渡期 helper

但不应继续作为生产真相来源：

- `project-groups-store`
- `project-memberships-store`
- `project-member-permissions-store`
- `project-permission-templates-store`
- file library 旧内存 runtime store

## 5. 工程检查要求

审查后端状态时，必须至少确认：

1. 该数据是否会在 API 重启后继续被产品使用
2. 若会，是否已有持久化 repo / docStore 真相
3. route / authz / notebook / files / governance 是否都读同一套真相
4. 是否存在“运行记录已持久化，但主数据仍在内存”的分叉

推荐的最低验证模式：

1. 创建主数据
2. 重启 API
3. 再读取 / 再执行 / 再治理判断
4. 结果应与重启前一致

## 6. 已知非目标

本文件不要求：

- 删除所有旧内存 helper 文件
- 把所有缓存都迁到持久化层
- 为历史脏数据自动补迁移

当前策略是：

- fix-forward
- 新主路径统一走持久化真相
- 历史孤儿状态显式报错
