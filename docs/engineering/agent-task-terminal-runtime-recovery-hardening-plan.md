# Agent Task Terminal Runtime Recovery Hardening Plan

更新时间：2026-05-08 PDT
状态：`handoff_plan_ready`
适用范围：Agent task terminal、runner websocket control channel、terminal PTY 生命周期、terminal session 恢复、Developer runner 本机路径、local-manual / backend-real terminal gates

## 0. 文档状态

本文是下一步开发工作的结构化 handoff plan，用于修复并加固两类同源问题：

- 用户进入 Agent task terminal 后，切换页面或刷新回来，terminal 显示需要恢复、`failed` 或 `agent_disconnected`，但没有回到同一个 terminal process。
- backend-real / terminal UX 验证暴露 Developer runner 在本机普通进程中使用 `/home/task_*` 创建 task HOME，触发 `EACCES`。

Terminal close/recovery 的当前实现语义以 [`Agent Task Terminal Runtime Recovery Engineering Guidance`](./agent-task-terminal-runtime-recovery-guidance.md) 为准；本文保留 broad recovery hardening 大图。

本文不是当前实现真相，也不替代 OpenAPI、generated types、runner protocol、代码或 runbook。进入实现后，必须同步更新 contracts、API/runner/frontend 代码、测试和 current truth docs；实现完成后，以 contracts、runbook 和代码作为运行依据，本文只保留为对应工作的计划记录。

本计划不是临时绕路方案。目标是把 terminal 恢复职责、PTY 生命周期、runner reconnect/adopt、close tombstone、runtime-aware path resolver 和 local-manual 配置源收敛成可测试的工程真相。

## 1. 用户原始问题复述

用户问题：

> 打开 Agent task terminal 后，切换到其他页面或刷新浏览器，再回到 task terminal，页面显示 terminal 需要恢复，或者直接进入 `failed / agent_disconnected`。用户期望如果原 terminal process 仍在，系统应自动恢复到同一个 terminal process，而不是失败，也不是新开一个 shell 冒充旧 session。

验证中新增暴露的问题：

> Developer runner / local-manual 路径使用 managed pod 的 `/home/<task_home_segment>` 形态。本机普通用户进程无权在 `/home` 下创建 `/home/task_*`，导致 terminal warmup 或 task HOME 初始化出现 `EACCES`。

## 2. 最新 Root Cause

这次问题不是单一前端刷新问题，而是六个职责边界没有同时收敛。

### 2.1 Browser close

Browser websocket close 只表示浏览器连接离开了 terminal 视图。它不拥有 terminal PTY，也不应把 terminal session 标记为不可恢复失败。

正确语义：

- browser close after handshake：terminal session 保持 live，`browser_connection_status=browser_disconnected`。
- 浏览器刷新回来：通过后端 persisted session truth 重新 attach/reconnect。
- browser reconnect 不能伪造 runtime truth；输入能力取决于后端返回的 `input_enabled`。

### 2.2 Runner transport close

Runner websocket transport close 表示 API 到 runner 的控制通道断开。它不是 terminal PTY 已消失的证据。

当前问题链路：

- API 在 runner socket release 时把 terminal runtime stream 当作 fatal error 收口，写出 `failed / agent_disconnected`。
- Runner 在 websocket close 后进入 shutdown 或终止 terminal process，导致原 PTY 真的丢失。
- 前端刷新后只能读到 failed truth，无法恢复。

正确语义：

- task run child process 可以因 runner transport lost 收口失败。
- terminal PTY 不因短暂 transport lost 被杀。
- live terminal session 进入 `recovering + transport_lost`，等待 runner reconnect 后 adopt。

### 2.3 API persisted session reload

API reload 或 service-level session reload 不应把 persisted live terminal 解释成失败。API 只能确认：曾经存在一个 live session，但当前 runtime handle 丢失，需要恢复或等待超时。

正确语义：

- persisted `pending / active / disconnected / recovering` session reload 后进入 `recovering + transport_lost`。
- 若没有 `recovery_deadline_at`，API 设置 bounded deadline。
- 若 deadline 已过期，read-time expiry 收敛为 typed failed。
- reload 后不得自动发送 `server.terminal.start` 给同一个 `terminal_session_id`。

### 2.4 Runner ready / adopt

Runner reconnect 后的 `agent.ready` 必须携带可被 adopt 的 `active_terminals`。API 需要用 persisted task/session truth 校验 ownership，然后发 `server.terminal.adopt`，恢复旧 PTY 的控制绑定。

当前风险：

- `agent.ready.active_terminals` 被忽略或和 detach 持久化竞争。
- adopt 缺少 runner id、runner session、terminal session、connection epoch、generation、attempt id 等 fencing。
- stale socket 或重复 ready/adopt 可能影响新 truth。

正确语义：

- detach transition 必须先持久化，再处理同 runner authority 的新 ready/adopt。
- adopt 只能恢复同一个 `terminal_session_id` 对应的旧 PTY。
- adopt 成功后 `input_enabled=true`；失败必须进入 typed final state。

### 2.5 Terminal PTY lifecycle

Terminal PTY 生命周期属于 runner 运行环境，不属于浏览器。API 保存 session truth 和 blocker truth，但不持久化 PTY 本身。

正确语义：

- browser close 不结束 PTY。
- runner transport close 不结束 PTY。
- 用户点击结束、close tombstone ack、shell 自然退出、runner process 明确 shutdown、PTY crash 才改变 PTY 生命周期。
- runner process 确认已终止 terminal processes，或 recovery/adopt 超时后，API 才进入不可恢复 final state。

### 2.6 Developer runner 本机路径 EACCES

Managed pod 内的 canonical task HOME 是 `/home/<task_home_segment>`。这个路径在容器/pod 内由平台挂载和权限控制保证可写。

Developer runner 是本机普通用户进程。当前 path contract 没有按 runtime profile 分层，API/runner 把 managed pod canonical path 直接用于 developer local runtime，导致本机进程执行 `mkdir /home/task_*` 时触发 `EACCES`。

正确语义：

- API 持久化稳定的 `task_home_segment`。
- API 按 runtime profile 解析实际执行路径。
- managed pod：`TASK_HOME=/home/<task_home_segment>`。
- developer local：`TASK_HOME=<developer_workspace_root>/<task_home_segment>`，默认 root 为 `$HOME/ags-workspace`。
- local-manual API 和 runner 必须注入同一个 developer workspace root。
- runner 使用 API 下发的 resolved paths，不静默把 `/home/...` 翻译成本机路径。

## 3. 产品目标

1. 用户切换页面或刷新回来后，如果 terminal PTY 仍存在，自动恢复同一个 `terminal_session_id` 和同一个 terminal process。
2. 恢复中页面展示明确的 recovering 状态，禁用输入，不把用户引向手动临时绕路动作。
3. 恢复成功后，terminal 输入重新启用；历史输出按 replay 能力诚实展示 `complete / partial / unavailable`。
4. 若 terminal process 确实丢失，后端返回 typed `failure_kind`，前端展示用户可理解文案，不暴露裸 `agent_disconnected`。
5. Developer runner 在本机 local-manual / backend-real 环境中使用可写 task HOME root，terminal warmup 成功。
6. Managed runner / managed pod 仍使用 `/home/<task_home_segment>`，不因 developer local 修复而退化。
7. API 仍是路径、session、failure、recovery、close 的唯一后端真相。
8. Task 页面整体 surface 能同时表达 terminal recovery、agent task run failure、runner interruption，且不会把 task run failure 误投射成 terminal recovery failure。

## 4. 非目标

本计划明确不做：

1. 不引入 tmux、screen、terminal daemon 或远程桌面能力。
2. 不承诺持久化 PTY、screen、alternate screen、cursor mode 或完整视觉现场。
3. 不新增长期 terminal transcript、录像、持久记录或可检索历史终端审计能力。
4. 不要求 replay 完整才允许恢复；replay 缺失不阻塞同一 terminal process 的恢复。
5. 不引入多 API gateway 或 durable routing 架构。
6. 不让前端本地缓存伪造 terminal truth。
7. 不在同一个 `terminal_session_id` 下静默启动新 shell 冒充旧 session。
8. 不把 terminal recovery 扩成审计、配额、Incident 或 SLA 大改造。
9. 不让 runner 根据字符串前缀静默改写 API 下发路径。
10. 不把 Developer runner 路径问题处理成手工 chmod `/home` 或要求开发者用 root 运行。

## 5. 不可变决策

| 决策 | 结果 |
| --- | --- |
| 后端是否仍是 terminal/session/path 真相 | 是 |
| Managed pod 内 canonical `TASK_HOME` | `/home/<task_home_segment>` |
| Developer runner 本机 `TASK_HOME` | `<developer_workspace_root>/<task_home_segment>`，默认 root 为 `$HOME/ags-workspace` |
| Developer runner 是否保持同构布局 | 是：`HOME=$TASK_HOME`、`cwd=$TASK_HOME/workspace`、artifacts=`$TASK_HOME/workspace/.artifacts` |
| API 是否按 runtime profile 解析 resolved paths | 是 |
| Runner 是否静默翻译 API 下发路径 | 否 |
| Browser close 是否等于 terminal failed | 否 |
| Runner transport close 是否立即等于 terminal failed | 否 |
| API reload 后 live session 是否直接 failed | 否，进入 bounded recovery 或 read-time typed expiry |
| 恢复是否可以启动新 shell 冒充旧 session | 否 |
| `recovering` 是否允许 terminal 输入 | 否 |
| 用户 close 是否通过 tombstone 收敛 | 是 |
| `closing` 是否可以被 adopt 复活 | 否 |
| `failed` 是否必须 typed `failure_kind` | 是 |
| 是否向普通用户暴露裸 `agent_disconnected` | 否 |
| execution context 与 workspace-access 谁是 runner path 真相源 | execution context 是唯一 runner path 真相源；workspace-access 不是第二路径真相源 |

## 6. Target Runtime Model

### 6.1 Path model

持久身份：

```text
task_home_segment = backend-generated stable segment
```

Managed pod resolved paths：

```text
TASK_HOME=/home/<task_home_segment>
HOME=/home/<task_home_segment>
WORKSPACE_PATH=/home/<task_home_segment>/workspace
ARTIFACTS_PATH=/home/<task_home_segment>/workspace/.artifacts
```

Developer local resolved paths：

```text
developer_workspace_root=$HOME/ags-workspace   # default, scripts pass explicit absolute root
TASK_HOME=<developer_workspace_root>/<task_home_segment>
HOME=<developer_workspace_root>/<task_home_segment>
WORKSPACE_PATH=<developer_workspace_root>/<task_home_segment>/workspace
ARTIFACTS_PATH=<developer_workspace_root>/<task_home_segment>/workspace/.artifacts
```

Contract rules：

- API response to runner contains resolved `task_home_path`、`workspace_path`、`artifacts_path` for that runtime profile.
- Runner path truth source is the task run / terminal create execution context. Runner must consume these execution context paths as authoritative.
- `workspace-access` only provides mount credentials and workspace access material. It may echo resolved paths for API-side diagnostics and consistency checks, but it must not become a second runner path truth source.
- If `workspace-access` echoes paths, runner validates them against execution context paths and fails typed on mismatch, using `runtime_path_unavailable` or a protocol/configuration error according to the failing layer.
- Public/user-facing surfaces do not expose internal absolute paths to ordinary users.
- `task_home_segment` is not a Linux user and is not manually provided by users.
- Local reset/cleanup deletes only configured developer workspace root subtrees owned by Agent task runtime.

### 6.2 Terminal lifecycle model

Coarse statuses remain product-facing summaries, but implementation must keep lifecycle dimensions separate：

```text
pending -> starting -> active -> recovering -> active
                                  |          -> failed
active -> closing -> closed
active -> closed
active -> failed
```

Required dimensions：

- `lifecycle_status`: `pending | starting | active | recovering | closing | closed | failed`
- `runner_connection_status`: `dispatching | attached | transport_lost | adopting | missing | closed`
- `browser_connection_status`: `attached | browser_disconnected | none`
- `close_state`: `none | requested | delivered | acked | expired`
- `input_enabled`: boolean
- `recoverable`: boolean
- `recovery_deadline_at`: ISO timestamp or null
- `failure_kind`: typed enum or null

### 6.3 Close tombstone model

Close tombstone is the authority for user/system close. It is not the same as browser close.

Rules：

- Browser close never writes close tombstone.
- User clicks end terminal：API writes `close_state=requested` and disables input.
- If authoritative runner socket is available，API delivers close frame and moves to `delivered`。
- Runner returns matching close ack：API finalizes `closed`。
- Tombstone expires or runner reports missing：API finalizes `failed + terminal_process_lost`。
- If runner reconnects with active terminal while session is `closing`，API delivers close tombstone；it must not adopt that PTY back to active。

### 6.4 Failure kind model

`agent_disconnected` is a runner transport reason, not user-facing terminal failure kind.

Minimum `failure_kind` set for this plan：

| failure_kind | Meaning |
| --- | --- |
| `process_start_failed` | terminal process failed during start |
| `process_exited_unexpectedly` | terminal process exited outside normal close/user shell exit path |
| `protocol_error` | runner/browser terminal protocol mismatch, stale generation, invalid payload |
| `permission_revoked` | current actor no longer has authority to access terminal |
| `runner_recovery_timeout` | recovery deadline expired before adopt success |
| `terminal_process_lost` | runner reports not found, close tombstone cannot resolve, or process disappeared |
| `runner_process_exited` | runner process explicitly exited and terminal processes were terminated |
| `terminal_runtime_session_mismatch` | runtime event does not match persisted terminal session truth |
| `runtime_path_unavailable` | resolved task HOME cannot be prepared by the intended runtime profile |

### 6.5 Replay boundary

Replay is best-effort continuity, not the recovery authority.

- This plan does not add long-term terminal transcript storage, recording, screen persistence, or searchable terminal history.
- Recovery authority is whether the same terminal PTY can be adopted, not whether previous output can be fully replayed.
- Replay uses only existing replay/ring-buffer capability. It may return `complete / partial / unavailable`.
- `partial` or `unavailable` replay must not block same-process recovery when adopt succeeds.
- Frontend copy must distinguish "terminal recovered" from "some previous output may be unavailable".

### 6.6 Task page surface model

Task page surfaces must keep three states separate:

| State | Meaning | UI rule |
| --- | --- | --- |
| Terminal recovery | Existing terminal session may still have a live PTY and is being reattached | Terminal panel shows recovering; input disabled; no failed/raw transport copy |
| Agent task run failure | A specific agent run failed or was interrupted | Header/detail/run summary may show run failed, but must not make terminal recovery look failed |
| Runner interruption | Runner transport was interrupted | Ordinary user copy uses product availability language; raw `agent_disconnected` is hidden everywhere |

Task header、task detail、activity/run summary、terminal panel、toast、inline errors and any ordinary user visible area must not display bare `agent_disconnected`. A runner interruption can fail the current agent task run while terminal recovery remains in progress for the existing PTY.

### 6.7 `runtime_path_unavailable` audience strategy

`runtime_path_unavailable` must be typed once, then rendered by audience.

| Audience | Visible copy / behavior | Hidden details |
| --- | --- | --- |
| Ordinary user | "The task workspace is temporarily unavailable. Try again later or contact an administrator." Terminal/task actions stay disabled according to backend affordances. | Absolute host paths, `/home/task_*`, developer root, mount credentials, runner diagnostics |
| Developer runner owner | Show that the local Developer runner workspace root is not writable or not configured, with the configured root only on Developer runner setup/diagnostic surfaces. Provide the env/config key to fix, not chmod `/home`. | Other users' task paths, credentials, full internal stack traces |
| System/admin/diagnostic | Show typed error, diagnostic id, runtime profile, runner id, and redacted resolved path context in gated diagnostics/logs. Full path may appear only in protected diagnostic evidence. | Nothing leaks to ordinary task UI |

## 7. Detailed Implementation Tasks

### 7.1 Contracts / types

- Update `docs/contracts/agent-execution-protocol.md` for:
  - `agent.ready.active_terminals`
  - `server.terminal.adopt`
  - `agent.terminal.adopted / not_found / exited / error`
  - `agent.shutdown`
  - close tombstone ack semantics
- Update OpenAPI / generated types for terminal session fields:
  - `lifecycle_status`
  - `runner_connection_status`
  - `browser_connection_status`
  - `input_enabled`
  - `recoverable`
  - `recovery_deadline_at`
  - `failure_kind`
  - `close_state`
  - `close_reason`
  - `close_deadline_at`
  - `replay_status`
  - `latest_seq`
- Update execution context types to require:
  - `task_home_segment`
  - `runtime_profile`
  - `task_home_path`
  - `workspace_path`
  - `artifacts_path`
- Add typed contract coverage for `runtime_path_unavailable` and terminal failed states.
- Remove current contract wording that treats `/home/<task_home_segment>` as universal across developer local and managed pod. It is managed pod canonical, not host universal.
- Add negative generated-type tests that fail if terminal recovery uses bare `agent_disconnected` as user-facing `failure_kind`.
- Document that terminal replay fields describe output continuity only; they are not recovery authority and do not require new persistent transcript storage.

### 7.2 API services

Runtime-aware path resolver：

- Add a backend path resolver owned by API execution context construction.
- Inputs:
  - workspace/project/task identifiers
  - persisted `task_home_segment`
  - bound runner kind / runtime profile
  - configured developer workspace root
  - managed pod path policy
- Outputs:
  - `task_home_path`
  - `workspace_path`
  - `artifacts_path`
  - `runtime_profile`
- Managed profile resolves to `/home/<task_home_segment>`.
- Developer local profile resolves to `<developer_workspace_root>/<task_home_segment>`.
- Resolver validates absolute path, normalized segment, allowed root, traversal rejection, and root writability preflight where available.
- If developer root is unavailable or unwritable, return typed configuration/runtime error before dispatch, not late `EACCES`.
- Wire the resolver through the three current API call sites:
  - task run execution context
  - terminal create execution context
  - `workspace-access`
- Keep authority decision complete: task run / terminal create execution context is the runner path truth source; `workspace-access` may echo resolved paths only for API-side diagnostics/consistency and must not independently derive runner paths.
- Add consistency checks so mismatched echoed `workspace-access` paths fail typed before runner side effects.

Terminal recovery coordinator：

- Split browser close, runner transport close, API reload, runner ready/adopt, close tombstone, and terminal PTY final events.
- `AgentExecutionService.releaseSocketState()`:
  - task run stream may fail on runner transport lost.
  - terminal stream moves to recoverable detach, not fatal `agent_disconnected`.
  - detach transition is serialized per runner authority before a newer socket's ready/adopt path runs.
- `NotebookTerminalService`:
  - persists `recovering + transport_lost`
  - sets recovery deadline once per recovery episode
  - keeps live blocker during `recovering`
  - disables input until adopt success
  - treats old stream end after detach as detach tail, not terminal completion
  - performs read-time expiry for stale `recovering` and `closing`
- API service reload:
  - persisted live sessions become `recovering + transport_lost`
  - persisted closing sessions remain `closing`
  - expired recovery/close deadlines finalize with typed failure
- `processReadyMessage()`:
  - validates `active_terminals` top-level payload
  - drops malformed descriptors without blocking valid descriptors
  - waits for prior detach persistence on the same runner authority
  - calls terminal recovery coordinator with valid active terminal descriptors
- `adoptTerminalSession()`:
  - sends only `server.terminal.adopt`
  - never sends `server.terminal.start` for an existing `terminal_session_id`
  - accepts only current authoritative socket response
  - fences by workspace/project/task, resolved runner id, runner session id, terminal session id, connection epoch, generation, and adopt attempt id
  - duplicate ready/adopt is idempotent
  - maps `agent.terminal.not_found` to `failed + terminal_process_lost`
  - maps `agent.terminal.error` to typed `protocol_error` or `process_start_failed` according to payload phase/reason
  - maps `agent.terminal.exited` with normal exit evidence to `closed`, and unexpected exit evidence to `failed + process_exited_unexpectedly`
- Close authority:
  - user close writes tombstone
  - recovering + user close becomes `closing`
  - closing session cannot be adopted back to active
  - close ack requires matching tombstone attempt
- Permission / ownership:
  - reconnect, stdin, resize, close, adopt, and recovery actions revalidate task/session/runner authority
  - permission revoked finalizes `failed + permission_revoked` and best-effort closes runner PTY

### 7.3 Runner

- On websocket close:
  - enter reconnecting state
  - do not shutdown runner process
  - do not terminate active terminal PTYs
  - terminate only active task run child process if the run stream cannot remain authoritative
- On reconnect:
  - send `agent.ready` with `active_terminals`
  - include `runner_instance_id`, `connection_epoch`, `runner_session_id`, `terminal_session_id`, `generation`, dimensions, and current cwd
- Implement `server.terminal.adopt`:
  - bind API control to existing PTY
  - do not create a new PTY
  - return adopted/not_found/exited/error with request/adopt/generation fencing fields
- Implement graceful shutdown frame:
  - include shutdown reason
  - include whether terminal processes were terminated
- Path handling:
  - use API-provided `task_home_path`, `workspace_path`, `artifacts_path` exactly
  - do not translate `/home/...` to a developer root locally
  - if `workspace-access` echoes path fields, validate them against execution context paths and fail typed on mismatch
  - fail fast with typed runtime path error if paths are outside allowed local root or unwritable
  - set `TASK_HOME`、`HOME`、`WORKSPACE_PATH` for terminal and agent child processes
  - warmup creates `$TASK_HOME`、`$TASK_HOME/workspace`、`$TASK_HOME/workspace/.artifacts` under the resolved root
- Artifact collection:
  - collect only from `$TASK_HOME/workspace/.artifacts`
  - do not collect `$HOME/.codex`、`$HOME/.mbos`、`$HOME/.agents`、cache or user toolchain directories

### 7.4 Local-manual scripts / gates

- Introduce a single local developer workspace root config:

```bash
MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT="${HOME}/ags-workspace"
```

- `make local-real-up`、backend-real bootstrap、local API process、Developer runner process and terminal UX gate must receive the same explicit absolute root.
- Do not let API and runner separately derive root from different `HOME` values.
- Reset/cleanup commands must remove only task runtime subtrees under that configured root.
- Add preflight logging/evidence for:
  - resolved developer workspace root
  - root exists or is creatable by current user
  - task HOME path for a started Developer task
  - terminal warmup success
- Update `scripts/agent-task-terminal-ux-real-gate.sh` so the current failing gate exercises the same root injection as local-manual.
- Add a negative gate assertion: Developer runner must not attempt `mkdir /home/task_*` on host runtime.
- Developer terminal smoke must read `task_home_segment` from task response/API truth before asserting paths. Do not assume task id maps directly to the segment; add a focused non-direct segment test if current fixtures only cover direct segments.

### 7.5 Frontend UX / i18n

- Task terminal panel uses backend fields, not local inference, for:
  - recovering
  - input disabled
  - failed reason
  - whether a new terminal can be started
- Task header/detail/activity/terminal panel share the same redaction rule: no ordinary user visible surface displays raw `agent_disconnected`.
- Task run failure caused by runner interruption may appear in run summary, but terminal recovery UI must remain recovering while the terminal session is recoverable.
- `recovering` UI:
  - visible state: system is reconnecting the terminal
  - input and resize side effects disabled until `terminal.state ready` with `input_enabled=true`
  - refresh status may re-read backend truth, but is not the primary recovery action
  - task actions that require no live terminal respect `recovering` as live blocker
  - browser refresh/navigation return must not flash failed or raw error before backend truth is loaded
- `failed` UI:
  - show typed failure explanation from `failure_kind`
  - do not show raw `agent_disconnected`
  - do not reuse old `terminal_session_id`
  - any "start new terminal" action creates a new session only when backend allows, and copy must not imply old process was restored
  - after recovery timeout, primary action is "start new terminal" or equivalent backend-allowed action; copy must state the previous terminal could not be restored
- `closing` UI:
  - show ending state
  - no input
  - no adopt/recover button
- Recovery success:
  - terminal panel returns to ready/active with input enabled
  - focus and cursor/input affordance match `input_enabled=true`
  - if replay is partial/unavailable, show output continuity note without weakening the recovered state
- i18n:
  - add/adjust keys in `agent_tasks` and `errors`
  - include copy for `runner_recovery_timeout`、`terminal_process_lost`、`runtime_path_unavailable`、`permission_revoked`
  - ordinary user copy must avoid runner internals, pod terms, absolute internal paths, and raw diagnostic ids
  - Developer/admin diagnostics for `runtime_path_unavailable` must use audience-gated copy from Section 6.7

### 7.6 Docs cleanup

After implementation, update:

- `docs/contracts/agent-execution-protocol.md`
- `docs/contracts/internal-agent-workspace-binding-model-v1.md`
- `docs/agent-task-runner-runbook.md`
- `docs/engineering/agent-task-terminal-runtime-recovery-guidance.md`
- `docs/engineering/agent-task-persistent-home-runtime-plan.md` if its path model needs current-status notes
- `DEVELOPMENT.md`
- relevant user guides / troubleshooting docs

Cleanup requirements:

- Current truth docs must distinguish managed pod canonical path from developer local resolved path.
- Current truth docs must state API is resolved path source.
- Current truth docs must not present `agent_disconnected` as user-facing terminal failure.
- Old wording that says local developer uses `/home/<task_home_segment>` must be removed or rewritten as managed-only.

## 8. TDD / Verification Plan

Use progressive validation. Start with focused unit/contract tests, then backend-real and terminal UX gates. Do not run heavy visual catalog or full release gate unless the implementation expands into broad visual, release, deploy, or unrelated cross-module risk.

### 8.1 Focused unit red/green

Add or update focused tests first:

```bash
npm run test:run -- \
  packages/api-entry-node/src/internal-agent-runtime-path-resolver.test.ts \
  packages/api-entry-node/src/notebook-terminal-service.test.ts \
  packages/api-entry-node/src/agent-execution-service.test.ts \
  packages/api-entry-node/src/notebook-execution-orchestrator.test.ts \
  packages/api-entry-node/src/task-route-handler.test.ts \
  packages/agent-task-runner/src/task-workspace.test.ts \
  packages/agent-task-runner/src/terminal-runtime.test.ts \
  packages/agent-task-runner/src/index.test.ts
```

Required unit coverage:

- managed path resolver returns `/home/<task_home_segment>`.
- developer path resolver returns `$HOME/ags-workspace/<task_home_segment>` by default or the configured root.
- developer resolver rejects traversal and unwritable roots with typed error.
- task run execution context, terminal create execution context, and `workspace-access` all use the same runtime-aware resolver.
- `workspace-access` echoed paths are consistency checks only; mismatch fails typed and does not become runner path truth.
- runner does not translate API paths.
- websocket close preserves terminal PTY and enters reconnecting.
- API socket release moves terminal to `recovering`, not `failed / agent_disconnected`.
- API reload converts persisted live session to bounded `recovering`.
- ready/adopt success restores same `terminal_session_id` without a new start.
- adopt negative results cover `not_found`、`error`、`exited` mappings.
- close tombstone prevents adopt resurrection.
- failed terminal always has typed `failure_kind`.
- Developer terminal path assertions read `task_home_segment` from API truth, with non-direct segment coverage.

### 8.2 Contract and generated type checks

```bash
npm run contracts:check-openapi
npm run openapi:check-generated
npm run contracts:check
```

If the contract slice is still being developed, run the first two on each contract edit and reserve full `contracts:check` for slice close.

### 8.3 Focused runner / skills diagnostics

`test:skills:*` and `test:agent-task:runner:*` can overlap because agent-task runner diagnostics reuse skill runtime coverage in this repository. Choose the smallest relevant owner diagnostic for the touched slice; do not require all aliases to run by default.

For runner env / task HOME / terminal execution context:

```bash
npm run test:agent-task:runner:fast
```

If the slice also changes builtin skills, Context Store ownership, managed credential resolution, or shared skill runtime env, use the skills owner entrypoint instead or in addition:

```bash
npm run test:skills:fast
```

Backend-real escalation is risk-based:

```bash
npm run test:agent-task:runner:backend-real
npm run test:skills:backend-real
```

### 8.4 Backend-real terminal gates

Terminal smoke/matrix are focused diagnostics. Run them after unit/contract green when you need to isolate backend terminal behavior before the UX gate:

```bash
npm run test:agent-task:backend-real:terminal
npm run test:agent-task:backend-real:terminal:matrix
```

The current failing UX gate is the required closure evidence for this plan:

```bash
npm run test:e2e:integration:agent-task:terminal:ux
```

This gate must prove:

- browser navigation/refresh recovery returns to the same terminal process when PTY exists.
- Developer runner terminal warmup does not attempt `/home/task_*` on the host.
- failed UI uses typed failure copy and never displays bare `agent_disconnected`.
- task run interruption copy does not make terminal recovery appear failed.
- no refresh-time flash of failed/raw error appears before recovering truth renders.
- after timeout, the primary action starts a new terminal and does not imply the old process was restored.
- recovery success restores focus/input affordance consistently with `input_enabled=true`.

### 8.5 Stage close

For this targeted fix, stage close should normally stop at:

```bash
npm run verify -- --goal=pr --run
```

Only escalate to these when risk expands into real deploy configuration, broad release readiness, or visual-system behavior:

```bash
npm run verify -- --goal=real --run
npm run verify -- --goal=visual --run
npm run release:ready
```

## 9. Acceptance Criteria

Functional acceptance:

- 用户打开 terminal，切换页面或刷新回来后，若原 PTY 仍在，系统自动恢复同一个 `terminal_session_id` 和同一个 terminal process。
- 恢复期间 terminal 输入禁用；adopt 成功后输入恢复。
- API/runner 不发送第二个 `server.terminal.start` 来恢复同一个 session。
- runner transport close 不直接把 terminal 写成 `failed / agent_disconnected`。
- API reload 后 live terminal session 进入 bounded `recovering`，不会直接 failed。
- close tombstone 下的 session 不会被 runner ready/adopt 复活。
- terminal process 确认丢失或超时后，session 进入 typed failed，并释放 live blocker。
- 普通用户 UI 不展示裸 `agent_disconnected`、pod 内部词、内部绝对路径或 diagnostic id。
- Replay 缺失或 partial 不阻塞同一 PTY 恢复；本计划不新增长期 transcript/录像/持久 terminal 记录。
- Task run 因 runner 中断失败时，task header/detail/run summary 可以表达 run failed，但 terminal panel 在可恢复期间仍显示 recovering，不显示 failed/raw transport error。

Path/runtime acceptance:

- Managed runner / managed pod 内 `TASK_HOME=/home/<task_home_segment>`。
- Developer runner 本机 `TASK_HOME=$HOME/ags-workspace/<task_home_segment>`，或使用显式配置的 developer workspace root。
- Developer runner terminal warmup 成功创建 `$TASK_HOME/workspace/.artifacts`。
- API 和 runner 在 local-manual / backend-real 中使用同一个 developer workspace root。
- Task run execution context、terminal create execution context、`workspace-access` 使用同一个 runtime-aware resolver。
- Execution context 是 runner path 真相源；`workspace-access` 只提供 mount credentials，并且路径 echo mismatch 会 typed fail。
- Runner 不尝试在 host 上创建 `/home/task_*`。
- Developer terminal smoke 从 task response/API truth 读取 `task_home_segment`，不按 task id 直接拼路径。
- Artifacts 只来自 `$TASK_HOME/workspace/.artifacts`。
- Managed runner terminal/task path 不因 developer local 修复而退化。

UX acceptance:

- 刷新回来不能先闪 `failed`、raw `agent_disconnected` 或裸错误，再切到 recovering。
- recovering 是单一清晰状态，terminal 输入、resize side effects 和 prompt affordance 都禁用。
- 恢复超时后主行动是启动新终端；文案不得暗示旧 terminal process 已恢复。
- 恢复成功后 terminal 回到 active/ready，焦点、cursor、输入可用状态与 `input_enabled=true` 一致。
- replay partial/unavailable 只作为输出连续性提示，不改变 recovered 状态。

Engineering acceptance:

- Contracts、OpenAPI、generated types、MSW/fixtures、frontend types 同步。
- Focused unit/contract tests 先红后绿。
- `npm run test:e2e:integration:agent-task:terminal:ux` 通过并保留 evidence。
- `npm run test:agent-task:backend-real:terminal:matrix` 通过。
- Reviewer 能从 tests/evidence 中看到 browser close、runner transport close、API reload、runner ready/adopt、close tombstone、developer path resolver 六条职责链。

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| detach 与 ready/adopt 竞争，导致 active terminal descriptor 被忽略 | per runner authority 序列化 release 和 ready 处理；测试覆盖 ready 早到 |
| runner reconnect 后重复 adopt 创建多个 PTY 或重复绑定 | adopt idempotency、generation fencing、断言没有第二个 start |
| browser reconnect 期间输入穿透到未恢复 PTY | `input_enabled=false` server-side enforcement；前端和 API 双测 |
| close tombstone 与 adopt 竞争导致用户已关闭的 PTY 复活 | `closing` 优先级高于 recovering；ready 时先处理 close tombstone |
| Developer root 不一致导致 API 下发路径和 runner warmup 路径不同 | local scripts 显式注入同一个 `MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT` |
| 修复 developer path 时破坏 managed pod `/home/<task_home_segment>` | resolver profile tests 和 managed backend-real terminal matrix |
| typed failure 映射遗漏，UI 继续显示 raw reason | generated type exhaustive checks、i18n key coverage、terminal UX assertion |
| artifact collector 扫到 `$HOME` 下 runtime/cache | artifact scan tests 只允许 `workspace/.artifacts` |
| workspace-access 被误用成第二路径真相源 | execution context authority tests、workspace-access echo mismatch typed failure |
| task id 直接拼成本机 task HOME 导致 segment 规则漏测 | smoke 从 API truth 读取 `task_home_segment`，补 non-direct segment test |

## 11. Reviewer Checklist

Reviewer 需要逐项确认：

- 文档/contract 是否明确区分 managed pod canonical path 和 developer local resolved path。
- API 是否是 resolved path 真相源，runner 是否没有路径静默翻译。
- execution context 是否是 runner path 真相源，`workspace-access` 是否只提供 mount credentials / consistency echo。
- local-manual API 和 runner 是否共享同一个 developer workspace root。
- Developer smoke 是否从 API truth 读取 `task_home_segment`，并覆盖 non-direct segment。
- Browser close、runner transport close、API reload、runner ready/adopt、terminal PTY lifecycle 是否各有单测或 backend-real 证据。
- `releaseSocketState()` 是否不再把 terminal stream 直接收口为 `failed / agent_disconnected`。
- runner websocket close 是否不再杀 active terminal PTY。
- `agent.ready.active_terminals` 是否经过 authority / generation / attempt fencing。
- adopt `not_found / error / exited` 是否有 API-side negative result tests 和 typed 映射。
- 同一 `terminal_session_id` 恢复路径是否没有第二个 `server.terminal.start`。
- `closing` session 是否不会被 adopt 复活。
- replay 缺失是否不会阻塞同一 PTY 恢复，且没有新增长期 terminal transcript/录像承诺。
- failed terminal 是否一定有 typed `failure_kind`。
- 前端/i18n 是否隐藏 raw `agent_disconnected`、内部路径、pod/runner diagnostic 细节。
- task header/detail/terminal panel 是否都隐藏 raw `agent_disconnected`，且 task run failure 不污染 terminal recovery UI。
- `runtime_path_unavailable` 是否按 ordinary user / developer / admin diagnostic 分受众展示。
- 当前失败 gate `npm run test:e2e:integration:agent-task:terminal:ux` 是否通过。
- Managed runner 路径和 artifacts 语义是否没有退化。
