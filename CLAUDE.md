# CLAUDE.md

Guidance for Claude Code when working with AgentSmith ( MBOS enterprise control plane frontend.

## Project Overview

AgentSmith = MBOS 企业级控制面前端。**当前职责**: AI 智能体使用与管理、项目级 AI 资源治理与审计。

**Stack**: Next.js 15 + TypeScript 5.9 + TailwindCSS + Radix UI + Zustand + React Query + next-intl

 **workspace**: `/home/percy/works/mbos-v1/agentsmith`

## 项目宪法（必读)

> 宪法只规定思想与方法论，具体实现见 DEVELOPMENT.md 和 `docs/contracts/`, `docs/UXUI/`

**定位**: 企业级控制面，非 ToC 产品，非低代码平台。 **后端为唯一权威**。

**范围**: 认证/身份, 工作区, 项目, Chat, Notebook, Files, Agents, Endpoints, 资源策略, 成员, 凭据, 审计与用量, Runtime Console, 设置.

**非范围**: 文件级策略, Chat/Notebook 独立配额, 角色名鉴权, 性能压测, E2E 覆盖后端鉴权.

**设计原则**: (1) Token 唯一做门禁 (2) URL 为真相源 (3) 设计系统唯一来源 (4) 安全校验不可省.

**禁止**: 角色名做门禁, 未定义权限点, 参数不做校验, 设计系统外样式, 生产代码用 any, 文案不纳入国际化, 未过门禁检查合并路由.

## 治理方法论(必读)

> 核心思想: 先定义对象和运行时真相， 再用合约、证据、门禁、治理控制把系统收成可运营、可发布、可追责的产品.

**六层架构**: Product Model → Runtime Truth → Contract First → Evidence Driven Delivery → Governance by Control Plane → Operational Closure

**工程原则**: Contract First, 分层收敛复杂度, 拒绝补丁式修复, 证据作为一等产物.

**测试原则**: 分层验证 (type/contract → unit → integration → e2e → visual → real-lane smoke), mock/real lane 分离, 验收必须有工程检查门禁（engineering gate）.

**治理原则**: 治理是控制面, 统一策略引擎, 例外必须被治理, Incident 是治理主键, Ownership/SLA 是闭环.

## 常用命令

```bash
npm run dev / build / start / lint / test / test:e2e / test:integration
npm run contracts:check / contracts:check-openapi / openapi:check-generated
make bootstrap / api-dev / web / e2e / deps-down
 deps-reset
```

## 架构要点

**路由**: App Router + next-intl, `[locale]/workspaces/[workspace]/projects/[project]/(shell)/` (URL 为真相源)
**状态**: Zustand (authStore) + React Query, API 双客户端模式 (fetch/msw adapter)
**组件**: compound components + context, co-located, 父级拉数与门禁, 子级消费
**类型**: `lib/api/types/` (API 合约), `lib/types/` (前端专用)

## 设计系统
**tokens** (globals.css RGB): `--bg-*`, `--text-*`, `--accent`, `--success`, `--error`, `--border*`
**约束**: 主行动色仅用于链接/高亮, AI 渐变仅用于 AI 标识, 阴影仅用于浮层, 间距基: 4px, 侧边栏: 260px

## i18n
**library**: next-intl, **locales**: en-US, zh-CN, **keys**: snake_case, **namespaces**: common, nav, auth, workspace, project, sources, members, studio, chat, audit, usage, overview, agents, endpoints, settings, errors

## 环境配置
- `NEXT_PUBLIC_API_BASE=http://localhost:20000`
- `NEXT_PUBLIC_USE_MSW=true` (开发)
- `NEXT_PUBLIC_KEYCLOAK_*` (生产)

## 核心文档
- `docs/项目宪法.md` - 产品定位、范围边界、设计原则
- `docs/design/agentsmith-product-engineering-governance-methodology-v1.md` - 治理方法论
- `DEVELOPMENT.md` / `DESIGN_SYSTEM.md` - 开发与设计系统
- `docs/contracts/` - 合约与接口规范
- `docs/user-guides/` - 用户操作与排障入口
- `docs/UXUI/` - UX/UI 规范

## 测试
**unit**: Vitest, jsdom, 40% coverage, `**/__tests__/**/*.test.*`
**e2e**: Playwright, projects: smoke (26), chromium (146), visual (29), fixtures: `e2e/fixtures/test-base.ts`
**执行**: 不让 Playwright 管理服务启动, 手动启动后用 `BASE_URL` 运行, 清理代理环境变量, UI 变更需跑 visual e2e

## 测试 ID 规范
**format**: `scope__element__state` (e.g., `login__submit`, `projects__create-button`)
**规则**: 稳定, 唯一, 双下划线分隔

## 安全
**类型**: 生产代码禁 any, 使用类型守卫 `**认证**: SSE token 暴露风险, TODO: ticket-based auth
**内容**: Markdown 图片仅渲染可信域
**bundle**: 生产禁用 MSW (`NEXT_PUBLIC_USE_MSW=false`)

## 架构模式
**Permission Gate**: 禁止 hook 短路 (`useHasPermission('a') || useHasPermission('b')` ❌, 分开调用后组合 ✅)
**Auth Sync**: authStore 自动同步 token 到 API client
**URL Validation**: 参数必须用 `validateWorkspaceParam()` / `validateProjectParam()` 校验

## 开发工作流
**Route Gate**: 合并前 `npm run contracts:check` + `contracts:check-openapi` + `openapi:check-generated`
**提交前**: `npm test` + `npm run lint` + `npx tsc --noEmit`
**错误处理**: `useApiError` + ErrorBoundary

## 常见问题 & 开发注意
**SSE**: 检查 console EventSource, 验证 token | **测试失败**: 检查 mock, 验证 test ID, 用 waitFor
**注意**: Turbopack 快速启动, MSW 快速登录, Storybook 组件开发, 优先编辑现有文件, 发布前移除过时 payload paths
