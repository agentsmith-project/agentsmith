# Managed Agent Runner Execution Channel Protocol (WS, v1)

Last updated: 2026-05-08
Owner: Backend + Frontend

## 1. Scope

This contract defines the execution protocol between MBOS server and task-only Agent Runners over WebSocket.

- Transport: WebSocket
- Auth: `Authorization: Bearer ask_*` (agent service key)
- Endpoint: `GET /api/v1/agent-execution/ws?agent_runner_id={agentRunnerId}&runner_session_id={runnerSessionId}`
- Query contract: API entry accepts only the canonical runner query names in this contract. `runner_session_id` is optional for agent-level presence connections.
- Protocol version: `1.0`

## 2. Envelope

All frames are JSON objects:

```json
{
  "type": "string",
  "request_id": "optional-string",
  "runner_session_id": "optional-string",
  "timestamp": "ISO-8601",
  "payload": {}
}
```

## 3. Server -> Agent Events

- `server.hello`
  - payload: `{ "protocol_version": "1.0", "heartbeat_interval_sec": 15 }`
  - `server.hello` does not carry Endpoint/model selection or resource proxy data.
- `server.request.start`
  - payload:
    - `model: string`
    - `stream: true`
    - `messages: OpenAI-compatible message array` (supports multimodal content parts and data URLs)
    - `execution_context: TaskExecutionContext` (required agent task execution metadata validated by the public runner guard)
      - `workspace_id: string`
      - `project_id: string`
      - `task_id: string`
      - `run_id: string`
      - `runner_id: string`
      - `username: string`
      - `endpoint_id: string`
      - `agent_task_model: { endpoint_id: string; endpoint_display_name?: string; resolved_model: string; upstream_protocol?: "openai_chat_completions" | "openai_responses" | "anthropic_messages"; setting_revision: string; policy_decision_id?: string; resolved_at: string }`
      - `resource_proxy: { base_url: string }`
      - `api_base?: string` (for task helper scripts / file download access)
      - `execution_ticket: string`
      - `wire_api: "openai_chat_completions" | "openai_responses" | "anthropic_messages"`
      - `model: string`
      - `resource_proxy.base_url` is request-scoped and must be used for this run/session instead of any connection-level cache.
      - `runner_session_scope: "agent_presence" | "task_execution"`
      - `workspace_binding_mode: "file_library" | "pre_mounted"`; this only identifies the workspace source, not a path shape.
      - `runtime_profile: "managed" | "developer"`
      - `task_home_segment: string`
      - `task_home_path: string` (managed canonical value: `/home/<task_home_segment>`)
      - `workspace_path: string` (managed canonical value: `/home/<task_home_segment>/workspace`)
      - `artifacts_path: string` (managed canonical value: `/home/<task_home_segment>/workspace/.artifacts`)
      - `task_inputs?: Array<{ kind?: "library_object" | "artifact" | "url"; library_id?: string; key?: string; task_id?: string; artifact_id?: string; url?: string; filename?: string; file_type?: string; file_size?: number }>`
      - Short-lived execution tickets, Project secrets, and managed OAuth credentials must stay in request-scoped environment/context projections. Runners must not persist them to `HOME`, `workspace_path`, Codex config, or reusable tool config.
      - runner path model (implementation contract):

        | Item | Agent task runner |
        | --- | --- |
        | task HOME (`TASK_HOME` / `HOME`) | `task_home_path` |
        | user file workspace (`cwd`) | `workspace_path` |
        | Codex state | `<task_home_path>/.codex/` |
        | runner metadata | `<task_home_path>/.mbos/` |
        | skills | `<task_home_path>/.agents/skills/` |
        | user-visible artifacts | `artifacts_path` |
        | context / credentials | AgentSmith Context Store member/task/project_member/project/workspace context via capability-aware builtin skill helpers; `mbos-context` remains the generic direct-access skill; managed OAuth credentials are read-only context projections |

        Notes:
        - `task_home_path` is the root of the bound file library while the task binding exists
        - `workspace_path` is the default cwd for both agent runs and terminal sessions
        - reusable tool configuration, user-mode installs, caches, runner metadata, and Codex config may live under `task_home_path`
        - deleting a task releases the file-library binding; it does not delete or clean the file library HOME
        - `container_workspace_path` is not a canonical execution context field
        - provider-specific mount mechanics are backend details; runners consume the explicit path fields
- `server.request.cancel`
  - payload: `{ "reason": "client_cancelled" }`
- `server.ping`
  - payload: `{}`
  - server emits this frame every `server.hello.payload.heartbeat_interval_sec` while the socket is online.
  - if the agent misses the configured pong budget, server closes the socket with code `4000` and reason `agent_heartbeat_timeout`.

## 4. Agent -> Server Events

- `agent.ready`
  - payload: execution metadata/capabilities
- `agent.pong`
  - payload: `{}`
  - agents must send one pong for each `server.ping`; each pong refreshes `last_pong_at` and keeps presence online.
- `agent.response.delta`
  - required: `request_id`
  - payload: `{ "delta": "text token chunk" }`
- `agent.response.event`
  - required: `request_id`
  - payload: structured execution telemetry event for Agent task diagnostics and expandable activity UI
  - shape (v1 additive extension):
    - `sequence: number`
    - `at: ISO-8601`
    - `category: "lifecycle" | "progress" | "tool" | "artifact" | "warning" | "error" | "debug"`
    - `phase?: "start" | "update" | "end"`
    - `status?: "running" | "success" | "error" | "cancelled"`
    - `name: string`
    - `summary: string`
    - `details?: object` (must be sanitized; no secrets/tokens)
      - normalized run lifecycle events use:
        - `name = "run.lifecycle"` with `details.run_phase` in:
          `queued|dispatching|running|streaming|completed|failed|cancelled`
        - `name = "run.summary"` with final run metrics (for example `final_status`, `duration_ms`, `artifacts_count`)
      - recommended for trace fidelity UX:
        - preserve sanitized provider/codex event metadata (e.g. original event type/source labels)
        - avoid semantic rewrites; frontend may render `Raw` view directly from `details`
    - `raw?: string` (sanitized raw snippet/source text for fidelity-oriented UI/debug views)
- `agent.response.artifact`
  - required: `request_id`
  - payload: structured artifact emitted by the runner for Agent task outputs
  - shape:
    - `filename: string`
    - `task_relative_path: string` (must be under `.artifacts`, for example `.artifacts/plot.png`)
    - `artifact_type: "text" | "image" | "file" | "other"`
    - `mime_type?: string`
    - `file_size?: number`
    - `title?: string`
    - `content?: string` (text preview or inline data URL; size-limited)
    - `thumbnail_url?: string` (usually for image artifact previews)
- `agent.response.done`
  - required: `request_id`
  - payload: `{ "finish_reason": "stop|length|cancelled|...", "usage_tokens": number }`
- `agent.response.error`
  - required: `request_id`
  - payload: `{ "error_code": "string", "error_message": "string" }`

## 5. Chat Boundary

Chat does not bind to Agent Runners and does not use this channel. The removed `external_agent_id` field is negative-contract evidence only; payloads containing it fail with `400 unsupported_field`.

## 6. Execution Constraints (v1)

- One active connection per `agent_runner_id` without `runner_session_id` (new connection replaces old one); task-scoped connections are keyed by `agent_runner_id + runner_session_id`.
- No offline queue (fail-fast if agent is offline).
- Pending streams and terminal sessions are bounded by first-event, idle, and max-runtime timers. Timeout cleanup fails the pending resource, removes its server map entry, and prevents leaked capacity.
- Attachments are passed as data URLs in multimodal messages.
- Strict protocol validation:
  - `agent.response.delta.payload.delta` must be `string`; otherwise request fails with `AGENT_PROTOCOL_ERROR`.
  - `agent.response.event.payload` must match the structured event schema above; otherwise request fails with `AGENT_PROTOCOL_ERROR`.
  - `agent.response.artifact.payload` must match the artifact schema above; otherwise request fails with `AGENT_PROTOCOL_ERROR`.
  - Unsupported `agent.response.*` types with a valid `request_id` fail that request with `AGENT_PROTOCOL_ERROR`.
  - Invalid JSON frame closes socket with close code `1003` (`invalid_json`).

## 7. Browser Agent Task Terminal WS

This section covers the browser-facing terminal websocket issued by Agent task terminal routes. It does not change the runner-side terminal protocol.

- Endpoint: `/api/v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}/terminal/ws?terminal_session_id={terminalSessionId}&ticket={ticket}`
- The first browser business frame must be `terminal.reconnect`.
- Before a valid reconnect handshake, `terminal.stdin`, `terminal.resize`, and `terminal.close` are rejected with `terminal.error` and the websocket is closed.
- `terminal.reconnect` payload fields:
  - `terminal_session_id: string`
  - `cols: number`
  - `rows: number`
  - `after_seq?: number | null`
- Browser terminal URLs use `terminal_session_id`; `session_id` is not accepted.
- Reconnect payloads do not carry a `view` discriminator. `notebook.task_terminal` is a removed view name and may appear only as negative-contract evidence; reconnect payloads that include any `view` fail with `terminal.error` / `invalid_reconnect_payload` and close the websocket.
- On successful reconnect, API entry emits `terminal.replay_start`, zero or more `terminal.output` replay frames, and `terminal.replay_end`.
- Browser-facing reconnect/replay frames use `terminal_session_id` as the session identifier.
- `terminal.output.seq` is monotonic only within one `terminal_session_id`; it is not a global audit cursor and is not durable across API entry restarts.
- `terminal.output` carries real terminal bytes with `seq` and either `chunk` or `encoding`/`data`. Browser UI must not synthesize missing output.
- For `encoding: "base64"`, `data` is arbitrary terminal byte chunk data. Browser decoding must use session-scoped streaming UTF-8 decoder state so multibyte characters split across frames are not corrupted.
- For `status: "partial"`, the browser may discard decoder state at `terminal.replay_start` because bytes before the replay window are missing, but it must preserve decoder state accumulated from replayed output across `terminal.replay_end` into later live `terminal.output` frames at the next seq.
- For `status: "unavailable"`, `next_seq` only realigns the seq cursor; byte continuity is not proven. The browser must discard pending UTF-8 decoder state before accepting later live output at that boundary.
- `terminal.replay_start` and `terminal.replay_end` use `status: "complete" | "partial" | "unavailable"` plus `gap` and seq range metadata. When `status` is `"unavailable"` because replay cannot satisfy the browser cursor, both frames may include `next_seq`.
- `next_seq` is the next acceptable `terminal.output.seq` for subsequent live output. It is a continuity boundary for the browser, not evidence that missing replay output has been recovered.
- When an unavailable replay includes `next_seq`, the browser should show a degraded replay state, align its expected live-output seq to `next_seq`, and accept later `terminal.output` frames at that boundary. It must not render placeholder bytes, fabricate missing output, or reconnect-loop solely to fill the unavailable replay range.
- `terminal.replay_end.input_enabled` tells the browser whether `terminal.stdin` / `terminal.resize` may be sent immediately after replay. Replay completion and input readiness are not the same thing.
- When `terminal.replay_end.input_enabled` is `false`, the browser must keep `terminal.stdin` / `terminal.resize` gated until API entry emits `terminal.state` with `state: "ready"`/`"active"`/`"connected"` or explicit `input_enabled: true`.
- If the runtime is still starting after replay, API entry emits `terminal.state` with `input_enabled: false`; after the runner runtime reports started/active, API entry emits `terminal.state` with `input_enabled: true`.
- API entry accepts `terminal.stdin` and `terminal.resize` only when backend runtime truth says terminal input is enabled for that session. A completed browser reconnect handshake or replay completion alone is not sufficient; post-handshake/pre-ready input is rejected with `terminal.error` and a websocket close, without writing pseudo output.
- Browser-facing terminal failures are emitted as `terminal.error`.
- Replay source is an API-entry in-memory bounded ring. If `after_seq` is older than the ring, replay is `partial` with `gap: true`; if the ring is unavailable or `after_seq` is ahead of the latest known seq, replay is `unavailable`, and future cursors use `error_code: "future_after_seq"` plus `next_seq`.
- Reconnect must not synthesize a `started` frame. Browser UI should treat replay status as terminal recovery metadata, not terminal bytes.
- Routes that issue an interactive terminal `ws_url` or ticket require `project:agent_task:terminal` in addition to task access. Reconnect handshakes and each `terminal.stdin` / `terminal.resize` frame re-check current backend permission truth; revoked permission rejects the frame and closes the websocket instead of trusting a cached ticket or open socket.
- Terminal runner startup uses the same public `TaskExecutionContext` guard as task runs. The terminal `server.terminal.start.payload.execution_context` is required; its canonical subset includes `workspace_id`, `project_id`, `task_id`, `runner_id`, `api_base`, `execution_ticket`, `runner_session_scope`, request-scoped `resource_proxy`, the `agent_task_model` snapshot when model access is required, workspace binding fields, and optional `task_inputs`; it must not include legacy top-level `session_id`, `agent_id`, or `interaction_kind`.

## 8. Terminal Recovery And Adopt

Terminal sessions are backend-owned lifecycle records. Browser disconnect is not terminal failure; runner transport loss enters recovery first.

- Terminal session `status` may be `pending | active | disconnected | recovering | closing | closed | failed`.
- `lifecycle_status`, `runner_connection_status`, `browser_connection_status`, `input_enabled`, `recoverable`, `recovery_deadline_at`, `failure_kind`, `close_state`, `close_deadline_at`, `replay_status`, `replay_gap`, and `latest_seq` are API truth fields on terminal session list/get/create responses.
- API reload of a persisted live terminal session must return `recovering + runner_connection_status=transport_lost + input_enabled=false` with a bounded `recovery_deadline_at`; it must not finalize the session as `failed` merely because API memory was lost.
- `pending | active | disconnected | recovering | closing` are live task blockers. `closed | failed` release the blocker.
- While recovering, browser reconnect is allowed and returns `terminal.state { state: "recovering", input_enabled: false }` followed by replay frames. API must not dispatch a second `server.terminal.start` for that `terminal_session_id`.
- While recovering or closing, API must not forward `terminal.stdin` or `terminal.resize`; clients that still send them receive `terminal.error / terminal_input_disabled`.

Runner reconnect uses `agent.ready.payload.active_terminals`:

```json
{
  "runner_instance_id": "uuid",
  "connection_epoch": 7,
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

- `active_terminals` must be an array with at most 64 descriptors; non-array or over-limit payloads fail the whole `agent.ready` frame with `agent_ready_validation_failed`.
- Invalid descriptors are discarded independently and do not block valid descriptors in the same ready frame.
- API serializes runner detach handling before consuming `active_terminals` from a newer socket for the same runner authority.
- For a matching recovering session, API sends `server.terminal.adopt`; it must not send `server.terminal.start`.

`server.terminal.adopt`:

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

Runner replies with `agent.terminal.adopted`, `agent.terminal.not_found`, `agent.terminal.exited`, or `agent.terminal.error`. Adopt success restores `active + attached + input_enabled=true`; `not_found` maps to `failed + terminal_process_lost`; timeout maps to `failed + runner_recovery_timeout`.

Close is tombstone based:

- User/API close of a live/recovering terminal writes `closing + close_state=requested`, sends `server.terminal.close` with the current close fence, and keeps the task blocked. Browser `terminal.close` uses the same tombstone path as REST DELETE; browser websocket disconnect alone never closes the runner terminal.
- Delivery changes `close_state=delivered`.
- Only matching `agent.terminal.close_ack` may finalize the close tombstone as `closed + close_state=acked`; ordinary `agent.terminal.exited` is not a substitute for close ack.
- API persists and validates the delivered `request_id`, `close_attempt_id`, `generation`, and `connection_epoch`. Stale socket authority, stale request id, stale attempt id, stale generation, or stale connection epoch are ignored.
- `agent.terminal.close_ack.payload.status="closed"` finalizes as closed. `status="not_found"` also finalizes as user-visible closed and records internal diagnostic `terminal_process_missing_on_close`. `status="error"` keeps the session `closing + close_state=delivered`, records the diagnostic, and waits for runner-ready redelivery or deadline expiry.
- Close deadline expiry maps to `failed + terminal_process_lost + close_state=expired + close_reason=close_tombstone_timeout`.
- Runner ready with `active_terminals: []` still invokes the recovery coordinator so missing closing tombstones can be redelivered or expired.

`server.terminal.close`:

```json
{
  "type": "server.terminal.close",
  "request_id": "close_req_xxx",
  "runner_session_id": "task_xxx",
  "terminal_session_id": "term_xxx",
  "timestamp": "ISO-8601",
  "payload": {
    "close_attempt_id": "close_xxx",
    "generation": 3,
    "connection_epoch": 12,
    "reason": "user_requested"
  }
}
```

`agent.terminal.close_ack`:

```json
{
  "type": "agent.terminal.close_ack",
  "request_id": "close_req_xxx",
  "runner_session_id": "task_xxx",
  "terminal_session_id": "term_xxx",
  "timestamp": "ISO-8601",
  "payload": {
    "terminal_session_id": "term_xxx",
    "runner_session_id": "task_xxx",
    "close_attempt_id": "close_xxx",
    "generation": 3,
    "connection_epoch": 12,
    "status": "closed",
    "diagnostic_code": null,
    "remaining_pid_count": 0
  }
}
```

## 9. Agent Task Error Mapping

Agent task runs return explicit API error codes for runner bootstrap and protocol failures:

- `AGENT_OFFLINE`: no active execution WS connection for the selected runner
- `AGENT_PROTOCOL_ERROR`: invalid execution frame format/content
- `AGENT_UPSTREAM_ERROR`: runner reported upstream error
## 10. Related REST APIs

- `GET /api/v1/workspaces/{ws}/projects/{project}/agent-runners/{agentRunnerId}/connection-info`
- `GET/POST /api/v1/workspaces/{ws}/projects/{project}/agent-runners/{agentRunnerId}/keys`
- `DELETE /api/v1/workspaces/{ws}/projects/{project}/agent-runners/{agentRunnerId}/keys/{keyId}`
- `GET /api/v1/workspaces/{ws}/projects/{project}/agent-runners/{agentRunnerId}/execution-config`

## 11. Echo Example

Reference implementation:

- `@mbos/agent-task-runner` package entrypoint

Run with:

```bash
MBOS_AGENT_WS_URL='ws://localhost:20000/api/v1/agent-execution/ws?agent_runner_id=runner_xxx' \
MBOS_AGENT_KEY='ask_xxx' \
npm run agent:task-runner
```

## 12. Risk Register

- `R1` user token forwarding to runner:
  - MBOS forwards user bearer token in execution context for project proxy auth/audit.
  - Runner must keep this token in-memory only by injecting it through child-process environment variables.
  - The token must never be written to Codex config files, workspace files, or CLI argv.
  - Follow-up hardening: replace with short-lived ticket exchange.

- `R3` task HOME isolation:
  - Runner runtime state is task-scoped under `task_home_path` for Codex state, runner metadata, skills, caches, and user-mode installs.
  - Real workspace files live under `workspace_path`; user-visible deliverables are collected only from `artifacts_path`.
  - The backend owns `task_home_segment` generation and binding release; runners must not derive or sanitize their own HOME segment.
  - Task delete releases the file-library binding and preserves the file library contents. Ops should rely on file-library lifecycle controls and periodic storage monitoring rather than task deletion to remove storage.
