# AGENTS.md

Guidance for coding agents working with AgentSmith (MBOS enterprise control plane frontend).

## Project Overview

AgentSmith = MBOS 企业级控制面前端。**当前职责**: AI 智能体使用与管理、项目级 AI 资源治理与审计。

**Stack**: Next.js 15 + TypeScript 5.9 + TailwindCSS + Radix UI + Zustand + React Query + next-intl

**workspace**: `/home/percy/works/mbos-v1/agentsmith`

## 项目宪法（必读）

> 宪法只规定思想与方法论；当前实现与体验真相看 `DEVELOPMENT.md`、`DESIGN.md`、`docs/contracts/`、`docs/UXUI/`。

**定位**: 企业级控制面，非 ToC 产品，非低代码平台。**后端为唯一权威**。

**范围**: 认证/身份、工作区、项目、Chat、Notebook、Files、Agents、Endpoints、资源策略、成员、凭据、审计与用量、设置。

**非范围**: 文件级策略、Chat/Notebook 独立配额、角色名鉴权、性能压测、E2E 覆盖后端鉴权。

**设计原则**: (1) Token 唯一做门禁 (2) URL 为真相源 (3) 设计系统唯一来源 (4) 安全校验不可省。

**禁止**: 角色名做门禁、未定义权限点、参数不做校验、设计系统外样式、生产代码用 `any`、文案不纳入国际化、未过门禁检查合并路由。

## 治理方法论（必读）

> 核心思想：先定义对象和运行时真相，再用合约、证据、门禁、治理控制把系统收成可运营、可发布、可追责的产品。

**六层架构**: Product Model → Runtime Truth → Contract First → Evidence Driven Delivery → Governance by Control Plane → Operational Closure

**工程原则**: Contract First、分层收敛复杂度、拒绝补丁式修复、证据作为一等产物。

**测试原则**: 分层验证（type/contract → unit → integration → e2e → visual → backend-real smoke），mock/backend-real 分离，验收必须有工程检查门禁（engineering gate）。

**治理原则**: 治理是控制面，统一策略引擎，例外必须被治理，Incident 是治理主键，Ownership/SLA 是闭环。

## UI 设计真相（必读）

- [`DESIGN.md`](./DESIGN.md) 是当前唯一 UI 宪法与设计语言真相。
- `docs/UXUI/` 只保留 active 的交互规范、状态/文案规范和模块边界补充；它们**依赖** `DESIGN.md`，不再定义平行视觉真相。
- 当页面注释、旧设计文档与 `DESIGN.md` 冲突时，以 `DESIGN.md` 为准。

## 术语收敛

**优先表述**: `system 管理侧`、`用户访问入口`、`工作区发布状态`、`工作区是否可访问`、`后端基础初始化`

**避免滥用术语**: `control plane`、`runtime`、`orchestrator`、`foundation` 等容易放大范围的词，除非是在说明代码实现细节。

**使用要求**: 必须使用工程术语时，先给出当前项目语境下的直白解释，避免把工程分层误写成产品范围扩张。

**补充约定**:
- 不用 `registry` 作为泛化术语；优先说 `工作区配置记录`、`system 管理侧保存的工作区清单`、`历史工作区配置数据`
- 身份模型默认使用 `Email 选人，ID 落库`：界面主识别是 email，系统内部唯一主键是 `user_id = Keycloak sub`

## 常用命令

```bash
npm run dev / build / start / lint / test / test:e2e / test:integration
npm run contracts:check / contracts:check-openapi / openapi:check-generated
make bootstrap / api-dev / web / e2e / deps-down / deps-reset
```

## 架构要点

**路由**: App Router + next-intl, `[locale]/workspaces/[workspace]/projects/[project]/(shell)/`（URL 为真相源）
**状态**: Zustand (`authStore`) + React Query，API 双客户端模式（fetch/msw adapter）
**组件**: compound components + context, co-located，父级拉数与门禁，子级消费
**类型**: `lib/api/types/`（API 合约），`lib/types/`（前端专用）

## 设计实现约束

**tokens**: 当前实现 token 在 `src/app/globals.css`，新增或重构 UI 时必须同时满足 `DESIGN.md` 的原则与当前 token 约束。
**约束**: 主行动色仅用于链接/高亮，AI 渐变仅用于 AI 标识，阴影仅用于浮层，新样式必须优先复用现有 token 和组件变体。

## i18n

**library**: next-intl
**locales**: en-US, zh-CN
**keys**: snake_case
**namespaces**: common, nav, auth, workspace, project, sources, members, studio, chat, audit, usage, overview, agents, endpoints, settings, errors

## 环境配置

- `NEXT_PUBLIC_API_BASE=http://localhost:20000/api/v1`
- `NEXT_PUBLIC_USE_MSW=true`（开发）
- `NEXT_PUBLIC_KEYCLOAK_*`（生产）

## 核心文档

- `docs/项目宪法.md` - 产品定位、范围边界、治理主线
- `DESIGN.md` - 当前唯一 UI 宪法与设计语言真相
- `docs/design/agentsmith-product-engineering-governance-methodology-v1.md` - 治理方法论
- `DEVELOPMENT.md` - 开发工作流与本地操作说明
- `docs/contracts/` - 合约与接口规范
- `docs/user-guides/` - 用户操作与排障入口
- `docs/UXUI/` - 依赖 `DESIGN.md` 的 UX/UI 交互规范库

## 测试

**unit**: Vitest, jsdom, `**/__tests__/**/*.test.*`
**e2e**: Playwright, projects: smoke / chromium / visual, fixtures: `e2e/fixtures/test-base.ts`
**执行**: 不让 Playwright 管理服务启动，手动启动后用 `BASE_URL` 运行，清理代理环境变量，UI 变更需跑 visual e2e

**skill runtime gate**:
- 改 builtin skills、runner skill env、Context Store route/store、managed credential resolution 时，至少跑 `npm run test:skills:fast`
- 改 chat/notebook/terminal execution context、agent ticket scope、Context Store ownership 时，再加跑 `npm run test:skills:backend-real`
- `test:skills:*` 覆盖的是 builtin skills + runner runtime + Context Store 主链，不替代共享 context UI、治理、files 等业务 gate
- notebook runner 主链可直接用 `npm run test:notebook:runner:fast` / `npm run test:notebook:runner:backend-real`
- chat runner 主链可直接用 `npm run test:chat:runner:fast` / `npm run test:chat:runner:backend-real`

## 测试 ID 规范

**format**: `scope__element__state`（例如 `login__submit`, `projects__create-button`）
**规则**: 稳定、唯一、双下划线分隔

## 安全

**类型**: 生产代码禁 `any`，使用类型守卫
**认证**: SSE token 暴露风险，TODO: ticket-based auth
**内容**: Markdown 图片仅渲染可信域
**bundle**: 生产禁用 MSW（`NEXT_PUBLIC_USE_MSW=false`）

## 架构模式

**Permission Gate**: 禁止 hook 短路（`useHasPermission('a') || useHasPermission('b')` ❌，分开调用后组合 ✅）
**Auth Sync**: authStore 自动同步 token 到 API client
**URL Validation**: 参数必须用 `validateWorkspaceParam()` / `validateProjectParam()` 校验

## 开发工作流

**Route Gate**: 合并前 `npm run contracts:check` + `contracts:check-openapi` + `openapi:check-generated`
**提交前**: `npm test` + `npm run lint` + `npx tsc --noEmit`
**错误处理**: `useApiError` + ErrorBoundary

## 常见问题 & 开发注意

**SSE**: 检查 console EventSource, 验证 token
**测试失败**: 检查 mock, 验证 test ID, 用 `waitFor`
**注意**: Turbopack 快速启动, MSW 快速登录, Storybook 组件开发, 优先编辑现有文件, 发布前移除过时 payload paths

## Runner Home 约定

当你是在 AgentSmith notebook / terminal runner 的 task workspace 里工作时，必须遵守以下运行时约定：

- `HOME == cwd`，当前工作目录就是 task 的持久 home。
- 动态配置、缓存、安装产物、用户态工具链、认证文件都必须写在当前 home 下，不能写到 `/etc`、`/usr/local`、`/opt`、`/var/tmp` 等系统级目录。
- builtin skills 的运行时可见路径是 `~/.agents/skills`。
- AgentSmith 的成员/任务级上下文、简单 credentials、共享说明通过 `mbos-context` builtin skill 和 AgentSmith Context Store 获取，不应假设它们存在于 workspace 文件树中。
- Context Store 的正式 scopes 是 `member / task / project / workspace`：`member` 表示当前 workspace 内成员私有上下文，`task` 表示当前成员拥有的任务上下文，`project/workspace` 表示共享上下文。
- 复杂 OAuth 凭据（例如 Feishu）通过只读 context 视图暴露，例如 `managed_credentials.feishu`；不要尝试在 workspace 中查找或持久化这类凭据文件。
- skill runtime 的正式主链覆盖 chat / notebook / terminal 三条执行路径；如果改动影响 skill env、ticket scope 或 Context Store 路由，必须把对应 `test:skills:*` gate 一起更新或回归验证。
- Codex 运行时状态位于 `~/.codex`；runner 自己的 task 元数据位于 `~/.mbos`；用户可见输出放在 `~/.artifacts`。
- 如果需要安装 Python / Node / Rust 环境或库，只能使用 user 模式并安装到 home 下：
  - Python: `python3 -m pip install --user ...`
  - Node: 使用 user prefix，例如 `npm_config_prefix=$HOME/.local`
  - Rust: 使用 `CARGO_HOME=$HOME/.cargo`、`RUSTUP_HOME=$HOME/.rustup`
