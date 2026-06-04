# Agent Task Runner Owner Diagnostics

术语边界：本文出现的 `release` / `engineering gate` 命令名是仓库内工程脚本命名；`permission gate` 仅表示产品权限门禁语义，不代表 AgentSmith 提供对外 DevOps 发布能力。

当前 agent-task runner 真相：
- current product/object truth 以 [项目宪法](./项目宪法.md) 和 [Product Terminology Contract](./contracts/product-terminology.md) 为准
- current UI style guidance 参考 [DESIGN.md](../DESIGN.md)
- current engineering workflow 以 [Current Engineering Governance Model](./current-engineering-governance-model.md) 为准
- current agent-task runner protocol / workspace binding / contracts 以 [Internal Agent Workspace Binding Model](./contracts/internal-agent-workspace-binding-model-v1.md) 和 [agent-execution-protocol.md](./contracts/agent-execution-protocol.md) 为准

## 1. Scope

这份 runbook 只保留当前 Agent task / terminal runner 的操作与排障真相：
- managed runner / sandbox k8s 的可执行 task HOME 诊断模式
- Developer runner 的连接/存在状态诊断，以及 Slice 5 blocked 时的 fail-closed 证据要求
- task workspace / HOME / CODEX_HOME 的路径合同
- builtin skills / Context Store / request-scoped credential inputs 的当前运行时约定
- 当前推荐验证命令与 evidence 路径

不再保留：
- 一次性 release checklist
- 历史 benchmark/evidence 说明
- 非当前 run-scoped 的证据路径说明

## 2. Current runtime contract

Managed runner is the current executable task HOME binding chain.

当前可执行 task HOME 链路共享这些不变量：
- `TASK_HOME` / `HOME` 始终是 task-bound persistent HOME：managed canonical path 是 `/home/<task_home_segment>`
- managed runner 的 HOME 来自 AFSCP workload mount binding 和 orchestrator-only mount plan；诊断路径不得从临时 task id 派生 HOME。
- `cwd` 始终是 `$TASK_HOME/workspace`
- Codex runtime 状态写到 `$HOME/.codex`
- runner runtime 元数据写到 `$HOME/.mbos`
- builtin skills 安装到 `$HOME/.agents/skills`
- 用户可见 deliverables 写到 `$TASK_HOME/workspace/.artifacts/`
- 可复用工具配置、用户态安装产物和缓存可以写入当前 `HOME`
- 短期 execution ticket、Project secrets、外部连接 credential material 不得持久化到 `HOME`、workspace、Codex config 或可复用工具配置；运行时只通过请求级环境变量暴露
- 共享上下文和用户显式写入的简单自定义值可以通过普通 Context Store keys 读取；不要依赖 `managed_credentials.*` projection 或 provider-specific credential route 的成功路径
- `agent-task-credential-file-safety-smoke` 只作为负向安全检查，证明外部连接不会生成 credential files，也不会投影 managed/provider credentials；默认 backend-real / engineering smoke 不执行这条 focused diagnostic。

### Developer runner Slice 5 blocker posture

AFSCP export-backed developer connector 安全实现前，Developer runner 不是当前可执行 HOME binding 主链。它只能用于 Developer runner 记录、密钥/连接配置、readiness projection 和 Test connection 这类连接/存在状态诊断。

Slice 5 blocked 时必须 fail closed：
- Developer runner 不得创建、解析或暴露 local `file_library` HOME。
- Developer runner runner-test task、task HOME/file access、terminal/recovery execution self-check 都必须拒绝或保持不可用。
- 关闭 evidence 只需要 upstream blocker/no-workaround evidence：说明当前 AFSCP 合约缺少安全 export-backed lease/connector，并证明 AgentSmith 没有加入 raw storage/local path workaround。
- 不要求 Developer runner backend-real/deploy smoke；如果 Slice 5 后续 unblocked 并实现，才恢复 Developer runner file marker / task execution smoke。

### Runtime modes

| Runtime mode | Typical use | Storage access posture | Runner process location | Task HOME / workspace |
| --- | --- | --- | --- | --- |
| Developer runner | connection/existence diagnostics while Slice 5 is blocked | no task HOME/file access; fail closed for execution self-check | host machine | none while blocked; must not create local `file_library` HOME |
| Managed runner | unified deploy managed agent-task runner | AFSCP workload mount binding | Kubernetes runner container | `/home/<task_home_segment>`, `/home/<task_home_segment>/workspace` |
| Sandbox k8s | sandbox workload pod | orchestrator-provided mounted repo payload | workload container | `/home/<task_home_segment>`, `/home/<task_home_segment>/workspace` |

Local/manual profiles that exercise the deployment default managed runner must prove the runner has a valid internal sandbox/runtime configuration before task execution. If the sandbox is unavailable, task creation or create-and-start should fail with a clear unavailable/configuration state instead of producing `AGENT_SANDBOX_NOT_CONFIGURED` after dispatch. Any sandbox/pod-internal API base must be reachable from inside that environment and must not rely on browser-host `localhost`.

### Runtime pending/readiness convergence

这里的 runtime pending/readiness 指 Agent task 可执行环境、Files 读投影、AFSCP workspace binding 在进入可读/可执行状态前的后台收敛过程；它是工程收口主题，不按单个偶发 bug 处理。

Convergence rules:
- Agent Task sandbox `offline` / `not_found`: call ASBCP create-or-ensure for the workload, then continue status checks until `Running`, `Failed`, or timeout.
- Agent Task sandbox `pending`: keep polling bounded readiness/status checks until `Running`, `Failed`, or timeout; do not treat the first pending status as terminal failure.
- Agent Task sandbox `releasing`: wait for workload release or surface a typed release-incomplete error; do not start a second conflicting task HOME holder.
- AFSCP workspace binding `releasing` / `release_pending`: continue release convergence through the workspace binding owner until the binding is terminal (`released`, `revoked`, `expired`, or `deleted`) before read export is considered clean.
- AFSCP workspace binding PVC lookup not ready: ASBCP `ensure_workspace_binding` returning `internal_error` with message `get persistent volume claim failed` is treated as bounded readiness convergence evidence, not as a terminal sandbox-unavailable failure on the first occurrence.
- Files read export `pending`: return typed pending to the caller, trigger or continue runtime-access release convergence, and invalidate the read export once when this request/background recheck moves runtime access to released.
- Files read export after a completed runtime-release fence: if the list path is still pending, treat the completed fence as released, keep the pending read export warm for the caller's next poll, and do not do a second synchronous list in the same request; do not turn completed fences into repeated export revoke/create loops.

Evidence rules:
- `AGENT_SANDBOX_UNAVAILABLE` backend-real evidence must include the API trace, pod-manager diagnostic summary, ASBCP create/status call summaries, request id, workload id, phase, and error code when those fields are available.
- A focused gate that first fails with sandbox unavailable and then passes on rerun is recorded as a `runtime flake`. Consecutive sandbox-unavailable failures for the same focused gate are a stability blocker until the runtime owner evidence explains or fixes the repeated failure.
- Product readiness sign-off keeps the Files restore continuation focused backend-real gate as a key evidence item before running the full Product Readiness campaign.

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

### Transition-only monorepo runner owner diagnostic

这些命令只用于 owner 排障，默认 fail fast。正常运行/发布路径消费 `agentsmith-runner` image/manifest/lock；不要把 monorepo source runner 启动写成 release proof。

```bash
AGENTSMITH_ALLOW_MONOREPO_RUNNER_DIAGNOSTIC=1 make agent-task-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-execution/ws?agent_runner_id=runner_xxx' AGENT_KEY='ask_xxx'
AGENTSMITH_ALLOW_MONOREPO_RUNNER_DIAGNOSTIC=1 make agent-task-runner-from-state
AGENTSMITH_ALLOW_MONOREPO_RUNNER_DIAGNOSTIC=1 make agent-task-smoke-full
AGENTSMITH_ALLOW_MONOREPO_RUNNER_DIAGNOSTIC=1 npm run agent:task-runner
```

### Terminal-specific owner diagnostics

```bash
npm run test:agent-task:backend-real:terminal
npm run test:agent-task:backend-real:terminal:matrix
npm run test:e2e:integration:agent-task:terminal:ux
```

### Current release-grade Agent task path

```bash
npm run product:ready
npm run product:status
```

默认从 `product:ready` 发起 release-grade campaign，用 `product:status` 查看当前 readiness / evidence 状态。`npm run release:ready` / `npm run release:status` 只是 deprecated transition aliases / 过渡 alias，不给 deployment、package 或 operator verdict。`release:campaign:full` 只作为 `product:ready` 后面的 internal adapter identity 出现，不是 Agent task runbook 里的可复制发布命令。下面的 owner identity 只用于 campaign 失败后的 diagnostics / rerun 归因，不能替代 `product:ready`。

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
- Slice 5 blocked 时，Developer runner HOME/file access/backend-real/deploy smoke 不作为本轮通过条件；记录 fail-closed 与 no-workaround evidence。

## 4. Current evidence paths

当前 run-scoped evidence 目录统一使用：

- backend-real state / logs / token / integration outputs：
  - `artifacts/backend-real/runs/<run-id>/...`
- backend-real visual review：
  - `artifacts/backend-real-visual/<run-id>/review.md`
- task-local deliverables：
  - `<task-home>/workspace/.artifacts/`
- Developer runner Slice 5 blocker evidence：
  - upstream blocker/no-workaround record in the same run-scoped evidence bundle or PR evidence notes; do not attach local path or raw `file_library` smoke as acceptance evidence.

说明：
- current runbook 一律写 run-scoped `artifacts/backend-real/runs/<run-id>/...`

## 5. Current configuration

### Runner config

- Agent Runners are task-only execution capability records.
- The default managed runner is deployment/system-side configuration and is read-only from frontend/project APIs.
- The current milestone has exactly one deployment default managed runner available across workspaces/projects.
- Model/endpoint access is resolved through project Endpoint/model governance, not through mutable frontend runner configuration.
- User task creation may omit `bound_runner_id` to bind the default managed runner.
- `Developer runner` records may be created, configured, and test-connected through the Agent Runners management surface. While Slice 5 is blocked, Developer runner task binding, runner-test task, file access, terminal execution, and recovery execution must fail closed through backend affordances; no local path workaround is allowed.
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

`TASK_HOME` / `HOME` / `WORKSPACE_PATH` are execution-context env vars for managed/sandbox task execution. Slice 5 blocked Developer runner connection diagnostics must not synthesize them from a host-local file-library path.

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

7. 如果问题落在 Context Store / skills / request-scoped credential env：
```bash
npm run test:skills:fast
npm run test:skills:backend-real
```

手测/回归时必须确认：
- default managed runner seed/config 走 system-side/internal path，不走 public Agent Runners create API
- default managed sandbox 已配置，或 task creation/create-and-start 提前暴露 unavailable/configuration state
- sandbox/pod 内部 API base 不是 browser-host `localhost`
- managed runner 的 AFSCP-backed task HOME / terminal / recovery smoke 有证据
- Developer runner 在 Slice 5 blocked 时只有连接/存在状态证据；task HOME/file access/execution self-check 必须 fail closed，并附 upstream blocker/no-workaround evidence

## 8. What this runbook no longer contains

这份 runbook 不再承担：
- benchmark archive 命令手册
- traces query sweep 历史实验说明
- 一次性 release checklist
- completed retro / release evidence 记录

如果需要 current release verdict，看：
- [Release Readiness Checklist](./user-guides/release-readiness-checklist.md)
- human release execution entrypoint: `npm run product:ready`
- read-only release status entrypoint: `npm run product:status`
- campaign launcher behind the wrapper: internal adapter `release:campaign:full`
- aggregate-only verifier for an existing campaign: internal verifier `gate:release:full`

不要把裸 `gate:release:full` 当成 release 执行入口；它只复核已有 campaign evidence，不执行 suite。
