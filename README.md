# AgentSmith

AgentSmith is the enterprise control plane for the Microservices-Based Agent System (MBOS). It is used to:

- operate AI agents through project-scoped Chat and Notebook workflows
- manage AI resources such as files, endpoints, project secrets, and agents
- govern project resource configuration, usage, and cost with project-scoped policy evidence

Core product positioning:

- enterprise AI agent usage and management platform
- AI resource governance platform
- project-scoped usage and audit control plane

Current product terminology:
- [`docs/contracts/product-terminology.md`](./docs/contracts/product-terminology.md) is the authoritative source for product-facing object names and IA boundaries.
- Use `Execution target`, `Project secrets`, `Shared context`, `Access guide`, and `Files` in user-facing product descriptions.
- Do not collapse `Endpoint` and `Agent` into a generic model-source concept in product-facing docs or UI copy.

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: TailwindCSS + shadcn/ui
- **Icons**: Lucide React
- **i18n**: next-intl (zh-CN / en-US)
- **State Management**: Zustand
- **API Mocking**: MSW (Mock Service Worker)
- **Component Docs**: Storybook

## UI Design Guide

Current UI style guidance is defined in [DESIGN.md](./DESIGN.md).

Use:
- [DESIGN.md](./DESIGN.md) for the official `getdesign cursor` UI design guide and global style direction
- `docs/UXUI/` for active interaction and module-specific UX specs that apply the design guide
- [docs/testing/visual-baseline-policy-v1.md](./docs/testing/visual-baseline-policy-v1.md) for visual evidence policy


## Getting Started

Runtime baseline: `Node 24.14.1 LTS` with `npm 11.11.0` for local development, CI, build images, and deployment images.

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run Storybook
npm run storybook

# Build for production
npm run build

# Run production server
npm start
```

## Make Quick Commands

Local runtime rule:
- start the shared `substrate` first
- run one `flow` at a time
- switch flows by stopping the current one first

<!-- current-workflow:readme:start -->
Use this minimal command set for daily work.

Current workflow model:
- `环境`
- `测试`
- `门禁`
- `验证通道`
- `发布`

Authoritative definition:
- [Current Engineering Governance Model](./docs/current-engineering-governance-model.md)
- Machine-readable source: [`scripts/governance/current-workflow-manifest.ts`](./scripts/governance/current-workflow-manifest.ts)
- Machine-readable gate source: [`scripts/governance/current-gate-manifest.ts`](./scripts/governance/current-gate-manifest.ts)

Command naming rule:
- `make` is the canonical entrypoint for environment and rehearsal orchestration
- `npm run` is the canonical entrypoint for tests, gates, verification lanes, and release validation

### 环境

```bash
make substrate-up
make substrate-reseed
make substrate-status
make local-manual-up
make local-manual-seed-notebook
make local-manual-status
```

### 测试

```bash
npm run test:default-e2e
npm run test:visual
npm run test:governance
npm run test:backend-real:core
```

### 门禁

```bash
npm run gate:fast
npm run gate:default
```

### 验证通道

```bash
npm run lane:mock
npm run lane:visual
npm run lane:backend-real:release
```

### 发布

```bash
npm run backend-real:run
npm run backend-real:report
```
<!-- current-workflow:readme:end -->

## Local Runtime In Plain Words

<!-- current-runtime-lines:readme:start -->
Current runtime-line truth:
- Human guides: [Runtime Lines Matrix](./docs/user-guides/runtime-lines-matrix.md) and [Local Runtime Flows](./docs/user-guides/local-runtime-flows.md)
- Machine-readable source: [`scripts/governance/current-runtime-line-manifest.ts`](./scripts/governance/current-runtime-line-manifest.ts)

Current local runtime baseline:
- One shared local substrate backs local-manual, demo-rehearsal, and cluster-rehearsal on a development host.
- Only one local flow should be active at a time; switch flows by stopping or resetting the current one first.
- Demo and cluster rehearsal each own their local kind world and registry identity instead of sharing one generic local cluster.
- Rehearsal lines validate release paths on a development host; deploy lines operate on target-host release roots.

Current local flows:
- `local-manual` — Daily development, real-backend manual validation, and notebook / runner checks.
- `demo-rehearsal` — Local rehearsal of the demo deploy flow on a development host. Uses `agentsmith-demo` / `agentsmith-demo-registry`.
- `cluster-rehearsal` — Local rehearsal of the real-cluster deployment flow on a development host. Uses `agentsmith-cluster` / `agentsmith-cluster-registry`.

Use `Local Runtime Flows` for local commands and switching. Use the deploy runbooks for target-host release steps.
<!-- current-runtime-lines:readme:end -->

### No-Sandbox Deployment Baseline

```bash
make notebook-agent-no-sandbox-smoke
```

This validates the required behavior for MVP deployment without sandbox:
- current API/Web/Runner path is healthy (`make local-manual-status`)
- internal-agent sandbox path is fail-fast with explicit `AGENT_SANDBOX_NOT_CONFIGURED`

### Default Gates And Verification Channels

```bash
npm run gate:fast
npm run gate:default
npm run gate:release
```

Recommended release flow:

```bash
npm run backend-real:reset
npm run backend-real:bootstrap
npm run backend-real:ready
make manual-feishu-admin
make manual-feishu-check
make manual-feishu-user
make manual-feishu-check
npm run backend-real:run
npm run backend-real:report
```

### Dependency Recovery (only when the environment is broken)

```bash
make bootstrap
make deps-down
make deps-reset
```

## Environment

Copy `.env.local.example` to `.env.local` and configure:

```bash
NEXT_PUBLIC_API_BASE=http://localhost:20000/api/v1
NEXT_PUBLIC_USE_MSW=false
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:18080/realms
NEXT_PUBLIC_KEYCLOAK_REALM=mbos
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=agentsmith
```

Third-party accounts and Feishu OAuth backend configuration:

```bash
USER_EXTERNAL_CONNECTIONS_SECRET_KEY=<strong-random-secret>
FEISHU_APP_ID=<your-feishu-app-id>
FEISHU_APP_SECRET=<your-feishu-app-secret>
FEISHU_OAUTH_REDIRECT_URI=http://127.0.0.1:18181/callback
```

For normal product flow, point `FEISHU_OAUTH_REDIRECT_URI` to the workspace callback page:

```bash
http://localhost:3001/workspaces/ws_default/feishu/callback
```

## Permission Token Naming

Use canonical project tokens in all new code:

- `project:endpoint:use`
- `project:agent:manage`
- `project:agent:public`
- `project:files:update`

Only canonical permission tokens are valid in current code and tests.

## Project Structure

```
src/
├── app/              # Next.js App Router
├── components/       # React components
├── lib/             # Utilities
│   ├── api/         # API client
│   ├── hooks/       # Custom hooks
│   ├── stores/      # Zustand stores
│   └── utils/       # Utilities
├── messages/        # i18n messages
└── types/           # TypeScript types
```

## Documentation

- [Current Engineering Governance Model](./docs/current-engineering-governance-model.md) — 当前唯一工程治理模型与术语表
- [Current Baseline (Whitelist)](./docs/CURRENT_BASELINE.md) — 当前唯一白名单入口
- [项目宪法 (Project Constitution)](./docs/项目宪法.md) — 产品目标、设计风格与功能范围之最高指导，防漂移
- [User Guides Index](./docs/user-guides/README.md) — 用户手册总入口（MVP-first）
- [Personal Connections & Workspace Integrations](./docs/user-guides/third-party-accounts-feishu.md) — 用户级个人连接、workspace integrations 与 Feishu 连接说明
- [File Library Client Mount](./docs/user-guides/file-library-local-mount.md) — 本地挂载 project file library 与双向同步校验
- [Product Doc Artifacts](./docs/user-guides/product-doc-artifacts.md) — 生成产品说明截图与配套 Markdown 产物
- [Marketing Assets](./marketing/README.md) — 刷新 marketing 截图资产
- [Product Engineering Governance Methodology](./docs/design/agentsmith-product-engineering-governance-methodology-v1.md) — 产品设计、工程交付与治理方法论基线
- [UI Design Guide](./DESIGN.md)
- [Development Guide](./DEVELOPMENT.md)
- [Documentation Index](./docs/README.md) — current docs index, contracts, UXUI, engineering, testing
