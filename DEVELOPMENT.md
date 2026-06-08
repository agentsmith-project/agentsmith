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
- Use `Model`, `Endpoint`, `Project secrets`, `Shared context`, `Access guide`, and `Files` in user-facing product descriptions, UI copy, and product docs.
- Do not describe Chat or Agent tasks as runner-backed user workflows. Runner configuration belongs in Agent Runners administration surfaces.

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
- 维护者排障：`gate:*`、`lane:*`、`backend-real:*`、`release:campaign:*` 保留为内部 adapter / evidence producer，不作为默认人工入口

Quick path note:
- `make help-extended` 只重复 clean human surface；owner 需要内部 adapter 时回到 manifest / runbook。
- `npm run product:status` is read-only; it reads the latest product readiness summary plus the frozen projection/snapshot fields recorded in that summary.
- `npm run product:ready` / `npm run product:status` 最后输出短 evidence summary；原始日志仍保留，NO_COLOR、Postgres already exists、containerd deprecation 这类常见 setup warning 只有在 evidence 明确列为 blocker 时才进入主结论。
- `npm run release:ready` / `npm run release:status` 保留为 deprecated transition aliases / 过渡 alias；它们不提供 deployment、package 或 operator verdict。

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
npm run product:ready
npm run product:status
```
<!-- current-workflow:development:end -->

Release boundary note: `npm run product:ready` is the AgentSmith product-side readiness / local complete / contract and handoff input gate, not a deployment/package/operator verdict. Unified deploy, local-kind, existing-cluster, and product-flow deploy commands are transition-only focused diagnostics.

先选入口，不要混用三条路径：

| Entry path | 适用情况 | 先跑什么 |
| --- | --- | --- |
| `ui_only` | 只改前端 UI、文案、mock 交互、客户端状态。 | `npm run dev`，然后用 `npm run verify` 生成 dry-run plan。 |
| `local_manual` | 需要真实本地 API / Web / Agent tasks / Terminal / runner / files 行为。 | `make local-real-up`，然后用 `make local-real-status` 看当前状态。 |
| `release_grade` | 大改动收口、发布前产品侧 readiness / handoff input completeness 复核、incident 修复后的跨层复验。 | `npm run product:ready`，然后用 `npm run product:status` 只读查看 frozen summary/status projection。 |

如果只是定位问题，先用 [diagnostic catalog](./docs/testing/diagnostic-catalog-v1.md) 找最小诊断命令。诊断命令通过后，按范围回到 `npm run verify -- --goal=... --run`；发布级收口回到 `npm run product:ready`。

### GA 开发提效约定

- 每个改动先定事实源和职责边界：哪个对象由后端、合约、URL、manifest、lock 或本地 fixture 说了算，前端只消费对应真相。
- GA 旧路径、旧命名、旧脚本和旧计划默认删除、归档或 fail fast；不要为过渡实现增加长期兼容层。
- 每个 change slice 先用最小 TDD、fixture、focused diagnostic 或 focused e2e 证明局部事实；重门禁不是日常调试工具。
- focused diagnostic 只能写成 scoped evidence，不能写成 readiness、release、deploy、package 或 operator verdict。
- active 文档只维护当前边界、下一步、阻断点和验收口径；历史 evidence、流水账和过期决策进入 archive/reference。
- 长期 gate、docs、script 必须绑定当前功能、安全、合同、真实运行/发布风险，或显著降低 operator 心智负担；否则降级、合并或删除。
- 服务商专用集成只能作为显式选择或 targeted diagnostic，不进入默认成功路径。

CI 前本地验证口径：

- CI 前不能裸奔；每个 change slice 至少跑与改动风险匹配的最小本地检查，并在交付说明中记录命令/结果，或说明不能运行的原因。
- 小改动不要求本地跑 `npm run product:ready`、backend-real full、full visual、release-kit 四路径或 airgap 全链路；这些只在阶段收口、merge/release 前、高风险跨层变更或 incident 修复后升级执行。
- 风险分层示例：docs-only 跑 docs/static guard；contract/API/权限/route 跑 contract/type/相关 unit；UI/visual 跑相关 unit、focused e2e 或 targeted visual；Files/sandbox/runner/runtime 跑 owner focused diagnostic 或 backend-real smoke；release/adoption/image lock 跑对应 contract/lock check；阶段收口或发布前回到 `npm run verify -- --goal=... --run` 或 `npm run product:ready`。
- CI 是统一环境复核、保护、产物签发与 evidence 生产，不替代基本本地验证。CI failure 指向真实 bug 时，转入 owner repo 根因、业务逻辑或运行时不变量修复，不用 rerun、retry、report 或拉长等待掩盖。
- 不为这条规则新增流程、看板、PR bot、强制 evidence 包或 wrapper；按 KISS / DRY / YAGNI 保持最小执行面。

Files / sandbox / runtime readiness blocker 处理口径：

- gate 只是探针；blocker 先翻译成 owner repo 的运行时不变量、状态机、API admission、terminal truth 或可见性边界，再决定修哪里。
- save point 可发起表示可进入受控 pending，不等于 runtime writer 存在时必须立即 terminal success；terminal success 必须对应同一 file library 的 save point list、Files read 和 restore 路径可见事实。
- restore ready 前必须先收敛冲突的 RW writer fence / drain / flush；`pending`、`releasing`、`offline`、`not_found` 等状态必须有 owner 收敛路径，无法完成时返回 typed pending 或 failed。
- evidence-only patch 只用于判责和缩小 owner；不要新增 gate、report、wrapper retry、拉长等待或无限重试来掩盖 readiness 收敛缺口。

Gate adapter fidelity notes:
- adapter fidelity 统一看 `scripts/governance/current-gate-manifest.ts` 里的 `npmScript`、可选 `ciJob` 与 structured `executionTargets`
- free-form `command` 只作为 operator hint / 展示面，不再承担 enforcement truth

## Verification Guidance

给新开发者的执行边界：

1. 先区分诊断命令和 authoritative verdict
- `test` family commands、某个 focused Playwright spec、owner runbook 里的 targeted internal adapter，主要用于诊断、复现和缩小问题范围。
- 普通开发者先用 `npm run verify` 生成计划，并用 `npm run verify -- --goal=... --run` 执行正式验证；不从 gate adapter 目录手工拼流程。
- 诊断命令语境：`gate:default` 不是 full visual，也不是产品侧 readiness 结论。full visual 的内部 owner 是 `lane:visual`；面向人的 AgentSmith product readiness 入口统一看 `npm run product:ready`，它会在 precheck 通过后委托内部 campaign，并在 campaign context 内调用 aggregate readiness check。
- 维护者排障语境：`gate:release:full` 是 aggregate-only 内部复核器，只能在显式 campaign context 下由 release wrapper 或 owner runbook 使用；它不会执行任何 suite。

2. `command passed` 不等于验收通过
- 对 evidence-owning internal adapters，证据完整性与命令返回同级。
- 需要检查的证据包括 visual review artifacts、`visual_scene_catalog`、`ux_trace_bundle` 等当前文档或 contract 明确要求的产物。
- 对当前在 `scripts/governance/current-gate-result-schema.ts` 注册了 writer 的内部 owner，还要检查 canonical `<evidence_dir>/result.json`。
- 如果命令成功但 required machine-readable evidence 缺失，按治理规则仍然算失败。

3. 日常开发、功能收口、AgentSmith product readiness 自动化是三种不同路径
- 日常开发：先跑 contract / type / unit / targeted integration，尽量用最小成本定位问题。
- 功能收口：补跑与改动直接相关的 integration、e2e、story、backend-real smoke 或 targeted visual。
- AgentSmith product readiness 自动化：统一按照 [`docs/user-guides/release-readiness-checklist.md`](./docs/user-guides/release-readiness-checklist.md) 的自动化 campaign 执行，日常入口是 `npm run product:ready`。
- 如果需要理解 wave、证据、rerun 策略与常见误区，再看 [`docs/testing/verification-campaigns-v1.md`](./docs/testing/verification-campaigns-v1.md)。
- Diagnostic catalog 里的 internal adapters、unified deploy producers 与 `test:*` owner commands 是维护者诊断，不是普通流程的默认命令目录；诊断变绿后要回到 `npm run verify -- --goal=... --run` 或 `npm run product:ready`。

4. `failure_class` 是 gate verdict，不是 troubleshooting 标签
- `result.json` 里的 `failure_class` 只用于 canonical gate verdict。
- 本地排障脚本、incident note、人工 triage 可以有更细的分类，但不能拿来替代 canonical gate result，也不能把二者混写成同一套真相。

推荐阅读顺序：
- 当前治理真相：[`docs/current-engineering-governance-model.md`](./docs/current-engineering-governance-model.md)
- campaign 执行说明：[`docs/testing/verification-campaigns-v1.md`](./docs/testing/verification-campaigns-v1.md)
- AgentSmith product readiness 自动化与手工边界：[`docs/user-guides/release-readiness-checklist.md`](./docs/user-guides/release-readiness-checklist.md)
- gate verdict schema：[`docs/contracts/current-gate-result-schema-contract.md`](./docs/contracts/current-gate-result-schema-contract.md)
- 方法论背景：[`docs/design/agentsmith-product-engineering-governance-methodology-v1.md`](./docs/design/agentsmith-product-engineering-governance-methodology-v1.md)

## Current Runtime Lines

<!-- current-runtime-lines:development:start -->
当前 runtime-line 真相：
- 人类入口：[`Runtime Lines Matrix`](./docs/user-guides/runtime-lines-matrix.md) 与 [`Local Runtime Flows`](./docs/user-guides/local-runtime-flows.md)
- machine-readable source: [`scripts/governance/current-runtime-line-manifest.ts`](./scripts/governance/current-runtime-line-manifest.ts)

当前本机操作基线：
- `local-real` 是开发机上的正式人类入口；`local-manual` 只保留为底层 maintainer adapter。
- `local-real` 与 unified deploy substrate 共享默认本地 substrate 端口，在同一开发机上必须串行切换。

持续生效的 runtime contract：
- 只有一个 AgentSmith deploy 模型；当前 GA operator-facing release 路径是 `online` / `airgap` × `use_existing` / `install_substrates`。`local-kind` 与 `existing-cluster` 是 transition-only focused diagnostic entry names，不是 release targets、不是两套产品，也不是 `product:ready` 的部署结论。`install_substrates` 需要 release-kit namespace-scoped installer evidence 和显式确认。兼容 alias `kit_provided` 只保留在 transition-only diagnostics 内部，不是 GA operator `deployment_path`。
- Substrates 保持在 app namespace 外部，由 Docker 或运维提供的服务承载；AgentSmith app 工作负载运行在 Kubernetes。
- 当前里程碑 `api replicas=1`，直到引入明确的多副本 execution routing 设计。

当前本机工作线：
- `local-manual` — Daily development, real-backend manual validation, and focused Agent task / Files checks through the local-real entrypoint.

本文件只保留开发/排障入口；部署命令、profile、证据路径统一看 runtime-line 文档与 Unified Deploy Operations。
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
- unified deploy: app/substrate truth lives in `infra/deploy/unified/` and generated evidence under `artifacts/unified-deploy/`
- 机器可读报告语境：post-deploy product smoke handoff `npm run test:unified-deploy:product-flows` is only the focused aggregate diagnostic. The AgentSmith-owned canonical report producer is the product-flow lane (`lane:unified-deploy:product-flows`), with `UNIFIED_DEPLOY_RELEASE_CONTRACT` or `AGENTSMITH_RELEASE_CONTRACT_PATH` pointing to the downloaded `agentsmith-release-contract.json`, optional `UNIFIED_DEPLOY_RELEASE_SITE_ENV`, and `UNIFIED_DEPLOY_RELEASE_ROOT_DIR=<ga-smoke-evidence-root>`. It writes `<ga-smoke-evidence-root>/post-deploy-product-smoke/post-deploy-product-smoke-report.json` for release-kit `--ga-release`; it is not part of default `product:ready` / release-full.

模板入口：

- local-manual: `.env.local-manual.example`
- backend-real: `.env.backend-real.example`
- unified deploy: `infra/deploy/unified/env/site.env.example`

当前部署说明看 `docs/user-guides/unified-deploy-operations.md`。

### CI Image Publishing

`.github/workflows/image-publish.yml` is the current GHCR producer. It builds and pushes the single shared `agentsmith-app` image, writes `artifacts/image-publish/build-manifest.json`, and uploads `agentsmith-release-contract-input` for `.github/workflows/release-contract-artifact.yml`. The release contract artifact workflow also requires `runner_release_run_id` from the current `agentsmith-runner` `runner-image-publish` run, then downloads the canonical `runner-release-manifest` and `runner-ga-handoff` artifacts from that run.

GA fail-fast rule: do not invent separate `web`, `api`, `product_schema_bootstrap`, or backend/API image digests in AgentSmith CI. The release-contract input exposes the real `agentsmith_app` product image only; a separate backend/API image must be connected by its owner when that image exists.

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

依赖命令语义：

| Command | Semantics |
| --- | --- |
| `make deps-up` | 启动或更新 integration dependencies。 |
| `make deps-ready` | 只轮询 readiness，不启动 dependencies。 |
| `make deps-bootstrap` | Makefile helper：先 `deps-up`，再 `deps-ready`。 |
| `make deps-init` | 先 `deps-bootstrap`，再初始化 postgres/keycloak。 |
| `make deps-smoke` | 先 `deps-init`，再执行 dependency smoke。 |
| `make bootstrap` | 完整依赖准备入口，收口到 `deps-smoke`。 |

```bash
# 1) 一键准备依赖（启动 + 健康检查 + 初始化 + smoke）
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
make deps-init     # 启动/等待依赖后执行 postgres/keycloak 初始化
make api-dev-min   # 仅 keycloak + minio 的最小 API 启动
make web-msw       # 前端 mock 模式
make e2e                # mock e2e (MSW)
make e2e-int-minimal    # 最小集成测试
make e2e-int-chat       # chat 集成测试
make e2e-int-chat-auto  # 自动启动依赖+API+前端后执行 chat 集成测试
make e2e-int-chat-ux-auto # 自动启动并执行 chat UX 关键集成用例
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
`make agent-task-runner` / root `npm run agent:task-runner` 只保留在 owner runbook 指向的底层 diagnostic adapter 中，作为短期待删的 transition-only diagnostic：它们从当前 monorepo 源码启动本机 runner，不能作为正式成功路径或 release proof。默认不带 opt-in 会 fail fast；正式发布证据只接受 `agentsmith-runner` image/manifest/lock adoption 与对应 release contract digest。

```bash
AGENTSMITH_ALLOW_MONOREPO_RUNNER_DIAGNOSTIC=1 make agent-task-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-execution/ws?agent_runner_id=runner_xxx' AGENT_KEY='ask_xxx'
AGENTSMITH_ALLOW_MONOREPO_RUNNER_DIAGNOSTIC=1 make agent-task-runner-from-state
AGENTSMITH_ALLOW_MONOREPO_RUNNER_DIAGNOSTIC=1 make agent-task-smoke-full
AGENTSMITH_ALLOW_MONOREPO_RUNNER_DIAGNOSTIC=1 npm run agent:task-runner
```

## 本地真实手测环境

当前推荐的真实后端手测入口是 `make local-real-up`，它会把：

1. integration 依赖
2. universal-proxy
3. Node API
4. Next Web
5. local internal sandbox（kind / JuiceFS / ASBCP task execution service）

收成一条正式链路。`local-real` 是人类入口名，底层仍映射到已注册的 `local-manual` runtime line。

默认 `local-real-up` / `local-real-reset` 会拉起真实本地平台和 internal sandbox；internal sandbox 启动前会确保 managed Agent task diagnostic state。它不会启动本机 Developer runner 诊断进程；需要本机 runner 诊断时，再按 owner runbook 显式执行底层 diagnostic adapter。

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

### Start platform with internal sandbox

```bash
make local-real-up
```

这一步启动平台、拉起 internal sandbox，并在 internal sandbox 启动前确保 managed Agent task diagnostic state；它不启动本机 Developer runner 诊断进程。

### Prepare Agent task diagnostics only when owner runbook requires it

这一步是底层 owner diagnostic adapter。普通本机真实环境先从 `make local-real-up` 开始；只有需要单独重建或排障本机 Developer runner 诊断链路时再按 runbook 执行。

```bash
make local-manual-seed-agent-task
```

这一步会：

1. 刷新 `dev-admin` token
2. 创建 project / credential / endpoint / Developer runner config
3. 启动本机 Developer runner 诊断进程
4. 输出 Agent task URL

如果 owner runbook 只需要重建 managed Agent task diagnostic state，不启动本机 Developer runner，则使用显式环境：

```bash
AGENT_RUNNER_SEED_MODE=managed_agent_task LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER=0 bash scripts/local-manual/seed-agent-task-diagnostics.sh
```

### Check status

```bash
make local-real-status
```

### Inspect or rerun local internal sandbox when owner runbook requires it

```bash
make local-manual-internal-up
make local-manual-internal-status
```

`make local-real-up` / `make local-real-reset` 已经会调用 `local-manual-internal-up`。这组命令是 internal owner diagnostic adapter，只在需要聚焦重跑或排障 internal sandbox 时直接使用。

这一步会在底层 `local-manual` runtime line 基础上补：

1. 本地 `kind-agentsmith`
2. `agentsmith-sandbox` namespace
3. JuiceFS CSI
4. ASBCP image/contract 驱动的 internal task execution service
5. task execution workload

结束后如果想回到默认 external-only 模式：

```bash
make local-manual-internal-down
```

### Full reset

```bash
make local-real-reset
```

这一步会重建本地真实环境、确保 managed Agent task diagnostic state，并重新拉起 internal sandbox；它不启动本机 Developer runner 诊断进程。

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

`.env.local.example` is now a frontend-only shortcut for the narrow case
where you intentionally run `npm run dev` directly without `local-real`.

If you still need that shortcut, copy `.env.local.example` to `.env.local`
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
├── messages/            # i18n message files (src/messages)
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

Treat `npm run test:default-e2e` as a focused 诊断命令 / evidence-owner producer rerun, not as the default PR gate entry.

If daily verification also needs the real backend lane:

```bash
npm run verify -- --goal=real --run
```

For focused owner diagnostics on the real-backend core producer, rerun:

```bash
npm run test:backend-real:core
```

This backend-real producer auto starts integration dependencies, API, and frontend on dedicated ports. It is not product readiness sign-off; AgentSmith product-side readiness conclusions still use `npm run product:ready`.

## Release Readiness Checklist

For final AgentSmith product readiness verification, use the human-friendly readiness wrapper:

```bash
npm run product:ready
npm run product:status
```

Machine-readable Reports / Maintainer Troubleshooting Notes:

1. 机器可读报告语境：`npm run product:ready` is the human-friendly AgentSmith product-side readiness / local complete / contract and handoff input gate. It runs the non-verdict precheck first, then delegates to internal campaign adapters for `gate:fast`, `gate:default`, `lane:visual`, `gate:release`, and the aggregate readiness check. It does not execute or require unified deploy/local-kind/existing-cluster/product-flow deploy evidence, and it is not a deployment/package/operator verdict.
2. GA handoff with release-kit: pass the downloaded release contract with `npm run product:ready -- --release-contract <agentsmith-release-contract.json>` or `AGENTSMITH_RELEASE_CONTRACT_PATH=<agentsmith-release-contract.json> npm run product:ready`; a passed campaign writes `<campaign-root>/product-readiness/product-readiness-report.json`.
3. 维护者排障语境：`gate:release:full` is aggregate-only. Treat it as an internal verifier for an explicit campaign context, not as a copyable release command.
4. When diagnosing a failed campaign, rerun the owning evidence adapter from the owner runbook or manifest, then return to `npm run product:ready`.
5. Real-backend Agent task verification requires `PRESET_ENDPOINT_API_KEY`.
6. Unified deploy diagnostic roots are transition-only focused diagnostics / 过渡期专项诊断；when run directly, they derive a missing `PRESET_ENDPOINT_API_KEY` from repo-local runtime presets such as `.env.backend-real`.
7. 机器可读报告语境：Post-deploy product smoke handoff uses the product-flow lane (`lane:unified-deploy:product-flows`) as an AgentSmith-owned producer for release-kit `--ga-release`, not as a `product:ready` / release-full step. Configure the downloaded release contract with `UNIFIED_DEPLOY_RELEASE_CONTRACT` or `AGENTSMITH_RELEASE_CONTRACT_PATH`, the target site env with `UNIFIED_DEPLOY_RELEASE_SITE_ENV`, and the output root with `UNIFIED_DEPLOY_RELEASE_ROOT_DIR`.
8. The final human output is a short evidence summary. Keep raw logs for diagnosis, but do not treat common setup warnings such as NO_COLOR, Postgres already exists, or containerd deprecation as blockers unless the referenced evidence names them.

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
  - `artifacts/release-reports/`（generated report snapshots; current release authority comes from campaign-scoped `artifacts/release-runs/<campaign-run-id>` and `latest.json`）
  - `artifacts/release-escalations/`
  - `artifacts/governance-reports/`

使用规则：
1. 日常失败排查看 `test-results/`
2. mock visual 基线看 `e2e/__screenshots__/`
3. 真实后端人工界面审查看 `artifacts/backend-real-visual/<run-id>/`
4. Agent task / integration 当前运行态日志与状态优先看 `artifacts/backend-real/runs/<run-id>/...`
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

Treat `npm run test:governance` as a focused 诊断命令 / evidence-owner producer rerun, not as the default PR gate entry.

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

## Playwright E2E Diagnostics

Use this runbook when E2E is unstable or intermittently timing out. These commands are focused diagnostics; they do not replace the clean verification verdict path.

For normal PR acceptance, use:

```bash
npm run verify -- --goal=pr --run
```

For real-backend acceptance, use:

```bash
npm run verify -- --goal=real --run
```

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

## E2E Diagnostic Modes

We keep two E2E diagnostic modes with distinct responsibilities:

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
npm run test:e2e:integration:agent-task
```

### 3) Use route-targeted smoke for fast triage

```bash
BASE_URL=http://localhost:3001 npx playwright test --project=smoke e2e/smoke.spec.ts \
  --grep "loads /zh-CN/workspaces/ws_default/projects/proj_001/agent-tasks$" \
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

## Agent Task Execution Trace Workstream

This section records the current Agent task trace UI and evidence workflow. The user-facing surface is Agent tasks; runner identity and runner diagnostics stay in Agent Runners/admin surfaces.

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

### Current Scope

- Agent task activity shows execution details, recovered issues, final answer, terminal sessions, and artifacts.
- Trace storage/query/replay uses task routes such as `/tasks/:taskId/traces` and task SSE replay.
- Agent task terminal and run execution share a task-bound persistent HOME; managed paths are `/home/<task_home_segment>` and `/home/<task_home_segment>/workspace`.
- Deleting a task releases its file-library binding and keeps the file library contents. Archive keeps the binding.
- `FileLibrary.task_home_binding_status` is the frontend's authoritative binding truth; do not infer binding from task list responses.
- Reusable tool configuration, user-mode installs, and caches may live under `HOME`; short-lived execution tickets, Project secrets, and managed OAuth credentials must not be persisted to `HOME`, workspace files, Codex config, or reusable tool config.
- Artifact collection displays files from `$TASK_HOME/workspace/.artifacts` only.
- Chat model selection remains Endpoint-backed and does not dispatch Agent Runners.

### Diagnostic Commands

- UI-focused Agent task changes should start with focused component tests under `src/components/agent-tasks/__tests__/`.
- Runner/context owner diagnostics use `npm run test:agent-task:runner:fast`.
- Backend-real Agent task owner diagnostics use `npm run test:agent-task:runner:backend-real` when the change touches runner execution context, ticket scope, Context Store, or managed credentials.

### Where To Continue

Start from:
1. `docs/agent-task-runner-runbook.md` for current Agent task runner owner diagnostics.
2. `docs/contracts/agent-task-frontend-module-map.md` for frontend module boundaries.
3. `src/components/agent-tasks/TaskPage.tsx` and `src/components/agent-tasks/MessageItem.tsx` for the task activity UI.

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

## Manual UAT Runbook (GA Scope Lock)

When business logic changes are large, run this manual flow once before a GA scope-lock handoff:

1. Login and select workspace.
2. Open projects list, enter a project, verify no unexpected permission denial.
3. Verify project shell navigation and topbar switchers remain stable.
4. Validate members governance flow:
   - invite member
   - create/apply template
   - create/delete group
5. Validate resource management:
   - endpoints create/edit/toggle/delete
   - files upload/manage libraries
   - Agent Runners create/edit/toggle and key management
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

Permission gate model for the current GA scope is token-first:
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
Known limitation: auto-reconnection with token refresh is still runtime/security debt. Treat it as a current limitation to verify against the SSE client contract, not as a phase label.

### Build Issues

#### MSW appearing in production bundle
**Problem**: `grep -r "msw" .next/` finds MSW references
**Solution**: This is a known issue if MSW is statically imported.
Expected fix pattern: use dynamic imports or equivalent production-safe boundaries so MSW stays out of production bundles. Verify with the production bundle check rather than relying on a phase label.

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

## Agent Task Inputs And Artifacts

- Agent task inputs use `/tasks/:taskId/inputs` with `InputRef`-style records (`library_object`, `url`, `artifact`).
- Files default path uses project `file-libraries`; raw uploads land in a deterministic project library (`Project Uploads`) instead of personal upload storage.
- Agent task artifacts can be attached back into task inputs as first-class `artifact` refs.
- User-visible generated deliverables are collected from the task `$TASK_HOME/workspace/.artifacts` directory.
- Chat message `inputs` and attachment provenance support first-class `url` refs and project file-library-backed object refs.
- Shared backend resolver layering is in place:
  - `input-ref-resolver.ts` (ref keys / imported object extraction / dedupe helpers)
  - `input-ref-input-resolver.ts` (object/url/artifact request metadata resolution + fallback rules)
  - request-specific adapters build on top of the shared resolver layer

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
  - Agent task lifecycle / task input attach-remove / artifact creation
  - Agent task run usage (duration, tokens when available)
  - Chat message creation / attachment creation
  - Chat stream run lifecycle + usage
  - Endpoint proxy request usage (success/error, duration)
- Feature availability for `audit`, `usage`, `members`, and `resource_policy` in real backend mode is now governed by **supported enforcement scope**, not placeholder-vs-real status.
- Governance backend baseline now includes:
  - unified backend authz decisions and `/authorize` explain payloads
  - endpoint allow-list / rate / limit effects
  - source-library allow-list / rate / upload limit effects
  - Chat model access and Agent task request-rate effects
  - member permission, limit, suspend / restore / revoke downstream effects
  - opaque SSE ticket issuance with JWT query fallback disabled
