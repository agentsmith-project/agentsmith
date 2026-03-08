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

Before merge/engineering acceptance: ensure `npm run contracts:check`, `npm run contracts:check-openapi`, and `npm run openapi:check-generated` all pass on main.

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

## Notebook External Agent + Execution Trace UI Workstream (Process Record, 2026-02)

This section records the recent notebook external-agent workline (Codex runner + trace UI + production hardening), its current state, and the next-stage plan.

### Internal Release Scope Clarification (Product Governance Pages)

The current internal baseline no longer treats `Members` and `Resource Policy` as page-only or mock-backed governance surfaces. In local real-backend mode:

- `Audit` and `Usage` are fully backed by persisted `api-entry-node` routes
- `Members` supports real lifecycle effects (`suspend / restore / revoke`) and downstream cleanup
- `Resource Policy` supports real allow-list / rate / limit effects on the currently supported resource paths
- project route authorization is driven by the shared backend authz engine and explainable `/authorize` decisions

The important constraint is no longer "partial page support", but **scoped enforcement coverage**. For exact supported effects and current boundaries, use the current baseline and MVP smoke runbook as sources of truth.

See also:
- `docs/CURRENT_BASELINE.md`
- `docs/user-guides/mvp-core-smoke-runbook.md`

### Scope (What this workline covered)

- Notebook task execution via external agent runtime (`agent-codex-runner`, Codex script mode)
- Endpoint proxy compatibility for OpenAI Responses -> chat/completions fallback and streaming translation
- Notebook message bubble execution details UI (expandable trace panel)
- Trace storage/query/replay path (`trace_event` SSE + `/tasks/:taskId/traces`)
- Production-readiness for notebook runtime:
  - persistence (docStore-backed)
  - retention/payload limits
  - metrics/monitoring
  - load testing and benchmark tooling

### Delivered (Functional)

#### 1) External Agent Notebook Pipeline
- End-to-end notebook external-agent flow works with real backend + external Codex runner.
- Runner creates per-task workdir under `/tmp/<username>/<task_id>`.
- Runner supports Codex yolo mode and trusted current workdir/no-git project mode.
- Notebook task no longer auto-closes after a single external-agent turn (multi-turn behavior fixed).

Primary files (implemented across this workline):
- `packages/agent-codex-runner/src/index.ts`
- `packages/api-entry-node/src/task-route-handler.ts`
- `packages/api-entry-node/src/agent-runtime-service.ts`

#### 2) Execution Trace UI (Notebook Message Bubble)
- Agent message bubbles support expandable execution details (default collapsed).
- Views:
  - `Timeline`
  - `Raw` (Codex CLI-oriented fidelity)
- Features:
  - local filter (`All / Progress / Tool / Alerts / Debug`)
  - stats header (count/duration/warnings/errors/truncated hint)
  - copy trace logs
  - lazy-load trace per message (`message_id`)
  - "Load earlier logs" pagination (`before_id`)
- Frontend debug support:
  - notebook SSE debug panel (development only)
  - reconnect gap-fill debug events

Primary files:
- `src/components/notebook/TaskPage.tsx`
- `src/components/notebook/MessageItem.tsx`
- `src/lib/hooks/use-task-sse.ts`
- `src/lib/api/endpoints/tasks.ts`

#### 3) Trace Transport / Contracts
- Runtime protocol extended with `agent.response.event`.
- Notebook task SSE extended with `trace_event`.
- `/tasks/:taskId/traces` query endpoint added and evolved:
  - filters: `message_id`, `run_id`, `after_id`, `before_id`, `page_size`
  - returns pagination metadata (`has_more`, `next_after_id`)
- Task SSE replay support:
  - `last_event_id` replay for task events (buffered history)

### Delivered (Production Hardening / Operability)

#### 4) Persistence
- Notebook task data (tasks/messages/artifacts/traces) supports docStore-backed persistence in `api-entry-node`.
- Trace storage is write-through to docStore with in-memory cache/read-through behavior.
- In memory-only mode, behavior remains process-local and ephemeral (documented).

#### 5) Retention / Payload Limits
- Trace event count retention limit per task (`NOTEBOOK_TRACE_MAX_EVENTS`)
- Trace details payload size limit (`NOTEBOOK_TRACE_DETAILS_MAX_BYTES`)
- Truncation markers and truncation accounting metrics added
- Retention truncation is consistent with persisted trace records (docStore deletion on trim)

#### 6) Monitoring / Metrics
- Internal metrics JSON endpoint (auth required):
  - `/api/v1/internal/notebook-runtime-metrics`
- Prometheus text export endpoint (auth required):
  - `/api/v1/internal/notebook-runtime-metrics/prometheus`
- Metrics include:
  - task run lifecycle counters
  - active runs / SSE clients
  - trace recorded / truncated / details truncated
  - `/traces` query counters + latency histogram by scope (`task/message/run/message_run`)

#### 7) Load Testing / Benchmarks / Baselines
Added tooling and Make targets for:
- smoke: `make notebook-agent-smoke-task`, `make notebook-agent-smoke-full`
- monitoring: `make notebook-agent-monitor`
- load test: `make notebook-agent-load-test`
- load matrix: `make notebook-agent-load-matrix`
- benchmark baseline: `make notebook-agent-benchmark-baseline`
- compare baselines: `make notebook-agent-benchmark-compare`
- message-scoped traces query benchmark: `make notebook-agent-traces-query-bench`
- page-size sweep for traces query: `make notebook-agent-traces-query-sweep`
- compare page-size sweeps: `make notebook-agent-traces-query-sweep-compare`
- benchmark result archive (repo-local artifacts metadata): `make notebook-agent-benchmark-archive`

### Delivered (Docs / Contracts / Specs)

- Runbook (authoritative operational workflow for this workline):
  - `docs/agent-codex-notebook-runbook.md`
- Runtime protocol contract:
  - `docs/contracts/agent-runtime-protocol.md`
- Notebook module/contract mapping docs updated:
  - `docs/contracts/notebook-frontend-module-map.md`
- Main generated specs updated to include notebook traces + runtime event coverage:
  - `docs/contracts/specs/openapi.yaml`
  - `docs/contracts/specs/openapi.json`
  - `docs/contracts/specs/asyncapi.yaml`
  - `docs/contracts/specs/asyncapi.json`
- Supplement specs retained as compatibility/reference snapshots where applicable and documented in:
  - `docs/contracts/README.md`

### Validation Summary (What was actually tested)

#### Real Chain (Repeatedly)
- API (`:20000`) + Web (`:3001`) + external `agent-codex-runner`
- real local Keycloak auth
- real GLM endpoint via endpoint proxy
- notebook smoke tasks complete successfully and return final responses (`chain ok`)

#### UI / Frontend
- unit tests for notebook trace panel interactions (expand/filter/raw/copy/stats/pagination)
- page-level Playwright coverage for notebook trace panel interactions (MSW/mock)

#### Backend / Runtime
- notebook runtime/API targeted tests:
  - `trace_event` handling
  - `/traces` paging and replay paths
  - retention + details truncation behavior
  - metrics / Prometheus export
  - persisted trace retention truncation consistency

#### Performance / Capacity (Initial Baselines)
- end-to-end load/matrix benchmarks (real Codex + GLM path)
- message-scoped `/traces?message_id=...` benchmarks (memory vs Mongo/docStore)
- page-size sweeps (`20/50/200/500`) and compare tooling
- observed result so far:
  - message-scoped `/traces` query remains low-ms and is not the current bottleneck

### Known Boundaries / Open Items (Not blockers for current stage)

1. Notebook runtime persistence relies on docStore backend for restart durability
- Memory mode remains ephemeral by design.

2. Benchmark variance is heavily influenced by upstream model/runtime
- End-to-end latency should be analyzed with multiple runs and compare tools.
- `/traces` query-specific benchmarks are the more stable signal for trace panel performance.

3. Prometheus alert thresholds are bootstrap values
- Should be tightened after collecting more production-like baseline data.

### Next-Stage Plan (High Value, Non-UI-Fine-Tuning)

#### A. Production Baselines / SLO Calibration
- Run and archive standard memory + Mongo baseline sets per engineering verification round.
- Use:
  - `notebook-agent-benchmark-baseline`
  - `notebook-agent-benchmark-compare`
  - `notebook-agent-traces-query-sweep`
  - `notebook-agent-traces-query-sweep-compare`
  - `notebook-agent-benchmark-archive`
- Calibrate Prometheus alert thresholds using observed p95/p99 and success rate.

#### B. Mongo / DocStore Performance Tuning
- Validate recommended indexes under larger real trace volumes.
- Re-run message-scoped traces query sweep after index changes and compare.

#### C. CI / Periodic Regression (Ops-Oriented)
- Add a lightweight scheduled or manual benchmark smoke:
  - `traces-query-bench` or a small sweep
- Persist result artifacts and compare against previous baseline.

#### D. Security Hardening (Tracked Risk Follow-up)
- Replace bearer forwarding to runner with short-lived ticket exchange (planned hardening item).
- Keep trace event payload sanitization coverage strong (tests + review).

### Where to Continue

If this workline is resumed later, start from:
1. `docs/agent-codex-notebook-runbook.md` (current operational truth)
2. benchmark/compare/archive scripts in `scripts/`
3. notebook trace runtime implementation in:
   - `packages/api-entry-node/src/task-route-handler.ts`
   - `packages/agent-codex-runner/src/index.ts`
   - `src/components/notebook/TaskPage.tsx`
   - `src/components/notebook/MessageItem.tsx`

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

For step-by-step details and engineering verification workflow, see:
- `docs/CURRENT_BASELINE.md`
- `docs/user-guides/mvp-core-smoke-runbook.md`

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
- Do not require `project:endpoint:use` as a workspace-level permission token.
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

## Notebook Codex v1 Follow-up (Inputs / Artifacts / Headless Workflow)

This follow-up extends the external notebook-agent runtime line toward a NotebookLM-like workflow:

- notebook task attached sources are injected to external runtime context as `task_inputs`
- runner writes task-local manifest: `<task_cwd>/.mbos/task-inputs.json`
- runner writes task-local `AGENTS.md` (headless rules, artifact dir rules, input helper guidance)
- runner installs task-local Codex skill:
  - `./.codex/skills/source-read/`
  - helper: `fetch_input.mjs` (downloads attached source files through AgentSmith API)
- runner uses per-task session continuity:
  - first turn `codex exec ...`
  - later turns in same task cwd `codex exec resume --last ...`
- runner scans `<task_cwd>/artifacts/` after Codex exit and emits:
  - `agent.response.artifact`
  - `agent.response.event(category=artifact)` for trace/debug fidelity
- backend persists notebook task artifacts and surfaces them via task artifact APIs / `Artifacts` panel

Real-chain validation completed:
- `resume --last` confirmed in runner debug argv
- task-local skill used by Codex to fetch attached source files into `./inputs/`
- artifact outputs in `./artifacts/` surfaced in notebook artifacts list

Current known boundary:
- runner-side artifact dedupe is process-local (in-memory fingerprint cache)
- after runner restart, the first artifact scan may re-report historical files already present in `artifacts/`
- functional correctness is preserved, but cross-runner-restart artifact idempotency is not yet enforced

## Unified InputRefs / Default Library Migration Notes (Chat + Notebook)

- Notebook task inputs have been migrated to `attached_inputs` and `/tasks/:taskId/inputs` with `InputRef`-style records (`source`, `library_object`).
- Notebook file picker now supports direct `library_object` refs (no source-only model requirement).
- Chat file attachments started migrating toward object-first flow:
  - local file uploads are first written into a deterministic default upload library (`My Uploads`) as library objects,
  - then converted into chat attachments via the existing chat attachment runtime path.
- Backend now enforces a system-managed default personal library (`system_managed_kind=default_personal_uploads`) with ensure route semantics and rename/delete protections.
- Notebook "Add URL" follows object-first flow while attaching a first-class `url` input ref (with imported object provenance).
- Notebook artifacts can now be attached back into task inputs as first-class `artifact` input refs (output-to-input loop).
- Notebook local file uploads also follow object-first flow (default personal library object + `library_object` input ref), removing the last raw local-upload -> `source` shortcut in notebook task inputs.
- Current architectural rule: `source` remains a derived/processed input type (AI-ready/indexed workflows), not the default raw-file ingestion path for Chat or Notebook.
- Backend `POST /projects/:projectId/sources` creation now requires `library_id` and is treated as object-backed source creation only.
- Chat message `inputs` and attachment provenance now support first-class `url` input refs (with optional imported object provenance), while runtime consumption still resolves through attachment snapshots.
- Chat composer now exposes a URL input entry in the UI and imports URLs object-first into the default personal library before attaching a `url` input ref.
- Backend input-resolution code is partially shared: chat input parsing/attachment resolution is centralized in `chat-input-refs.ts`, and notebook input detail/runtime mapping is centralized in `notebook-input-refs.ts`.
- Shared backend resolver layering is now in place:
  - `input-ref-resolver.ts` (ref keys / imported object extraction / dedupe helpers)
  - `input-ref-runtime-resolver.ts` (object/url/artifact runtime metadata resolution + fallback rules)
  - runtime-specific adapters build on top (`chat-input-refs.ts`, `notebook-input-refs.ts`)
- Chat `attachments/init` now normalizes `library_object` / `url` attachment metadata via the shared runtime metadata resolver (avoids handler-local drift in filename/type/size fallback rules).

## Governance Backend (Audit / Usage) — Product-Grade v1 (Internal)

- `api-entry-node` now persists real governance data for:
  - audit ledger (`project_audit_events`)
  - usage facts (`project_usage_facts`)
- `/api/v1/workspaces/:workspaceId/projects/:projectId/audit`
  - no longer placeholder; returns persisted audit events with paging/filter/sort
- `/api/v1/workspaces/:workspaceId/projects/:projectId/usage`
  - no longer synthetic-only placeholder; aggregates persisted usage facts by `day|hour`
- `/api/v1/workspaces/:workspaceId/projects/:projectId/usage/kpi`
  - aggregates today/yesterday KPI from usage facts
- Initial instrumentation coverage includes:
  - Notebook task lifecycle / task input attach-remove / artifact creation
  - Notebook task run usage (duration, tokens when available)
  - Chat message creation / attachment creation
  - Chat stream run lifecycle + usage
  - Endpoint proxy request usage (success/error, duration)
- Feature availability for `audit`, `usage`, `members`, and `resource_policy` in real backend mode is now governed by **supported enforcement scope**, not placeholder-vs-real status.
- Governance backend baseline now includes:
  - unified backend authz decisions and `/authorize` explain payloads
  - endpoint allow-list / rate / limit effects
  - source-library allow-list / rate / upload limit effects
  - notebook/chat agent access and agent request-rate effects
  - member permission, limit, suspend / restore / revoke downstream effects
  - opaque SSE ticket issuance with legacy JWT query fallback disabled
