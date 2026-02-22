# AgentSmith - Development Guide

## Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run Storybook
npm run storybook

# Build for production
npm run build
npm start
```

## Manual Runbook (Makefile)

推荐直接用 `make`，少记环境变量。

```bash
# 1) 一键准备依赖（启动 + 健康检查 + PG 初始化）
make bootstrap

# 2) 启动 API（新终端）
make api-dev

# 3) 启动前端（新终端）
make web

# 4) 打开地址与测试账号
make urls
```

常用命令：

```bash
make help          # 查看所有命令
make deps-init     # 只执行 postgres schema 初始化（含 pgvector）
make api-dev-min   # 仅 keycloak + minio 的最小 API 启动
make web-msw       # 前端 mock 模式
make e2e                # mock e2e (MSW)
make e2e-int-minimal    # 最小集成测试
make e2e-int-chat       # chat 集成测试
make e2e-int-chat-auto  # 自动启动依赖+API+前端后执行 chat 集成测试
make e2e-int-chat-ux-auto # 自动启动并执行 chat UX 关键集成用例
make agent-test-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-runtime/ws?agent_id=ag_xxx' AGENT_KEY='ask_xxx' # 启动外部 agent 测试进程
make deps-down     # 关闭依赖
make deps-reset    # 关闭并清空依赖数据卷
make openapi-generate # 基于 OpenAPI contract 生成前端类型
make openapi-check-generated # 校验 generated types 是否需要更新
make openapi-changelog # 生成 OpenAPI 相对 origin/main 的变更摘要
make contracts-check-openapi # 检查 OpenAPI 核心覆盖与破坏性变更
```

说明：`*-auto` 目标会自动清理代理环境变量（`http_proxy/https_proxy/all_proxy` 等）后再启动服务和执行 Playwright。

## Environment Setup

Copy `.env.local.example` to `.env.local` and configure:

```bash
# For local development with backend
NEXT_PUBLIC_API_BASE=http://localhost:20000
NEXT_PUBLIC_USE_MSW=false
NEXT_PUBLIC_BYPASS_AUTH=false

# For local development with Keycloak
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:18080/realms
NEXT_PUBLIC_KEYCLOAK_REALM=mbos
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=agentsmith
```

## Project Structure

```
src/
├── app/                 # Next.js App Router pages
│   ├── [locale]/        # i18n routed pages
│   ├── app-shell/      # App shell preview
│   └── login/          # Login page (not routed)
├── components/          # React components
│   ├── app-shell/      # App shell components (Topbar, Sidebar)
│   ├── ui/              # shadcn/ui components
│   └── ...
├── lib/                 # Utilities and libraries
│   ├── api/             # API client with adapter pattern
│   ├── hooks/           # Custom React hooks
│   ├── stores/          # Zustand state
│   ├── i18n/            # i18n configuration
│   └── utils/           # Utility functions
├── messages/            # i18n message files
├── mocks/               # MSW mock handlers
└── stories/             # Storybook stories
```

## Design System Reference

See [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) for the design system index. All UI designs must follow the in-repo [视觉设计系统](./docs/UXUI/00-设计系统/视觉设计系统-v1.md).

## API Architecture

The frontend uses an adapter pattern for easy switching between MSW mocks and real backend:

- `lib/api/client.ts` - API client interface
- `lib/api/adapters/fetch-adapter.ts` - Real API implementation
- `lib/api/adapters/msw-adapter.ts` - MSW mock implementation

Switch via `NEXT_PUBLIC_USE_MSW` environment variable.

## Authentication Flow

### Development (MSW)
1. Enable `NEXT_PUBLIC_USE_MSW=true`
2. Use Quick Login on login page
3. Auth state is mocked and persisted locally

### Backend Mode (Keycloak)
1. User clicks "Login with Keycloak"
2. Frontend uses OIDC Authorization Code + PKCE
3. Keycloak redirects to `/[locale]/login/callback`
4. Callback exchanges code for token, loads user info, stores token in auth store
5. API requests include Bearer token

## State Management

- **Zustand** for global state
- **Auth Store** (`lib/stores/authStore.ts`) - Authentication state, workspace/project context
- LocalStorage persistence for auth state

## Component Development

1. Create component in `src/components/`
2. Add corresponding story in `src/stories/`
3. Review in Storybook (`npm run storybook`)
4. Update this guide with component details

## Route Gate Check (Required)

Before merging any new or changed route files, run:

```bash
npm run contracts:check
```

This check enforces route guard quality gates:

1. valid permission names only
2. route param validation presence
3. `__tests__/page.test.tsx` existence
4. invalid-param test coverage
5. forbidden/permission-denied test coverage for permission-gated routes

Current scope:

1. `src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/**/page.tsx`
2. `src/app/[locale]/workspaces/[workspace]/projects/page.tsx`

CI runs the same command and fails the pipeline on missing coverage.

Before release: ensure `npm run contracts:check`, `npm run contracts:check-openapi`, and `npm run openapi:check-generated` all pass on main.

## API 合约与文档入口

后端提供统一文档入口：

- `http://localhost:20000/docs`：Scalar API Reference（HTTP API）
- `http://localhost:20000/docs/asyncapi`：AsyncAPI 可视化页面（Agent Runtime WS）
- `http://localhost:20000/api/v1/openapi.json`：OpenAPI JSON
- `http://localhost:20000/api/v1/asyncapi.json`：AsyncAPI JSON（Agent Runtime WS）

本地治理命令：

```bash
npm run contracts:check-openapi
npm run openapi:generate
npm run openapi:check-generated
npm run openapi:changelog
```

## Playwright E2E Runbook (Recommended)

Use this runbook when E2E is unstable or intermittently timing out.

Notes:
- By default, Playwright manages its own `next dev` web server (port `3001`) with MSW enabled.
- If you set `BASE_URL=...`, Playwright will not start a server. In that mode you must start the dev server yourself.

### 1) Start dev server in a persistent terminal

```bash
npm run dev:test -- --port 3001
```

### 2) Run Playwright with explicit base URL

```bash
BASE_URL=http://localhost:3001 npm run test:e2e -- --project=smoke
```

This bypasses Playwright-managed `webServer` and is more stable in long sessions.
Make sure the dev server is started with MSW enabled:

```bash
NEXT_PUBLIC_USE_MSW=true npm run dev:test -- --port 3001
```

## E2E Modes (Recommended)

We keep two E2E modes with distinct responsibilities:

1) Mock E2E (default)

- Uses MSW fixtures as the source of truth.
- Runs fast and is used for frontend regression testing.

```bash
npm run test:e2e -- --project=chromium
```

2) Integration E2E

- Uses a real backend (Keycloak + API).
- Only runs `e2e/integration-*.spec.ts`.

```bash
npm run test:e2e:integration:minimal
npm run test:e2e:integration:chat
npm run test:e2e:integration:agents
```

### 3) Use route-targeted smoke for fast triage

```bash
BASE_URL=http://localhost:3001 npx playwright test --project=smoke e2e/smoke.spec.ts \
  --grep "loads /zh-CN/workspaces/ws_default/projects/proj_001/agents$" \
  --workers=1 --max-failures=1
```

### Minimal integration E2E

Run dependencies and API first, then:

```bash
BASE_URL=http://localhost:3001 npm run test:e2e:integration:minimal
```

Makefile shortcuts:

```bash
make e2e
make e2e-int-minimal
make e2e-int-chat
make e2e-int-agent
make e2e-int-minimal-local-api
make e2e-int-chat-local-api
make e2e-int-agent-local-api
```

### 4) Distinguish infra failure from app failure

If `page.goto` hangs, first check server health:

```bash
curl -I --max-time 15 http://localhost:3001/
curl -I --max-time 15 http://localhost:3001/zh-CN/workspaces/ws_default/projects
```

If curl times out, restart dev server before debugging selectors/assertions.

### 5) Inspect Playwright error context first

When tests fail, inspect:

- `test-results/**/error-context.md`
- `test-results/**/test-failed-1.png`

This is usually faster than changing selectors blindly.

## Manual UAT Runbook (MVP Freeze)

When business logic changes are large, run this manual flow once before freeze:

1. Login and select workspace.
2. Open projects list, enter a project, verify no unexpected permission denial.
3. Verify project shell navigation and topbar switchers remain stable.
4. Validate members governance flow:
   - invite member
   - create/apply template
   - create/delete group
5. Validate resource management:
   - endpoints create/edit/toggle/delete
   - sources upload/manage libraries
   - agents create/edit/toggle and key management
6. Validate resource policy:
   - edit default/resource/subject rules
   - save and confirm effective summary update
7. Validate audit/usage filters and table rendering.
8. Validate settings save and delete-project confirmation flow.

For step-by-step details and freeze-ready gate, see:
- `docs/verification-summary.md`

## Permission Gate Hook Rule (Important)

Never short-circuit React hooks in permission guards.

Do not write:

```tsx
const canRead = useHasPermission('x') || useHasPermission('y');
```

Write:

```tsx
const canX = useHasPermission('x');
const canY = useHasPermission('y');
const canRead = canX || canY;
```

Reason: short-circuiting can change hook call order across renders and cause runtime crashes (`Rendered more hooks than during the previous render` / `Cannot read properties of undefined (reading 'length')`).

## Troubleshooting

### Project list click/permission anomalies in MSW mode

If project rows are visible but clicking into a project leads to immediate permission denial,
or project settings actions appear non-responsive, verify fixture identity consistency first:

1. `src/mocks/fixtures/p0.json` auth user id
2. `src/mocks/fixtures/projects.ts` `CURRENT_USER_ID`
3. project membership `user_id` values used by `src/mocks/handlers/projects.ts`

These ids must match, otherwise project membership permissions are resolved as empty arrays.

Permission gate model (MVP) is token-first:
- Project list visibility checks `workspace:read` and data membership presence.
- Do not require `project:read` as a workspace-level permission token.
- Project internal routes use project membership permission tokens.

Pinned project state is persisted in localStorage key:
`mbos:projects:pinned:<workspaceId>`.
If pin state does not survive refresh, inspect browser localStorage and workspace id resolution.

## Visual Baselines (Best Practice)

For reliable full-page screenshots, run visual tests against a production build
and keep dev indicators disabled in local dev. This avoids dev overlays and the
Next.js dev tools badge appearing in screenshots.

**Recommended (production visuals):**
```bash
npm run build
npm run start
BASE_URL=http://localhost:3000 npx playwright test --project=visual --update-snapshots
```

**Dev visuals (when you must run `next dev`):**
```bash
npm run dev
BASE_URL=http://localhost:3001 npx playwright test --project=visual --update-snapshots
```

If `next build` is blocked by existing lint warnings in test files, you can
temporarily disable lint during the visual build only:
```bash
NEXT_DISABLE_ESLINT=1 npm run build
npm run start
BASE_URL=http://localhost:3000 npx playwright test --project=visual --update-snapshots
```

**Restore default dev indicators:**
- In `next.config.ts`, remove `devIndicators: false` or set it to `true`.
- In `src/app/globals.css`, remove the `nextjs-portal { display: none; }` rule.
- Ensure `NEXT_DISABLE_ESLINT` is unset for normal production builds.

Visual tests will still work in `next dev`, but overlays may appear unless
dev indicators are disabled.

### Test Failures

#### "QueryClientProvider not found"
**Problem**: Tests fail with "QueryClientProvider not found"
**Solution**: Wrap test render with QueryClientProvider:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();
render(
  <QueryClientProvider client={queryClient}>
    <YourComponent />
  </QueryClientProvider>
);
```

#### "next/navigation mock not found"
**Problem**: Tests fail with navigation errors
**Solution**: Mock next/navigation in test setup:
```tsx
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
```

### SSE Connection Issues

#### EventSource fails to connect
**Problem**: SSE connection fails immediately
**Solution**:
1. Check `NEXT_PUBLIC_API_BASE` environment variable
2. Verify backend is running and accessible
3. Check browser network tab for CORS errors
4. See `src/lib/api/sse-client.ts` for documented security limitations

#### Token expires during SSE stream
**Problem**: SSE connection drops after some time
**Solution**: Token refresh is not automatic. Currently requires page refresh.
TODO: Implement auto-reconnection with token refresh (see Phase 2, Task 2.1)

### Build Issues

#### MSW appearing in production bundle
**Problem**: `grep -r "msw" .next/` finds MSW references
**Solution**: This is a known issue if MSW is statically imported.
The fix (Phase 2, Task 2.3) uses dynamic imports to exclude MSW from production.

#### Type errors after refactoring
**Problem**: TypeScript errors after changes
**Solution**:
1. Run `npx tsc --noEmit` to see all errors
2. Check for missing type imports
3. Ensure `any` types are avoided - use proper type guards

### Next.js Build Errors

```bash
# Clear Next.js cache
rm -rf .next

# Clear Node modules
rm -rf node_modules
npm install
```

### MSW Issues

```bash
# Ensure MSW is initialized
# Check src/mocks/browser.ts is imported in your app
```

### Type Errors

```bash
# Regenerate types
npx tsc --noEmit
```

## Notebook Codex v1 Known Risks

- `R1` Token forwarding to external agent runner
  - Notebook codex runs may forward user bearer token to the external runner so it can call endpoint proxy with user-scoped auth/audit controls.
  - Do not print token in logs and do not persist token on disk.
  - Prefer short-lived sessions and rotate identity tokens by standard auth policy.

- `R3` Directory-only workspace isolation
  - Runner workdir is `/tmp/<username>/<task_id>` in v1.
  - No auto-cleanup and no sandbox/container isolation in v1.
  - Add periodic cleanup in ops (example: delete task dirs older than 14 days) and monitor `/tmp` disk usage.
