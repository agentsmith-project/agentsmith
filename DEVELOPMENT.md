# AgentSmith - Development Guide

## Runtime Baseline

Use `Node 24.14.1 LTS` for local development, CI, build jobs, and deployment images. Do not mix Node 20/22/25 across environments.

Repo version files:
- `.nvmrc`
- `.node-version`
- `package.json` `engines.node`
- `package.json` `packageManager` (`npm@11.11.0`)

## Product Terminology Guardrails

- [`docs/contracts/product-terminology.md`](./docs/contracts/product-terminology.md) is the authoritative source for product-facing object names and IA boundaries.
- Use `Execution target`, `Project secrets`, `Shared context`, `Access guide`, and `Files` in user-facing product descriptions, UI copy, and product docs.
- Do not collapse `Endpoint` and `Agent` into a generic model-source concept in product-facing docs, UI copy, or test narratives.

## Current Engineering Workflow

<!-- current-workflow:development:start -->
当前仓库只保留这几类 current 主路径：

- `环境`
- `测试`
- `门禁`
- `验证通道`
- `发布`

权威定义：
- [docs/current-engineering-governance-model.md](./docs/current-engineering-governance-model.md)
- machine-readable source: [`scripts/governance/current-workflow-manifest.ts`](./scripts/governance/current-workflow-manifest.ts)
- machine-readable gate source: [`scripts/governance/current-gate-manifest.ts`](./scripts/governance/current-gate-manifest.ts)
- gate result schema: [`scripts/governance/current-gate-result-schema.ts`](./scripts/governance/current-gate-result-schema.ts)

命令命名约定：
- `make` 与 `npm run` 是当前 command surface / adapter，不是 gate identity truth
- gate identity 统一看 `scripts/governance/current-gate-manifest.ts` 里的稳定 `id`
- `npm run dev` 是前端/mock 开发入口；local-real 环境编排走 `make`
- `gate:*`、`lane:*`、`backend-real:*`、`release:campaign:*` 保留为内部 adapter / evidence producer，不作为默认人工入口

Quick path note:
- `make help-extended` 只重复 clean human surface；owner 需要内部 adapter 时回到 manifest / runbook。
- `npm run release:status` is read-only; it only reads the latest release summary.

### 环境

```bash
npm run dev
make local-real-up
make local-real-status
make local-real-down
make local-real-reset
```

### 测试

```bash
npm run verify
```

### 发布

```bash
npm run release:ready
npm run release:status
npm run rehearse:demo
npm run rehearse:cluster
```
<!-- current-workflow:development:end -->

先选入口，不要混用三条路径：

| Entry path | 适用情况 | 先跑什么 |
| --- | --- | --- |
| `ui_only` | 只改前端 UI、文案、mock 交互、客户端状态。 | `npm run dev`，然后用 `npm run verify` 生成 dry-run plan。 |
| `local_manual` | 需要真实本地 API / Web / Notebook / Terminal / runner / files 行为。 | `make local-real-up`，然后用 `make local-real-status` 看当前状态。 |
| `release_grade` | 大改动收口、发布前、incident 修复后的跨层复验。 | `npm run release:ready`，然后用 `npm run release:status` 只读查看 summary/status。 |

如果只是定位问题，先用 [diagnostic catalog](./docs/testing/diagnostic-catalog-v1.md) 找最小诊断命令。诊断命令通过后，按范围回到 `npm run verify -- --goal=... --run`；发布级收口回到 `npm run release:ready`。

Gate adapter fidelity notes:
- adapter fidelity 统一看 `scripts/governance/current-gate-manifest.ts` 里的 `npmScript`、可选 `ciJob` 与 structured `executionTargets`
- free-form `command` 只作为 operator hint / 展示面，不再承担 enforcement truth

## Verification Guidance

给新开发者的执行边界：

1. 先区分诊断路径和 authoritative verdict
- `test` family commands、某个 focused Playwright spec、owner runbook 里的 targeted internal adapter，主要用于诊断、复现和缩小问题范围。
- 普通开发者先用 `npm run verify` 生成计划，并用 `npm run verify -- --goal=... --run` 执行正式验证；不从 gate adapter 目录手工拼流程。
- `gate:default` 不是 full visual，也不是 release-grade verdict。full visual 的内部 owner 是 `lane:visual`；面向人的发布级自动化入口统一看 `npm run release:ready`，它会在 precheck 通过后委托内部 campaign，并在 campaign context 内调用 terminal aggregate verdict。
- `gate:release:full` 是 aggregate-only 内部复核器，只能在显式 campaign context 下由 release wrapper 或 owner runbook 使用；它不会执行任何 suite。

2. `command passed` 不等于验收通过
- 对 evidence-owning internal adapters，证据完整性与命令返回同级。
- 需要检查的证据包括 visual review artifacts、`visual_scene_catalog`、`ux_trace_bundle` 等当前文档或 contract 明确要求的产物。
- 对当前在 `scripts/governance/current-gate-result-schema.ts` 注册了 writer 的内部 owner，还要检查 canonical `<evidence_dir>/result.json`。
- 如果命令成功但 required machine-readable evidence 缺失，按治理规则仍然算失败。

3. 日常开发、功能收口、release-grade 自动化是三种不同路径
- 日常开发：先跑 contract / type / unit / targeted integration，尽量用最小成本定位问题。
- 功能收口：补跑与改动直接相关的 integration、e2e、story、backend-real smoke 或 targeted visual。
- release-grade 自动化：统一按照 [`docs/user-guides/release-readiness-checklist.md`](./docs/user-guides/release-readiness-checklist.md) 的自动化 campaign 执行，日常入口是 `npm run release:ready`。
- 如果需要理解 wave、证据、rerun 策略与常见误区，再看 [`docs/testing/verification-campaigns-v1.md`](./docs/testing/verification-campaigns-v1.md)。

4. 手工 Feishu 操作与自动化 gate 分层
- `make manual-feishu-*` 属于 release operator 手工联调/验收说明，不属于 machine-readable gate identity。
- 是否需要执行这些手工步骤，看当前 release scope；不要把它们写成“自动化门禁已经覆盖”的替代说法。

5. `failure_class` 是 gate verdict，不是 troubleshooting 标签
- `result.json` 里的 `failure_class` 只用于 canonical gate verdict。
- 本地排障脚本、incident note、人工 triage 可以有更细的分类，但不能拿来替代 canonical gate result，也不能把二者混写成同一套真相。

推荐阅读顺序：
- 当前治理真相：[`docs/current-engineering-governance-model.md`](./docs/current-engineering-governance-model.md)
- campaign 执行说明：[`docs/testing/verification-campaigns-v1.md`](./docs/testing/verification-campaigns-v1.md)
- release-grade 自动化与手工边界：[`docs/user-guides/release-readiness-checklist.md`](./docs/user-guides/release-readiness-checklist.md)
- gate verdict schema：[`docs/contracts/current-gate-result-schema-contract.md`](./docs/contracts/current-gate-result-schema-contract.md)
- 方法论背景：[`docs/design/agentsmith-product-engineering-governance-methodology-v1.md`](./docs/design/agentsmith-product-engineering-governance-methodology-v1.md)

## Current Runtime Lines

<!-- current-runtime-lines:development:start -->
当前 runtime-line 真相：
- 人类入口：[`Runtime Lines Matrix`](./docs/user-guides/runtime-lines-matrix.md) 与 [`Local Runtime Flows`](./docs/user-guides/local-runtime-flows.md)
- machine-readable source: [`scripts/governance/current-runtime-line-manifest.ts`](./scripts/governance/current-runtime-line-manifest.ts)

当前本机操作基线：
- 本机共享一套 substrate，`local-manual`、`demo-rehearsal`、`cluster-rehearsal` 都复用它。
- 同一时间只建议一条本地工作线处于 active；切换前先停掉或 reset 当前工作线。

持续生效的 runtime contract：
- `demo-rehearsal` 和 `cluster-rehearsal` 都拥有自己的 scenario-owned local kind world 与 local registry，不再共用一个泛化本地集群。
- rehearsal 线负责在开发机上排演 release 路径；deploy 线负责目标主机上的正式发布。

当前本机工作线：
- `local-manual` — 日常开发、真实后端手测、notebook / runner 主链手测。
- `demo-rehearsal` — demo 发布线的本机排演入口，使用 `agentsmith-demo` / `agentsmith-demo-registry`。
- `cluster-rehearsal` — cluster 发布线的本机排演入口，使用 `agentsmith-cluster` / `agentsmith-cluster-registry`。

本文件只保留开发/排障入口；操作基线不再等同于系统正确性的前提，具体运行线拓扑与 contract 统一看 runtime-line 文档。
<!-- current-runtime-lines:development:end -->

本机真实环境的人类入口统一是 `make local-real-*`；`substrate-*` 与 `local-manual-*` 是底层实现 adapter，只在 maintainer diagnostics 或 owner runbook 明确要求时直接使用。

### Focused Helpers

这几条命令保留用于专项验证、治理证据或静态产物生成，不属于 current 主路径：

```bash
make verify-contracts
make verify-governance
make verify-governance-with-report
make governance-report REPORT_ARCHIVE=1
npm run docs:artifacts:generate
npm run marketing:assets:generate
```

当前有效配置命名：

- local-manual: `PRESET_ENDPOINT_*`
- backend-real runtime: `.env.backend-real` 以 `PRESET_*` 为主；部分包装脚本会派生 `BACKEND_REAL_*` 别名
- demo deploy: `PRESET_*` 与 deploy-specific 配置并存

模板入口：

- local-manual: `.env.local-manual.example`
- backend-real: `.env.backend-real.example`
- demo deploy: `infra/deploy/demo/env/site.env.example`

旧 demo 命令和旧供应商命名已经移除；当前入口统一使用 `PRESET_*`。

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
make agent-test-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_xxx' AGENT_KEY='ask_xxx' # 启动外部 agent 测试进程
make local-real-up      # 启动真实本地环境
make local-real-status  # 查看真实本地环境状态
make local-real-down    # 停掉真实本地环境
make local-real-reset   # 清空并重建真实本地环境
make openapi-generate # 基于 OpenAPI contract 生成前端类型
make openapi-check-generated # 校验 generated types 是否需要更新
make openapi-changelog # 生成 OpenAPI 相对 origin/main 的变更摘要
make contracts-check-openapi # 检查 OpenAPI 核心覆盖与破坏性变更
```

说明：`*-auto` 目标会自动清理代理环境变量（`http_proxy/https_proxy/all_proxy` 等）后再启动服务和执行 Playwright。
底层 `substrate-*` / `local-manual-*` 目标保留给 maintainer diagnostics、owner runbook 和实现排障，不作为新人默认常用命令。

## 本地真实手测环境

当前推荐的真实后端手测入口是 `make local-real-up`，它会把：

1. integration 依赖
2. universal-proxy
3. Node API
4. Next Web

收成一条正式链路。`local-real` 是人类入口名，底层仍映射到已注册的 `local-manual` runtime line。

默认 `local-real` 只保证真实本地平台可用，不自动创建 Notebook demo 或 host external runner。需要这些证据，或需要本机完整验证 internal sandbox / JuiceFS / internal notebook 时，再按 owner runbook 显式执行底层 diagnostic adapter。

### First-time setup

```bash
cp .env.local-manual.example .env.local-manual
```

模板名保留 `local-manual` 是底层 adapter 命名，不改变普通执行入口。

必须填写：

```bash
PRESET_ENDPOINT_API_KEY=...
PRESET_ENDPOINT_MODEL=<YOUR_MODEL_ID>
PRESET_ENDPOINT_MAX_CONTEXT_TOKENS=204800
PRESET_ENDPOINT_MAX_OUTPUT_TOKENS=128000
PRESET_ANTHROPIC_ENDPOINT_BASE_URL=<YOUR_ANTHROPIC_BASE_URL>
PRESET_ANTHROPIC_ENDPOINT_PROTOCOL=anthropic_messages
PRESET_OPENAI_ENDPOINT_BASE_URL=<YOUR_OPENAI_BASE_URL>
PRESET_OPENAI_ENDPOINT_PROTOCOL=openai_chat_completions
```

注意：

1. `local-real` 现在默认使用共享受管底层环境；需要完整重建时，直接使用 `make local-real-reset`
2. 当前本机规则是“共享一套底座，一次只跑一条工作线”
3. 如果本机要和其它工作线串行切换，`local-real` 只需要保留自己的 app 端口：

```bash
PORT_API=21000
PORT_WEB=3101
PROXY_PORT=39080
```

说明：

1. 这组端口只改变本地 API / Web / universal-proxy，不改共享底层环境
2. 底层 adapter 必须读取共享底座生成的连接文件；底座没起时会直接失败，不再 fallback 自己拼地址
3. 底层 adapter 不再依赖 `LOCAL_MANUAL_REUSE_SUPPORT_SERVICES` 这类隐藏状态开关
4. 底层 down adapter 默认不再清理未追踪的端口监听，避免误停其它工作线；只有显式设置 `LOCAL_MANUAL_ALLOW_UNTRACKED_PORT_CLEANUP=1` 才会强制按端口清理
5. 当前单机基线是同一时刻只运行一条工作线；切换前先执行上一条线的 `*-down` 或 `*-reset`

### Start platform only

```bash
make local-real-up
```

这一步只启动平台，不自动创建 notebook demo 资源。

### Seed notebook demo and start host runner only when owner runbook requires it

这一步是底层 owner diagnostic adapter。普通本机真实环境先从 `make local-real-up` 开始；只有需要 Notebook demo / host external runner 证据时再按 runbook 执行。

```bash
make local-manual-seed-notebook
```

这一步会：

1. 刷新 `dev-admin` token
2. 创建 project / credential / endpoint / external agent / key
3. 启动 host external runner
4. 输出 notebook URL

### Check status

```bash
make local-real-status
```

### Enable local internal sandbox only when owner runbook requires it

```bash
make local-manual-internal-up
make local-manual-internal-status
```

这组命令是 internal owner diagnostic adapter，不是普通本机真实环境入口。

这一步会在底层 `local-manual` runtime line 基础上补：

1. 本地 `kind-agentsmith`
2. `agentsmith-sandbox` namespace
3. JuiceFS CSI
4. local sandbox manager / cleaner
5. internal notebook agent

结束后如果想回到默认 external-only 模式：

```bash
make local-manual-internal-down
```

### Full reset

```bash
make local-real-reset
```

### Stop everything

```bash
make local-real-down
```

## Environment Setup

Preferred real-backend local entrypoint:

```bash
cp .env.local-manual.example .env.local-manual
make local-real-up
```

`.env.local.example` is now a legacy frontend-only shortcut for the narrow case
where you intentionally run `npm run dev` directly without `local-real`.

If you still need that legacy shortcut, copy `.env.local.example` to `.env.local`
and configure:

```bash
# For local development with backend
NEXT_PUBLIC_API_BASE=http://localhost:20000/api/v1
NEXT_PUBLIC_USE_MSW=false
NEXT_PUBLIC_BYPASS_AUTH=false

# For local development with Keycloak
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:18080/realms
NEXT_PUBLIC_KEYCLOAK_REALM=mbos
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=agentsmith
```

## Identity & Permissions

- 内部用户唯一主键保持 `user_id = Keycloak sub`
- `system 管理侧` 与工作区管理页统一按 `email` 搜索和确认用户
- 正式权限关系最终保存 `user_id`，不把 email 当长期主键
- 当前 system 管理侧保存的是 `工作区配置记录`，不要再把它泛化称为 `registry`
- Keycloak 用户目录本轮只支持 `搜索选人`，不提供完整用户列表
- 还未存在于 IdP 的用户，不能被设置成正式 `workspace admin` 或 `project creator`

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

## Current Surface Baseline

当前系统与项目业务面的产品基线固定为：

1. `System Admin`：系统超级管理员管理 workspace 生命周期、workspace 数据配置与 workspace IdP 配置
2. `Workspace Entry`：普通业务用户选择 workspace 或直接进入 workspace URL，再完成 workspace 登录
3. `Usage`：用户查看自己在各 endpoint 上的用量与限制消耗程度
4. `Audit`：管理员查看资源、配置、状态与异常事件记录，并完成审查与追溯

补充说明：

1. `release-ops` 已从当前功能基线中移除
2. 独立的第三产品面已被移除，不再继续建设独立运行控制台
3. 若历史能力仍需保留，应并入 `Audit`
4. `release` / `engineering gate` / `rollout` 等术语若出现在仓库内，默认指工程流程，不是平台对外能力名；产品内权限约束一律表述为 `permission gate`
5. 以下对象不再作为前端产品对象继续扩张：`guardrails`、`probe`、`alias`、`combo`、`routing`、`activation`
6. Authn 由 workspace 绑定的 IdP 提供；Authz 由 AgentSmith 执行
7. 系统超级管理员入口必须与 workspace 业务登录入口完全分离
8. workspace 生命周期与底层租户配置只归系统超级管理员管理

## Design System Reference

Current UI style guidance is defined in [DESIGN.md](./DESIGN.md).

Use:
- [DESIGN.md](./DESIGN.md) for the official `getdesign cursor` UI design guide and global style direction
- `docs/UXUI/` for active interaction and module-specific UX specs
- [docs/testing/visual-baseline-policy-v1.md](./docs/testing/visual-baseline-policy-v1.md) for visual evidence policy


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

## 默认工程门禁（工作区 / 项目）

When the current work touches the default workspace/project business chain

1. `system 管理侧`
2. `工作区发布状态`
3. `用户访问入口`
4. `项目创建与进入`

run the default PR verification entry:

```bash
npm run verify -- --goal=pr --run
```

Use `npm run verify` when you only need the dry-run plan.

This PR verification covers:

1. contract checks
2. lint + typecheck
3. targeted frontend/backend tests for workspace publish, project creators, and project creation
4. mock lane E2E for `system -> workspace -> project`
5. targeted visual checks for the default entry pages

For focused owner diagnostics on the default workspace/project evidence producer, rerun:

```bash
npm run test:default-e2e
```

Treat `npm run test:default-e2e` as a focused diagnostics / evidence-owner producer rerun, not as the default PR gate entry.

If daily verification also needs the real backend lane:

```bash
npm run verify -- --goal=real --run
```

For focused owner diagnostics on the real-backend core producer, rerun:

```bash
npm run test:backend-real:core
```

This backend-real producer auto starts integration dependencies, API, and frontend on dedicated ports. It is not release sign-off; release-oriented conclusions still use `npm run release:ready`.

## Release Readiness Checklist

For final release-oriented verification, use the human-friendly release readiness wrapper:

```bash
npm run release:ready
npm run release:status
```

Notes:

1. `npm run release:ready` is the human-friendly automated release path. It runs the non-verdict precheck first, then delegates to internal campaign adapters that orchestrate `gate:fast`, `gate:default`, `lane:visual`, `gate:release`, demo rehearsal, cluster rehearsal, and the terminal aggregate verdict.
2. `gate:release:full` is aggregate-only. Treat it as an internal verifier for an explicit campaign context, not as a copyable release command.
3. When diagnosing a failed campaign, rerun the owning evidence adapter from the owner runbook or manifest, then return to `npm run release:ready`.
4. Real-backend notebook verification requires `PRESET_ENDPOINT_API_KEY` (or a derived `BACKEND_REAL_API_KEY` alias).
5. Fresh demo rehearsal roots seeded by the release campaign keep `infra/deploy/demo/env/site.env.example` secret-free and derive a missing `PRESET_ENDPOINT_API_KEY` from repo-local runtime presets such as `.env.backend-real`.

## Test & Evidence Directory Contract

当前测试与审查资产的目录约定固定为：

### 测试代码
- `src/**/__tests__/`
- `e2e/`
- `scripts/**/__tests__/`

### 临时运行结果
- `test-results/`
- 这里只放 Playwright 单次运行的临时结果，例如 actual、diff、error context

### mock lane visual 基线
- `e2e/__screenshots__/`
- 这里只表示 mock lane visual baseline，不表示真实发布审查截图

### 长期证据与发布审查资产
- `artifacts/`
- 其中长期结构约定为：
  - `artifacts/backend-real-visual/`
  - `artifacts/backend-real/runs/<run-id>/...`
  - `artifacts/release-runs/`
  - `artifacts/release-reports/`
  - `artifacts/release-escalations/`
  - `artifacts/governance-reports/`

使用规则：
1. 日常失败排查看 `test-results/`
2. mock visual 基线看 `e2e/__screenshots__/`
3. 真实后端人工界面审查看 `artifacts/backend-real-visual/<run-id>/`
4. notebook / integration 当前运行态日志与状态优先看 `artifacts/backend-real/runs/<run-id>/...`
5. 不再新增泛化的 `tests/` 目录承载主测试代码
6. `artifacts/system-workspace-provisioning/` 仍是当前工作区发布/初始化尝试记录输出路径，不要按新目录约定直接重命名或手工迁走

## 默认治理门禁

When the current work touches

1. `Members`
2. `Policy`
3. `Audit`
4. `Alerts`
5. governance explainability or drilldown links

run the default PR verification entry:

```bash
npm run verify -- --goal=pr --run
```

Use `npm run verify` when you only need the dry-run plan.

This PR verification covers:

1. contract checks
2. lint + typecheck for governance explainability surfaces
3. targeted frontend/backend tests for authorization explainability
4. mock lane E2E for `members -> resource policy -> members`
5. targeted visual checks for governance pages and overlays

For focused owner diagnostics on the governance evidence producer, rerun:

```bash
npm run test:governance
```

Treat `npm run test:governance` as a focused diagnostics / evidence-owner producer rerun, not as the default PR gate entry.

## API 合约与文档入口

后端提供统一文档入口：

- `http://localhost:20000/docs`：Scalar API Reference（HTTP API）
- `http://localhost:20000/docs/asyncapi`：AsyncAPI 可视化页面（Agent Execution WS）
- `http://localhost:20000/api/v1/openapi.json`：OpenAPI JSON
- `http://localhost:20000/api/v1/asyncapi.json`：AsyncAPI JSON（Agent Execution WS）

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
- Desktop Playwright runs in this repo use an explicit browser window and viewport of `1920x1080`. This is especially required for visual baseline consistency.
- Dev server startup is wrapped by `scripts/run-next-dev-safe.sh`, which sets `NODE_OPTIONS=--max-old-space-size=4096` by default and warns if multiple repo-local `next dev` processes are already running.

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
- Playwright launch/window baseline: `1920x1080`.

```bash
npm run test:e2e -- --project=chromium
```

2) Integration E2E

- Uses a real backend (Keycloak + API).
- Only runs `e2e/integration-*.spec.ts`.
- Playwright launch/window baseline: `1920x1080`.

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

The current internal baseline no longer treats `Members` and `Policy` as page-only or mock-backed governance surfaces. In local real-backend mode:

- `Audit` and `Usage` are fully backed by persisted `api-entry-node` routes
- `Members` supports real lifecycle effects (`suspend / restore / revoke`) and downstream cleanup
- `Policy` supports real allow-list / rate / limit effects on the currently supported resource paths
- project route authorization is driven by the shared backend authz engine and explainable `/authorize` decisions

The important constraint is no longer "partial page support", but **scoped enforcement coverage**. For exact supported effects and current boundaries, use the current baseline, current contracts, and current user guides as sources of truth.

See also:
- `docs/CURRENT_BASELINE.md`
- `docs/contracts/product-terminology.md`
- `docs/user-guides/README.md`

### Scope (What this workline covered)

- Notebook task execution via external agent execution (`notebook-codex-runner`, Codex script mode)
- Endpoint proxy protocol bridging for OpenAI Responses and streaming translation on canonical proxy paths
- Notebook message bubble execution details UI (expandable trace panel)
- Trace storage/query/replay path (`trace_event` SSE + `/tasks/:taskId/traces`)
- Production-readiness for notebook task execution:
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
- `packages/notebook-codex-runner/src/index.ts`
- `packages/api-entry-node/src/task-route-handler.ts`
- `packages/api-entry-node/src/agent-execution-service.ts`

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
- Execution protocol extended with `agent.response.event`.
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
  - `/api/v1/internal/notebook-task-metrics`
- Prometheus text export endpoint (auth required):
  - `/api/v1/internal/notebook-task-metrics/prometheus`
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

- Notebook Codex Runner Runbook (authoritative operational workflow for this workline):
  - `docs/notebook-codex-runbook.md`
- Execution protocol contract:
  - `docs/contracts/agent-execution-protocol.md`
- Notebook module/contract mapping docs updated:
  - `docs/contracts/notebook-frontend-module-map.md`
- Main generated specs updated to include notebook traces + execution event coverage:
  - `docs/contracts/specs/openapi.yaml`
  - `docs/contracts/specs/openapi.json`
  - `docs/contracts/specs/asyncapi.yaml`
  - `docs/contracts/specs/asyncapi.json`
- Supplement specs retained as compatibility/reference snapshots where applicable and documented in:
  - `docs/contracts/README.md`

### Validation Summary (What was actually tested)

#### Real Chain (Repeatedly)
- API (`:20000`) + Web (`:3001`) + external `notebook-codex-runner`
- real local Keycloak auth
- real provider-compatible endpoint via endpoint proxy
- notebook smoke tasks complete successfully and return final responses (`chain ok`)

#### UI / Frontend
- unit tests for notebook trace panel interactions (expand/filter/raw/copy/stats/pagination)
- page-level Playwright coverage for notebook trace panel interactions (MSW/mock)

#### Backend / Execution
- notebook task execution/API targeted tests:
  - `trace_event` handling
  - `/traces` paging and replay paths
  - retention + details truncation behavior
  - metrics / Prometheus export
  - persisted trace retention truncation consistency

#### Performance / Capacity (Initial Baselines)
- end-to-end load/matrix benchmarks (real Codex + provider-backed path)
- message-scoped `/traces?message_id=...` benchmarks (memory vs Mongo/docStore)
- page-size sweeps (`20/50/200/500`) and compare tooling
- observed result so far:
  - message-scoped `/traces` query remains low-ms and is not the current bottleneck

### Known Boundaries / Open Items (Not blockers for current stage)

1. Notebook task execution persistence relies on docStore backend for restart durability
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
1. `Notebook Codex Runner Runbook` (`docs/notebook-codex-runbook.md`) (current operational truth)
2. benchmark/compare/archive scripts in `scripts/`
3. notebook trace execution implementation in:
   - `packages/api-entry-node/src/task-route-handler.ts`
   - `packages/notebook-codex-runner/src/index.ts`
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
- `docs/user-guides/release-readiness-checklist.md`

## Project Shell Page Contract

When adding or refactoring a project shell page, use this exact governance path:

1. Add the route to `PROJECT_ROUTE_POLICY_MANIFEST`.
2. Resolve `workspace/project/locale` through `useResolvedProjectRoute()`.
3. Consume page capability hooks from `use-permissions.ts`; do not compose raw tokens in the page or page-level component.
4. Add route tests for:
   - happy path
   - invalid params
   - forbidden
   - feature blocked when the page supports that state

This is the only allowed project shell governance pattern. Do not introduce a second route guard, a second policy manifest, or page-local permission composition.

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
Known limitation: auto-reconnection with token refresh is still runtime/security debt. Treat it as a current limitation to verify against the SSE client contract, not as an active historical work item.

### Build Issues

#### MSW appearing in production bundle
**Problem**: `grep -r "msw" .next/` finds MSW references
**Solution**: This is a known issue if MSW is statically imported.
Expected fix pattern: use dynamic imports or equivalent production-safe boundaries so MSW stays out of production bundles. Verify with the production bundle check rather than relying on a historical phase label.

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

This follow-up extends the external notebook-agent execution line toward a NotebookLM-like workflow:

- notebook task attached sources are injected to external execution context as `task_inputs`
- runner writes task-local manifest: `<task_cwd>/.mbos/task-inputs.json`
- runner writes task-local `AGENTS.md` (headless rules, artifact dir rules, input helper guidance)
- runner installs task-local Codex skill:
  - `./.codex/skills/file-read/`
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

- Notebook task inputs use `/tasks/:taskId/inputs` with `InputRef`-style records (`library_object`, `url`, `artifact`).
- Files default path now uses project `file-libraries`; raw uploads land in a deterministic project library (`Project Uploads`) instead of personal upload storage.
- Notebook `source` UI is intentionally paused: the dialog shell remains visible, but it no longer performs file attachment/import logic.
- Notebook artifacts can still be attached back into task inputs as first-class `artifact` refs (output-to-input loop).
- Chat message `inputs` and attachment provenance support first-class `url` refs and project file-library-backed object refs.
- Shared backend resolver layering is now in place:
- Backend input-resolution code is partially shared: chat input parsing/attachment resolution is centralized in `chat-input-refs.ts`, and notebook input detail/execution mapping is centralized in `notebook-input-refs.ts`.
- Shared backend resolver layering is now in place:
  - `input-ref-resolver.ts` (ref keys / imported object extraction / dedupe helpers)
  - `input-ref-input-resolver.ts` (object/url/artifact request metadata resolution + fallback rules)
  - request-specific adapters build on top (`chat-input-refs.ts`, `notebook-input-refs.ts`)
- Chat `attachments/init` now normalizes `library_object` / `url` attachment metadata via the shared request metadata resolver (avoids handler-local drift in filename/type/size fallback rules).

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
  - opaque SSE ticket issuance with JWT query fallback disabled
