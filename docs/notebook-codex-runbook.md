# Notebook Codex Runner Runbook

术语边界：本文出现的 `release` / `engineering gate` 命令名是仓库内工程脚本命名；`permission gate` 仅表示产品权限门禁语义，不代表 AgentSmith 提供对外 DevOps 发布能力。

当前 notebook runner 真相：
- current product/object truth 以 [项目宪法](./项目宪法.md) 和 [Product Terminology Contract](./contracts/product-terminology.md) 为准
- current UI style guidance 参考 [DESIGN.md](../DESIGN.md)
- current engineering workflow 以 [Current Engineering Governance Model](./current-engineering-governance-model.md) 为准
- current notebook runner protocol / workspace binding / contracts 以 [Internal Agent Workspace Binding Model](./contracts/internal-agent-workspace-binding-model-v1.md) 和 [agent-execution-protocol.md](./contracts/agent-execution-protocol.md) 为准

## 1. Scope

这份 runbook 只保留当前 notebook / terminal runner 的操作与排障真相：
- external bare / external docker / internal k8s 三条运行模式
- task workspace / HOME / CODEX_HOME 的路径合同
- builtin skills / Context Store / managed credentials 的当前运行时约定
- 当前推荐验证命令与 evidence 路径

不再保留：
- 一次性 release checklist
- 历史 benchmark/evidence 说明
- 非当前 run-scoped 的证据路径说明

## 2. Current runtime contract

当前三条运行模式共享这些不变量：
- `cwd` 始终是 task-scoped workspace
- `HOME` 与 `cwd` 相同
- Codex runtime 状态写到 task-local `~/.codex`
- runner runtime 元数据写到 task-local `~/.mbos`
- builtin skills 安装到 task-local `~/.agents/skills`
- 用户可见 deliverables 写到 task-local `./.artifacts/`
- 共享上下文、简单 credentials、managed OAuth credentials 通过 AgentSmith Context Store 暴露，不应假设存在于 workspace 文件树

### Runtime modes

| Runtime mode | Typical use | workspace binding | Runner process location | Workspace path |
| --- | --- | --- | --- | --- |
| External bare | local-manual, host development | `file_library` | host machine | host task workspace |
| External docker | demo / cluster deploy external runner | `file_library` | runner container | `/workspace/<task_id>/` |
| Internal k8s | internal notebook workload pod | `pre_mounted` | workload container | `/workspace/<task_id>/` |

## 3. Current operational entrypoints

### Fast / default validation

```bash
npm run test:notebook:runner:fast
```

### Real verification clean path

```bash
make local-real-status
npm run verify -- --goal=real --run
```

### Notebook runner owner diagnostics

```bash
npm run test:notebook:runner:backend-real
```

### Terminal-specific owner diagnostics

```bash
npm run test:notebook:backend-real:terminal
npm run test:notebook:backend-real:terminal:matrix
npm run test:e2e:integration:notebook:terminal:ux
```

### Current release-grade notebook path

```bash
npm run release:ready
npm run release:status
```

默认从 `release:ready` 发起 release-grade campaign，用 `release:status` 查看当前 verdict / evidence 状态。`release:campaign:full` 只作为 `release:ready` 后面的 internal adapter identity 出现，不是 notebook runbook 里的可复制发布命令。下面的 owner identity 只用于 campaign 失败后的 diagnostics / rerun 归因，不能替代 `release:ready`。

| Owner identity | Use after campaign failure |
| --- | --- |
| internal adapter `gate:fast` / `gate:default` | Fast/default gate owner rerun. |
| internal adapter `lane:visual` | Visual lane owner diagnostics. |
| `make local-real-status` / `make local-real-up` | Clean backend-real status/start before an owner rerun. |
| `npm run backend-real:reset` / `npm run backend-real:bootstrap` / `npm run backend-real:ready` | Maintainer recovery only after clean status / verify paths fail and owner diagnostics require stack recovery. |
| internal adapter `lane:backend-real:release` | Backend-real release lane owner rerun. |
| internal verifier `gate:release:full` | Aggregate-only verifier for an existing campaign context; it does not execute suites. |

如果只排 notebook runner：
- 先看 `npm run test:notebook:runner:fast`
- 再看 `make local-real-status` 和 `npm run verify -- --goal=real --run`
- 如果问题仍落在 runner owner，再看 `npm run test:notebook:runner:backend-real`
- 最后按需要补 terminal matrix 与 UX owner diagnostics

## 4. Current evidence paths

当前 run-scoped evidence 目录统一使用：

- backend-real state / logs / token / integration outputs：
  - `artifacts/backend-real/runs/<run-id>/...`
- backend-real visual review：
  - `artifacts/backend-real-visual/<run-id>/review.md`
- task-local notebook deliverables：
  - `<task-workspace>/.artifacts/`

说明：
- current runbook 一律写 run-scoped `artifacts/backend-real/runs/<run-id>/...`

## 5. Current configuration

### Agent config

- mode: `external` 或 `internal`
- interaction kind: `notebook`
- required execution preferences:
  - `execution_preferences.notebook.endpoint_id`
- optional:
  - `wire_api`
  - `model`

### Runner env vars

- `MBOS_AGENT_WS_URL`
- `MBOS_AGENT_KEY`
- `CODEX_BIN`
- `MBOS_AGENT_TASK_TIMEOUT_SEC`
- `MBOS_AGENT_RUNNER_DEBUG=1`
- `MBOS_AGENT_CODEX_YOLO=1`
- `MBOS_AGENT_BUILTIN_SKILLS_DIR`
- `MBOS_AGENT_BUILTIN_SKILLS`
- `MBOS_AGENT_BUILTIN_SKILLS_REQUIRED`
- `MBOS_AGENT_WORKSPACE_ROOT`

## 6. Governance and product boundaries

当前 notebook baseline 覆盖这些治理对象：
- `Members`
- `Policy`
- `Audit`
- `Usage`
- `Project secrets` / `Files` / `Shared context` 作为 project-scoped supporting surfaces

产品命名与对象边界一律以 [Product Terminology Contract](./contracts/product-terminology.md) 为准。

## 7. Current troubleshooting shortcuts

1. 看当前 clean local-real path 是否 ready：
```bash
make local-real-status
```

2. 如果未启动，先走 clean start：
```bash
make local-real-up
```

3. 看 notebook runner fast gate：
```bash
npm run test:notebook:runner:fast
```

4. 看 real verification clean entrypoint：
```bash
npm run verify -- --goal=real --run
```

5. 只有问题仍落在 notebook runner owner 时，再看 notebook runner backend-real diagnostics：
```bash
npm run test:notebook:runner:backend-real
```

6. 如果问题落在 terminal：
```bash
npm run test:notebook:backend-real:terminal:matrix
npm run test:e2e:integration:notebook:terminal:ux
```

7. 如果问题落在 Context Store / skills / managed credentials：
```bash
npm run test:skills:fast
npm run test:skills:backend-real
```

## 8. What this runbook no longer contains

这份 runbook 不再承担：
- benchmark archive 命令手册
- traces query sweep 历史实验说明
- 一次性 release checklist
- completed retro / release evidence 记录

如果需要 current release verdict，看：
- [Release Readiness Checklist](./user-guides/release-readiness-checklist.md)
- human release execution entrypoint: `npm run release:ready`
- read-only release status entrypoint: `npm run release:status`
- campaign launcher behind the wrapper: internal adapter `release:campaign:full`
- aggregate-only verifier for an existing campaign: internal verifier `gate:release:full`

不要把裸 `gate:release:full` 当成 release 执行入口；它只复核已有 campaign evidence，不执行 suite。
