# api-entry-node 模块结构（2026-02-13）

本文档定义 `packages/api-entry-node/src` 的职责边界，后续开发按此结构继续演进，避免再次回到超大入口文件。

## 1. 模块分层

- `index.ts`
- 仅保留服务启动与生命周期管理（HTTP server + job worker + CLI 启动）
- 负责 WebSocket upgrade 分发（agent runtime）
- 不再承载业务路由与资源逻辑

- `request-handler.ts`
- 负责 HTTP 请求编排（鉴权、路由分发、统一错误映射）
- 串联 `project/source`、`chat`、`endpoint`、`agent` 四类 handler

- `error-mapper.ts`
- 统一维护 request 层错误到 HTTP 响应的映射策略
- 避免在 `request-handler.ts` 堆积 if-chain 分支

- `projects-route-match.ts`
- 统一维护 API 路由匹配与 `ProjectsRoute` 联合类型
- 新增路由必须先改这里，再改对应 handler

- `workspace-permissions.ts`
- 维护 workspace/project 级权限集合与权限推导规则
- 维护默认 workspace 构造逻辑

- `node-api-deps.ts`
- 统一依赖注入接口 `NodeApiDeps`（类型契约）

- `node-api-deps-factory.ts`
- 依赖装配工厂
- `createDefaultNodeApiDeps()`：内存实现（测试/本地快速开发）
- `createNodeApiDepsFromEnv()`：按环境变量装配 Postgres/Redis/Mongo/MinIO/PgVector

- `chat-resource-service.ts`
- chat 会话、消息、附件资源读写逻辑
- 会话支持 `external_agent_id` 线程绑定

- `agent-resource-service.ts`
- agent/agent-key 资源读写与连接状态元信息

- `agent-runtime-service.ts`
- external agent websocket runtime（鉴权、在线会话、请求分发、流式事件回传）

- `endpoint-resource-service.ts`
- endpoint/credential 资源读写与 OpenAI-compatible 批量导入逻辑

- `resource-models.ts`
- 资源文档模型定义（chat/endpoint/agent/workspace）

## 2. 当前开发约束

- 不在 `index.ts` 增加业务分支、Schema 校验与资源读写。
- 新 API 路径必须：
1. 在 `projects-route-match.ts` 补充匹配与 route kind。
2. 在对应 handler 文件实现逻辑。
3. 如需新资源模型，先落到 `resource-models.ts` 或独立 `*-models.ts`。

- 新依赖（repo/store/client）必须通过 `node-api-deps.ts` 显式声明，再在 `node-api-deps-factory.ts` 统一装配。

## 3. 后续建议（P1/P2 配套）

- 给 `projects-route-match.ts` 添加路由匹配单元测试，避免正则回归。
- 持续扩展 `chat-resource-service.ts` 分支/修订语义测试，覆盖跨 session/project 的边界场景。
- Chat 会话流控制契约（`sessions/{sessionId}/streams` + 双 stop 路径）统一维护在 `docs/contracts/cf-private-hybrid-architecture-guide-v1.md`。
