# AgentSmith

AgentSmith is the enterprise control plane for the Microservices-Based Agent System (MBOS). It is used to:

- operate AI agents through project-scoped Chat and Notebook workflows
- manage AI resources such as files, endpoints, credentials, and agents
- govern runtime behavior, usage, and cost with project-scoped policy evidence

Core product positioning:

- enterprise AI agent usage and management platform
- AI resource governance platform
- AI runtime operations and project governance surface

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

### Daily

```bash
make dev-up
make dev-down
make urls
```

### Real Backend Manual Testing

```bash
make api-dev
make web
make notebook-agent-refresh-token
make notebook-agent-init-resources
make e2e-int-core-local-api
```

### No-Sandbox Deployment Baseline

```bash
make notebook-agent-no-sandbox-smoke
```

This validates the required behavior for MVP deployment without sandbox:
- mainline API/Web/Runner path is healthy (`notebook-agent-demo-check`)
- internal-agent sandbox path is fail-fast with explicit `AGENT_SANDBOX_NOT_CONFIGURED`

### Quality Gates

```bash
make gate-pr
make gate-premerge
make gate-release
make smoke-governance   # optional extended/legacy smoke, not part of default release gate
make release-core-smoke
make mvp-freeze-check
```
Note: `release`/`engineering gate` command names above are repository engineering workflow terms, not product DevOps capabilities.
`release-core-smoke` runs core real-lane smoke + endpoint requests/day rate-limit smoke, then archives an engineering verification report with contract/type checks (`typecheck`, `openapi-check`, `contracts-check`).
`mvp-freeze-check` is the freeze-oriented bundle: contracts + core smoke + demo readiness check.

### Dependency Recovery (only when environment is broken)

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

For normal product flow, point `FEISHU_OAUTH_REDIRECT_URI` to an AgentSmith callback page such as:

```bash
http://localhost:3001/zh-CN/user/third-party-accounts/feishu/callback
```

## Permission Token Naming

Use canonical project tokens in all new code:

- `project:endpoint:use`
- `project:agent:manage`
- `project:agent:public`
- `project:manage`

Deprecated aliases are still accepted only for compatibility:

- `project:endpoint:invoke` -> `project:endpoint:use`
- `project:agent:create` -> `project:agent:manage`
- `project:agent:publish` -> `project:agent:public`

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
