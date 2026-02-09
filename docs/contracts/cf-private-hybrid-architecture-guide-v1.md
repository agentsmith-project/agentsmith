# MBOS 双部署架构技术说明（Cloudflare 试水 + 私有化落地）v1

## 1. 文档目标

本说明用于指导开发团队实现以下目标：

- 前端已完成（当前基于 MSW Mock），后端从 0 开始建设。
- 第一阶段低成本部署在 Cloudflare（以下简称 CF）做业务试水。
- 第二阶段支持客户私有化部署（本地机房 / 私有云 / K8s）。
- 使用一套核心业务代码，同时兼容两种运行环境。

本说明重点覆盖：

- 架构分层与代码组织方式
- API 层实现策略
- 数据存储与缓存选型（含 CF 与私有化映射）
- 双部署工程化方案
- 迁移路径、风险与验收标准

---

## 2. 总体原则

### 2.1 一句话原则

用 **“核心业务不依赖平台”** 的分层架构：

- 平台相关能力（CF Workers、R2、KV，或私有化 Redis、MongoDB、MinIO）放在适配层。
- 业务规则、权限模型、用例流程保持纯 TypeScript 实现。

### 2.2 核心设计原则

1. 契约优先（Contract First）
- OpenAPI 是前后端唯一通信契约。
- MSW Mock、后端 DTO、集成测试都基于同一份契约生成。

2. Hexagonal / Ports & Adapters
- Domain/Application 只依赖端口接口（Port），不直接依赖云厂商 SDK。
- 每个平台仅实现自己的 Adapter。

3. 运行时可替换
- CF 入口与私有化入口分离（入口薄层）。
- 核心用例层完全共用。

4. 数据语义一致优先
- 不追求底层产品 1:1 对齐，追求业务语义一致（幂等、事务边界、最终状态一致）。

5. 先可用后优化
- 先满足试水期成本和交付速度，再按指标逐步升级高可用与性能。

---

## 3. 推荐总体架构

```text
Frontend (Next.js, 已有)
   |
   | OpenAPI Contract (single source of truth)
   v
API Entry Layer
   |- Cloudflare Entry (Workers)
   |- Private Entry (Node/Fastify or Hono-Node)
   |
Application Layer (UseCases)
   |- AuthZ / Validation / Idempotency / Audit
   |
Domain Layer
   |- Entities / Value Objects / Domain Services
   |
Ports (interfaces)
   |- UserRepo / ProjectRepo / AgentRepo
   |- CachePort / QueuePort / ObjectStorePort / DocStorePort
   |
Adapters
   |- Cloudflare: D1/KV/R2/Queues/DO
   |- Private: Postgres(or MySQL)/Redis/MongoDB/MinIO/MQ
```

### 3.1 分层职责

1. Entry（API 入口层）
- HTTP 路由绑定、请求解析、鉴权上下文注入、返回标准错误。
- 不能写业务规则。

2. Application（应用服务层）
- 用例编排（例如创建项目、执行任务、上传资源、触发异步处理）。
- 事务边界、幂等控制、权限检查、审计日志。

3. Domain（领域层）
- 纯业务规则（实体状态迁移、配额计算、策略决策）。
- 不依赖数据库、缓存、消息队列。

4. Port（端口接口）
- 以接口抽象存储和外部服务。

5. Adapter（适配层）
- 连接具体实现（CF 组件或私有化中间件）。

---

## 4. 为什么不把私有化主运行时绑定到 workerd

`workerd` 适合本地模拟 / Worker 兼容运行验证，但不建议作为私有化主运行时唯一方案。推荐策略：

- CF 环境：Workers（生产入口）
- 私有化环境：Node.js 容器（Fastify/Hono）
- 共用：Application + Domain + Contracts

这样做的收益：

1. 私有化部署生态成熟（Node/K8s/可观测性/数据库驱动）。
2. 避免将客户环境约束在 CF 语义和运行时限制上。
3. 在可控成本下保留对 CF 的快速部署能力。

---

## 5. 存储选型与语义映射

> 目标不是“产品名一致”，而是“语义一致 + 运维可控”。

### 5.1 推荐基线（私有化）

- 关系数据：PostgreSQL（推荐）
- 缓存/分布式锁：Redis
- 文档数据：MongoDB
- 文件对象存储：MinIO（S3 兼容）
- 队列：Redis Streams / RabbitMQ / NATS（三选一）

### 5.2 CF 与私有化映射建议

1. 对象存储
- CF：R2
- Private：MinIO
- 统一接口：`ObjectStorePort`（put/get/signedUrl/delete/listByPrefix）

2. 缓存
- CF：KV（适合读多写少、可接受最终一致）或 Upstash Redis
- Private：Redis
- 统一接口：`CachePort`（get/set/del/setNx/expire）

3. 关系数据
- CF：D1（早期可用）或外部 Postgres
- Private：Postgres
- 统一接口：`RelationalRepo`

4. 文档数据
- CF：可先外部 MongoDB（Atlas 或自托管）
- Private：MongoDB
- 统一接口：`DocStorePort`

5. 异步任务
- CF：Queues
- Private：Redis Streams / RabbitMQ
- 统一接口：`QueuePort`（publish/consume/retry/dlq）

### 5.3 数据模型落地建议

1. 强事务核心数据
- 用户、workspace、project、权限、配额、账单、任务主记录等放关系库。

2. 高变结构数据
- Agent 中间状态、执行上下文、可变 schema 配置放 MongoDB。

3. 大文件与二进制
- 仅存对象存储，DB 存元数据与引用。

4. 缓存原则
- 缓存永远可失效，不能作为唯一真相来源。

---

## 6. API 层设计（可直接执行）

### 6.1 API 规范（强制）

1. 统一版本
- `/api/v1/...`

2. 统一响应
- 成功：`{ code: 0, data, request_id }`
- 失败：`{ code: <biz_code>, message, request_id, details? }`

3. 统一错误码
- `AUTH_*`, `PERMISSION_*`, `VALIDATION_*`, `RESOURCE_*`, `SYSTEM_*`

4. 幂等机制
- 对创建/触发类接口要求 `Idempotency-Key`。

5. 审计字段
- 每个写操作记录 `actor_id`, `workspace_id`, `project_id`, `trace_id`。

### 6.2 Handler 模板

```ts
// 入口层只做 parse + auth + invoke + map
export async function createProjectHandler(req: Request, deps: Deps) {
  const ctx = await deps.auth.resolve(req);
  const input = deps.validator.parse(CreateProjectSchema, await req.json());

  const result = await deps.useCases.createProject.execute({
    actor: ctx.actor,
    workspaceId: ctx.workspaceId,
    input,
    idempotencyKey: req.headers.get('Idempotency-Key') ?? undefined,
  });

  return deps.presenter.ok(result);
}
```

### 6.3 用例层模板

```ts
export class CreateProjectUseCase {
  constructor(
    private readonly projectRepo: ProjectRepo,
    private readonly permission: PermissionService,
    private readonly idempotency: IdempotencyPort,
    private readonly audit: AuditPort,
  ) {}

  async execute(cmd: CreateProjectCommand) {
    await this.permission.ensure(cmd.actor, 'project:create', cmd.workspaceId);

    return this.idempotency.run('create_project', cmd.idempotencyKey, async () => {
      const project = Project.create(cmd.input.name, cmd.workspaceId, cmd.actor.id);
      await this.projectRepo.save(project);
      await this.audit.record({ action: 'project.create', actorId: cmd.actor.id, resourceId: project.id });
      return project.toDTO();
    });
  }
}
```

---

## 7. 一套代码双部署：目录与包设计

建议 monorepo（pnpm / npm workspaces）结构：

```text
packages/
  contracts/              # OpenAPI + shared schemas + generated types
  domain/                 # 纯领域模型（无平台依赖）
  application/            # UseCases（依赖 ports）
  ports/                  # TS interfaces
  adapters-cf/            # D1/KV/R2/Queues adapters
  adapters-private/       # pg/redis/mongo/minio adapters
  api-entry-cf/           # Workers 入口
  api-entry-node/         # Node 入口（Fastify/Hono）
  observability/          # logger, tracer, metrics 抽象
```

### 7.1 依赖方向（必须遵守）

- `entry -> application -> domain`
- `application -> ports`
- `adapters -> ports`
- 禁止 `domain/application` 反向依赖 `adapters/entry`

### 7.2 环境开关策略

- 不在业务代码里 `if (isCloudflare)`。
- 在 `composition root`（应用启动处）注入不同 adapter。

---

## 8. 部署拓扑建议

### 8.1 阶段一：Cloudflare 试水

1. 前端
- Next.js 部署到 CF Pages/Workers（按团队现状选择）。

2. API
- Workers 作为 API 入口。

3. 数据
- 低复杂度先 D1 + R2 + Queue。
- 若业务复杂度高，尽早改为外部 Postgres/Mongo，避免后期迁移成本。

4. 观测
- 接入统一日志和 Trace（request_id/trace_id）。

### 8.2 阶段二：私有化

1. 入口
- Node API（容器化），Nginx/Ingress 暴露。

2. 数据中间件
- Postgres + Redis + MongoDB + MinIO + MQ。

3. 部署方式
- 首选 K8s Helm Chart。
- 次选 Docker Compose（POC 与小规模客户）。

4. 安全
- 私有化支持离线 license、审计日志导出、对象存储加密、密钥轮换。

### 8.3 当前阶段范围（P0）与目标阶段（P1）

为了避免团队在最小验证期过早复杂化，按阶段约束能力边界：

1. P0（当前最小验证范围）
- 目标：打通真实登录与核心业务闭环，不追求高并发与复杂编排。
- 依赖：Keycloak + MinIO（后端可先用 Node API + 进程内任务 worker）。
- 功能闭环：登录、workspace/project 进入、source library CRUD、file CRUD、AIReady 最小链路。
- 要求：所有接口保持最终契约形态（路径、字段、错误码、幂等语义），避免后续重写前端。

2. P1（扩展到生产级私有化能力）
- 目标：提升可靠性、可扩展性和运维可观测性。
- 依赖：Postgres(+pgvector) + Redis + MongoDB + Queue + MinIO。
- 增强：Outbox、DLQ、回放工具、任务并发治理、复杂查询与聚合能力。
- 要求：不修改 domain/application 语义，仅替换和扩展 adapter。

---

## 9. 关键非功能设计

### 9.1 一致性与事务

1. 单库事务
- 同一关系库内操作使用本地事务。

2. 跨系统一致性
- 使用 Outbox Pattern：
  - 业务事务提交时写 outbox 表
  - 异步投递器发送到队列
  - 消费端幂等处理

3. 补偿策略
- 任务状态机 + 重试上限 + DLQ + 人工回放工具。

### 9.2 性能与缓存

1. 缓存分层
- L1 进程内短缓存（可选）
- L2 Redis/KV

2. 缓存键规范
- `mbos:{env}:{workspace}:{resource}:{id}`

3. 防穿透
- 空值缓存 + 布隆过滤（可后续引入）

4. 防雪崩
- TTL 增加随机抖动。

### 9.3 可观测性

强制打点：

- `request_id`, `trace_id`, `actor_id`, `workspace_id`, `project_id`
- API 延迟 P50/P95/P99
- 失败率、重试率、DLQ 累积
- 对象存储读写时延与失败率

### 9.4 安全

1. 鉴权
- JWT/OIDC，后端二次校验权限。

2. 多租户隔离
- 所有读写必须带 workspace/project 作用域。

3. 文件安全
- 上传后缀白名单、MIME 二次校验、恶意内容扫描（后置异步）。

4. 密钥管理
- CF Secrets / K8s Secret + 外部 KMS（企业客户可选）。

### 9.5 后台任务统一模型（文档处理 / 异步 Chat / 离线 Agent）

统一任务域模型，避免每个模块自建状态机：

1. 任务类型
- `document_ingest`：文件解析、切片、embedding、索引入库。
- `chat_async_turn`：允许前端断线后继续推理，重连后恢复会话状态。
- `agent_offline_run`：离线 agent 批处理执行。

2. 标准状态机
- `queued -> running -> retrying -> succeeded | failed | cancelled | dead_lettered`
- 所有任务都必须记录 `retry_count`、`last_error`、`updated_at`。

3. 幂等规则
- 写接口必须接受 `Idempotency-Key`。
- 建议任务幂等键：`{workspace}:{project}:{resource}:{operation}:{version}`

4. 失败恢复规则
- 明确最大重试次数和退避策略（指数退避 + 抖动）。
- 超过阈值进入 `dead_lettered`，支持人工回放。
- 回放必须保留原始上下文快照，避免“当前配置污染历史任务”。

### 9.6 Source Library 三元组一致性（强约束）

每个 `source_library` 实例绑定一套三元组资源，切换库时必须一起切换：

1. 三元组定义
- 文件对象存储命名空间：`object_prefix`（MinIO/R2）
- 文档存储命名空间：`doc_namespace`（Mongo 或同类文档库）
- 向量存储命名空间：`vector_namespace`（向量库或同类服务）

2. 一致性约束
- 任何文件查询、AIReady 入库、向量检索都必须显式携带 `source_library_id`。
- 禁止跨库混读（例如文件属于 A 库，向量写入 B 库）。
- 库切换后，前端应清空旧库视图并按新库上下文重拉数据。

3. 审计要求
- 记录 `source_library_id`、`doc_namespace`、`vector_namespace`、`object_prefix` 到任务审计日志。
- 任务失败时输出可定位到具体库三元组的错误上下文。

---

## 10. API 与前端协同（你当前阶段最重要）

前端已经在 MSW Mock 上跑，建议按下面顺序把 Mock 变成生产后端：

1. 冻结 OpenAPI v1
- 把现有页面全部接口抽成 OpenAPI（路径、参数、响应、错误码）。

2. 建立 Contract CI
- PR 必须通过：
  - OpenAPI lint
  - 前后端类型生成
  - Mock 与 schema 一致性检查

3. 后端先实现读接口，再实现写接口
- 优先让页面从“假数据可看”变“真数据可看”。

4. 引入回归测试
- 前端 E2E 复用现有用例。
- 增加 API contract tests + integration tests。

### 10.1 Source Library / File / AIReady 最小契约（P0 必做）

1. Source library
- `GET /workspaces/{ws}/projects/{project}/source-libraries`
- `POST /workspaces/{ws}/projects/{project}/source-libraries`
- `PATCH /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}`
- `DELETE /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}`

2. File CRUD（强制 library 作用域）
- `GET /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/files`
- `POST /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/files`
- `PATCH /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/files/{fileId}`
- `DELETE /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/files/{fileId}`

3. AIReady job
- `POST /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/ai-ready-jobs`
- `GET /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/ai-ready-jobs/{jobId}`
- `POST /workspaces/{ws}/projects/{project}/source-libraries/{libraryId}/ai-ready-jobs/{jobId}:cancel`
- 迁移兼容期可保留旧接口 `/sources/{sourceId}/ai-ready/*`，但新功能必须优先对接 library-scoped jobs。
- 当前实现基线：`document_ingest` 在 Node 入口以进程内 worker 执行，状态至少覆盖 `queued/running/succeeded/failed/cancelled`。

4. 字段约束
- `source_library_id`, `object_prefix`, `doc_namespace`, `vector_namespace` 为跨端必备字段。
- 任务字段：`job_status`, `retry_count`, `error_code`, `error_message`, `idempotency_key`。
- 错误语义统一 `401/403/422/5xx`，并保持稳定业务错误码。

### 10.2 OpenAI 兼容端点代理（可用性优先）

为尽快打通“可用”链路，后端提供项目级 endpoint 资源和 OpenAI 兼容转发：

1. 资源管理
- `GET/POST /workspaces/{ws}/projects/{project}/credentials`
- `POST /workspaces/{ws}/projects/{project}/credentials/{credentialId}/rotate`
- `DELETE /workspaces/{ws}/projects/{project}/credentials/{credentialId}`
- `GET/POST /workspaces/{ws}/projects/{project}/endpoints`
- `GET/PUT/DELETE /workspaces/{ws}/projects/{project}/endpoints/{endpointId}`

2. 批量导入（OpenAI-compatible 配置）
- `POST /workspaces/{ws}/projects/{project}/endpoints/import-openai-compatible`
- 支持一次导入 `reranker/embedding/completion` 三类端点定义。

3. OpenAI 兼容代理
- `POST /workspaces/{ws}/projects/{project}/endpoints/{endpointId}/proxy/{openai_path}`
- 例如：`proxy/chat/completions`、`proxy/embeddings`
- 代理层按 endpoint 绑定的 credential 注入 `Authorization: Bearer <api_key>`，并支持 `source_model` 覆盖 `model`。

4. Chat 运行时最小链路（已落地）
- `GET/POST /workspaces/{ws}/projects/{project}/chat/sessions`
- `GET/PATCH/DELETE /workspaces/{ws}/projects/{project}/chat/sessions/{sessionId}`
- `POST /workspaces/{ws}/projects/{project}/chat/sessions/{sessionId}/stop`
- `GET /workspaces/{ws}/projects/{project}/chat/sessions/{sessionId}/streams`
- `GET/POST /workspaces/{ws}/projects/{project}/chat/sessions/{sessionId}/messages`
- `PATCH /workspaces/{ws}/projects/{project}/chat/sessions/{sessionId}/messages/{messageId}`
- `POST /workspaces/{ws}/projects/{project}/chat/sessions/{sessionId}/messages/stream`
- `POST /workspaces/{ws}/projects/{project}/chat/sessions/{sessionId}/messages/streams/{streamId}/stop`
- `GET/POST/DELETE /workspaces/{ws}/projects/{project}/chat/sessions/{sessionId}/attachments/*`
- `messages/stream` 必须:
  - 读取 session 绑定 endpoint/credential
  - 转发到 OpenAI-compatible `/chat/completions`
  - 返回 SSE 事件 (`meta`, `delta`, `done`)
  - HTTP Header `x-chat-stream-id` 与 `meta.stream_id` 一致，可用于显式 stop
  - 客户端断开（刷新/离开）时不得中断上游推理，后台继续并落库
  - `finish_reason` 仅表示模型完成原因，不得复用为系统状态
  - 系统状态通过 `message_status` 表达（`streaming|completed|stopped|failed`）
  - 将 assistant 回复落库，支持前端断线后重载历史
  - 支持分支对话语义：
    - 用户编辑产生新 revision（不覆盖原 message）
    - assistant 重生成产生 variant（同 parent，不同 variant_index）
    - 携带 `branch_leaf_message_id` + 相同 input 时不得重复创建 user message
  - `messages/streams/{streamId}/stop` 需幂等（重复调用返回 202）
  - `sessions/{sessionId}/stop` 需支持无 `stream_id` 停止（用于页面刷新后仅有 `runtime_status` 的场景）
  - `sessions/{sessionId}/streams` 返回当前活跃流列表（`stream_id/status/started_at`），用于浏览器刷新或切线程后的 stream 恢复
  - 同一 `session_id` 在任一时刻只允许一个活跃 stream（`running|stopping`）
  - 若同 session 已有活跃 stream，`POST .../messages/stream` 必须快速失败并返回 `409 CHAT_SESSION_STREAM_CONFLICT`
  - 控制语义采用双层：
    - `sessions/{sessionId}/stop` = 粗粒度，停止该 session 全部活跃流
    - `messages/streams/{streamId}/stop` = 细粒度，仅停止指定 stream
  - `chat/sessions` 响应可携带 `runtime_status`（`running|stopping|completed|stopped|failed`）用于前端刷新后的运行态展示
  - `chat/sessions` 与 `chat/sessions/{sessionId}/messages` 必须支持 `page`/`page_size` 分页参数，并返回准确 `total/page/page_size/has_more`
  - 分页参数契约：
    - `chat/sessions` 默认 `page=1,page_size=100,max_page_size=500`
    - `chat/sessions/{sessionId}/messages` 默认 `page=1,page_size=200,max_page_size=500`
    - 非法 `page/page_size`（非数字、<=0）按默认值处理
    - 过大 `page_size` 按 `max_page_size` 截断
  - `done.tokens` 与落库 `tokens` 应优先使用上游 `usage.total_tokens`；无 usage 时可为空，不得使用字符长度估算 token
  - 删除 session 前必须先中止该 session 的活跃 stream，避免后台悬挂写入
  - `GET .../sessions/{sessionId}/streams` 行为契约：
    - session 不存在返回 `404 chat_session_not_found`
    - active stream 运行中返回 `total>0`
    - stream 完成/停止后返回空列表 `total=0`

5. 认证策略（当前约束）
- API 必须依赖 Keycloak `userinfo` 校验 Bearer Token。
- 不允许 “Keycloak 未配置时本地用户回退” 的兼容路径；未配置即按未认证返回 401（快速失败）。

---

## 11. 迁移与演进路线（建议 6 周）

### Week 1：契约冻结与骨架搭建

- 完成 OpenAPI v1
- 建 packages 基础结构
- 打通 hello-world 级双入口（CF/Node）

### Week 2：核心读 API

- workspace/project/overview 查询接口
- 接入关系库 + 缓存

### Week 3：核心写 API

- 项目创建、成员管理、来源管理
- 幂等、审计、权限检查落地

### Week 4：文件与异步

- 对象存储接入（R2/MinIO）
- 队列与任务状态机

### Week 5：稳定性建设

- Outbox、DLQ、回放工具
- 压测与慢查询优化

### Week 6：双部署验收

- CF 与私有化均通过同一套契约测试
- 发布候选版本（RC）

---

## 12. 验收标准（架构是否成功）

满足以下条件，说明架构设计达标：

1. 同一业务用例在 CF 与私有化运行结果一致（契约与语义一致）。
2. 切换部署目标无需修改 domain/application 代码。
3. 任意写接口支持幂等并可审计追踪。
4. 关键链路可观测（trace + metrics + structured logs）。
5. 任一基础设施故障（队列/存储）可恢复并可回放。

---

## 13. 常见误区（必须避免）

1. 误区：直接在业务代码里写 CF SDK 调用。
- 后果：私有化几乎重写。

2. 误区：把 KV 当强一致数据库。
- 后果：权限、配额、状态出现脏读。

3. 误区：没有幂等键就做重试。
- 后果：重复创建资源、账单错误。

4. 误区：对象存储只存文件不存元数据。
- 后果：审计追踪困难，难做权限回收。

5. 误区：只做功能测试，不做契约和回放测试。
- 后果：环境切换时出现隐性回归。

---

## 14. 团队执行清单（可直接分工）

1. 架构组
- 建立 ports/adapters 分层规范与代码模板。

2. 后端组
- 先实现 application + domain，再接各平台 adapter。

3. 前端组
- 维护 OpenAPI 与 MSW 对齐，增加契约测试门禁。

4. 测试组
- 搭建双环境测试矩阵（CF runtime / Node runtime）。

5. 运维组
- 提供 CF 发布流水线与私有化 Helm/Compose 模板。

---

## 15. 你当前项目的建议起步点

结合 `mbos-frontend-v1` 当前状态（前端已完成、MSW 在用），建议立刻执行：

1. 在仓库新增 `packages/contracts`，把现有 mock 涉及接口收敛成 OpenAPI。
2. 新增 `packages/domain` 与 `packages/application`，先实现 2 个核心用例（例如 project list/create）。
3. 新增 `packages/api-entry-node`，先跑私有化最小链路（本地 Node + Postgres/Redis）。
4. 再新增 `packages/api-entry-cf`，验证同用例在 CF 路由可运行。
5. 用一组 E2E 用例同时打两套入口，确保行为一致。

当这 5 步跑通后，再扩展到 agents/sources/studio 等复杂模块，风险会明显下降。
