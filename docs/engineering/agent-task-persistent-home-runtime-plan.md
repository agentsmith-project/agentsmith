# Agent Task Persistent HOME Runtime Plan

更新时间：2026-05-08 PDT
状态：`handoff_plan_ready`
适用范围：Agent task terminal、Agent task agent 执行环境、task-bound persistent HOME、runner HOME/cwd/artifacts 路径语义

## 0. 文档状态

本文是下一步开发计划，用于把 Agent task terminal 和 agent 的文件系统运行语义收敛到同一个 task-bound persistent HOME。它不是当前实现真相，也不替代现有 contracts、OpenAPI、runner 协议或代码。

进入实现时，必须同步更新当前 truth docs、contracts、测试与实现代码。开发完成后，正式 contract 和 runbook 接管运行时真相；本文只保留为对应开发工作的计划记录，不再作为运行依据。

### 0.1 最新 findings 输入

当前实现仍有这些旧真相，实施时必须清理：

- `docs/contracts/agent-execution-protocol.md` 和 `docs/agent-task-runner-runbook.md` 仍描述 `HOME` 是 runner-private runtime home，且与 `cwd` 分离。
- API / OpenAPI 仍暴露 `container_workspace_path`，并在 managed task 中注入 `/workspace/${task.id}`。
- `packages/agent-task-runner` 仍使用 `/workspace/<task_id>`、runtimeRoot hash 和 `MBOS_AGENT_CODEX_STATE_ROOT` 来派生 HOME。
- sandbox workload 仍把 PVC mount path 和 container workingDir 绑定成同一路径。
- 当前任务删除路径未拥有 task HOME subtree 清理责任。

本文的 handoff 目标是让这些差异在实现中归零，而不是为旧路径保留长期兼容。

## 1. 产品目标

用户模型：

> 一个 Agent task 有一个持久 HOME。terminal 和 agent 都在这个 HOME 下工作，默认进入同一个 workspace。Pod 只是临时运行容器，回收后可以用同一个 HOME 继续。

工程模型：

> pre-GA 只使用任务绑定的 file-library-backed PVC。每个 task 在该 PVC 内拥有独立 subtree：`agent-tasks/<task_home_segment>`。managed Pod 内把该 subtree 挂载为 `TASK_HOME=/home/<task_home_segment>`，设置 `HOME=$TASK_HOME`，默认 `cwd=$TASK_HOME/workspace`，artifacts 只来自 `$TASK_HOME/workspace/.artifacts`。

需要删除的旧心智：

- `cwd` 和 `HOME` 分离。
- runner-private runtime home 位于 workspace 外部。
- `/workspace/<task_id>` 作为 managed 产品路径。
- runtime root hash contract。
- `/home/node` 作为 task home 或用户可见路径。
- `container_workspace_path` 作为 current contract 字段。

## 2. 不可变决策

| 决策 | 结果 |
| --- | --- |
| terminal 和 agent 是否共享 HOME | 是，同一个 Agent task 内必须共享 |
| Pod 是否是持久对象 | 否，Pod 可随时回收 |
| 持久对象是什么 | task-bound persistent HOME |
| 底层存储 | pre-GA 只使用任务绑定的 file-library-backed PVC |
| 是否引入 per-task PV/PVC | 否；未来需要时另起计划，不作为本计划分支 |
| PVC 内 task subtree | `agent-tasks/<task_home_segment>` |
| managed `TASK_HOME` | `/home/<task_home_segment>` |
| `HOME` | `$TASK_HOME` |
| 默认 `cwd` | `$TASK_HOME/workspace` |
| artifacts 扫描目录 | `$TASK_HOME/workspace/.artifacts` only |
| artifact wire path | 继续使用 `.artifacts/...` workspace-relative path |
| 是否创建 task Linux account | 否，`task_home_segment` 不是 Linux user |
| canonical HOME env | `TASK_HOME`；不新增 `MBOS_AGENT_TASK_HOME` 作为正式 contract |
| 是否持久化 terminal process/screen/PTY | 否 |
| 是否改变多 API routing | 否 |
| `workspace_binding_mode` 是否继续存在 | 可以继续存在为执行来源标记，但不得再表达旧 `/workspace/<task_id>` workspace-only path 语义 |

## 3. 路径与 Wire Contract

### 3.1 路径合同

```text
/home/<task_home_segment>/                 # TASK_HOME / HOME
/home/<task_home_segment>/workspace/       # cwd / WORKSPACE_PATH
/home/<task_home_segment>/workspace/.artifacts/
/home/<task_home_segment>/.codex/
/home/<task_home_segment>/.mbos/
/home/<task_home_segment>/.agents/
/home/<task_home_segment>/.cache/
/home/<task_home_segment>/.config/
/home/<task_home_segment>/.local/
/home/<task_home_segment>/.cargo/
/home/<task_home_segment>/.rustup/
```

规则：

- shared file library 根目录不能直接作为 `$HOME`。
- task HOME 必须是 file-library-backed PVC 下的 task 专属 subtree。
- Codex state、runner metadata、skills/cache、用户态安装和配置都写入 `$HOME` 下的稳定子目录。
- 用户可见生成产物只从 `$TASK_HOME/workspace/.artifacts` 扫描。

### 3.2 Runner / API 路径字段

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `task_home_path` | `/home/<task_home_segment>` | runner/sandbox 内部执行路径；managed canonical TASK_HOME |
| `workspace_path` | `/home/<task_home_segment>/workspace` | runner cwd；terminal 默认目录 |
| `artifacts_path` | `/home/<task_home_segment>/workspace/.artifacts` | runner 本地 artifact 扫描目录 |
| `workspace_binding_mode` | `file_library` / `pre_mounted` | 只表示执行来源；不再决定 HOME/cwd 路径形态 |
| `container_workspace_path` | removed | 不再作为 canonical contract 或 generated type 字段 |

所有 Agent task execution context 都必须下发 `task_home_path`、`workspace_path`、`artifacts_path`。`workspace_binding_mode=pre_mounted` 的新语义是：backend/sandbox 已把 task HOME subtree 挂载好，runner 直接使用下发的路径字段；它不再表示 `/workspace/<task_id>`，也不允许只下发单一 workspace path。`workspace_binding_mode=file_library` 的新语义是：runner/developer runtime 使用本地可访问路径，但仍必须保持同构布局：`HOME=$TASK_HOME`、`cwd=$TASK_HOME/workspace`、artifacts=`$TASK_HOME/workspace/.artifacts`。

`recommended_mount_path` 只用于 file-library 本地挂载指南，不参与 Agent task runtime path contract。

### 3.3 Sandbox workload contract

Sandbox create/ensure workload 必须支持 mount path、subPath、workingDir 分离：

```text
mount_path  = /home/<task_home_segment>
sub_path    = agent-tasks/<task_home_segment>
working_dir = /home/<task_home_segment>/workspace
```

环境变量：

```text
TASK_HOME=/home/<task_home_segment>
HOME=/home/<task_home_segment>
WORKSPACE_PATH=/home/<task_home_segment>/workspace
```

Sandbox 必须继续校验绝对路径、allowed prefixes、path traversal 和 UID/GID/fsGroup 可写性。

## 4. `task_home_segment`

`task_home_segment` 是后端在 task 创建时生成并持久化的路径段。它不是 Linux 用户名，不允许前端或用户手工拼接。

生成规则：

- 若 `task.id` 满足 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`，不等于 `.` / `..`，且不以保留前缀 `taskhash-` 开头，则直接使用 `task.id`。
- 否则使用 `taskhash-` + `sha256(workspace_id + "/" + project_id + "/" + task_id).slice(0, 32)`。
- 禁止替换式 sanitize 和截断式 sanitize。
- 生成后必须写入 task record，Pod 重建、terminal、agent run、cleanup 均读取同一个持久字段。
- 如果发现 segment 冲突，返回 typed provisioning error；不得复用已有 HOME。

Kubernetes workload id 继续使用单独算法，不复用 `task_home_segment` 作为 workload identity。

## 5. 生命周期与 Cleanup

| 对象 | 生命周期 | 是否持久 | Owner |
| --- | --- | --- | --- |
| Pod | 可随时回收 | 否 | sandbox |
| task HOME subtree | 随 task lifecycle | 是 | AgentSmith task lifecycle |
| terminal process | 随 terminal session / Pod | 否 | terminal runtime |
| agent process/run | 随 run | 否 | runner runtime |
| artifacts | 随 task HOME / file library | 是 | artifact collector 只读收集 |

Cleanup 规则：

- Archive 保留 task HOME。
- Delete task 在无 active run / active terminal 后删除 `agent-tasks/<task_home_segment>` subtree。
- Delete task 如果存在 active run、active terminal、terminal hard-teardown debt 或未完成 workspace holder，必须返回 typed conflict `AGENT_TASK_DELETE_BLOCKED`，并在响应中列出 blocker 类型；不得自动停止运行中的进程，也不得做部分 cleanup。
- Pod 删除、Pod 回收、sandbox idle cleanup 只释放进程和 Pod，不删除 task HOME。
- File library 删除必须阻止任何未删除 task 使用中的 library，不只检查 active task。
- local-real、backend-real、staging/手测 reset 必须清理 task HOME subtree。
- 对旧 runner-private HOME 布局不做静默双读或自动迁移；无法明确处理时返回 typed error，要求清理或重建。

本计划只持久文件系统状态，不承诺 terminal screen、PTY、前台命令、tmux 或跨 API durable routing。

## 6. 实施任务

### 6.1 Contracts / OpenAPI

- 更新 `docs/contracts/agent-execution-protocol.md`、OpenAPI、generated types 和 async/ws supplement。
- 删除 canonical `container_workspace_path`。
- 增加或统一 `task_home_path`、`workspace_path`、`artifacts_path`。
- 更新 `docs/contracts/internal-agent-workspace-binding-model-v1.md`，明确 binding 交付的是 task HOME path contract，不是单一 workspace mount path。

### 6.2 API Execution Context

- Task 创建时生成并持久化 `task_home_segment`。
- `internal-agent-workspace-provisioner.ts` 返回 `task_home_path`、`workspace_path`、`artifacts_path` 和 PVC `sub_path=agent-tasks/<task_home_segment>`。
- `internal-agent-pod-manager.ts` 传递 `TASK_HOME`、`HOME`、`WORKSPACE_PATH`，并传递 sandbox `mount_path`、`sub_path`、`working_dir`。
- `notebook-execution-orchestrator.ts` 和 `task-route-handler.ts` 只向 runner 下发新 path fields。
- Task DELETE / reset 增加 task HOME subtree cleanup owner 逻辑；DELETE blockers 使用 `AGENT_TASK_DELETE_BLOCKED` typed conflict 收口。
- File library DELETE 拦截所有未删除 task。

### 6.3 Sandbox Manager

- workload API/spec 支持 `mount_path`、`sub_path`、`working_dir` 分离。
- Pod spec 将 file-library-backed PVC 的 task subPath 挂载到 `/home/<task_home_segment>`。
- Container `workingDir` 设置为 `/home/<task_home_segment>/workspace`。
- 更新 manager config allowed prefixes，允许 `/home/<task_home_segment>`，继续拒绝相对路径和 traversal。
- 更新 sandbox docs、Go unit/e2e pod spec tests。

### 6.4 Runner Runtime

- 重写 `packages/agent-task-runner/src/task-workspace.ts` path builder。
- 删除 `/workspace/<task_id>` managed 产品路径。
- 删除 runtimeRoot hash HOME；`runtimeRoot` 若保留，只能等于 task HOME 或作为内部别名。
- `MBOS_AGENT_CODEX_STATE_ROOT` 不再作为正式 task HOME 来源。
- `TaskWorkspacePaths` 表达 `taskHome` / `homeDir` / `workspaceDir` / `artifactsDir`。
- Agent run 和 terminal 共同消费同一套 path builder。
- 更新生成的 task `AGENTS.md` / `RUNNER_RUNTIME.md`，删除 HOME/cwd 分离规则。

### 6.5 Artifacts / UI / Docs

- Artifact collector 只扫 `$TASK_HOME/workspace/.artifacts`。
- `$HOME/.codex`、`$HOME/.mbos`、`$HOME/.agents`、`$HOME/.local` 不进入 artifacts。
- UI/i18n 不承诺跨 task 复用 Codex state、runner metadata、skills/cache 或用户安装包。
- 同步 `AGENTS.md`、`docs/agent-task-runner-runbook.md`、`DEVELOPMENT.md`、product terminology、user guides。

## 7. TDD / Verification

首轮 red/green：

```bash
npm run test:run -- \
  packages/agent-task-runner/src/task-workspace.test.ts \
  packages/agent-task-runner/src/artifact-scan.test.ts \
  packages/agent-task-runner/src/user-install-env.test.ts \
  packages/agent-task-runner/src/terminal-runtime.test.ts \
  packages/agent-task-runner/src/index.test.ts \
  packages/agent-task-runner/src/task-assets.test.ts \
  packages/agent-task-runner/src/child-launcher.test.ts \
  packages/agent-runner/src/protocol.test.ts \
  packages/api-entry-node/src/internal-agent-workspace-provisioner.test.ts \
  packages/api-entry-node/src/internal-agent-pod-manager.test.ts \
  packages/api-entry-node/src/sandbox-manager-client.test.ts \
  packages/api-entry-node/src/notebook-execution-orchestrator.test.ts \
  packages/api-entry-node/src/task-route-handler.test.ts
```

Sandbox 侧：

```bash
cd ../mbos-sandbox-v1
make test-unit
```

如果改动 sandbox manager API/spec、request validation、Pod spec builder 或 PVC mount/subPath/workingDir 逻辑，再跑：

```bash
cd ../mbos-sandbox-v1
make test-integration
```

Focused gates：

```bash
npm run contracts:check-openapi
npm run openapi:check-generated
npm run test:skills:fast
npm run test:agent-task:runner:fast
npm run test:internal:backend-real:agent-task-workspace
```

阶段收口：

```bash
make local-real-status
npm run verify -- --goal=pr --run
```

涉及真实 managed Pod recycle、local-kind sandbox 或发布路径时升级：

```bash
cd ../mbos-sandbox-v1
make test-e2e
cd ../agentsmith
npm run verify -- --goal=real --run
npm run release:ready
npm run release:status
```

负向检查：

```bash
rg -n "/home/node|/workspace/<task_id>|container_workspace_path|runner-private runtime home|runtime root hash|MBOS_AGENT_CODEX_STATE_ROOT" docs packages src scripts infra
```

负向检查允许匹配本计划中“旧心智待删除”的说明；实现完成后的 truth docs、代码、generated types、UI/i18n 和测试 snapshot 不得把这些内容写成当前真相。

## 8. Acceptance

功能验收：

- Managed task 的 terminal 和 agent 中 `HOME` 都是 `/home/<task_home_segment>`。
- Managed task 的 terminal 和 agent 默认 `pwd` 都是 `/home/<task_home_segment>/workspace`。
- Managed task 的 execution context 无论使用 `file_library` 还是 `pre_mounted`，都包含 `task_home_path`、`workspace_path`、`artifacts_path`，且不包含 canonical `container_workspace_path`。
- Pod 回收并重建后，`$HOME/.codex`、`$HOME/.mbos`、`$HOME/.agents`、`$HOME/.local`、`$HOME/workspace` 仍存在。
- 写入 `$HOME/workspace/.artifacts/a.txt` 会被收集；写入 `$HOME/.artifacts/b.txt`、`$HOME/.mbos/x`、`$HOME/.codex/y` 不会被收集。
- Developer runner 可以使用本地绝对路径，但必须保持同构布局：`HOME=$TASK_HOME`、`cwd=$TASK_HOME/workspace`、artifacts=`$TASK_HOME/workspace/.artifacts`。
- Task DELETE 删除 task HOME subtree；Archive 不删除。
- Task DELETE 遇到 active blocker 时返回 `AGENT_TASK_DELETE_BLOCKED`，不自动停止进程，不做部分 cleanup。
- File library DELETE 阻止仍有关联未删除 task 的 library。

工程验收：

- OpenAPI/generated types 不再包含 canonical `container_workspace_path`。
- `task_home_segment` 有单测覆盖正常 id、reserved prefix、非法字符、hash fallback、冲突 typed error。
- Sandbox Go tests 覆盖 mount path / subPath / workingDir 分离；涉及 manager API/spec 或真实 Pod recycle 时补充 integration/e2e evidence。
- Runner 生成的 task `AGENTS.md` / `RUNNER_RUNTIME.md` 不再描述 HOME/cwd 分离。
- `docs/contracts/agent-execution-protocol.md`、`docs/agent-task-runner-runbook.md`、`AGENTS.md`、`DEVELOPMENT.md` 已同步。
- focused tests、sandbox tests、contract/openapi checks、matching `verify` goal 均通过并保留 evidence。
