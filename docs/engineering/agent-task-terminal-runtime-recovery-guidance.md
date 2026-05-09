# Agent Task Terminal Runtime Recovery Engineering Guidance

更新时间：2026-05-08 PDT
状态：`current_engineering_guidance`
适用范围：Agent task terminal、runner websocket control channel、terminal session 状态真相、browser terminal recovery、close tombstone、focused validation

## 0. 文档状态

本文是 Agent task terminal runtime recovery 的当前工程指导与实现 rationale，用于保留对象模型、状态语义、恢复/关闭约束和验证方式。它解释已经落地的行为为什么必须保持一致，避免后续维护重新回到旧的 terminal failure 心智。

原始问题：

> 进入 Agent task terminal 后，切换到其他页面再回来，terminal session 进入 `failed / agent_disconnected`，无法恢复。

权威合约和实现真相以这些位置为准；本文负责解释它们必须保持一致的工程边界：

- `docs/contracts/agent-execution-protocol.md`
- `docs/contracts/agent-task-frontend-module-map.md`
- OpenAPI / generated types
- `docs/agent-task-runner-runbook.md`
- 相关 UX/i18n 文案规范

恢复能力涉及的关键实现路径是：

- `packages/api-entry-node/src/notebook-terminal-service.ts`
  - browser websocket close after handshake 已有 `disconnected` grace。
  - `reconcilePersistedSessionAfterServiceReload()` 必须把 persisted live session 收敛为 `recovering / transport_lost`，不得回到 `failed / terminal_connection_failed_service_reload`。
  - `completeReconnectHandshake()` 必须拒绝 `view` payload，保持 browser reconnect 不携带 `view` 的 contract。
- `packages/api-entry-node/src/agent-execution-service.ts`
  - `releaseSocketState()` 必须区分 task run stream 和 terminal stream；runner transport lost 对 terminal 进入 detached/recovering，不推 `error / agent_disconnected`。
  - `processReadyMessage()` 必须消费 `active_terminals`，并在 authority 校验后触发 terminal adopt。
- `packages/agent-task-runner/src/index.ts`
  - `ws.on('close')` 必须进入 reconnecting，而不是直接调用 shutdown。
  - transport lost 必须终止 active Codex child process，但保留 active terminal PTY；operator/process shutdown 才终止 terminal processes。

根因表述必须继续保持准确：browser-only close 不是当前 fatal 主链，它已有 disconnected grace；真正导致 `failed / agent_disconnected` 的 fatal 主链是 runner control socket close 后，API 把 pending terminal runtime stream 当 fatal error 关闭，同时 runner 自己进入 shutdown 并杀掉 terminal process。

## 1. 产品心智

必须分清三个对象：

| 对象 | 用户心智 | 后端真相 | 失败语义 |
| --- | --- | --- | --- |
| Agent task | 一个稳定任务容器 | task record、workspace/project/user scope、terminal/task run blockers | task 本身不因 terminal/browser 断线失败 |
| Task run | 一次 agent 执行流 | run request、Codex child process、trace/artifact stream | runner transport lost 可以让当前 run 失败并终止 child process |
| Terminal session | task 下的短生命周期 shell 入口 | terminal session record、terminal process、browser/runner bindings | browser 断开不是 terminal 失败；runner 短断先进入 recovery |

用户期望：

> terminal 是 Agent task 的手动执行入口。切换页面、刷新、短暂断线后，terminal 应尽量自动恢复；只有后端确认 terminal process 真的结束、丢失或恢复超时，才展示失败。

产品目标：

1. Browser 切走、刷新、回来后，如果 terminal process 仍存在，用户能回到同一个 `terminal_session_id`。
2. Runner websocket 短暂断开不再直接把 terminal session 标记为 `failed / agent_disconnected`。
3. Runner 在恢复窗口内重连后，API 通过 adopt 恢复同一个 terminal session，不新建 shell，不伪造恢复。
4. 恢复中输入必须禁用；只有后端确认 terminal process 已 adopt 且 input enabled 后，browser 才可发送 `stdin` / `resize`。
5. 如果 terminal process 确实丢失，系统以 typed `failure_kind` 进入不可恢复失败态，不把裸 `agent_disconnected` 暴露给普通用户。
6. `recovering` 表示系统正在自动恢复。刷新状态只是辅助读取后端真相，不是用户完成恢复的主动作。

## 2. 非目标

本文明确不做：

1. 不引入 platform-managed tmux、screen、terminal daemon 或远程桌面能力。
2. 不做多人共享 terminal、协同观看、长期 terminal 日志检索。
3. 不承诺恢复完整交互式 screen、alternate screen、cursor mode 或假 prompt。
4. 不引入多 API 副本 durable routing；当前仍按 api replica=1 的架构目标推进。
5. 不把 terminal recovery 扩成 incident、SLA、审计或配额大改造。
6. 不让前端本地缓存伪造 terminal truth。
7. 不在同一个 `terminal_session_id` 下静默重启一个新 shell。
8. 不保证恢复完整终端视觉现场；P0 只保证同一 terminal process 可被继续交互，历史输出按 replay 能力诚实降级。

## 3. 不可变决策

| 决策 | 结果 |
| --- | --- |
| 后端是否仍是唯一真相 | 是 |
| Browser 断开是否等于 terminal failed | 否 |
| Runner websocket 断开是否立即等于 terminal failed | 否 |
| Runner process 明确退出并终止 terminal processes 后是否可恢复 | 否，除非未来另起 supervisor 方案 |
| 恢复是否可以新建 shell 冒充原 session | 否 |
| 恢复中是否允许输入 | 否，直到后端 runtime truth 确认为 input enabled |
| `recovering` 是否算 live task blocker | 是 |
| `closing` 是否算 `recovering` | 否，它是独立用户态和 contract 状态 |
| 是否使用 tmux/workaround | 否 |
| 是否为了 pre-GA 过渡字段保留 `view` payload | 否 |

## 4. 状态模型

现有 `pending | active | disconnected | closed | failed` 太粗，必须拆出三个维度。当前粗粒度 `status` 可以作为 pre-GA coarse status 过渡字段保留一段时间，但它不再承担完整产品语义。

### 4.1 Terminal Lifecycle

```text
pending      # session created, runtime not started
starting     # server.terminal.start dispatched
active       # terminal process exists and runtime stream attached
recovering   # terminal process may still exist, runner/API binding is being recovered automatically
closing      # user/system requested close; waiting for authoritative teardown or tombstone expiry
closed       # terminal process exited normally or close was acknowledged
failed       # terminal process cannot be recovered
```

### 4.2 Runner Transport Binding

```text
dispatching      # start/adopt frame is being sent
attached         # runner socket owns control for this terminal
transport_lost   # runner websocket/heartbeat/authority was lost
adopting         # runner reconnected and API is verifying terminal ownership
missing          # runner says terminal no longer exists
closed           # runner confirmed terminal close/exited
```

### 4.3 Browser Binding

```text
attached
browser_disconnected
none
```

`browser_connection_status` 是 ephemeral truth。API reload 后不得从 persisted record 恢复为 `attached`。

### 4.4 Close State

```text
none
requested   # tombstone written, not delivered to runner yet
delivered   # close frame delivered to authoritative runner socket
acked       # API accepted matching agent.terminal.close_ack for this close attempt
expired     # tombstone delivery/ack timed out
```

`close_state=acked` 表示 API 收到并接受了匹配当前 tombstone 的 `agent.terminal.close_ack`，不表示任何普通 `agent.terminal.exited` 都能替代 close ack。

`closing` 不是 `recovering` 的 UI 别名。`closing` 的用户态是“正在结束终端会话”，输入禁用，不能 adopt 复活，仍然阻塞 task run/delete 直到 close ack 或 tombstone expiry。

### 4.5 Failure Kind

`failed` 必须携带可解释原因。`agent_disconnected` 只能作为 runner transport event reason，不应直接成为用户可见的 terminal failure kind。

| failure_kind | 触发条件 | 用户可见解释 |
| --- | --- | --- |
| `process_start_failed` | start frame accepted 前后 terminal process 启动失败 | 终端启动失败 |
| `process_exited_unexpectedly` | terminal process 非用户/非 close tombstone 路径异常退出 | 终端进程异常退出 |
| `protocol_error` | runner/browser terminal 协议不匹配、payload mismatch、stale generation 违规 | 终端协议错误 |
| `permission_revoked` | 权限或 scope 复校验失败 | 无法继续访问终端 |
| `runner_recovery_timeout` | recovery deadline 到期仍未 adopt | 终端恢复超时 |
| `terminal_process_lost` | adopt `not_found`、close tombstone timeout 或 runner 上报缺失 | 终端进程已丢失 |
| `runner_process_exited` | runner 明确 graceful shutdown 且 terminal processes 已终止 | 执行环境已退出，原终端不可恢复 |
| `terminal_runtime_session_mismatch` | runtime event terminal_session_id 与 persisted session 不一致 | 终端会话不一致 |

正常退出和异常退出必须分开：

- 用户点击结束、API 下发 close tombstone 且 runner 返回匹配的 `agent.terminal.close_ack status=closed`：`closed`，`close_reason=ended_by_user`，`failure_kind=null`。
- shell 自然退出且 runner 标记 `exit_kind=user_exit|shell_exit`：`closed`，`close_reason=process_exited`，`failure_kind=null`。
- runner process graceful shutdown 且 `terminal_processes_terminated=true`：`failed`，`failure_kind=runner_process_exited`。
- PTY crash、unexpected signal、runner 明确 `exit_kind=unexpected`：`failed`，`failure_kind=process_exited_unexpectedly`。
- P0 contract 要求 runner 提供 `exit_kind`。如果 implementation slice 中发现旧路径仍缺失 `exit_kind`，API 使用固定保守映射并写测试：close-requested 路径映射为 `closed`，其余 signal/crash/unknown exit evidence 映射为 `failed + process_exited_unexpectedly`。

### 4.6 API Response Fields

Terminal session list/get 响应需要补充：

- `status`: pre-GA coarse status，新增 `recovering` 和 `closing`。
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
- `replay_gap`
- `latest_seq`
- `ws_url`

返回规则：

- 粗粒度 `status=disconnected` 只表示 browser 断开；runner transport 断开必须使用 `status=recovering`。
- `pending | starting | active | disconnected | recovering | closing` 都是 live task blocker。
- `recovering` 可以返回 `ws_url`，browser attach 后只能看到 recovering 状态和 replay metadata，不能输入。
- `closing` 返回 `ws_url=null`，`input_enabled=false`，`recoverable=false`，允许用户刷新状态但不允许 reconnect/adopt。
- `closed | failed` 不返回可交互 `ws_url`。
- `replay_status` 取值为 `complete | partial | unavailable`，只说明 output replay 能力，不说明 terminal process 是否存在。

### 4.7 Coarse `status` 派生规则

| lifecycle | runner connection | browser connection | coarse `status` |
| --- | --- | --- | --- |
| `pending` | `dispatching` | `none` | `pending` |
| `starting` | `dispatching/attached` | any | `pending` |
| `active` | `attached` | `attached` | `active` |
| `active` | `attached` | `browser_disconnected/none` | `disconnected` |
| `recovering` | `transport_lost/adopting` | any | `recovering` |
| `closing` | any | any | `closing` |
| `closed` | `closed` | any | `closed` |
| `failed` | `missing/closed` | any | `failed` |

### 4.8 状态转移表

| 事件 | 前置状态 | 后置状态 | 说明 |
| --- | --- | --- | --- |
| Browser WS close after handshake | `active + attached` | `active + browser_disconnected` | 保留 runner control；启动 browser reconnect grace |
| Browser reconnect success | `active + browser_disconnected` | `active + attached` | replay 后按 `input_enabled` 决定是否可输入 |
| Runner websocket close / heartbeat lost | `active + attached` | `recovering + transport_lost` | 不失败，不杀 terminal PTY，set-once 设置 recovery deadline |
| Runner graceful shutdown frame, terminals terminated | any live terminal | `failed + runner_process_exited` | 明确不可恢复 |
| Runner graceful shutdown frame, terminal fate unknown | any live terminal | `recovering + transport_lost` | 等待 adopt 或 deadline |
| API reload discovers persisted live session | persisted `pending/active/disconnected/recovering` | `recovering + transport_lost` | 不直接 failed；缺 deadline 时补 bounded deadline |
| API reload discovers persisted closing session | persisted `closing + close_state=requested/delivered` | `closing` | 继续 tombstone delivery/expiry；不得进入 adopt 主链 |
| Runner `agent.ready` with matching active terminal | `recovering + transport_lost` | `recovering + adopting` | API 校验 ownership 后发 `server.terminal.adopt` |
| Adopt accepted | `recovering + adopting` | `active + attached` | 新 runtime/control handle 替换旧 handle；不发第二个 start |
| Adopt `not_found` | `recovering + adopting` | `failed + terminal_process_lost` | 释放 blocker |
| Adopt `exited` normal | `recovering + adopting` | `closed` | 不写 failure_kind |
| Adopt error / timeout | `recovering + adopting` | `failed + runner_recovery_timeout` 或 typed error | 释放 blocker |
| Recovery deadline expired | `recovering` | `failed + runner_recovery_timeout` | read-time expiry 与 sweeper 都必须执行 |
| User close during recovering | `recovering` | `closing + close_state=requested` | 写 tombstone，阻止后续 adopt 复活 |
| Close tombstone delivered | `closing + requested` | `closing + delivered` | 等待 ack |
| Close tombstone acked | `closing + delivered` | `closed + acked` | 释放 blocker |
| Close tombstone deadline expired | `closing` | `failed + terminal_process_lost` | `close_reason=close_tombstone_timeout`，释放 blocker |
| Permission revoked | any nonterminal | `failed + permission_revoked` | 输入/reconnect 立即拒绝，browser socket 关闭，runner terminal best-effort close，释放 blocker |

## 5. Recovery Coordinator Contract

实现需要明确 `AgentExecutionService` 和 `NotebookTerminalService` 的边界，避免两个 service 都“半知道” terminal recovery。

### 5.1 Ownership

`NotebookTerminalService` 负责：

- 维护 terminal session persisted truth。
- 维护 recoverable session index。
- 维护 recovery deadline 和 close tombstone deadline。
- 维护 global recovery/closing index，供 sweeper 收敛过期 session。
- 决定某个 session 是否可以 adopt、是否应 close garbage collect、是否已 final。
- 创建和替换 browser-facing `TerminalRuntime` handle。
- 对 browser 发送 `terminal.state recovering/ready/closing/failed`。

`AgentExecutionService` 负责：

- 维护 runner websocket authority、connection epoch、socket lifecycle。
- 在 runner socket release 时区分 task run stream 和 terminal stream。
- 消费 `agent.ready.active_terminals`，在 authority 校验后通知 `NotebookTerminalService`。
- 提供 start/adopt/close control frame dispatch。
- 为 start/adopt 创建 `PendingTerminal` 并做 request/generation fencing。
- 防止 stale socket 的 stdin/resize/close/adopt response 影响新 truth。

Runner 负责：

- websocket transport close 后进入 reconnecting，而不是 shutdown。
- 保留 active terminal PTY process。
- 终止 active task run child process，因为 task run stream 已按失败收口，不能继续产生文件副作用。
- 在 reconnect 的 `agent.ready` 中上报可 adopt 的 `active_terminals`。
- 响应 `server.terminal.adopt` 和 close tombstone frame。

### 5.2 Suggested Service Interfaces

命名可按实现风格调整，但 contract 必须具备这些能力。

`AgentExecutionService` 增加 coordinator registration：

```ts
type TerminalRecoveryCoordinator = {
  handleRunnerDetached(event: {
    workspaceId: string;
    projectId: string;
    agentId: string;
    runnerSessionId: string | null;
    connectionId: string;
    reason: 'agent_disconnected' | 'heartbeat_lost' | 'agent_stale_connection' | 'server_shutdown';
    terminalSessionIds: string[];
    terminalProcessesTerminated?: boolean;
  }): Promise<void> | void;

  handleRunnerReady(event: {
    workspaceId: string;
    projectId: string;
    agentId: string;
    runnerSessionId: string | null;
    runnerInstanceId: string | null;
    connectionId: string;
    connectionEpoch: number;
    activeTerminals: RunnerActiveTerminalDescriptor[];
  }): Promise<void> | void;
};
```

`NotebookTerminalService` consumes those callbacks and calls:

```ts
type AdoptTerminalSessionInput = {
  workspaceId: string;
  projectId: string;
  sessionId: string;
  agentId: string;
  terminalSessionId: string;
  adoptAttemptId: string;
  connectionEpoch: number;
  generation: number;
  cols: number;
  rows: number;
  executionContext?: Record<string, unknown>;
};

type AdoptedTerminalRuntime = {
  stream: AsyncIterable<AgentTerminalEvent>;
  writeInput: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
};

AgentExecutionService.adoptTerminalSession(input: AdoptTerminalSessionInput): Promise<AdoptedTerminalRuntime>;
```

`dispatchTerminalSession()` remains the only path that sends `server.terminal.start`. `adoptTerminalSession()` must send only `server.terminal.adopt`.

Coordinator serialization rule:

- `handleRunnerDetached` is the serialized authoritative coordinator callback for runner socket release.
- `AgentExecutionService` must enqueue and await `handleRunnerDetached` per runner authority key before it processes `handleRunnerReady` / adopt work for a newer socket on the same runner authority.
- If a new `agent.ready` arrives while the prior socket release is still converging, `processReadyMessage()` waits for that detach transition to persist `recovering + transport_lost` truth, then consumes `active_terminals` against that updated truth.
- This ordering prevents `agent.ready.active_terminals` from racing ahead of the recovery transition and being ignored because the session still appears `active` on stale truth.

### 5.3 Recoverable Session Index

Add a durable-enough index for current api replica=1:

```text
notebook_terminal_recovery_index -> terminal_session_id[]
notebook_terminal_closing_index  -> terminal_session_id[]
```

Each indexed session must also persist its own deadline fields, so read-time expiry remains correct even if index maintenance missed an update.

Index update rules:

- Add to recovery index when lifecycle enters `recovering`.
- Remove from recovery index when lifecycle leaves `recovering`.
- Add to closing index when lifecycle enters `closing`.
- Remove from closing index when lifecycle leaves `closing`.
- API reload should rebuild missing in-memory indexes lazily from read-time session truth when list/get/delete touches a task, and sweeper should tolerate missing/deleted ids.

### 5.4 Handling `agent.ready.active_terminals`

Runner reconnect payload:

```json
{
  "runner_instance_id": "uuid",
  "connection_epoch": 7,
  "capabilities": {
    "terminal_adopt": "v1"
  },
  "active_terminals": [
    {
      "terminal_session_id": "term_xxx",
      "runner_session_id": "task_xxx",
      "generation": 1,
      "cols": 120,
      "rows": 30,
      "cwd": "/home/task_xxx/workspace"
    }
  ]
}
```

Processing rules:

1. `AgentExecutionService.processReadyMessage()` first rechecks socket authority as it does today.
2. It waits for any queued `handleRunnerDetached` transition from the previous socket on the same runner authority before consuming the new ready payload.
3. It validates top-level `active_terminals` before descriptor iteration:
   - `active_terminals` must be an array.
   - max descriptors per ready frame is `64`.
   - non-array or over-limit payloads fail the whole ready validation with `agent_ready_validation_failed`; recovery coordinator is not called for that ready frame.
4. It validates each descriptor independently. Invalid descriptor fields discard only that descriptor and emit a protocol warning/diagnostic such as `agent_ready_active_terminal_descriptor_invalid`; they do not fail the whole `agent.ready` frame and must not block recovery for other valid descriptors.
5. It calls `NotebookTerminalService.handleRunnerReadyForTerminalRecovery(...)` with the valid descriptors.
6. `NotebookTerminalService` looks up recoverable sessions by `runner_session_id` and `terminal_session_id`.
7. If session is `recovering` and deadline not expired, call `adoptTerminalSession()`.
8. If session is `closing`, do not adopt; deliver close tombstone first.
9. If session is final or deadline expired, do not adopt; send close/garbage-collect or ignore late runner truth.

Tests must cover both validation levels: one malformed descriptor is dropped while another valid descriptor can still recover; a non-array or `>64` `active_terminals` payload fails ready validation.

## 6. Runner Recovery Protocol

### 6.1 Runner Websocket Close

Current behavior must change:

- websocket close should not trigger runner process shutdown.
- websocket close should not kill active terminal processes.
- runner enters `reconnecting`, uses bounded backoff, and creates a new websocket.
- only SIGTERM/SIGINT, explicit operator shutdown, runner process crash, or task/session close terminates terminal processes.
- transport lost still terminates active task run child processes, because task run stream has failed from the product point of view.

Runner health may display:

```text
connected
reconnecting
disconnected
shutting_down
```

`reconnecting` means runner process is alive and terminal processes may still be running. API can only infer transport lost. It may upgrade to `runner_process_exited` only after a graceful shutdown frame, managed pod lifecycle termination evidence, or recovery timeout.

Graceful shutdown frame:

```json
{
  "type": "agent.shutdown",
  "timestamp": "ISO-8601",
  "payload": {
    "reason": "sigterm|sigint|operator_shutdown|runner_process_exit",
    "terminal_processes_terminated": true
  }
}
```

If API does not receive this frame, it must first put live terminal sessions into `recovering`, then wait for adopt or deadline.

### 6.2 API Socket Release

`AgentExecutionService.releaseSocketState()` must split task run stream and terminal stream behavior:

- Task run stream: runner transport lost may keep current failure semantics and terminate run stream with error.
- Terminal stream: runner transport lost emits recoverable detach, not fatal `error`.
- The detach callback is authoritative and serialized: release must await `handleRunnerDetached` persistence for affected terminal sessions before a newer socket's ready/adopt path is allowed to consume `active_terminals`.

New terminal runtime event:

```json
{
  "type": "detached",
  "terminal_session_id": "term_xxx",
  "reason": "agent_disconnected"
}
```

`NotebookTerminalService` receives `detached` and:

- sets `lifecycle_status=recovering`
- sets `runner_connection_status=transport_lost`
- sets `input_enabled=false`
- sets recovery deadline if this recovery episode does not already have one
- keeps task blocker alive
- keeps browser replay ring if still available
- does not call `finishSession(... failed ...)`

After `detached`, the old stream may close. `NotebookTerminalService` must treat “stream ended while lifecycle is recovering” as the tail of detach, not as `terminal_complete`. Late events from the old socket/generation must be ignored.

### 6.3 Adopt Frames

API sends:

```json
{
  "type": "server.terminal.adopt",
  "request_id": "adopt_xxx",
  "runner_session_id": "task_xxx",
  "terminal_session_id": "term_xxx",
  "timestamp": "ISO-8601",
  "payload": {
    "adopt_attempt_id": "adopt_xxx",
    "connection_epoch": 7,
    "generation": 1,
    "cols": 120,
    "rows": 30
  }
}
```

Runner replies:

- `agent.terminal.adopted`
- `agent.terminal.not_found`
- `agent.terminal.exited`
- `agent.terminal.error`

Runner response must include:

- `request_id`
- `adopt_attempt_id`
- `connection_epoch`
- `terminal_session_id`
- `runner_session_id`
- `generation`

Fencing rules:

- API only accepts response from the current authoritative runner socket.
- `terminal_session_id` must match persisted terminal session.
- `runner_session_id` must match terminal session persisted runner session id.
- runner id must match task bound/resolved runner id.
- workspace/project/task/user scope is checked by API session truth; runner payload cannot expand scope.
- `connection_epoch`、`adopt_attempt_id`、`generation` mismatch means stale response; ignore it.
- duplicate `agent.ready` / duplicate `agent.terminal.adopted` is idempotent and must not create a second PTY or duplicate control binding.

Adopt success:

- `NotebookTerminalService` replaces old `TerminalRuntime` handle with the adopted runtime.
- `runner_connection_status=attached`
- `lifecycle_status=active`
- `input_enabled=true`
- browser receives `terminal.state { state: "ready", status: "active", input_enabled: true }`
- no `server.terminal.start` is sent
- no second PTY is created

Adopt failure:

- `not_found` maps to `failed + terminal_process_lost`
- timeout maps to `failed + runner_recovery_timeout`
- protocol mismatch maps to `failed + protocol_error`
- normal exited maps to `closed`
- all terminal final states release live blocker

## 7. Browser Recovery Websocket Sequence

This sequence is required for a browser attaching while backend lifecycle is `recovering`.

1. Browser loads task detail and list/get returns a recovering session:

```json
{
  "terminal_session_id": "term_xxx",
  "status": "recovering",
  "lifecycle_status": "recovering",
  "runner_connection_status": "transport_lost",
  "input_enabled": false,
  "recoverable": true,
  "recovery_deadline_at": "ISO-8601",
  "ws_url": "wss://..."
}
```

2. Browser opens `ws_url`.
3. Browser sends `terminal.reconnect` without `view`:

```json
{
  "type": "terminal.reconnect",
  "terminal_session_id": "term_xxx",
  "cols": 120,
  "rows": 30,
  "after_seq": 12
}
```

4. Server sends state and replay frames:

```json
{
  "type": "terminal.state",
  "terminal_session_id": "term_xxx",
  "state": "recovering",
  "status": "recovering",
  "input_enabled": false,
  "recovery_deadline_at": "ISO-8601"
}
```

Then:

```text
terminal.replay_start
terminal.output...
terminal.replay_end { replay_status, replay_gap, latest_seq, input_enabled: false }
```

5. Browser must disable typing and resize side effects. If a client still sends `terminal.stdin` or `terminal.resize`, API must not forward it to runner. It may emit `terminal.error { error_code: "terminal_input_disabled" }` without closing the socket.
6. When runner reconnects and adopt succeeds, server sends:

```json
{
  "type": "terminal.state",
  "terminal_session_id": "term_xxx",
  "state": "ready",
  "status": "active",
  "input_enabled": true
}
```

7. Browser may send `stdin` / `resize` only after this ready state.

Hard prohibition: this path must not call `server.terminal.start`. Tests must assert that recovering browser attach plus runner adopt sends zero new start frames for the same `terminal_session_id`.

## 8. Deadlines and Expiry

### 8.1 Recovery Deadline

Add explicit recovery deadline config:

```text
NOTEBOOK_TERMINAL_RECOVERY_TIMEOUT_MS       default 120000
NOTEBOOK_TERMINAL_RECOVERY_TIMEOUT_MAX_MS   default 300000
```

Rules:

- Clamp timeout to `5000..NOTEBOOK_TERMINAL_RECOVERY_TIMEOUT_MAX_MS`.
- Set `recovery_deadline_at` once per recovery episode.
- Do not extend the same episode because browser reconnects, list/get reads, repeated `agent.ready`, or repeated detach events arrive.
- A new recovery episode can be created only after the session returned to `active` and later loses runner transport again.
- If API reload sees persisted live session with no `recovery_deadline_at`, it sets one bounded deadline from current time.
- If API reload sees an existing future deadline, keep it.
- If API reload sees an expired deadline, read-time expiry immediately finalizes the session.

Expiry priority:

1. `permission_revoked` wins immediately.
2. `closed` / `failed` final truth wins over recovery.
3. `closing` wins over `recovering`; close tombstone must not become adopt.
4. expired recovery deadline before adopt response means `failed + runner_recovery_timeout`.
5. late adopt after final truth is ignored and should trigger close/garbage-collect if runner still holds PTY.

### 8.2 Close Tombstone Deadline

Add explicit close tombstone config:

```text
NOTEBOOK_TERMINAL_CLOSE_TOMBSTONE_TIMEOUT_MS      default 120000
NOTEBOOK_TERMINAL_CLOSE_TOMBSTONE_TIMEOUT_MAX_MS  default 300000
```

Rules:

- Set `close_deadline_at` once when entering `closing`.
- Do not extend by repeated DELETE, list/get, repeated runner ready, or repeated close delivery.
- If close is delivered to runner, set `close_state=delivered` and `delivered_at`.
- If runner `agent.terminal.close_ack status=closed` matches the current close attempt, set `close_state=acked` and final `closed`.
- `agent.terminal.exited` is not a close tombstone ack and must not set `close_state=acked`.
- If deadline expires first, set `close_state=expired`, final `failed + terminal_process_lost`, `close_reason=close_tombstone_timeout`.

### 8.3 Sweeper

Must implement both:

- read-time expiry: list/get/create run/delete task paths converge expired recovery/closing sessions before returning blocker truth.
- background sweeper: periodic scan of `notebook_terminal_recovery_index` and `notebook_terminal_closing_index`.

The sweeper must be idempotent and tolerate stale ids. It should remove final sessions from indexes.

## 9. Close Tombstone Delivery and API Semantics

### 9.1 Close Frame

When close is requested for `active`, `disconnected`, or `recovering`:

```json
{
  "type": "server.terminal.close",
  "request_id": "close_xxx",
  "runner_session_id": "task_xxx",
  "terminal_session_id": "term_xxx",
  "timestamp": "ISO-8601",
  "payload": {
    "close_attempt_id": "close_xxx",
    "connection_epoch": 7,
    "generation": 1,
    "reason": "user_requested|permission_revoked|garbage_collect"
  }
}
```

Close tombstone ack wire contract is explicit `agent.terminal.close_ack`.

`agent.terminal.exited` remains a normal terminal process/runtime event. It can close or fail a non-closing terminal according to `exit_kind`, but it cannot substitute for tombstone ack and cannot set `close_state=acked`.

Runner sends:

```json
{
  "type": "agent.terminal.close_ack",
  "request_id": "close_xxx",
  "runner_session_id": "task_xxx",
  "terminal_session_id": "term_xxx",
  "timestamp": "ISO-8601",
  "payload": {
    "close_attempt_id": "close_xxx",
    "connection_epoch": 7,
    "generation": 1,
    "status": "closed|not_found|error",
    "exit_code": 0,
    "signal": null,
    "error_code": null,
    "message": null
  }
}
```

Required fields and fencing:

- top-level `request_id`
- top-level `runner_session_id`
- top-level `terminal_session_id`
- payload `close_attempt_id`
- payload `connection_epoch`
- payload `generation`
- payload `status`

API accepts `agent.terminal.close_ack` only when all fencing checks match current authoritative truth:

- ack is received from the current authoritative runner socket.
- `request_id` equals the delivered `server.terminal.close.request_id`.
- `close_attempt_id` equals the persisted tombstone attempt id.
- `terminal_session_id` equals the persisted terminal session id.
- `runner_session_id` equals the persisted runner session id.
- `connection_epoch` equals the epoch used when the close frame was delivered.
- `generation` equals the current terminal process generation.
- workspace/project/task/user scope comes from persisted API truth; runner payload cannot expand scope.

API convergence on accepted ack:

- `status=closed`: set `close_state=acked`, final `closed`, keep `failure_kind=null`, and set `close_reason` from the tombstone reason (`ended_by_user`, `permission_revoked`, or `garbage_collected`).
- `status=not_found`: set `close_state=acked`, final `closed`, keep `failure_kind=null`, set `close_result=not_found`, record internal diagnostic `terminal_process_missing_on_close`, and release the live blocker. This is close-path `not_found -> closed`; recovery/adopt `not_found -> terminal_process_lost` remains separate.
- `status=error`: record protocol diagnostic fields (`error_code`, `message`) and keep the session `closing`; do not release the blocker. API may redeliver close on the next authoritative ready, and if `close_deadline_at` expires first, the existing tombstone expiry rule finalizes `failed + terminal_process_lost`.

Late or mismatched close ack is ignored and recorded as a stale/protocol diagnostic. A normal `agent.terminal.exited` received while `close_state=requested|delivered` may be stored as runtime evidence, but final close convergence still requires `agent.terminal.close_ack` or tombstone deadline expiry.

### 9.2 DELETE Semantics

`DELETE /terminal/sessions/{terminal_session_id}` becomes an idempotent close request for nonfinal sessions.

| Current state | DELETE behavior |
| --- | --- |
| `pending/starting` before runner start | final `closed + ended_by_user` if no PTY exists |
| `active/disconnected` | write tombstone, send close if attached, return `closing` truth |
| `recovering` | write tombstone, return `closing`; next runner ready must close/GC, not adopt |
| `closing` | return existing `closing` tombstone truth; do not extend deadline |
| `closed/failed` | keep current hide/history behavior only after final truth; do not resurrect |

### 9.3 List/Get Semantics

- list/get must return `closing` sessions until ack or tombstone expiry, because they still block task run/delete.
- `closing` returns `ws_url=null` and `input_enabled=false`.
- `closing` is not counted as recoverable.
- `recovering` returns enough fields for UI to show automatic recovery and deadline.
- `failed` returns `failure_kind`; `close_reason=agent_disconnected` must not be the only explanation.

## 10. Output Replay and Seq Authority

P0 keeps API entry as `terminal.output.seq` authority.

- Runner does not report `last_output_seq` as browser-continuity evidence.
- Runner transport lost期间 terminal process 产生的 output 在 P0 不承诺可恢复。
- Adopt 成功后，API 从自己持有的 latest/next seq 继续编号 live output。
- 如果 API ring 在 disconnect/API reload 后不可用，browser replay 返回 `replay_status=unavailable` 或 `partial`，并用 `next_seq` 对齐后续 live output。
- UI 说明“较早输出不可恢复”，但 adopt 成功后仍允许继续输入和新 live output。

若后续要让 runner 成为 output spool/seq authority，必须单独决策并同步更新权威 contracts。

## 11. Browser UX

### 11.1 用户可见状态

| 后端状态 | UI 行为 |
| --- | --- |
| `active + ws_url` | 自动连接，显示实时 terminal |
| `active + browser_disconnected` | 回到页面后自动 reconnect；主动作可为“重新连接” |
| `recovering` | 显示“正在恢复终端运行状态”；禁用输入；保留 tab；展示恢复截止时间或倒计时；系统自动恢复 |
| `recovering + ws_url=null` | 显示“终端运行状态正在恢复，暂时不能输入”；主行为是等待自动恢复；刷新状态只是辅助动作，结束会话是危险次动作；不展示“重新连接”作为主动作 |
| `closing` | 显示“正在结束终端会话”；禁用输入；不可重新连接；主行为是等待结束确认，刷新状态只是辅助动作 |
| `recovering + replay_status=partial/unavailable` | 展示较早输出不可恢复的外层说明；xterm 只显示真实 replay/live bytes |
| `failed + terminal_process_lost` | 显示“终端进程已丢失，无法继续连接” |
| `failed + runner_recovery_timeout` | 显示“终端恢复超时，已停止恢复” |
| `failed + runner_process_exited` | 显示“执行环境已退出，原终端不可恢复”；不直接显示“Runner 已退出” |
| `closed` | 显示已结束，可新建 session |
| `permission_revoked` | 输入和 reconnect 均拒绝，说明权限变化 |

### 11.2 文案原则

- 不把 `agent_disconnected` 原样暴露给普通用户。
- 区分 terminal 的“重新连接”和 task run 的“重新运行”。
- `recovering` 不是用户可主动完成的连接动作；主行为是等待自动恢复，“刷新状态”只是弱辅助动作，危险/次动作是“结束会话”。
- `closing` 是独立状态；不能显示为“正在恢复”。
- 原 session 不可恢复时，动作必须叫“新建终端”或“结束该终端并新建终端”，不能叫“重新打开”。
- 恢复说明显示在 xterm 外层，不写入 xterm buffer。
- 无法恢复时说明 typed reason，不伪造 prompt。
- 任何 UI fallback 都不能直接显示 raw enum、`runner` 内部术语或“Runner 已退出”这类实现语言。

建议 i18n keys：

- `terminal_runtime_recovering`
- `terminal_runtime_recovered`
- `terminal_runtime_recovery_timeout`
- `terminal_runtime_closing`
- `terminal_process_lost`
- `terminal_runner_transport_lost`
- `terminal_runner_process_exited`
- `terminal_replay_partial`
- `terminal_replay_unavailable`
- `terminal_recovery_blocks_run`
- `terminal_new_session`
- `terminal_unrecoverable_generic`

i18n fallback rules:

| failure_kind | title fallback | body fallback |
| --- | --- | --- |
| `runner_process_exited` | 执行环境已退出 | 执行环境已退出，原终端不可恢复。你可以新建终端继续操作。 |
| known typed failure with missing localized key | 终端不可恢复 | 原终端不可恢复。你可以新建终端继续操作。 |
| unknown/null failure while `status=failed` | 终端不可恢复 | 终端已停止，原会话无法继续连接。请新建终端继续操作。 |

### 11.3 CTA 和 Failure 文案矩阵

| 状态 | 标题 | 正文 | 主行为/动作 | 辅助/危险动作 |
| --- | --- | --- | --- | --- |
| browser disconnected, runtime active | 终端连接已断开 | 当前终端仍在运行，可以重新连接当前会话。 | 重新连接 | 结束会话 |
| runner/runtime recovering | 正在恢复终端运行状态 | 系统正在尝试恢复同一个终端进程。恢复完成前暂时不能输入；该任务会继续被这个终端占用，直到恢复成功、超时或你结束会话。 | 等待自动恢复 | 刷新状态（辅助）；结束会话（危险） |
| closing | 正在结束终端会话 | 系统正在确认终端进程已结束。完成前该任务仍会被这个终端占用。 | 等待结束确认 | 刷新状态（辅助） |
| replay partial | 已恢复最近输出 | 较早输出已过期，仅显示可恢复范围内的真实输出。 | 无 | 无 |
| replay unavailable | 输出无法完整恢复 | 终端运行状态已恢复，但断开期间或较早输出不可恢复。后续新输出会继续显示。 | 无 | 无 |
| `terminal_process_lost` | 终端进程已丢失 | 原来的 shell 无法继续连接。你可以结束该终端并新建终端。 | 新建终端 | 关闭 |
| `runner_recovery_timeout` | 终端恢复超时 | 系统没有在恢复窗口内重新连接到运行中的终端。 | 新建终端 | 关闭 |
| `runner_process_exited` | 执行环境已退出 | 执行环境已退出，原终端不可恢复。你可以新建终端继续操作。 | 新建终端 | 关闭 |
| `protocol_error` | 终端协议错误 | 终端连接因协议不一致而停止。 | 新建终端 | 关闭 |
| `permission_revoked` | 无法访问终端 | 你的权限已变化，不能继续查看或输入这个终端。 | 返回任务 | 无 |

权限变化处理：

- `permission_revoked` 后不能继续下发可输入 ticket。
- 已连接 browser socket 必须关闭或进入不可输入状态。
- `permission_revoked` 后 terminal websocket 关闭或保持不可输入且不再 replay/stream terminal bytes；历史内容如果通过 task artifact/read policy 另行可见，不属于 terminal recovery UI 继续展示的范围。

### 11.4 Frontend Behavior

- 页面进入 task detail 时，以 URL 为 truth 拉取 terminal sessions。
- `recovering` session 应恢复 terminal tab，而不是清空 tab 或切回 conversation。
- `closing` session 应保留 tab/row，并展示正在结束，不进入 reconnect/adopt UI。
- `TaskTerminalPanel` 对 `recovering` session 可打开 websocket；收到 `terminal.state recovering` 时禁用 stdin/resize。
- 自动重连失败后，不直接把 tab 置为 failed；先重新拉后端 session truth。
- 如果后端已 `failed`，前端按 `failure_kind` 展示。

## 12. Contract Guard: Browser Reconnect `view`

当前 reconnect contract truth：

- `docs/contracts/agent-execution-protocol.md` 已声明 browser `terminal.reconnect` 不携带 `view`。
- Browser reconnect payload 和 integration helper `runTerminalCommandViaWs` 不发送 `view`。
- `NotebookTerminalService.completeReconnectHandshake()` 必须拒绝任何带 `view` 的 reconnect payload，返回 `invalid_reconnect_payload`。
- 服务端测试必须保留 rejected `view` payload 覆盖，防止 browser/helper 重新引入该字段。

工程要求：

- Browser reconnect payload 保持不含 `view`。
- Helper/browser coverage 断言发送帧不含 `view`。
- Backend coverage 保留带 `view` 的负向用例，确保请求被拒绝。
- 不把 `view` payload 写成可接受路径；这是 reconnect payload contract 收敛。

## 13. Persistence and Resource Boundaries

P0 使用现有 task terminal session storage/cache 扩展字段，不引入长期 terminal 日志系统。

必须持久化：

- terminal session id
- workspace/project/task/user scope
- bound runner id / runner session id
- lifecycle status
- runner connection status
- input enabled
- recovery deadline
- generation
- failure kind
- close tombstone
- close deadline

`browser_connection_status` 是 runtime 派生字段，不作为 API reload 后可恢复的持久真相；如实现为了当前进程体验缓存它，reload 后必须重置为 `none`。

Live blocker:

- `pending | starting | active | disconnected | recovering | closing` 均算 live blocker。
- 新 agent run、task delete 必须继续被这些状态阻塞。
- `closed | failed` 才释放 blocker。

## 14. Implementation Guidance Areas

### Area A: Contract-First Schema and Regression Tests

Contract changes remain the first implementation boundary:

- Update `docs/contracts/agent-execution-protocol.md` for runner-side terminal adopt frames, close tombstone ack, `agent.shutdown`, `terminal.state recovering/closing`, and browser reconnect cleanup.
- Update OpenAPI terminal session schemas with `recovering`, `closing`, lifecycle/runner/browser status, `recoverable`, `input_enabled`, `recovery_deadline_at`, `failure_kind`, `close_state`, `close_deadline_at`, `replay_status`, `latest_seq`.
- Update generated types.
- Add WS supplement/contract coverage for:
  - `server.terminal.adopt`
  - `agent.terminal.adopted`
  - `agent.terminal.not_found`
  - `agent.terminal.exited`
  - `agent.terminal.error`
  - `agent.terminal.close_ack`
  - `agent.shutdown`
  - `terminal.state recovering`
  - `terminal.state closing`
  - close tombstone expiry
  - `agent.ready.active_terminals` top-level validation and per-descriptor warning behavior

### Area B: Backend Session Truth

- Extend terminal session state fields.
- `NotebookTerminalService` supports `recovering` and `closing` lifecycle.
- `finishSession` handles only authoritative closed/failed, not transport detach.
- `bindRuntimeStream` treats stream end during `recovering` as detach tail, not `terminal_complete`.
- API list/get returns `recovering`、`closing`、`recoverable`、`failure_kind`、`input_enabled`、deadlines。
- `hasLiveSessionsForTask` / blocker logic includes `recovering` and `closing`.
- read-time expiry and sweeper converge recovery/closing deadlines.
- permission/token/owner/scope revalidation covers list/get ticket issue、browser reconnect、stdin、resize、close。

### Area C: AgentExecutionService Recovery Coordinator

- `releaseSocketState()` emits terminal `detached` instead of fatal terminal `error` when runner transport is lost.
- `handleRunnerDetached` is serialized and awaited before ready/adopt processing for the next socket on the same runner authority.
- Task run pending streams keep existing failure behavior.
- `processReadyMessage()` consumes `active_terminals` after authority validation and descriptor-level validation.
- Add `adoptTerminalSession()` that sends `server.terminal.adopt`, never `server.terminal.start`.
- Add pending terminal generation/adopt attempt fencing.
- Adopt not_found/exited/error/timeout maps to typed terminal truth through `NotebookTerminalService`.
- stdin/resize/close are not forwarded while `input_enabled=false` or after stale takeover.

### Area D: Runner Reconnect/Adopt

- Runner websocket close enters `reconnecting`, not shutdown.
- Runner reconnect backoff with bounded jitter.
- Runner terminates active task run child process on transport lost.
- Runner keeps active terminal PTY processes on transport lost.
- Runner maintains active terminal registry with `terminal_session_id`, `runner_session_id`, `generation`, `cols`, `rows`, `cwd`.
- `agent.ready` reports active terminals and `terminal_adopt` capability.
- Runner handles `server.terminal.adopt` idempotently.
- Runner handles close tombstone before adopt if API asks close/garbage-collect.
- Runner acknowledges close tombstones only with `agent.terminal.close_ack`; `agent.terminal.exited` remains ordinary runtime exit.
- SIGTERM/SIGINT/operator shutdown still kills terminal processes and sends `agent.shutdown` when possible.

### Area E: Frontend UX

- Terminal workspace hydrate recognizes `recovering` and `closing`.
- Hidden/reopened terminal tab remains visible during recovery.
- `recovering` disables input and shows automatic recovery message.
- `recovering` primary behavior is waiting for automatic recovery; refresh status is weak/auxiliary and end session is dangerous/secondary.
- `closing` disables input and shows closing message, not recovery message.
- `ws_url=null` does not directly mean failed; UI follows lifecycle/status.
- `failure_kind` drives failure copy.
- `runner_process_exited` uses “执行环境已退出，原终端不可恢复” style copy, never raw “Runner 已退出”.
- xterm buffer never receives recovery/closing explanatory copy.
- CTA vocabulary remains terminal-specific: “重新连接 / 刷新状态 / 新建终端 / 结束会话”。`重新运行` 不出现在 terminal recovery 面板里。

### Area F: Docs and Runbook

- Update runbook hand test and troubleshooting sections.
- Update terminal UX/i18n copy list.
- Add manual control-channel short-disconnect scenario for managed and developer runner.

## 15. Existing Test Expectations

These expectations are regression guardrails for the original failure shape. Current tests should keep these assertions green when the implementation evolves.

### 15.1 API Reload Tests

Coverage in `packages/api-entry-node/src/notebook-terminal-service.test.ts` asserts:

- API reload/read-time sees persisted `pending/active/disconnected/recovering` and returns `recovering + transport_lost`.
- `recovery_deadline_at` is set if absent.
- `recovering` remains a live blocker until deadline.
- `getSession()` and list advertise recoverable truth and may issue a ws ticket with input disabled.
- after deadline, read-time expiry or sweeper converts to `failed + runner_recovery_timeout`.
- persisted `closing + close_state=requested/delivered` stays `closing`, never `recovering`, and tombstone expiry maps to `failed + terminal_process_lost`.

### 15.2 Runner Websocket Close Tests

Coverage in `packages/agent-task-runner/src/index.test.ts` keeps transport close separate from process shutdown:

- transport close:
  - runner enters `reconnecting`
  - active Codex/task run child is terminated
  - active terminal PTY is not killed
  - runner does not clear active terminal registry
  - next websocket sends `agent.ready.active_terminals`
- process shutdown:
  - SIGTERM/SIGINT/operator shutdown kills Codex child and terminal PTY
  - sends/attempts `agent.shutdown { terminal_processes_terminated: true }`
  - release workspace cleanup remains in shutdown path

### 15.3 AgentExecutionService Tests

Coverage includes:

- release runner socket sends `detached` for pending terminal streams and `error` for task run streams.
- `handleRunnerDetached` completes the persisted `recovering + transport_lost` transition before the next socket's ready/adopt path consumes `active_terminals`.
- stale socket takeover does not mark terminal failed.
- `agent.ready.active_terminals` triggers `server.terminal.adopt` for matching recovering session.
- `agent.ready.active_terminals` non-array or `>64` payload fails ready validation with `agent_ready_validation_failed`.
- one invalid active terminal descriptor is dropped with protocol warning/diagnostic while another valid descriptor in the same ready frame can still recover.
- adopt sends no `server.terminal.start`.
- duplicate ready/adopt is idempotent.
- adopt `not_found/exited/error/timeout` maps to typed terminal truth.
- close tombstone prevents adopt and sends close/garbage-collect instead.
- when backend truth is `recovering` and `input_enabled=false`, incoming browser `terminal.stdin` is rejected or answered with `terminal_input_disabled` and is not forwarded to runner/runtime.
- when backend truth is `recovering` and `input_enabled=false`, incoming browser `terminal.resize` is rejected or answered with `terminal_input_disabled` and is not forwarded to runner/runtime.

### 15.4 Frontend Tests

Coverage in `TaskTerminalPanel` / `TaskPage` includes:

- browser-only `disconnected` with active runtime shows reconnect CTA.
- runtime `recovering` shows automatic recovery copy, disables input, and does not show reconnect as primary CTA.
- `closing` shows closing copy, not recovering copy.
- `failed + terminal_process_lost` and `failed + runner_recovery_timeout` show different copy from browser disconnected.
- `ws_url=null + recovering/closing` is not rendered as generic failed.
- xterm does not receive recovery/closing explanatory copy through `writeln`.
- browser reconnect payload does not include `view`.

### 15.5 Close Tombstone Red Tests

Backend coverage includes:

- user close during recovering writes tombstone and returns `closing`.
- runner ready with active terminal while tombstone exists sends close/GC and never adopt.
- `agent.terminal.close_ack status=closed` finalizes `closed`.
- `agent.terminal.close_ack status=not_found` finalizes user-visible `closed` with `close_result=not_found` and internal diagnostic `terminal_process_missing_on_close`.
- `agent.terminal.close_ack status=error` records a diagnostic and keeps `closing` until retry or tombstone expiry.
- `agent.terminal.exited` does not ack a close tombstone and cannot set `close_state=acked`.
- close deadline expiry finalizes `failed + terminal_process_lost` and releases blocker.
- late adopt/terminal output after tombstone expiry cannot resurrect session.

### 15.6 Integration Helper Tests

Current `scripts/integration-real-helpers.test.ts` coverage:

- `terminal.reconnect` frame no longer includes `view`.
- helper waits for `terminal.state input_enabled=true` before sending stdin/resize.
- helper treats `terminal.state recovering` as live wait, not failure.
- rejected `view` payload coverage lives in backend `invalid_reconnect_payload` tests, not in the helper happy path.

## 16. Focused Validation

Follow progressive validation. Do not run heavy gates after every small slice.

Suggested TDD/focused commands:

```bash
npm run contracts:check
npm run contracts:check-openapi
npm run openapi:check-generated
npm run test:run -- packages/api-entry-node/src/notebook-terminal-service.test.ts
npm run test:run -- packages/api-entry-node/src/agent-execution-service.test.ts -t "terminal adopt|runner transport recovery|invalid_reconnect_payload|close tombstone"
npm run test:run -- packages/agent-task-runner/src/index.test.ts -t "terminal adopt|websocket close|transport lost|process shutdown"
npm run test:run -- src/components/agent-tasks/__tests__/TaskTerminalPanel.test.tsx
npm run test:run -- src/components/agent-tasks/__tests__/TaskPage.test.tsx -t terminal
npm run test:run -- scripts/integration-real-helpers.test.ts -t "terminal"
```

Focused e2e:

```bash
npx playwright test --config playwright.config.integration.ts \
  e2e/integration-agent-task-terminal-ux.spec.ts \
  --project=chromium --workers=1 --grep "terminal recovery"
```

Backend-real smoke:

- default managed runner: open terminal, output marker, switch page, return, recover, then input `echo AFTER_RECOVERY`.
- developer runner: same path once, proving developer mode and managed mode share the same mental model.
- default managed runner: force runner websocket/control-channel short disconnect while keeping runner process and PTY alive; verify `agent.ready.active_terminals -> server.terminal.adopt -> input_enabled=true`.
- developer runner: same control-channel short disconnect and adopt path.
- process shutdown path: stop runner process; verify terminal becomes typed failed and does not show recoverable UI after deadline/evidence.

Stage closeout:

- `npm run test:agent-task:runner:fast` and `npm run test:skills:fast` currently call the same producer script (`scripts/skills-runtime-fast-gate.sh`). Run one physical producer per stage and record both aliases in evidence, or run both only if governance requires separate script invocation.
- `npm run test:agent-task:runner:backend-real` and `npm run test:skills:backend-real` currently call the same producer script (`scripts/skills-runtime-backend-real-gate.sh`). Do not duplicate the heavy backend-real run in the same stage unless release governance explicitly asks for both aliases as separate executions.
- PR closeout returns to `npm run verify -- --goal=pr --run` when the implementation spans contracts, backend, runner, frontend, and backend-real smoke.
- If the work enters release/deploy closeout, follow release governance and run `npm run release:ready` at that stage, not after every change slice.

Avoid per-slice heavy gates; only run these at the appropriate stage closeout described above:

- full visual catalog
- `npm run verify -- --goal=real --run`
- `npm run release:ready`
- full unified deploy rollout/smoke

Evidence checklist:

| 验收点 | 证据 |
| --- | --- |
| Contract-first schema 更新 | `contracts:check`、`contracts:check-openapi`、`openapi:check-generated` |
| Browser reconnect payload 不含 `view`，且带 `view` 被拒绝 | `TaskTerminalPanel` unit + integration helper test + `invalid_reconnect_payload` backend unit |
| Runner transport lost 不 fatal terminal | `AgentExecutionService` + `NotebookTerminalService` unit |
| Adopt 同一 session、不发第二次 start | `AgentExecutionService` adopt unit + runner unit |
| `closing` 独立于 `recovering` | backend unit + frontend unit |
| Close tombstone 不复活且只由 `agent.terminal.close_ack` ack | protocol contract + backend unit |
| `active_terminals` validation 分层行为 | `AgentExecutionService` ready validation unit |
| recovering/input disabled 不转发 stdin/resize | backend websocket/runtime unit |
| Deadline 不无限 blocker | backend unit + read-time expiry test |
| Managed/Developer control-channel 短断恢复 | focused backend-real smoke |
| UI recovering/closing/typed failure 文案 | `TaskTerminalPanel` / `TaskPage` unit；若有视觉变动，加 focused screenshot |
| skill runtime / terminal execution context 未回归 | one physical fast producer and one physical backend-real producer, deduplicated by script identity |

## 17. Acceptance Criteria

产品验收：

- 用户切换页面再回来，运行中的 terminal 不被标记为 `failed / agent_disconnected`。
- 刷新 task detail 后，运行中的 terminal tab 自动恢复或进入明确 `recovering`。
- Browser-only disconnected 时主操作是“重新连接”；runtime recovering 时主行为是等待自动恢复，刷新状态只是辅助动作，结束会话是危险/次动作。
- `closing` 显示为“正在结束终端会话”，不能显示为 recovering。
- 只有真实 process lost、recovery timeout、protocol error、permission revoked、runner process exited 才展示失败。
- 失败文案不暴露裸 `agent_disconnected`。

技术验收：

- Runner websocket 短断不会杀 terminal PTY。
- Runner websocket 短断会终止 active task run child process。
- Runner ready/adopt 处理前已收敛同一 runner authority 的 detach transition，避免 ready 先于 recovering truth。
- Runner reconnect 后同一 `terminal_session_id` adopt 成功，不触发第二次 `server.terminal.start`。
- Browser 在 runner recovery 中可 attach 到 API，但 input disabled。
- Browser 在 `recovering/input_enabled=false` 中发送 stdin/resize 时，API 不转发给 runner/runtime。
- Adopt 成功后 stdin/resize/close 重新可用。
- Adopt not_found/timeout 后 session 进入 typed failed 并释放 blocker。
- Close tombstone 防止 recovering session 被后续 runner reconnect 复活，且只接受 `agent.terminal.close_ack` 作为 tombstone ack。
- `agent.ready.active_terminals` 顶层非数组或超过 64 个 descriptor 会 ready validation fail；单个 invalid descriptor 只丢弃自身并记录 diagnostic。
- API reload 后 persisted live terminal 进入 recovering/adopt 主链，不直接 failed；deadline 后才 typed failed。
- Persisted closing terminal reload 后继续 tombstone 主链，不进入 adopt。
- `detached` runtime stream close 不触发 `terminal_complete`。
- Reconnect payload 不再携带 `view`，任何带 `view` 的请求被拒绝。
- OpenAPI/generated types/contracts/runbook/i18n 同步。

手测验收：

1. 打开 task terminal，执行持续输出命令。
2. 切换到其他页面，再回到 task terminal。
3. 确认 terminal 不显示失败，处于 active、disconnected 或 recovering。
4. 恢复成功后输入 `echo AFTER_RECOVERY`，确认输出可见。
5. 人为制造 runner control-channel 短断但保留 runner process，确认 adopt 成功。
6. 人为停止 runner process，确认 terminal 进入 typed failed，不再显示可恢复假象。
7. 在 recovering 中点击结束会话，确认 UI 进入 closing，runner later reconnect 不会复活该 terminal。

## 18. 明确禁止的 Workaround

1. 不用前端刷新强行创建新 terminal session。
2. 不在原 `terminal_session_id` 下重启 shell。
3. 不强发回车来让 shell 重绘 prompt。
4. 不把恢复/closing 说明写入 xterm。
5. 不把 `agent_disconnected` 直接当用户可见失败。
6. 不用 tmux/screen 作为平台内置修复。
7. 不接受带 `view` 的 browser reconnect payload。
8. 不把 `closing` 当作 `recovering` 展示。

## 19. Engineering Review Rationale and Resolution Log

本节保留设计评审中形成的工程 rationale，用于解释本文为何采用这些当前约束。维护时按 checklist 复核，不把本节当作签署记录。

### Pass 1: Product / UX Review

| Finding | Current guidance / resolution |
| --- | --- |
| `closing` 不能被 UX 当作 `recovering` | Sections 3, 4, 9, 11, 15, 17 define `closing` as separate lifecycle/coarse status/user state |
| task run、Agent task、terminal session 失败心智混在一起 | Section 1 separates object model and failure semantics |
| 文档不能把刷新描述成恢复主动作 | Sections 1 and 11 say recovery is automatic; refresh only rereads backend truth |
| 正常退出和异常退出 failure kind 不清楚 | Section 4.5 defines normal closed vs typed failed mapping |
| 带 `view` 的 reconnect payload 必须作为无效请求拒绝 | Sections 4 and 12 define the no-`view` contract and rejected-payload guard |
| 文档末尾不能预写通过结论 | This section records findings/resolutions and checklist, not sign-off statements |

### Pass 2: Backend / Runner Architecture Review

| Finding | Current guidance / resolution |
| --- | --- |
| 根因表述需要更准 | Section 0 identifies browser-only grace vs runner control socket fatal path |
| 缺少 recovery coordinator contract | Section 5 defines service ownership, suggested interfaces, indexes, ready consumption |
| `agent.ready.active_terminals` 谁消费不明确 | Section 5.4 makes `AgentExecutionService` consume after authority check and call `NotebookTerminalService` |
| Adopt method 和 TerminalRuntime replacement 不明确 | Sections 5.2 and 6.3 define `adoptTerminalSession()` and runtime handle replacement |
| recovering browser WS 帧序列不精确 | Section 7 defines exact sequence and input-disabled behavior |
| 必须禁止 recovery path 调用 `server.terminal.start` | Sections 5.2, 6.3, 7, 15, 17 make this a hard assertion |
| deadline 默认/最大/env、set-once/续期、过期优先级不清楚 | Section 8 defines envs, set-once semantics, and expiry priority |
| sweeper 需要全局 recovery/closing index | Sections 5.3 and 8.3 define indexes and sweeper |
| close tombstone delivery/ack 和 API semantics 不完整 | Section 9 defines frames, DELETE semantics, list/get semantics |
| failure_kind 映射表不完整 | Section 4.5 adds mapping table |
| `view` cleanup 必须区分 helper happy path 和服务端负向用例 | Sections 0 and 12 point to the current no-`view` helper/browser contract and rejected-payload guard |

### Pass 3: Test / Delivery Review

| Finding | Current guidance / resolution |
| --- | --- |
| API reload regression coverage must protect recovery semantics | Section 15.1 lists exact expected assertions |
| runner websocket close tests 要拆 transport close vs process shutdown | Section 15.2 lists split expectations |
| 前端 disconnected vs recovering 覆盖要区分 | Section 15.4 lists UI assertions |
| recovering close tombstone 覆盖不能缺失 | Section 15.5 lists backend assertions |
| 阶段收口避免重复 heavy gate | Section 16 documents `test:agent-task:runner:*` and `test:skills:*` producer deduplication |

### Pass 4: Second Round Review Closure

| Finding | Current guidance / resolution |
| --- | --- |
| Close tombstone ack contract 不能二选一 | Sections 8.2, 9.1, 14, 15, 17 choose `agent.terminal.close_ack`; `agent.terminal.exited` is ordinary runtime exit only |
| `agent.ready.active_terminals` invalid descriptor behavior不能二选一 | Section 5.4 chooses top-level ready validation fail for non-array/`>64`, and per-descriptor discard with diagnostic for invalid descriptors |
| `handleRunnerDetached` ordering needs authority | Sections 5.2, 6.2, 14, 15, 17 define it as serialized authoritative coordinator callback before ready/adopt |
| recovering CTA 不能把刷新状态当强主动作 | Sections 11 and 17 make waiting for automatic recovery the primary behavior; refresh is weak auxiliary and end session is dangerous/secondary |
| UX/i18n fallback 不应显示 raw runner wording | Sections 4.5 and 11 add user-facing `runner_process_exited` copy and generic fallback rules |
| recovering/input disabled stdin/resize backend red tests 缺失 | Section 15.3 adds no-forward assertions for stdin and resize |
| gate strategy needs PR vs release closeout split | Section 16 says PR uses `verify --goal=pr`; release/deploy closeout uses `release:ready` under release governance, not per slice |

### Maintenance Checklist

- [ ] Contracts stay updated before behavior changes merge.
- [ ] Contracts define `agent.terminal.close_ack` and do not let `agent.terminal.exited` substitute for tombstone ack.
- [ ] Regression tests cover `recovering`, `closing`, adopt, tombstone, active terminal descriptor validation, input-disabled no-forward, and `view` cleanup.
- [ ] No business path sends `server.terminal.start` for a recovering session.
- [ ] `closing` never renders as `recovering`.
- [ ] API reload keeps live terminal as recoverable until deadline.
- [ ] Runner transport close keeps terminal PTY alive but terminates task run child process.
- [ ] Focused backend-real smoke covers managed and developer runners.
