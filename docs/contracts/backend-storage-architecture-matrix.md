# 后端数据持久化架构总表

Last updated: 2026-03-18  
Owner: API entry  
Audience: 架构评审、后端、前端、测试、发布负责人

## 1. 目的

本文件给出 AgentSmith 当前后端系统的数据真相总表，用于回答 3 个问题：

1. 每个功能模块的主数据放在哪里
2. 哪些状态属于共享运行态，应该进入 Redis / shared cache
3. 哪些状态只是当前进程的瞬态缓存，可以保留在内存

本文件和 [backend-persistent-state-boundary.md](./backend-persistent-state-boundary.md) 的关系是：

- `backend-persistent-state-boundary.md` 负责定义原则边界
- 本文件负责列出当前系统的模块、接口入口、存储模式和成熟度判断

## 2. 分层定义

### 2.1 主数据

定义：

- 会在 API 重启后继续被产品使用
- 会影响权限、治理、用户历史、后续执行或审计判断

要求：

- 必须进入 `docStore` / Mongo 或等价正式持久化存储

### 2.2 共享运行态

定义：

- 不需要进入主数据存储
- 但不能只存在单实例内存
- 多实例或 API 重启后仍需要保持有效

要求：

- 进入 Redis / shared cache

### 2.3 进程内瞬态

定义：

- 只为当前进程提速或维护当前执行控制
- 重启后可从持久化真相或上游状态重建

要求：

- 可以保留在进程内内存

### 2.4 内部工程证据型存储

定义：

- 数据并非产品主数据记录，而是研发验收、发布审查或内部治理工具链的运行产物、报告或证据文件

要求：

- 可以落本地磁盘
- 但必须有明确的部署前提：
  - 单机持久卷
  - 共享卷
  - 或后续迁到对象存储

## 3. 模块总表

| 领域/功能 | 主要接口/模块 | 核心数据对象 | 当前存储模式 | 真相类型 | 成熟度判断 | 备注 |
|---|---|---|---|---|---|---|
| system 管理侧工作区配置 | `src/lib/system-admin/workspace-registry.ts`, `src/lib/system-admin/workspace-registry/persistence.ts`, `packages/api-entry-node/src/system-workspace-persistence.ts` | `SystemWorkspaceRecord` | `docStore` / Mongo | 主数据 | 通过 | 已移除 workspace JSON 生产真相 |
| 工作区权限与 tenant 配置解析 | `packages/api-entry-node/src/workspace-permissions.ts`, `packages/api-entry-node/src/workspace-tenant-collections.ts` | workspace owner / creators / tenant config | 基于持久化 workspace 配置读取 | 主数据投影 | 通过 | 已不再读 `system-workspaces.json` |
| 项目主数据 | project routes / workspace scoped collections | project records | `docStore` / Mongo | 主数据 | 通过 | 标准 workspace-scoped 真相 |
| Endpoint 配置 | `packages/api-entry-node/src/endpoint-resource-service.ts` | endpoint records | `docStore` / Mongo | 主数据 | 通过 | 符合企业控制面模式 |
| Project secrets / 凭据引用 | `packages/api-entry-node/src/endpoint-resource-service.ts` 等 | credentials / secret refs | `docStore` / Mongo | 主数据 | 通过 | 需持续保证 secret-at-rest 约束 |
| Agents 主数据 | `packages/api-entry-node/src/agent-resource-service.ts` | agent records / keys | `docStore` / Mongo | 主数据 | 通过 | 与 presence 分层 |
| Agent 在线状态 | `packages/api-entry-node/src/agent-resource-service.ts` | heartbeat / presence | shared cache / Redis + 本地 socket 镜像 | 共享运行态 | 通过 | 当前实现适合多实例 presence 投影 |
| 用户外部连接 | `packages/api-entry-node/src/user-external-connections-store.ts` | external connections | `docStore` / Mongo | 主数据 | 通过 | 外部账号绑定真相已持久化 |
| Feishu OAuth state | `packages/api-entry-node/src/feishu-oauth.ts` | OAuth callback state | shared cache / Redis TTL | 共享运行态 | 通过 | API 重启后回调可继续完成 |
| 文件库 catalog / backend / mount access | `packages/api-entry-node/src/file-library-persistence.ts`, `packages/api-entry-node/src/project-file-library-routes.ts` | catalog / backend / mount access | `docStore` / Mongo | 主数据 | 通过 | 已修复 API 重启即丢问题 |
| 文件库 gateway 运行态 | `packages/api-entry-node/src/file-library-runtime.ts` | gateway sessions / child proc state | 进程内内存 | 瞬态运行态 | 条件通过 | 连接型运行态，若未来多实例 HA 需增强 |
| Chat 主数据 | `packages/api-entry-node/src/chat-resource-service.ts` | sessions / messages / attachments | `docStore` / Mongo | 主数据 | 通过 | 当前真相清晰 |
| Chat 流式状态 | `packages/api-entry-node/src/chat-stream-state.ts` | active stream registry / abort handles | 本地内存 + shared cache | 共享/瞬态混合 | 通过 | 分层合理 |
| Notebook 主数据 | `packages/api-entry-node/src/task-route-handler.ts`, `packages/api-entry-node/src/notebook-task/task-store.ts`, `packages/api-entry-node/src/notebook-trace-store.ts` | tasks / messages / artifacts / traces | `docStore` / Mongo | 主数据 | 通过 | 已与 file library workspace 真相打通 |
| Notebook 当前运行控制 | `packages/api-entry-node/src/notebook-task/task-runtime-state.ts`, `packages/api-entry-node/src/notebook-task-sse-broker.ts` | active runs / cancel handles / hot cache | 进程内内存 | 瞬态运行态 | 条件通过 | 当前架构可接受，但不是 HA 执行控制 |
| 项目资源策略主数据 | `packages/api-entry-node/src/project-resource-policy-store.ts` | allow-list / limits / policies | `docStore` / Mongo | 主数据 | 通过 | 已从旧 Map store 收敛 |
| 资源策略分钟级频控 | `packages/api-entry-node/src/project-resource-policy-enforcer.ts` | minute bucket counters | shared cache / Redis | 共享运行态 | 通过 | 已支持跨重启/跨实例共享 |
| 成员治理 | `packages/api-entry-node/src/project-member-governance-persistence.ts`, `packages/api-entry-node/src/project-authz-engine.ts` | memberships / groups / templates / permissions / history | `docStore` / Mongo | 主数据 | 通过 | 达到产品级治理真相 |
| 加入申请 | `packages/api-entry-node/src/project-join-request-routes.ts` | join requests | `docStore` / Mongo | 主数据 | 通过 | 与成员治理真相已对齐 |
| 审计与用量 | `packages/api-entry-node/src/audit-usage-store.ts` | audit events / usage facts | `docStore` / Mongo | 主数据 | 通过 | 与 resource policy 已打通 |
| 用户资料与通知 | `packages/api-entry-node/src/me-notifications-store.ts`, `packages/api-entry-node/src/me-route-handler.ts` | profile / notifications | `docStore` / Mongo | 主数据 | 通过 | 已持久化 |
| SSE ticket | `packages/api-entry-node/src/sse-ticket-store.ts` | short-lived tickets | 进程内内存 | 瞬态运行态 | 条件通过 | 若未来无粘性多实例 SSE，可考虑共享化 |
| 治理报告 | `packages/api-entry-node/src/governance-report-store.ts` | reports / evidence files | 本地磁盘 | 内部工程证据型存储 | 条件通过 | 当前属于研发/发布证据链，不属于产品主数据 |
| 治理运行记录 | `packages/api-entry-node/src/governance-run-store.ts` | run evidence files | 本地磁盘 | 内部工程证据型存储 | 条件通过 | 当前属于研发/发布证据链，不属于产品主数据 |
| 治理事件/incident 证据 | `packages/api-entry-node/src/governance-incident-store.ts` | incident evidence files | 本地磁盘 | 内部工程证据型存储 | 条件通过 | 当前属于研发/发布证据链，不属于产品主数据 |

## 4. 审查结论

### 4.1 当前已经达到产品级成熟度的部分

以下主数据和共享运行态，当前已符合正式发布级的基本工程要求：

- system workspace 配置
- file library
- notebook task / artifact / trace 主数据
- chat 主数据
- resource policy 主数据
- member governance
- join request
- notifications / profile
- external connections
- audit / usage
- agent presence
- Feishu OAuth state
- resource policy minute counters

结论：

- 当前活跃生产主路径中，已经没有再发现“产品主数据仍依赖单进程内存或 workspace JSON 文件”的高危块

### 4.2 条件通过的部分

以下模块当前设计是合理的，但它们的成熟度依赖部署假设：

- notebook 当前运行控制
- SSE tickets
- file library gateway runtime

它们不是“主数据未落库”问题，但如果目标是：

- 多实例 HA
- 无状态 API 容器
- 进程级故障后的无损接管

则仍需要下一阶段增强。

## 5. 产品级成熟度判断

### 通过

- 主数据持久化边界基本正确
- 共享运行态与主数据分层正确
- 旧 JSON / 旧内存 store 生产真相已清理
- 当前 full real release gate 已可通过

### 需要明确部署前提

- SSE ticket 单进程模型
- notebook active run / cancel 进程内控制
- file library gateway 进程内会话模型

### 不纳入产品主数据成熟度主线

以下目录和对应读取模块当前定义为内部工程/发布证据链：

- `artifacts/governance-reports/`
- `artifacts/governance-runs/`
- `artifacts/governance-incidents/`

它们需要有自己的工程治理和存储前提，但不应再与产品主数据持久化问题混在一起判断。

## 6. 推荐的下一阶段增强方向（Backlog / Reference）

若目标从“正式发布可用”进一步提升到“更强的多实例与高可用成熟度”，建议按以下顺序推进：

1. SSE ticket 共享化
2. notebook active run / cancel 控制共享化
3. file library gateway manager 外部化
4. 如需继续提升工程证据链，再单独立项治理证据型存储外部化

对应完整清单见：
