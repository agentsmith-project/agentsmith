# Current Baseline (Whitelist)

更新时间：2026-03-12  
状态：`authoritative`

本文件是当前唯一白名单。新人入项、评审、实施、验收都以本清单为准。

## 1. 治理主线（唯一）

1. 项目级治理（project scope）
2. LLM endpoint 统一约束链路
3. Chat / Notebook / API 共用同一套 rate / spending / audit / usage 约束
4. 不做发布管理平台，不做组织级总控治理主线

术语边界（必须一致）：

- 文档中的 `release` / `engineering gate` 仅表示 AgentSmith 本项目研发治理与验收流程命名。
- `permission gate` 表示产品内路由/交互权限门禁，不等于工程流程门禁。
- 不代表 AgentSmith 产品对外提供 DevOps 发布编排、发布门禁平台能力。
- 若必须描述底层技术职责，应优先使用更具体的词，例如 `agent execution`、`notebook execution`、`model request execution`、`model catalog sync`、`project pricing config`；避免用 `Runtime` 这种大词兜底。在当前 MVP 中，`Runtime` 不再是独立产品面。

## 2. 当前 MVP 对外产品面（唯一）

1. `System Admin`
- 面向系统超级管理员。
- 唯一目标是管理 workspace 生命周期、workspace 底层配置与 workspace 鉴权配置。
- 系统超级管理员账户在系统启动前以配置方式注入；默认凭据为 `mbos-admin / mbos-admin`。

2. `Workspace Entry`
- 面向普通业务用户与 workspace 管理员。
- 唯一目标是选择 workspace 或直接进入 workspace URL，再完成该 workspace 的登录。

3. `Usage`
- 面向普通用户。
- 唯一目标是查看自己在各资源上的当前用量与限制消耗程度。

4. `Audit`
- 面向管理员。
- 唯一目标是查看资源、配置、状态与异常事件的记录，并完成审查、追溯与治理判断。

补充约束：

1. `Usage + Audit` 是项目业务面的治理主线，不等于整个系统只有这两个入口。
2. 任何原本归入 `Runtime` 的用户可见能力，如仍然必要，必须并入 `Audit`。
3. 系统超级管理员入口必须与 workspace 业务入口分离。
4. workspace overview 不得继续作为无真实后台支撑的指标大盘。

## 3. 当前 MVP 最小产品对象模型（唯一）

1. `Resource`
- 当前 MVP 中主要指 project scope 下的 endpoint 资源。

2. `UsageRecord`
- 用户在资源上的时间窗口用量事实。

3. `LimitRecord`
- 用户在资源上的 rate / spending 限制事实。

4. `ConfigurationChange`
- 管理员或系统对资源配置产生的变更记录。

5. `SystemEvent`
- 资源状态变化、异常、失败、恢复、限流、限额等关键事件。

禁止在前端产品建模层继续扩张以下对象为一等概念：

- `guardrails`
- `probe`
- `alias`
- `combo`
- `routing`
- `activation`

这些如仍存在，只能作为实现细节，不得继续主导页面结构、导航、文案与用户心智。

系统级对象补充：

1. `SystemAdmin`
2. `Workspace`
3. `WorkspaceAdmin`
4. `ProjectAdmin`
5. `IdentityProviderConfig`
6. `WorkspaceDataConfig`

身份边界补充：

1. Authn 由 workspace 绑定的 IdP 提供；当前只支持 Keycloak。
2. Authz 由 AgentSmith 执行。
3. workspace 成员不在 AgentSmith 内独立管理；workspace IdP 中的用户视为合法认证用户。
4. workspace 管理员只负责 workspace 下 project 创建与 project 管理员分配。
5. workspace 生命周期与底层租户配置只归系统超级管理员管理。
6. 只有系统超级管理员可以查看 workspace 级系统信息、依赖服务 URL 与租户隔离结果。
7. 当前 MVP 中，`ProjectAdmin` 在 project scope 内与 `owner` 共享同一组治理入口与 `project:manage` 权限。
8. 这种等价只存在于 project scope，不外溢到 workspace 或 system scope。

## 4. 必读文档（必须）

1. [项目宪法](./项目宪法.md)
2. [产品研发与治理方法论](./design/agentsmith-product-engineering-governance-methodology-v1.md)
3. [Usage / Audit MVP 职责边界](./UXUI/01-通用规范/usage-audit-职责边界-v1.md)
4. [Usage / Audit MVP 功能与 UX 定义](./UXUI/01-通用规范/usage-audit-mvp-功能与uxui-v1.md)
5. [System / Workspace Identity & Entry MVP](./UXUI/01-通用规范/system-workspace-identity-entry-mvp-v1.md)
6. [Contracts Index](./contracts/README.md)
7. [User Guides Index](./user-guides/README.md)
8. [Troubleshooting Guide](./troubleshooting-guide-v1.md)

## 5. 设计与交互规范（必须遵循）

1. `docs/UXUI/00-设计系统/*`
2. `docs/UXUI/01-通用规范/*`
3. `docs/UXUI/02-组件规格/*`
4. `docs/UXUI/2026-02-05-前端-testid-规范.md`

## 6. 合同与接口规范（实施依据）

1. `docs/contracts/README.md` 中列出的现行合同
2. `docs/contracts/specs/openapi.yaml`
3. `docs/contracts/specs/asyncapi.yaml`

## 7. 运行操作文档（按需）

1. [Agent Codex Notebook Runbook](./agent-codex-notebook-runbook.md)
2. [CI Integration Troubleshooting](./ci-integration-troubleshooting.md)

## 8. 执行规则

1. 白名单之外文档不作为需求与评审依据。
2. 若需新增治理维度，先改宪法与合同，再做代码。
3. 文档冲突时：宪法 > 合同 > UXUI 规范 > 用户指南。
