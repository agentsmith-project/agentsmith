# Agent Task Terminal Close and Recovery Handoff

更新时间：2026-05-08 PDT
状态：`handoff_plan_ready`
适用范围：Agent task terminal close/recovery、runner terminal process lifecycle、close tombstone ack、managed/internal terminal path、Developer runner terminal path、backend-real / real UX terminal gates

## 0. 文档状态

本文是最新 terminal 恢复/关闭问题的下一步开发 handoff。它收敛在 terminal close/recovery 主链，特别是 managed/internal terminal close 卡在 `closing/delivered` 的问题。

本文继承并缩小 [`Agent Task Terminal Runtime Recovery Hardening Plan`](./agent-task-terminal-runtime-recovery-hardening-plan.md) 的范围。已有 broad plan 继续保留 terminal recovery、runner reconnect/adopt、typed failure、Developer runner path hardening 的大图；本文是当前下一步实现入口，聚焦 close ack、真实 terminal process tree 终止、smoke/API gate 等待 close 收敛。

本文不是已实现真相，也不替代 contracts、OpenAPI、generated types、runner protocol、runbook 或代码。实现开始后，必须按 contract-first 流程同步更新合约、代码、测试和 current truth docs；本文保留为 handoff 记录。

用户承诺：离开页面、切换页面或刷新不等于结束 terminal。用户回来时，系统先读取 API truth，自动接回原 `terminal_session_id` 和原 terminal process；不要求用户手动恢复，不发起新 shell 冒充恢复，也不把本地 websocket close / stale error 当作失败真相。

## 1. 问题复述

用户手测问题：

> 进入 Agent task terminal，切换页面或刷新后再回来，terminal 没有恢复，显示 `failed`、`agent_disconnected` 或需要恢复。

最新 real UX gate 暴露的问题：

> managed/internal terminal close 之后，session 仍卡在 `closing/delivered`。浏览器 websocket 已经 close，但后端 terminal session 没有收敛到 `closed` 或 typed `failed`，任务仍被 live terminal blocker 占用。

最新 root-cause investigation 的直接结论：

> runner 很可能已经终止 terminal process，但 `agent.terminal.close_ack` 没有被 API 接受。普通 terminal start 路径没有持久化 runner runtime identity（`runner_session_id` / `generation` / `connection_epoch`），导致 API close 可能发送 `generation=0` / `connection_epoch=0`；runner 按正整数解析后发生 fallback / null 化，API ack 入口又要求有效并匹配的 fence，最终 ack 被拒收或丢弃。API 只收到 `agent.terminal.exited`，但 exited 不等于 close tombstone ack，最后走到 `close_tombstone_timeout`。

两位 reviewer 的共同结论：

1. Browser websocket close 不是 runner close ack。smoke 不能把 `waitForClosed()` 当作 session 已从 list 移除或 close tombstone 已收敛；必须轮询 API truth，直到 close ack、final state 或 typed expiry。
2. 更核心的 runner close 目前只对 `node-pty` 外层 pid 调用 `kill(signal)`。在 managed pod 下，真实 foreground command 例如 `sleep 120` 不可靠退出。close path fire-and-forget，缺少进程树/进程组终止、退出确认和可观测 ack。

当前实现/测试与目标语义已有明确冲突：部分 close ack coverage 把 `not_found -> closed`、`error -> failed` 固化为直接映射。新的目标语义保留 `not_found` 用户可见关闭成功，但必须补内部 diagnostic 和 fencing；`error` 不再立即 final failed，而是保持 `closing`，由 retry 或 close deadline expiry 收敛。实现必须用 TDD 更新这些断言，避免文档、产品心智和代码三套语义并存。

## 2. 产品期望

1. 用户切换页面或刷新回来后，如果原 terminal process 仍在，系统自动恢复同一个 `terminal_session_id` 和同一个 terminal process。
2. 自动恢复是主链：`GET/API truth -> existing active/recovering terminal -> attach/adopt -> active`。不得发送第二个 `server.terminal.start`，不得启动新 shell 冒充恢复，也不把“手动恢复”作为主 CTA。
3. 前端初始加载必须等待 API session truth；truth 未返回前只能显示中性加载/连接状态，不能用本地 websocket close、stale error 或缓存 raw enum 渲染 `failed` / `agent_disconnected`。
4. 用户点击结束 terminal 后，系统必须真实结束该 terminal 下的 shell 和 foreground command，然后收敛到 `closed`，或在确认无法收敛时进入 typed `failed`。
5. 如果用户点击结束 terminal 后 runner 回报 `not_found`，产品上视为关闭目标已达成：释放 blocker，普通用户看到 terminal 已结束；后台保留 missing-on-close diagnostic。
6. `closing` 是明确的结束中状态：输入禁用，不可 adopt 复活，不展示为 recovering，也不要求用户手工修复。
7. 恢复只承诺同一个 process/session 可继续交互，不承诺完整视觉现场、scrollback、alternate screen 或 cursor state。
8. 刷新回来不能先闪 generic failed、raw enum 或裸 `agent_disconnected`，再切到 recovering/closing。
9. 普通用户不看到裸 `agent_disconnected`、pod/internal 细节、host 绝对路径或 diagnostic id。
10. managed/internal runner 和 Developer runner 都必须覆盖；本文重点仍是 terminal close/recovery，不扩展到 execution-gateway、多 API 副本、部署拓扑重构或长期 terminal 记录能力。

## 3. 根因

### 3.1 Smoke 等待条件错误

当前 smoke/helper 仍有把 browser websocket close 当成 terminal session close 的心智。`waitForClosed()` 只能说明浏览器连接断开，不能说明：

- API 已写入或完成 close tombstone。
- runner 已收到 `server.terminal.close`。
- runner 已结束真实 terminal process tree。
- API 已接受匹配的 `agent.terminal.close_ack`。
- session 已从 live list 或 blocker truth 中收敛。

因此 gate 可能误判 close 已完成，也可能在真实问题上只看到 `closing/delivered` 超时。

### 3.2 Runner close 没有结束真实进程树

当前 close path 的结构性缺口：

- `TerminalProcess` 没有稳定暴露真实 pid / process group 信息，后续 close 只能操作抽象 pty handle。
- runner close 主要调用 `node-pty.kill(signal)` 到 pty 外层 pid；在 managed pod 下，foreground command 可能仍在同一 pty session 或子进程树中继续运行。
- close path 没有统一走可测试的 `terminateTerminalProcessTree()`。
- close 是 fire-and-forget，ack 语义没有绑定到“真实 process tree 已退出”。
- 失败时缺少 typed diagnostic，API 只能长期保留 `closing/delivered` 或靠 tombstone deadline 兜底。

### 3.3 API close truth 缺少强收敛证据

API 的正确真相应来自 close tombstone 和 runner close ack，而不是 browser transport。当前问题说明 close delivery 与 close completion 的边界还没有足够硬：

- `delivered` 只表示 close frame 已交给 authoritative runner socket。
- `acked` 只能表示 API 接受了匹配当前 close attempt 的 `agent.terminal.close_ack`。
- `agent.terminal.exited` 可以作为普通 runtime exit evidence，但不能替代 close tombstone ack。
- close deadline expiry 是 typed failure 收敛，不是让测试睡够久的 workaround。

### 3.4 Browser close path 旁路 tombstone

现有 browser WS `terminal.close` 或 browser disconnect grace 的某些路径可能直接调用 runtime close / `finishSession`，绕过 close tombstone。这会让关闭缺少 request/attempt fencing、runner ack、deadline 和 blocker 收敛证据。

目标语义要求：

- browser disconnect grace 只处理 browser attachment，不关闭 terminal。
- browser 发起的 `terminal.close` 必须和 DELETE 使用同一个 `beginCloseTombstone` / close tombstone semantics。
- 任何用户可见关闭动作都不能直接 `runtime.close + finishSession`。

### 3.5 Runtime identity / fencing 未持久化

最新直接根因更偏 runtime identity 和 fencing，而不是单纯“runner 没杀掉进程”：

- 普通 terminal start path 没有把 runner runtime identity 持久化到 API terminal session truth：`runner_session_id`、`generation`、`connection_epoch` 缺失或不可用于后续 close。
- API close 因此可能发送 `generation=0` / `connection_epoch=0` 这类无效 fence。
- runner 解析 close frame 时要求正整数，`connection_epoch=0` 会被视为缺失 / null，`generation` 可能 fallback 到默认值。
- API close ack 入口又要求 ack 携带有效且匹配当前 close attempt、runner session、generation、connection epoch 和 socket authority；不匹配时 ack 被拒收或丢弃。
- API 只看到 `agent.terminal.exited` 时不能设置 `close_state=acked`，因此最终只能通过 close deadline 进入 `close_tombstone_timeout`。

`.mbos/.builtin-skills-seed.lock` ENOENT 属于并发 seed robustness follow-up，不是本次 close timeout 主因；本文只记录为非阻塞后续，不扩大范围。

## 4. 非目标

本文明确不做：

1. 不引入 tmux、screen、terminal daemon 或远程桌面能力。
2. 不持久化 terminal 视觉现场、alternate screen、cursor mode、完整 transcript、录像或长期可检索终端历史。
3. 不启动新 shell 冒充恢复，也不在同一个 `terminal_session_id` 下静默重启 shell。
4. 不把裸 `agent_disconnected` 暴露给普通用户。
5. 不靠 sleep、固定 timeout 或“多等一会儿”作为 close/recovery 修复。
6. 不要求用户 root、sudo、chmod `/home` 或修改系统级目录权限。
7. 不把本文扩展到 execution-gateway、多 API 副本、durable routing、部署平台重构。
8. 不把 Developer runner path hardening 扩成新的产品配置模式；Developer 和 managed 都要覆盖，但本文焦点是 terminal close/recovery。
9. 不让前端本地缓存、browser close 或 xterm 状态伪造后端 terminal truth。

## 5. 不可变决策

| 决策 | 结果 |
| --- | --- |
| 后端是否仍是 terminal/session/close truth | 是 |
| Browser websocket close 是否等于 terminal close 完成 | 否 |
| `server.terminal.close` delivered 是否等于 process 已退出 | 否 |
| close ack 是否必须等待真实 terminal process tree 退出 | 是 |
| `agent.terminal.exited` 是否可以替代 close tombstone ack | 否 |
| terminal start 是否必须持久化 runner runtime identity | 是，`runner_session_id` / `generation` / `connection_epoch` 是 close/recovery fencing truth |
| `generation` / `connection_epoch` wire/storage 语义 | 统一为正整数；不发送 `0` 代表 unknown |
| close `not_found` 用户可见状态 | 视为关闭目标达成，用户可见 `closed`，后台留 diagnostic |
| `close_result` 公开边界 | API/user-visible low-risk field；值为 `closed` / `not_found` / `null` |
| close `error` 是否立即 final failed | 否，保持 `closing`，由 retry 或 deadline expiry 收敛 |
| `closing` 是否可以被 runner ready/adopt 复活 | 否 |
| 恢复是否可以启动新 shell 冒充旧 session | 否 |
| 自动恢复是否有“手动恢复”主 CTA | 否，等待 API truth 后自动 attach/adopt |
| API truth 未返回前是否可用本地 WS/stale error 渲染 failed | 否 |
| 恢复是否承诺完整视觉现场/scrollback | 否，只承诺同 process/session 的交互连续性 |
| `recovering` / `closing` 是否允许输入 | 否 |
| 普通用户是否可见裸 `agent_disconnected` | 否 |
| managed/internal 和 Developer terminal close 是否都要覆盖 | 是 |
| Developer runner 本次 close/process tree 支持平台 | Linux；macOS 返回 `error + unsupported_platform`，不伪装 closed |
| close 修复是否依赖 root/chmod/system path 权限 | 否 |
| close 修复是否通过 sleep/timeout workaround 签收 | 否 |

## 6. 目标行为和协议语义

### 6.1 Browser close

Browser websocket close 只表示浏览器离开 terminal view。它不写 close tombstone，不杀 terminal process，不代表 runner 已 ack close。

正确行为：

- browser close after handshake：terminal session 仍可为 `active + browser_disconnected`。
- 页面刷新回来：从 API session truth 重新 attach/reconnect。
- smoke/helper 可以等待 browser socket close 作为浏览器行为证据，但不能把它作为 close 完成证据。

### 6.2 User/API close

用户点击结束 terminal，或 API 收到 DELETE close request：

1. API 写入 close tombstone，进入 `closing + close_state=requested`。
2. 如果 authoritative runner socket 可用，API 发送 `server.terminal.close`，进入 `closing + close_state=delivered`。
3. `closing` session 保持 live blocker，直到 close ack 或 typed expiry。
4. runner reconnect 时，如果 active terminal descriptor 命中 `closing` session，API 必须优先重发 close/garbage-collect，不能 adopt 回 active。
5. API 只接受匹配 current socket、request id、close attempt id、terminal session、runner session、generation、connection epoch 的 `agent.terminal.close_ack`。

Browser 发起关闭也走同一语义：

- Browser WS `terminal.close` 等价于用户 close request，必须调用 API close tombstone 入口。
- DELETE、browser `terminal.close`、permission revoke close、garbage collect close 共享同一个 begin-close state machine。
- browser disconnect grace 不能写 tombstone；它只改变 browser binding truth。

### 6.3 Close frame contract and storage

Terminal start / adopt 成功时，API 必须持久化 runner runtime identity：`runner_session_id`、当前 `generation`、当前 `connection_epoch`。这些字段是后续 close/recovery fencing truth，不是仅存在于 runner 内存或 websocket 连接上的瞬时信息。

Fence 语义本次统一为正整数：`generation >= 1` 且 `connection_epoch >= 1`。API 不发送 `0` 表示 unknown；runner 不把 `0` 静默纠正成可匹配值；缺失或非正整数必须产生 typed diagnostic / debug reject reason，而不是伪造默认 fence。

`server.terminal.close` 必须携带 fencing 字段：

```json
{
  "type": "server.terminal.close",
  "request_id": "close_req_xxx",
  "runner_session_id": "task_xxx",
  "terminal_session_id": "term_xxx",
  "timestamp": "ISO-8601",
  "payload": {
    "close_attempt_id": "close_attempt_xxx",
    "generation": 3,
    "connection_epoch": 12,
    "reason": "user_requested|permission_revoked|garbage_collect|shutdown"
  }
}
```

`agent.terminal.close_ack` 必须回带相同 fencing 字段：

```json
{
  "type": "agent.terminal.close_ack",
  "request_id": "close_req_xxx",
  "runner_session_id": "task_xxx",
  "terminal_session_id": "term_xxx",
  "timestamp": "ISO-8601",
  "payload": {
    "close_attempt_id": "close_attempt_xxx",
    "generation": 3,
    "connection_epoch": 12,
    "status": "closed|not_found|error",
    "diagnostic_code": null,
    "remaining_pid_count": 0
  }
}
```

API terminal session storage must persist at least:

- authoritative `runner_session_id`
- current `generation`
- current `connection_epoch`
- user/API-visible `close_result` (`closed` / `not_found` / `null`)
- `close_attempt_id`
- delivered `close_request_id`
- delivered `generation`
- delivered `connection_epoch`
- `close_state`
- `close_deadline_at`
- internal `close_diagnostic_code`
- internal redacted `close_diagnostic` / evidence reference

Contract work:

- Update terminal start / adopt contract or storage mapping so runtime identity is persisted before any close tombstone can be delivered.
- Update AsyncAPI for `server.terminal.close` and `agent.terminal.close_ack` fields.
- Update OpenAPI/session schemas, generated types, and serializers for user/API-visible fields, including `close_result`; internal diagnostic fields remain gated or diagnostic-only.
- Add negative contract tests for missing, non-positive, zero, or mismatched fencing fields.

### 6.4 Runner close

Runner 收到 `server.terminal.close` 后：

1. 查找 `TerminalProcess` registry。
2. 如果 terminal 不存在，返回 `agent.terminal.close_ack status=not_found`，API 释放 blocker，并将普通用户可见状态收敛为 `closed`。
3. 如果存在，调用统一的 `terminateTerminalProcessTree()`。
4. 先尝试 graceful termination，再在 bounded grace 后升级 hard termination。
5. 等待 pty shell、foreground command 和已知 descendants 退出。
6. 只有确认退出后，发送 `agent.terminal.close_ack status=closed`。
7. 如果终止失败或无法确认退出，发送 `status=error` 和 diagnostic，API 保持 `closing`，等待 retry 或 tombstone expiry typed fail。

`TerminalProcess` 必须暴露 pid 相关信息，至少包括可用于终止和诊断的 pty/shell pid；如果实现可以可靠获得 process group id 或 session id，也应记录为 fenced runtime truth。实现不得使用宽泛的 `pkill`、进程名匹配或会误杀同 task 其他进程的策略。

runner 发送 `agent.terminal.close_ack` 前必须记录同组可观测字段：terminal session、runner session、close attempt、request id、generation、connection epoch、ack status、remaining pid count、diagnostic code。该日志用于区分“runner 未 ack”和“ack 被 API fencing 拒收”。

### 6.5 `terminateTerminalProcessTree()` 语义

目标函数语义：

```text
terminateTerminalProcessTree(input) -> {
  outcome: 'terminated' | 'not_found' | 'failed',
  root_pid,
  terminated_pids,
  remaining_pids,
  signal_sequence,
  duration_ms,
  diagnostic_code?
}
```

要求：

- 支持 managed/internal pod 和 Developer runner 本机路径。
- 本次 Developer runner 只保证 Linux。macOS 不在本次完成范围内；如果检测到非 Linux Developer runner，返回明确 `error + unsupported_platform`，不假装已完成 process-tree hardening。
- Developer runner on macOS 本次必须返回 close ack `status=error + diagnostic_code=unsupported_platform`，不能把 unsupported 伪装成 `closed`。
- 不需要 root，不要求 chmod，不写系统级目录。
- 启动 terminal 时记录 pty pid、process group id、session id；如果某项平台不可得，记录为 `null` 并在 diagnostic 中说明。
- signal 前先验证边界：pid 仍存在、属于当前 terminal generation、pgid/session id 未漂移到 runner 或其他 terminal。
- 优先 signal 当前 terminal 的 process group / session；必要时枚举 root pid descendants 并逐个终止。
- hard kill 后重新枚举 remaining descendants，直到全部退出或 close grace 用尽。
- 只终止当前 terminal session 的进程树或同一 pty session 下的进程，不影响同 task 的 agent run child、其他 terminal 或 runner 本身。
- 禁止宽泛 `pkill`、按进程名匹配、按命令文本匹配或 task-wide kill。
- 测试 marker 必须使用唯一 session marker，不能用裸 `sleep` 名称误匹配其他进程。
- SIGTERM/SIGHUP/SIGKILL 的具体顺序由实现按 Linux 验证决定，但必须有 bounded grace、hard kill 升级和退出确认。
- 终止完成条件必须基于 process exit / descendant gone / pty close 等可观测信号，不基于 sleep。
- 每次 close attempt 记录足够诊断：terminal_session_id、runner_session_id、generation、root pid、signal sequence、remaining pid count、duration、outcome。
- `outcome=not_found` 只表示 terminal registry miss，或 fenced root pid 在终止前已经消失。close path 映射为 `agent.terminal.close_ack status=not_found`；恢复/adopt path 的 not_found 仍按 terminal process lost 处理。

### 6.6 Close ack、diagnostic 和用户可见 truth

`agent.terminal.close_ack` 是 close tombstone 的唯一 ack 事件。

API 收到匹配 ack 后：

| Ack status | API session truth | 用户可见 truth | Diagnostic |
| --- | --- | --- | --- |
| `closed` | `closed + close_state=acked + failure_kind=null + close_result=closed` | 已结束 | 可记录 close duration/process evidence |
| `not_found` | `closed + close_state=acked + failure_kind=null + close_result=not_found` | 已结束，不惊吓用户 | 记录 `terminal_process_missing_on_close` |
| `error` | 保持 `closing`，记录 diagnostic | 仍显示正在结束 | 记录 error code，等待 retry 或 deadline |

`not_found` 的产品解释：用户请求结束 terminal，runner 说目标进程已经不在了，关闭目标已经达成。普通用户不应看到失败；后台 diagnostic 用于调查为什么 close delivery 前进程已消失。

`close_result` 决策：`close_result` 是 API/user-visible low-risk field，取值 `closed` / `not_found` / `null`。前端用它把 close-path `not_found` 渲染为已结束；管理员详情可结合 gated diagnostic 看见 close result；普通用户 copy 不把 `not_found` 显示为失败或进程丢失。

非 close 路径仍然不同：runner adopt `not_found` 或恢复过程中发现 process missing，表示原 terminal 无法恢复，应进入 `failed + terminal_process_lost`。

close deadline expiry：

- `closing/requested` 或 `closing/delivered` 过期后，API 收敛为 `failed + failure_kind=terminal_process_lost + close_state=expired + close_reason=close_tombstone_timeout`。
- 这是后端 typed failure，不是测试通过条件的 sleep workaround。
- list/get/delete/create-run paths 都必须做 read-time expiry，sweeper 只作为补充。
- 用户文案优先看 `close_reason` 或独立 close typed reason。只要 `close_reason=close_tombstone_timeout` 存在，就显示“结束超时/无法确认已结束”类 copy，不能因为 `failure_kind=terminal_process_lost` 误显示普通“进程丢失”。

API 拒收 `agent.terminal.close_ack` 时必须保留 debug reject reason，例如 `missing_runtime_identity`、`non_positive_generation`、`non_positive_connection_epoch`、`stale_socket_authority`、`wrong_close_attempt`、`wrong_generation`、`wrong_connection_epoch`。普通用户不看这些细节，但 backend-real gate / runbook 需要能定位 ack 为什么没被接受。

### 6.7 Retry decision for close `status=error`

本次选择清晰、可测的 retry 策略：

- close ack `status=error` 不立即 final failed。
- API 保持 `closing + close_state=delivered`，记录 diagnostic。
- 重复 DELETE / browser close request 返回同一个 closing tombstone truth，不创建新 attempt，不延长 deadline。
- 没有新的 authoritative runner ready 时，允许只等待 `close_deadline_at`，由 read-time expiry / sweeper typed final。
- 有新的 authoritative runner ready 时必须调用 `redeliverMissingClosingTombstones()`；如果 session 仍是 `closing` 且 deadline 未过，必须重投递同一个 close attempt。
- API 可做 bounded internal retry，但本次不要求一定实现后台 timer；如果实现 timer，不能延长 `close_deadline_at`。
- deadline 到期后统一 final `failed + terminal_process_lost + close_state=expired + close_reason=close_tombstone_timeout`，释放 blocker。

### 6.8 Recovery 和 close 的优先级

- 刷新/切页回来后的 recovery happy path：前端先 GET API session truth；如果发现 existing `active` / `recovering` terminal，则 attach/adopt 到同一个 `terminal_session_id` 和同一个 terminal process；成功后转 `active`。该路径不得发送第二个 `server.terminal.start`，也不展示手动恢复主 CTA。
- `closing` 优先级高于 `recovering`。
- `closing` session 不可 adopt。
- late `agent.ready.active_terminals`、late adopt response、late terminal output 都不能复活 `closing/closed/failed` session。
- runner transport lost 可以让 terminal 进入 `recovering + transport_lost`，但用户 close 后必须进入 `closing`，等待下一次 authoritative runner ready 时 close/GC。

Runner ready 即使 `active_terminals=[]`，也必须调用 recovery coordinator：

- recoverable sessions may expire or remain waiting.
- closing sessions may need close tombstone redelivery or expiry.
- `redeliverMissingClosingTombstones()` must run for the authoritative runner ready event, independent of whether the ready frame reports active terminals.

### 6.9 User-visible state table

| Backend state | 用户看到什么 | 输入 | CTA | Deadline 后 | Blocker |
| --- | --- | --- | --- | --- | --- |
| `recovering + transport_lost` | 正在恢复同一个终端会话/进程；可能显示恢复截止时间 | 禁用 | 等待自动恢复；辅助刷新状态；危险动作为结束会话 | `recovery_deadline_at` 到期后 `failed + runner_recovery_timeout` | 保持 |
| `recovering + adopting` | 正在重新接入终端 | 禁用 | 等待自动恢复 | adopt 成功转 `active`；失败按 typed failure | 保持 |
| `closing + requested` | 正在结束终端会话 | 禁用 | 等待结束确认；辅助刷新状态 | `close_deadline_at` 到期后 `failed + close_reason=close_tombstone_timeout` | 保持 |
| `closing + delivered` | 正在确认终端进程已结束 | 禁用 | 等待结束确认；辅助刷新状态 | ack `closed/not_found` 转用户可见 `closed`；ack `error` 保持 closing；deadline 后 `failed + close_reason=close_tombstone_timeout` | 保持到 final |
| `closed + close_result=closed` | 终端已结束 | 不可输入 | 新建终端（如果后端允许） | 已 final | 释放 |
| `closed + close_result=not_found` | 终端已结束 | 不可输入 | 新建终端（如果后端允许） | 已 final | 释放 |
| `failed + runner_recovery_timeout` | 终端恢复超时，原终端不可恢复 | 不可输入 | 新建终端（如果后端允许） | 已 final | 释放 |
| `failed + close_reason=close_tombstone_timeout` | 终端结束超时，系统无法确认终端已结束 | 不可输入 | 刷新状态或联系管理员；新建终端仅在后端允许时显示 | 已 final | 释放 |
| `failed + terminal_process_lost` from recovery/adopt | 原终端进程已丢失，无法继续连接 | 不可输入 | 新建终端（如果后端允许） | 已 final | 释放 |
| `failed + protocol_error/permission_revoked` | typed 用户文案，不显示 raw enum | 不可输入 | 按后端 affordance | 已 final | 释放 |

UI 渲染要求：

- `closed + close_result=not_found` 不显示失败样式、不显示 `terminal_process_lost` 给普通用户。
- `recovering` 和 `closing` 的说明显示在 xterm 外层，不能写入 xterm buffer。
- 刷新进入 task detail 时，必须先以 API session truth 渲染 `active/recovering/closing/final`，truth 未返回前不能用本地 websocket close / stale error 渲染 generic failed 或 raw enum。
- typed copy 优先级：`close_reason` / close typed reason 高于 generic `failure_kind`；`close_reason=close_tombstone_timeout` 不能显示为普通 `terminal_process_lost`。
- 恢复成功只说明同一 process/session 已恢复；如果 replay/scrollback 不完整，用 replay partial/unavailable 说明，不改变 recovered 状态。

### 6.10 Time boundaries

这些边界必须来自配置或集中常量，并进入测试可控配置：

| Boundary | Purpose | Acceptance |
| --- | --- | --- |
| `NOTEBOOK_TERMINAL_CLOSE_GRACE_MS` | runner 从 graceful signal 到 hard kill 的等待窗口 | grace 内退出则 ack `closed`；未退出则升级 hard kill |
| `NOTEBOOK_TERMINAL_CLOSE_TIMEOUT_MS` | API close tombstone 从 requested/delivered 到 final truth 的最大窗口 | timeout 内必须 `closed` 或保持 retry；timeout 后 read-time expiry 必须 typed final 并释放 blocker |
| `NOTEBOOK_TERMINAL_RECOVERY_TIMEOUT_MS` | runner transport lost 后自动恢复窗口 | timeout 内 adopt 成功转 active；timeout 后 typed final `runner_recovery_timeout` |

验收要求：

- Tests/gates 不使用无意义 sleep 签收；它们轮询 API truth，直到这些配置边界内出现 final truth 或 typed failure。
- API 仍可暴露 `close_deadline_at` / `recovery_deadline_at` 这类绝对时间字段；env / constructor 配置命名统一使用 close timeout 和现有 recovery timeout，不让 handoff 与代码各说各话。
- close grace、close timeout、recovery timeout 在 unit tests 中使用短配置。
- backend-real/UX gate 输出最后一次 observed session truth 和 elapsed time，证明收敛发生在配置边界内。

## 7. 开发任务拆分

### A. Contract and protocol slice

- 明确 `agent.terminal.close_ack` 是 close tombstone 唯一 ack。
- 明确 browser websocket close、`agent.terminal.exited`、transport close 都不能替代 close ack。
- 明确 close ack 只有在 runner 确认 terminal process tree 退出后发送。
- 补齐 close ack `status=closed|not_found|error` 的 API 映射和 diagnostic 字段，其中 close-path `not_found` 用户可见为 `closed`。
- terminal start / adopt contract 和 storage mapping 必须持久化 authoritative `runner_session_id`、`generation`、`connection_epoch`。
- `server.terminal.close` 和 `agent.terminal.close_ack` 增加/携带 `request_id`、`close_attempt_id`、`generation`、`connection_epoch`。
- 统一 fencing 正整数语义：`generation` / `connection_epoch` 不发送 `0`，缺失或非正整数必须 reject / diagnostic。
- `close_result` 作为 API/user-visible field 进入 OpenAPI、generated types、serializer 和 session response。
- API terminal session storage 记录并校验 close attempt fencing 字段。
- close ack reject 路径补 debug reject reason，覆盖 missing identity、非正整数、stale socket、wrong attempt、wrong generation / epoch。
- 统一 close/recovery timeout 配置命名：沿用 `NOTEBOOK_TERMINAL_RECOVERY_TIMEOUT_MS`，新增或对齐 close timeout env / constructor config。
- AsyncAPI 更新 close frame 和 ack frame schema。
- 补齐 `closing/delivered` list/get 语义：仍是 live blocker，直到 ack 或 typed expiry。
- 更新当前测试/实现冲突：close `error` 不再立即 failed；close `not_found` 必须断言 user-visible closed + internal diagnostic。

### B. Runner process lifecycle slice

- 让 `TerminalProcess` 暴露 pid 相关信息，至少可用于终止 pty shell/root process。
- 记录 pty pid、pgid、session id；不可得字段写 `null` 并产出 diagnostic。
- 在 terminal runtime 中建立 terminal session 到 process metadata 的 registry，包含 runner_session_id、generation 和 connection_epoch。
- 实现统一的 `terminateTerminalProcessTree()`，覆盖 managed/internal 和 Developer runner。
- close path、runner shutdown path、garbage-collect path 统一调用该函数，不再各自 fire-and-forget。
- 终止真实 foreground command，例如 `sleep 120`，并确认 descendants 已退出。
- 终止算法先验证 pid/pgid/session 边界，再 signal group/tree，并枚举 remaining descendants。
- 禁止宽泛 `pkill`、进程名匹配或 task-wide kill。
- 本次 Developer runner process-tree hardening 只保证 Linux；macOS 返回 `status=error + diagnostic_code=unsupported_platform`。
- close ack 在终止确认后发送；失败时发送 `status=error` 和 typed diagnostic。
- 发送 close ack 前记录同组 observability 字段，便于和 API reject reason 对齐。

可能涉及的实现位置：

- `packages/agent-task-runner/src/terminal-runtime.ts`
- `packages/agent-task-runner/src/index.ts`
- runner process/child utility 文件，命名按现有结构收敛

### C. API close coordinator slice

- browser WS `terminal.close`、DELETE、permission revoke close、GC close 统一转入 `beginCloseTombstone`。
- browser disconnect grace 只改变 browser binding，不关闭 runtime，不 finish session。
- 普通 terminal start / adopt 成功后立即持久化 runtime identity，缺失时不允许后续 close frame 用 `0` 补位。
- DELETE terminal session 写 tombstone 后返回 `closing` truth，不等待 browser websocket close。
- `close_state=delivered` 只表示 frame delivered，不释放 blocker。
- 接受 close ack 前做 request、attempt、terminal、runner session、generation、connection epoch、socket authority fencing。
- close ack 被拒时记录 debug reject reason 和收到/期望的 redacted fence 字段。
- `status=closed` 才 final `closed`。
- close-path `status=not_found` final user-visible `closed`，释放 blocker，并记录 internal `terminal_process_missing_on_close` diagnostic。
- `close_result=closed|not_found|null` 写入 storage，并通过 serializer / OpenAPI response 暴露为 user-visible field。
- `status=error` 保持 `closing`，重复 DELETE 不延长 deadline；runner ready redelivery 使用同一个 attempt；deadline expiry 后 typed failed。
- read-time expiry 覆盖 list/get/delete/create-run blocker check。
- runner ready 命中 `closing` terminal 时发送 close/GC，不进入 adopt。
- runner ready 即使 `active_terminals=[]` 也调用 recovery coordinator 和 `redeliverMissingClosingTombstones()`。

可能涉及的实现位置：

- `packages/api-entry-node/src/notebook-terminal-service.ts`
- `packages/api-entry-node/src/agent-execution-service.ts`
- `packages/api-entry-node/src/task-route-handler.ts`

### D. Smoke and helper slice

- 移除把 `waitForClosed()` 当 session final truth 的测试心智。
- helper close 后轮询 API session list/get，直到：
  - session final `closed`，或
  - final typed `failed`，或
  - 超过 gate deadline 后报告最后一次 API truth 和 runner diagnostic。
- managed/internal close smoke 要执行真实 foreground command，例如 `sleep 120`，然后 close terminal 并证明命令不再存活。
- foreground command 必须携带唯一 marker，process-gone 检查按 marker + terminal session evidence 关联，避免误匹配。
- Developer runner close smoke 使用同一语义，确保本机路径和 managed 路径都覆盖。
- Developer runner 本次只要求 Linux evidence；macOS 后续另行实现，本次只能输出 `unsupported_platform` error evidence。
- gate evidence 记录 runner kind（managed/internal vs Developer/Linux）、start count、terminal_session_id、runtime identity、close attempt id、close_state transition、ack status、final session truth。
- refresh/navigation 恢复场景必须证明没有第二个 `server.terminal.start`。
- gate 必须同时有 API final truth polling 和 process-gone evidence；不能 `waitForClosed()` 后直接 list 一次就签收。

可能涉及的实现位置：

- `e2e/integration-real-helpers.ts`
- `scripts/agent-task-terminal-ux-real-gate.sh`
- `e2e/integration-agent-task-terminal-ux.spec.ts`
- backend-real terminal smoke/matrix helpers

### E. Frontend / UX slice

- `closing/requested` 和 `closing/delivered` 都显示“正在结束终端会话”。
- `closing` 不显示恢复 CTA，不进入 reconnect/adopt UI，不展示 raw enum。
- `recovering` 显示自动恢复，输入禁用，不把“手动恢复”作为主 CTA。
- 初始加载等 API truth；truth 未返回前不根据本地 websocket close / stale error 显示 failed。
- `failed` 文案由 typed `close_reason` / `failure_kind` 驱动，不能显示裸 `agent_disconnected`。
- `close_reason=close_tombstone_timeout` 的 copy 优先于 generic `terminal_process_lost`。
- close-path `not_found` 渲染为已结束，不渲染失败。
- 使用 API response 中的 `close_result` 判定 close-path `not_found`，不靠本地推断。
- 刷新回来不能先闪 `failed` / raw transport error，再切换到 recovering。
- 恢复成功文案只承诺同 process/session 继续交互，不承诺完整视觉现场或 scrollback。

### F. Docs and runbook slice

- 实现完成后同步 current truth docs、runner runbook、terminal troubleshooting、i18n copy docs。
- 更新 broad recovery plan 中已被实现或调整的状态说明。
- 保持 `docs/engineering/agent-task-terminal-runtime-recovery-guidance.md` 与本文一致：close-path `not_found -> closed`、recovery/adopt `not_found -> terminal_process_lost`。
- 不把本文中的 handoff 语义误写成已发布能力，直到 tests/evidence 完成。

## 8. TDD / 测试计划

采用 progressive validation。先写 focused red tests，再实现，再跑相关 owner diagnostics；不要用 full release gate 替代本次 close/recovery 的精准证据。

以下 `-t` 过滤只作为建议 grep，最终以实际落地测试名为准；如果测试名不匹配，必须跑文件级命令，避免空跑。

### 8.1 Runner unit / integration tests

新增或更新测试覆盖：

- `TerminalProcess` 暴露 pid metadata。
- `TerminalProcess` 记录 pty pid、pgid、session id；不可得字段产生 diagnostic。
- `terminateTerminalProcessTree()` 对 fake/process fixture 能终止 descendants，并返回 remaining pid evidence。
- `terminateTerminalProcessTree outcome=not_found` 只覆盖 registry miss 或 fenced root pid 已消失，并在 close path 映射为 close ack `status=not_found`。
- runner close frame 对运行中的唯一 marker `sleep 120` 或等价 foreground command 收敛到 process gone。
- close ack 在 process exit 之前不会发送。
- close ack send observability 记录 terminal、runner、attempt、request、generation、connection epoch、status 和 remaining pid count。
- close 失败发送 `agent.terminal.close_ack status=error`，并保留 diagnostic。
- close frame 的 non-positive `generation` / `connection_epoch` 不被 runner fallback 成可匹配 fence。
- repeated close attempt 幂等，不重复 ack stale attempt。
- runner websocket transport close 不杀 terminal PTY；operator shutdown 路径仍杀 terminal process tree。
- terminal A close 不影响 terminal B、不杀 runner process、不杀同 task active run child。
- Linux Developer runner 通过；macOS Developer runner 返回 `status=error + diagnostic_code=unsupported_platform`。

建议 focused 命令：

```bash
npm run test:run -- packages/agent-task-runner/src/terminal-runtime.test.ts -t "terminal close"
npm run test:run -- packages/agent-task-runner/src/index.test.ts -t "close ack|process tree|websocket close|shutdown"
```

### 8.2 API service tests

新增或更新测试覆盖：

- browser websocket close 不写 close tombstone，不 final terminal。
- browser WS `terminal.close` 和 DELETE 进入同一个 `beginCloseTombstone`。
- DELETE terminal session 返回 `closing/requested` 或 `closing/delivered`。
- terminal start / adopt 持久化 runtime identity；close frame 使用持久化的正整数 `generation` / `connection_epoch`，不发送 `0`。
- API 不把 browser `waitForClosed()` 当 close ack。
- accepted `agent.terminal.close_ack status=closed` final `closed`。
- accepted close-path `status=not_found` final user-visible `closed`，stores `close_result=not_found` and internal diagnostic，releases blocker。
- close-path `status=error` 保持 `closing`；没有 runner ready 时允许等 deadline typed expiry，有 runner ready 时必须 same-attempt redelivery。
- `agent.terminal.exited` 不设置 `close_state=acked`。
- runner ready with active terminal while session is `closing` sends close/GC, never adopt。
- runner ready with `active_terminals=[]` still calls recovery coordinator and redelivers missing closing tombstones。
- close ack fencing 拒绝 stale socket authority、stale request id、stale close attempt、wrong generation、wrong / non-positive connection epoch，并记录 debug reject reason。
- OpenAPI/session serializer/generated types 暴露 `close_result=closed|not_found|null`，internal diagnostic 仍 gated。
- refresh/navigation recovery happy path 不发送第二个 `server.terminal.start`。
- list/get/delete/create-run blocker path 执行 read-time close expiry。
- close grace / close timeout / recovery timeout 使用短配置测试，timeout 内必须 final truth 或 typed failure。

建议 focused 命令：

```bash
npm run test:run -- packages/api-entry-node/src/notebook-terminal-service.test.ts -t "close tombstone|closing|close ack"
npm run test:run -- packages/api-entry-node/src/agent-execution-service.test.ts -t "terminal close|ready|adopt"
npm run test:run -- packages/api-entry-node/src/task-route-handler.test.ts -t "terminal close|live terminal blocker"
```

### 8.3 Frontend tests

新增或更新测试覆盖：

- `closing/requested` 和 `closing/delivered` 显示 closing copy，不显示 recovering copy。
- `closing` 没有 reconnect/adopt 主动作，输入禁用。
- `failed + close_reason=close_tombstone_timeout`、`failed + terminal_process_lost`、`runner_recovery_timeout` 使用不同 typed copy，且 close reason 优先。
- close-path `closed + close_result=not_found` 显示已结束，不显示失败。
- ordinary task UI 不显示裸 `agent_disconnected`。
- 刷新 task detail 时，API truth 未返回前不根据本地 websocket close / stale error 闪 generic failed；truth 返回后 recovering/closing 不闪 generic failed。
- recovering 不展示“手动恢复”主 CTA。
- 恢复成功不承诺完整 scrollback；partial/unavailable replay 只显示输出连续性提示。

建议 focused 命令：

```bash
npm run test:run -- src/components/agent-tasks/__tests__/TaskTerminalPanel.test.tsx -t "closing|recovering|agent_disconnected"
npm run test:run -- src/components/agent-tasks/__tests__/TaskPage.test.tsx -t "terminal"
```

### 8.4 Backend-real / UX gates

当前问题的必需 closure evidence：

```bash
npm run test:e2e:integration:agent-task:terminal:ux
```

Focused backend-real smoke/matrix：

```bash
npm run test:agent-task:backend-real:terminal
npm run test:agent-task:backend-real:terminal:matrix
```

必测场景：

- managed/internal terminal 启动带唯一 marker 的 foreground command，例如 `sleep 120`，close 后轮询 API truth 到 final，并证明 marker command 不再存活。
- Linux Developer runner terminal 同样执行带唯一 marker 的 foreground command，close 后 final，并证明 marker command 不再存活。
- browser navigation/refresh 后，如果 terminal process 仍在，恢复同一个 `terminal_session_id`，并证明没有第二个 `server.terminal.start`。
- evidence 输出 runner kind：managed/internal 或 Developer/Linux。
- runner control-channel 短断但 runner process/PTY 仍在时，`agent.ready.active_terminals -> server.terminal.adopt -> input_enabled=true`。
- runner ready with `active_terminals=[]` 仍触发 recovery coordinator / missing closing tombstone redelivery。
- runner process 明确退出时，terminal 进入 typed failed，不展示可恢复假象。
- close helper 不再用 `waitForClosed()` 作为 session final 证据。
- close 收敛发生在配置的 close grace / close timeout 内；recovery 收敛发生在配置的 recovery timeout 内。

必要 contract gates：

```bash
npm run contracts:check
npm run contracts:check-openapi
npm run openapi:check-generated
```

### 8.5 Stage close

本次如果只改 terminal close/recovery 主链，阶段收口通常是：

```bash
npm run verify -- --goal=pr --run
```

只有当实现扩展到 deploy、release、视觉系统、跨模块治理或明确发布验收时，才升级到：

```bash
npm run verify -- --goal=real --run
npm run verify -- --goal=visual --run
npm run release:ready
```

## 9. 验收标准

功能验收：

- 用户刷新或切页回来，运行中的 terminal 不被写成 `failed / agent_disconnected`。
- 如果原 terminal process 仍在，恢复同一个 `terminal_session_id`，不发送第二个 `server.terminal.start`。
- terminal start / adopt 持久化 authoritative `runner_session_id`、正整数 `generation`、正整数 `connection_epoch`；close frame 不发送 `0` fence。
- 恢复只承诺同 process/session，不承诺完整视觉现场或 scrollback。
- 用户 close terminal 后，runner 确认真实 process tree 已退出才发送 `agent.terminal.close_ack status=closed`。
- `sleep 120` 这类 foreground command 在 managed/internal 和 Developer runner close 后都不再存活。
- macOS Developer runner 本次 close process-tree hardening 返回 `error + unsupported_platform`，不能伪装为 closed。
- terminal A close 不影响 terminal B、runner process 或同 task active run child。
- `closing/delivered` 不长期卡住；最终收敛到 `closed`、`failed + close_reason=close_tombstone_timeout` 或其他 typed final state。
- close-path `not_found` 对普通用户显示已结束并释放 blocker，API 暴露 `close_result=not_found`，后台留 diagnostic。
- close-path `error` 不直接 final failed；按同 attempt retry/redelivery 或 close deadline expiry 收敛。
- close deadline expiry 是 typed failure，释放 live blocker，用户 copy 优先使用 `close_reason=close_tombstone_timeout`。
- close grace、close timeout、recovery timeout 来自统一配置/常量；验收必须在这些边界内看到 final truth 或 typed failure。
- API reject close ack 和 runner send close ack 都有可关联 observability 字段。
- `closing` 不能被 runner ready/adopt 复活。
- 前端初始加载等 API truth，不显示手动恢复主 CTA。
- 普通用户 UI 不显示裸 `agent_disconnected`、内部绝对路径、pod/internal 细节或 diagnostic id。
- 刷新回来不能先闪 generic failed/raw enum。

测试验收：

- Runner close tests 证明 process tree termination 和 ack-after-exit。
- API tests 证明 browser close 不等于 close ack，`agent.terminal.exited` 不替代 close ack。
- API / contract tests 证明 `close_result` 进入 OpenAPI、generated types、serializer，且 diagnostic 字段仍 gated。
- API tests 证明 start/adopt runtime identity 持久化、正整数 fencing、reject reason observability 和 no-second-start recovery。
- Backend-real/UX gate 不依赖 `waitForClosed()` 判断 session final truth。
- Backend-real/UX gate 同时证明 API final truth polling、process-gone evidence 和 runner kind 输出。
- managed/internal 和 Linux Developer 两条路径都有 close foreground command 的证据。
- Linux 是本次 Developer runner process-tree support 的验收平台；macOS 本次必须返回 `error + unsupported_platform` evidence。
- focused terminal UX gate 通过，并保留 close transition evidence。
- `npm run contracts:check`、`npm run contracts:check-openapi`、`npm run openapi:check-generated` 通过。

文档验收：

- contracts/runbook/current truth docs 实现后同步。
- `agent-task-terminal-runtime-recovery-guidance.md` 明确 close-path `not_found -> closed`、recovery/adopt `not_found -> terminal_process_lost` 的分流语义。
- 文档不使用 v2/legacy 心智，不把当前 pre-GA 对齐写成旧版本迁移。
- 文档保持本文范围，不蔓延到 execution-gateway 或多 API 副本。

## 10. 风险与边界

| 风险 | 边界和缓解 |
| --- | --- |
| process group 终止误杀同 task 其他进程 | 只使用 terminal process metadata、generation、pty/session 边界；禁止宽泛进程名匹配 |
| managed pod PID namespace 或 shell 行为导致 descendants 枚举不完整 | backend-real 使用真实 foreground command 验证；终止函数输出 remaining pid diagnostic |
| `node-pty.kill()` 触发 shell exit 但 foreground command 残留 | close path 必须以 process tree gone 为完成条件，不以 pty close alone 为完成条件 |
| ack 和 exit event 顺序竞争 | API 只用 `agent.terminal.close_ack` ack tombstone；`agent.terminal.exited` 是普通 evidence |
| start path 缺 runtime identity 导致 ack 被拒 | terminal start/adopt 持久化 runner_session_id/generation/connection_epoch；正整数 fence；拒收时记录 reason |
| stale runner socket 发送 late ack | close ack fencing 包含 socket authority、request id、attempt id、generation、connection epoch |
| `close_result` 未进 OpenAPI/serializer 导致前端靠猜 | 将 `close_result` 定为 API/user-visible field，并跑 contract/generated gates |
| close `status=error` 导致 blocker 长期存在 | API 保持 `closing`，runner ready 重投递同一 attempt，bounded deadline 和 read-time expiry 兜底 |
| `not_found` 让普通用户看到失败惊吓 | close-path `not_found` 用户可见 `closed`，diagnostic 只给后台/工程 |
| smoke 继续误用 browser websocket close | helper API 必须改为轮询 API final truth；reviewer 检查不再用 `waitForClosed()` 作为 final |
| Developer 和 managed 行为分叉 | 两条路径都跑 foreground command close 场景；不要求 root/chmod，不静默改写 managed `/home` 语义 |
| macOS Developer runner process-tree 语义不稳定 | 本次只承诺 Linux；macOS 明确 `error + unsupported_platform`，不阻塞本次收口 |
| timeout 命名与代码不一致 | env / constructor 配置统一为 close timeout 和现有 recovery timeout，API deadline 字段只表达计算后的绝对时间 |
| `.mbos/.builtin-skills-seed.lock` ENOENT 干扰判断 | 作为 seed robustness follow-up 处理，不作为 close timeout 主因 |
| close/recovery 修复范围膨胀 | 本文只处理 terminal close/recovery，不处理 execution-gateway、多 API 副本、长期 transcript 或部署重构 |

## 11. Reviewer Checklist

- [ ] Browser websocket close 没有被当作 terminal close ack。
- [ ] Smoke/helper close 后轮询 API session truth，而不是只等 browser socket close。
- [ ] `TerminalProcess` 暴露 pid metadata。
- [ ] Terminal start/adopt 持久化 runner_session_id、正整数 generation、正整数 connection_epoch。
- [ ] `server.terminal.close` / `agent.terminal.close_ack` 携带 request id、attempt id、generation、connection epoch，API 持久化并校验。
- [ ] API 不发送 `generation=0` / `connection_epoch=0`；non-positive fence 有 reject reason。
- [ ] `close_result=closed|not_found|null` 进入 OpenAPI、generated types、serializer 和前端类型。
- [ ] Runner close/shutdown/GC 统一走 `terminateTerminalProcessTree()`。
- [ ] `terminateTerminalProcessTree outcome=not_found` 仅表示 registry miss 或 fenced root pid 已消失。
- [ ] 进程树算法验证 pty pid/pgid/session id 边界，禁止 pkill/name match。
- [ ] Foreground command，例如 `sleep 120`，在 close 后真实退出。
- [ ] Terminal A close 不影响 terminal B、runner 或同 task active run child。
- [ ] `agent.terminal.close_ack status=closed` 只在退出确认后发送。
- [ ] Runner 发送 close_ack 前记录可关联 observability 字段；API reject close_ack 记录 debug reason。
- [ ] close-path `not_found` 用户可见为 closed，后台有 diagnostic。
- [x] `agent-task-terminal-runtime-recovery-guidance.md` 明确 close-path `not_found -> closed`、recovery/adopt `not_found -> terminal_process_lost`。
- [ ] close-path `error` 保持 closing，经 runner ready redelivery / optional bounded retry / deadline expiry 收敛。
- [ ] `agent.terminal.exited` 不能设置 `close_state=acked`。
- [ ] `closing/delivered` 保持 live blocker，直到 ack 或 typed expiry。
- [ ] `closing` session 在 runner ready 时收到 close/GC，不被 adopt。
- [ ] runner ready with empty `active_terminals` 仍调用 recovery coordinator / redeliver missing closing tombstones。
- [ ] Stale ack/adopt/output 不能复活 final 或 closing session。
- [ ] Browser WS `terminal.close` 和 DELETE 统一走 begin close tombstone；browser disconnect grace 不关闭 terminal。
- [ ] Smoke 使用 API final truth polling + process-gone evidence，不把 `waitForClosed()` 当 final。
- [ ] close grace、close timeout、recovery timeout 在统一配置边界内收敛。
- [ ] 恢复同 process/session，不承诺完整视觉现场/scrollback。
- [ ] refresh/navigation recovery 没有第二个 `server.terminal.start`。
- [ ] backend-real evidence 输出 runner kind：managed/internal 或 Developer/Linux。
- [ ] 刷新不闪 generic failed/raw enum。
- [ ] 初始 API truth 未返回前不使用本地 WS/stale error 渲染 failed，且无手动恢复主 CTA。
- [ ] `close_reason=close_tombstone_timeout` 文案优先于 generic `terminal_process_lost`。
- [ ] 普通用户 UI 不显示裸 `agent_disconnected`。
- [ ] managed/internal 和 Linux Developer runner close/recovery 都有 focused evidence。
- [ ] contract gates：`contracts:check`、`contracts:check-openapi`、`openapi:check-generated`。
- [ ] 没有引入 tmux/screen、新 shell 冒充恢复、sleep workaround、root/chmod 要求。
