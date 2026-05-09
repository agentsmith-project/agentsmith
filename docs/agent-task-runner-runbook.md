# Agent Task Runner Owner Diagnostics

术语边界：本文出现的 `release` / `engineering gate` 命令名是仓库内工程脚本命名；`permission gate` 仅表示产品权限门禁语义，不代表 AgentSmith 提供对外 DevOps 发布能力。

当前 agent-task runner 真相：
- current product/object truth 以 [项目宪法](./项目宪法.md) 和 [Product Terminology Contract](./contracts/product-terminology.md) 为准
- current UI style guidance 参考 [DESIGN.md](../DESIGN.md)
- current engineering workflow 以 [Current Engineering Governance Model](./current-engineering-governance-model.md) 为准
- current agent-task runner protocol / workspace binding / contracts 以 [Internal Agent Workspace Binding Model](./contracts/internal-agent-workspace-binding-model-v1.md) 和 [agent-execution-protocol.md](./contracts/agent-execution-protocol.md) 为准

## 1. Scope

这份 runbook 只保留当前 Agent task / terminal runner 的操作与排障真相：
- local developer / managed docker / sandbox k8s 三条诊断模式
- task workspace / HOME / CODEX_HOME 的路径合同
- builtin skills / Context Store / managed credentials 的当前运行时约定
- 当前推荐验证命令与 evidence 路径

不再保留：
- 一次性 release checklist
- 历史 benchmark/evidence 说明
- 非当前 run-scoped 的证据路径说明

## 2. Current runtime contract

当前三条运行模式共享这些不变量：
- `TASK_HOME` / `HOME` 始终是 task-bound persistent HOME：managed canonical path 是 `/home/<task_home_segment>`
- Developer runner self-check / runner-test task 也使用绑定 file library 的稳定 `task_home_segment` 和 `binding_generation`；诊断路径不得从临时 task id 派生 HOME。
- `cwd` 始终是 `$TASK_HOME/workspace`
- Codex runtime 状态写到 `$HOME/.codex`
- runner runtime 元数据写到 `$HOME/.mbos`
- builtin skills 安装到 `$HOME/.agents/skills`
- 用户可见 deliverables 写到 `$TASK_HOME/workspace/.artifacts/`
- 可复用工具配置、用户态安装产物和缓存可以写入当前 `HOME`
- 短期 execution ticket、Project secrets、managed OAuth credentials 不得持久化到 `HOME`、workspace、Codex config 或可复用工具配置；它们只通过请求级环境变量或 AgentSmith Context Store 只读投影暴露
- 共享上下文、简单 credentials、managed OAuth credentials 通过 AgentSmith Context Store 暴露，不应假设存在于 workspace 文件树

### Runtime modes

| Runtime mode | Typical use | workspace binding | Runner process location | Task HOME / workspace |
| --- | --- | --- | --- | --- |
| Local developer | local-manual, host development | `file_library` | host machine | same layout: `$TASK_HOME`, `$TASK_HOME/workspace` |
| Managed docker | unified deploy managed agent-task runner | `file_library` | runner container | `/home/<task_home_segment>`, `/home/<task_home_segment>/workspace` |
| Sandbox k8s | sandbox workload pod | `pre_mounted` | workload container | `/home/<task_home_segment>`, `/home/<task_home_segment>/workspace` |

Local/manual profiles that exercise the deployment default managed runner must prove the runner has a valid internal sandbox/runtime configuration before task execution. If the sandbox is unavailable, task creation or create-and-start should fail with a clear unavailable/configuration state instead of producing `AGENT_SANDBOX_NOT_CONFIGURED` after dispatch. Any sandbox/pod-internal API base must be reachable from inside that environment and must not rely on browser-host `localhost`.

## 3. Current operational entrypoints

### Agent-task runner fast owner diagnostic

```bash
npm run test:agent-task:runner:fast
```

### Real verification clean path

```bash
make local-real-status
npm run verify -- --goal=real --run
```

### Agent-task runner owner diagnostics

```bash
npm run test:agent-task:runner:backend-real
```

### Terminal-specific owner diagnostics

```bash
npm run test:agent-task:backend-real:terminal
npm run test:agent-task:backend-real:terminal:matrix
npm run test:e2e:integration:agent-task:terminal:ux
```

### Current release-grade Agent task path

```bash
npm run release:ready
npm run release:status
```

默认从 `release:ready` 发起 release-grade campaign，用 `release:status` 查看当前 verdict / evidence 状态。`release:campaign:full` 只作为 `release:ready` 后面的 internal adapter identity 出现，不是 Agent task runbook 里的可复制发布命令。下面的 owner identity 只用于 campaign 失败后的 diagnostics / rerun 归因，不能替代 `release:ready`。

| Owner identity | Use after campaign failure |
| --- | --- |
| internal adapter `gate:fast` / `gate:default` | Fast/default gate owner rerun. |
| internal adapter `lane:visual` | Visual lane owner diagnostics. |
| `make local-real-status` / `make local-real-up` | Clean backend-real status/start before an owner rerun. |
| `npm run backend-real:reset` / `npm run backend-real:bootstrap` / `npm run backend-real:ready` | Maintainer recovery only after clean status / verify paths fail and owner diagnostics require stack recovery. |
| internal adapter `lane:backend-real:release` | Backend-real release lane owner rerun. |
| internal verifier `gate:release:full` | Aggregate-only verifier for an existing campaign context; it does not execute suites. |

如果只排 agent-task runner：
- 先看 owner diagnostic：`npm run test:agent-task:runner:fast`
- 再看 focused backend-real diagnostics：`npm run test:agent-task:runner:backend-real`
- 按需要补 terminal matrix 与 UX owner diagnostics
- 阶段收口或跨模块变更时再回到 `make local-real-status` 和 `npm run verify -- --goal=real --run`

## 4. Current evidence paths

当前 run-scoped evidence 目录统一使用：

- backend-real state / logs / token / integration outputs：
  - `artifacts/backend-real/runs/<run-id>/...`
- backend-real visual review：
  - `artifacts/backend-real-visual/<run-id>/review.md`
- task-local deliverables：
  - `<task-home>/workspace/.artifacts/`

说明：
- current runbook 一律写 run-scoped `artifacts/backend-real/runs/<run-id>/...`

## 5. Current configuration

### Runner config

- Agent Runners are task-only execution capability records.
- The default managed runner is deployment/system-side configuration and is read-only from frontend/project APIs.
- The current milestone has exactly one deployment default managed runner available across workspaces/projects.
- Model/endpoint access is resolved through project Endpoint/model governance, not through mutable frontend runner configuration.
- User task creation may omit `bound_runner_id` to bind the default managed runner, or authorized expert creation may send `bound_runner_id` for a Developer runner.
- Run, retry, terminal, and recovery actions do not accept runner selection fields; they use the task's immutable bound runner.
- Public Agent Runners create/update/delete/key APIs manage Developer runners only and must reject managed runner config/default/key mutation fields.

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
- `TASK_HOME`
- `HOME`
- `WORKSPACE_PATH`

## 6. Governance and product boundaries

当前 Agent task baseline 覆盖这些治理对象：
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

3. 看 agent-task runner fast gate：
```bash
npm run test:agent-task:runner:fast
```

4. 看 focused backend-real runner diagnostics：
```bash
npm run test:agent-task:runner:backend-real
```

5. 阶段收口或跨模块变更时再看 real verification clean entrypoint：
```bash
npm run verify -- --goal=real --run
```

6. 如果问题落在 terminal：
```bash
npm run test:agent-task:backend-real:terminal:matrix
npm run test:e2e:integration:agent-task:terminal:ux
```

7. 如果问题落在 Context Store / skills / managed credentials：
```bash
npm run test:skills:fast
npm run test:skills:backend-real
```

手测/回归时必须确认：
- default managed runner seed/config 走 system-side/internal path，不走 public Agent Runners create API
- default managed sandbox 已配置，或 task creation/create-and-start 提前暴露 unavailable/configuration state
- sandbox/pod 内部 API base 不是 browser-host `localhost`
- managed runner 和 Developer runner 两条 task/terminal/recovery smoke 都有证据

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
