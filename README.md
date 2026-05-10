# AgentSmith

AgentSmith is the enterprise control plane for the Microservices-Based Agent System (MBOS). It is used to:

- use Chat for governed model conversations and Agent tasks for file-backed work
- manage AI resources such as Files, Endpoints, Project secrets, and Agent Runners
- govern project resource configuration, usage, and cost with project-scoped policy evidence

Core product positioning:

- enterprise AI agent usage and management platform
- AI resource governance platform
- project-scoped usage and audit control plane

Current product terminology:
- [`docs/contracts/product-terminology.md`](./docs/contracts/product-terminology.md) is the authoritative source for product-facing object names and IA boundaries.
- Use `Model`, `Endpoint`, `Project secrets`, `Shared context`, `Access guide`, and `Files` in user-facing product descriptions.
- Do not describe Chat or Agent tasks as runner-backed user workflows. Runner configuration belongs in Agent Runners administration surfaces.

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

Before you run commands, choose one entry path:

| Entry path | Choose it when | Start here |
| --- | --- | --- |
| `ui_only` | You are changing frontend UI, copy, client state, or mock-only behavior. | `npm install`, `npm run dev`, then `npm run verify` for the dry-run plan. |
| `local_manual` | You need the real local API, Agent tasks, Terminal, runner, files, or backend behavior. | `make local-real-up` and `make local-real-status` (adapter over local-manual). |
| `release_grade` | You need a release-level answer after a large change, release prep, or incident fix. | Run `npm run release:ready`; use `npm run release:status` to read the latest summary. |

Use the [diagnostic catalog](./docs/testing/diagnostic-catalog-v1.md) when you need the smallest command that can reproduce or narrow a failure. Diagnostic commands help you find the problem; gates give the final verdict for a layer.

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
- `npm run dev` is the canonical frontend/mock development entrypoint
- `make` is the canonical entrypoint for local-real environment orchestration
- `npm run` is the canonical entrypoint for clean verification and release wrappers
- `gate:*`, `lane:*`, `backend-real:*`, and `release:campaign:*` stay internal adapters/evidence producers, not default human entrypoints

Quick path note:
- `make help-extended` repeats this clean human surface and points owners to manifest-backed internal adapters.
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
```
<!-- current-workflow:readme:end -->

## Local Runtime In Plain Words

<!-- current-runtime-lines:readme:start -->
Current runtime-line truth:
- Human guides: [Runtime Lines Matrix](./docs/user-guides/runtime-lines-matrix.md) and [Local Runtime Flows](./docs/user-guides/local-runtime-flows.md)
- Machine-readable source: [`scripts/governance/current-runtime-line-manifest.ts`](./scripts/governance/current-runtime-line-manifest.ts)

Current local runtime baseline:
- local-real is the supported developer-machine entrypoint; local-manual remains the maintainer adapter behind it.
- local-real and unified deploy substrate share default local substrate ports, so run them serially on one development host.

Still-binding runtime contracts:
- There is one AgentSmith deploy model; local-kind and existing-cluster are profiles, not separate products.
- Substrates stay outside the app namespace as Docker or operator-provided services; AgentSmith app workloads run in Kubernetes.
- api replicas stay at 1 until a dedicated multi-replica execution routing design is introduced.

Current local developer flow:
- `local-manual` — Daily development, real-backend manual validation, and focused Agent task / Files checks through the local-real entrypoint.

Use `Local Runtime Flows` for local commands and switching. Use `Unified Deploy Operations` for `local-kind` and `existing-cluster` deploy profile evidence under `artifacts/unified-deploy/`.
<!-- current-runtime-lines:readme:end -->

### No-Sandbox Deployment Baseline

```bash
make agent-task-no-sandbox-smoke
```

This validates the required behavior for MVP deployment without sandbox:
- current API/Web/Agent task path is healthy (`make local-real-status`)
- sandbox-backed task path is fail-fast with explicit `AGENT_SANDBOX_NOT_CONFIGURED`

### Internal Adapters And Owner Diagnostics

For daily verification, use the generated workflow entry above: `npm run verify`. For release readiness, use `npm run release:ready` and `npm run release:status`.

Low-level `gate:*`, `lane:*`, `backend-real:*`, and `release:campaign:*` scripts exist in `package.json` for CI, `release:ready`, and evidence-owner runbooks. They are internal adapters, not a default command directory for ordinary development, testing, or release work.

When a release campaign points to a specific owner, use the named adapter family from the owner runbook or manifest rather than copying commands from this README. Examples of owner identities are `gate:default`, `lane:visual`, `gate:release`, unified deploy evidence producers, and the aggregate-only `gate:release:full`.

Optional operator-only Feishu checks when the current release scope includes Feishu:

```bash
make manual-feishu-admin
make manual-feishu-check
make manual-feishu-user
make manual-feishu-check
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

Personal connections and Feishu OAuth backend configuration:

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
- [Verification Campaigns v1](./docs/testing/verification-campaigns-v1.md) — release-grade automated verification、evidence、story、visual 与 verdict 的执行说明
- [User Guides Index](./docs/user-guides/README.md) — 用户手册总入口（MVP-first）
- [Personal Connections & Workspace Integrations](./docs/user-guides/third-party-accounts-feishu.md) — 用户级个人连接、workspace integrations 与 Feishu 连接说明
- [File Library Access Model](./docs/user-guides/file-library-access-model.md) — Files Web/API 与 task HOME 展示模型
- [Product Doc Artifacts](./docs/user-guides/product-doc-artifacts.md) — 生成产品说明截图与配套 Markdown 产物
- [Marketing Assets](./marketing/README.md) — 刷新 marketing 截图资产
- [Product Engineering Governance Methodology](./docs/design/agentsmith-product-engineering-governance-methodology-v1.md) — 产品设计、工程交付与治理方法论基线
- [UI Design Guide](./DESIGN.md)
- [Development Guide](./DEVELOPMENT.md)
- [Documentation Index](./docs/README.md) — current docs index, contracts, UXUI, engineering, testing
