# AgentSmith

AgentSmith is the enterprise control plane for the Microservices-Based Agent System (MBOS). It is used to:

- operate AI agents through project-scoped Chat and Notebook workflows
- manage AI resources such as files, endpoints, credentials, and agents
- govern project resource configuration, usage, and cost with project-scoped policy evidence

Core product positioning:

- enterprise AI agent usage and management platform
- AI resource governance platform
- project-scoped usage and audit control plane

## Tech Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: TailwindCSS + shadcn/ui
- **Icons**: Lucide React
- **i18n**: next-intl (zh-CN / en-US)
- **State Management**: Zustand
- **API Mocking**: MSW (Mock Service Worker)
- **Component Docs**: Storybook

## Design System

See [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) for the design system index. All UI designs must follow the in-repo [视觉设计系统](./docs/UXUI/00-设计系统/视觉设计系统-v1.md).

## Getting Started

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

Use this minimal command set for daily work.

Current workflow model:
- `环境`
- `门禁`
- `验证通道`
- `发布`

Authoritative definition:
- [Current Engineering Governance Model](./docs/current-engineering-governance-model.md)

### 环境

```bash
cp .env.dev.real.example .env.dev.real
make dev-real-up
make dev-real-seed-notebook
make dev-real-status
make dev-real-down
make dev-real-reset
```

### 门禁

```bash
make gate-fast
make gate-default
make gate-release
```

### 验证通道

```bash
make lane-mock
make lane-visual

cp .env.real.local.example .env.real.local
npm run lane:real:core
npm run lane:real:release
npm run test:release:precheck
npm run test:visual:real:review
```

### 发布

```bash
npm run release:real:reset
npm run release:real:bootstrap
npm run release:real:ready
npm run release:real:run
npm run release:real:report
```

Current configuration names:

- dev-real: `PRESET_ENDPOINT_*`
- real lane env file: `PRESET_ENDPOINT_*` with derived `REAL_LANE_*` aliases
- deploy presets: `PRESET_*`

Templates:

- dev-real: `.env.dev.real.example`
- real lane: `.env.real.local.example`
- demo deploy: `infra/deploy/demo/env/site.env.example`

Old names and old demo commands are removed. Passing `GLM_*` to current entrypoints fails fast.

### No-Sandbox Deployment Baseline

```bash
make notebook-agent-no-sandbox-smoke
```

This validates the required behavior for MVP deployment without sandbox:
- current API/Web/Runner path is healthy (`make dev-real-status`)
- internal-agent sandbox path is fail-fast with explicit `AGENT_SANDBOX_NOT_CONFIGURED`

### Default Gates And Verification Channels

```bash
make gate-fast
make gate-default
make gate-release
```

Recommended release flow:

```bash
make release-real-reset
make release-real-bootstrap
make release-real-ready
make manual-feishu-admin
make manual-feishu-check
make manual-feishu-user
make manual-feishu-check
make release-real-run
make release-real-report
```

### Dependency Recovery (only when the environment is broken)

```bash
make bootstrap
make deps-down
make deps-reset
```

## Environment

Copy `.env.example` to `.env.local` and configure:

```bash
NEXT_PUBLIC_API_BASE=http://localhost:20000
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
- `project:manage`

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
- [MVP Core Smoke Runbook](./docs/user-guides/mvp-core-smoke-runbook.md) — 真实后端 MVP 核心回归执行手册
- [Third-Party Accounts & Feishu OAuth](./docs/user-guides/third-party-accounts-feishu.md) — 用户级第三方账户、Feishu OAuth、回调模式与手动验收说明
- [Product Engineering Governance Methodology](./docs/design/agentsmith-product-engineering-governance-methodology-v1.md) — 产品设计、工程交付与治理方法论基线
- [Design System](./DESIGN_SYSTEM.md)
- [Development Guide](./DEVELOPMENT.md)
- [Documentation Index](./docs/README.md) — contracts, UXUI, and other docs
- [i18n Internal Guide](./docs/UXUI/01-通用规范/2026-02-03-i18n-内部指南-v1.md)
