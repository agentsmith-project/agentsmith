# External Agent Execution Channel Protocol (WS, v1)

Last updated: 2026-04-15
Owner: Backend + Frontend

## 1. Scope

This contract defines the execution protocol between MBOS server and external agents over WebSocket.

- Transport: WebSocket
- Auth: `Authorization: Bearer ask_*` (agent service key)
- Endpoint: `GET /api/v1/agent-execution/ws?agent_id={agentId}`
- Protocol version: `1.0`

## 2. Envelope

All frames are JSON objects:

```json
{
  "type": "string",
  "request_id": "optional-string",
  "session_id": "optional-string",
  "timestamp": "ISO-8601",
  "payload": {}
}
```

## 3. Server -> Agent Events

- `server.hello`
  - payload: `{ "protocol_version": "1.0", "heartbeat_interval_sec": 15, "resource_proxy"?: { "base_url": "https://.../endpoints/{endpointId}/proxy" } }`
  - `resource_proxy.base_url` is static per agent connection and is derived from agent execution preferences (`execution_preferences_json.notebook.endpoint_id`).
- `server.request.start`
  - payload:
    - `model: string`
    - `stream: true`
    - `messages: OpenAI-compatible message array` (supports multimodal content parts and data URLs)
    - `execution_context?: object` (optional agent execution metadata)
      - `interaction_kind: "chat" | "notebook"`
      - `workspace_id: string`
      - `project_id: string`
      - `task_id?: string` (notebook only)
      - `session_id?: string` (chat only)
      - `run_id: string`
      - `username: string`
      - `endpoint_id: string`
      - `api_base?: string` (for notebook helper scripts / file download access)
      - `execution_ticket: string`
      - `wire_api: \"chat\" | \"responses\"`
      - `model: string`
      - `task_inputs?: Array<{ kind?: "library_object" | "artifact" | "url"; library_id?: string; key?: string; task_id?: string; artifact_id?: string; url?: string; filename?: string; file_type?: string; file_size?: number }>`
      - `credential_files?: Array<{ relative_path: string; content: string; description?: string }>`
        - Backend provides user third-party credential files per request.
        - Runner writes these files under workspace-relative paths before executing the turn.
      - runner path model (implementation contract):

        | Item | External bare (`file_library`) | External docker (`file_library`) | Internal (`pre_mounted`) |
        | --- | --- | --- | --- |
        | runner mode | `host_external` | `docker_external` | `k8s_internal` |
        | user file workspace (`cwd`) | `${MBOS_AGENT_WORKSPACE_ROOT:-<runner process home>/ags-workspace}/<task_id>/` | `/workspace/<task_id>/` | `/workspace/<task_id>/` |
        | runner-private runtime home (`HOME`) | `${MBOS_AGENT_CODEX_STATE_ROOT:-<runner process home>/.mbos/notebook-codex-runner}/<runtime_id>/` | `${MBOS_AGENT_CODEX_STATE_ROOT:-<runner process home>/.mbos/notebook-codex-runner}/<runtime_id>/` | `${MBOS_AGENT_CODEX_STATE_ROOT:-<runner process home>/.mbos/notebook-codex-runner}/<runtime_id>/` |
        | Codex state | `<runtime_home>/.codex/` | `<runtime_home>/.codex/` | `<runtime_home>/.codex/` |
        | runner metadata | `<runtime_home>/.mbos/` | `<runtime_home>/.mbos/` | `<runtime_home>/.mbos/` |
        | skills | `<runtime_home>/.agents/skills/` | `<runtime_home>/.agents/skills/` | `<runtime_home>/.agents/skills/` |
        | user-visible artifacts | `<cwd>/.artifacts/` | `<cwd>/.artifacts/` | `<cwd>/.artifacts/` |
        | agent context / credentials | AgentSmith Context Store member/task/project_member/project/workspace context via capability-aware builtin skill helpers; `mbos-context` remains the generic direct-access skill; managed OAuth credentials are read-only context projections | AgentSmith Context Store member/task/project_member/project/workspace context via capability-aware builtin skill helpers; `mbos-context` remains the generic direct-access skill; managed OAuth credentials are read-only context projections | AgentSmith Context Store member/task/project_member/project/workspace context via capability-aware builtin skill helpers; `mbos-context` remains the generic direct-access skill; managed OAuth credentials are read-only context projections |

        Notes:
        - the task mount point is the real JuiceFS-backed working directory for the current task
        - `cwd` is the user file workspace; `HOME` is the runner-private runtime home used for Codex config, runner metadata, skills, caches, and user-mode installs
        - `<runtime_id>` is `${basename(normalized_visible_root)}-${sha256(normalized_visible_root).slice(0,16)}`; `normalized_visible_root` is the path-normalized `cwd` with backslashes converted to `/` and trailing slashes removed except for `/`
        - the hash makes runtime homes collision-safe when two visible workspace roots share the same basename, for example `/workspace/team-a/task_shared` and `/workspace/team-b/task_shared`
        - external child processes are wrapped with `bwrap`; internal workloads keep per-task sandbox isolation
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
  - payload: structured execution telemetry event for notebook/chat UX diagnostics and expandable trace UI
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
  - payload: structured artifact emitted by the runner for notebook task outputs
  - shape:
    - `filename: string`
    - `task_relative_path: string` (for example `artifacts/plot.png`)
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

## 5. Chat Mapping Semantics

When a chat session is bound to `external_agent_id`, server maps execution events to chat SSE:

- `agent.response.delta` -> SSE `delta`
- `agent.response.done` -> SSE `done`
- `agent.response.error` -> SSE `error`

The frontend keeps the same chat SSE consumption model used by endpoint streaming.

## 6. Execution Constraints (v1)

- One active connection per `agent_id` (new connection replaces old one).
- No offline queue (fail-fast if agent is offline).
- Pending streams and terminal sessions are bounded by first-event, idle, and max-runtime timers. Timeout cleanup fails the pending resource, removes its server map entry, and prevents leaked capacity.
- Attachments are passed as data URLs in multimodal messages.
- Strict protocol validation:
  - `agent.response.delta.payload.delta` must be `string`; otherwise request fails with `AGENT_PROTOCOL_ERROR`.
  - `agent.response.event.payload` must match the structured event schema above; otherwise request fails with `AGENT_PROTOCOL_ERROR`.
  - `agent.response.artifact.payload` must match the artifact schema above; otherwise request fails with `AGENT_PROTOCOL_ERROR`.
  - Unsupported `agent.response.*` types with a valid `request_id` fail that request with `AGENT_PROTOCOL_ERROR`.
  - Invalid JSON frame closes socket with close code `1003` (`invalid_json`).

## 7. Browser Notebook Terminal WS

This section covers the browser-facing terminal websocket issued by notebook task terminal routes. It does not change the runner-side terminal protocol.

- The first browser business frame must be `terminal.reconnect`.
- Before a valid reconnect handshake, `terminal.stdin`, `terminal.resize`, and `terminal.close` are rejected with `terminal.error` and the websocket is closed.
- `terminal.reconnect` payload fields:
  - `terminal_session_id: string`
  - `view: "notebook.task_terminal"`
  - `cols: number`
  - `rows: number`
  - `after_seq?: number | null`
- `view` is a strict contract constant, not opaque metadata. API entry rejects missing, empty, or non-`notebook.task_terminal` views with `terminal.error` / `invalid_reconnect_payload` and closes the websocket.
- On successful reconnect, API entry emits `terminal.replay_start`, zero or more `terminal.output` replay frames, and `terminal.replay_end`.
- Browser-facing reconnect/replay frames use `terminal_session_id` as the session identifier. Legacy runtime frames using `session_id` are accepted only for older browser terminal links and are not emitted by the reconnect/replay path.
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
- Routes that issue an interactive terminal `ws_url` or ticket require `project:terminal:use` in addition to task access. Reconnect handshakes and each `terminal.stdin` / `terminal.resize` frame re-check current backend permission truth; revoked permission rejects the frame and closes the websocket instead of trusting a cached ticket or open socket.

## 8. Chat Stream Error Mapping

When chat session is bound to `external_agent_id`, server returns explicit API error codes for stream bootstrap failures:

- `AGENT_OFFLINE`: no active execution WS connection for the selected agent
- `AGENT_PROTOCOL_ERROR`: invalid execution frame format/content
- `AGENT_UPSTREAM_ERROR`: agent reported upstream error

Frontend maps these codes to explicit user-facing error banners.
## 9. Related REST APIs

- `GET /api/v1/workspaces/{ws}/projects/{project}/agents/{agentId}/connection-info`
- `GET/POST /api/v1/workspaces/{ws}/projects/{project}/agents/{agentId}/keys`
- `DELETE /api/v1/workspaces/{ws}/projects/{project}/agents/{agentId}/keys/{keyId}`
- `GET /api/v1/workspaces/{ws}/projects/{project}/agents/{agentId}/execution-config`

## 10. Echo Example

Reference implementation:

- `packages/api-entry-node/examples/external-agent-echo.ts`
- `packages/api-entry-node/examples/external-agent-test-runner.ts` (used by integration E2E)

Run with:

```bash
MBOS_AGENT_WS_URL='ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_xxx' \
MBOS_AGENT_KEY='ask_xxx' \
tsx packages/api-entry-node/examples/external-agent-echo.ts
```

## 11. Risk Register (Notebook Codex v1)

- `R1` user token forwarding to runner:
  - MBOS forwards user bearer token in execution context for project proxy auth/audit.
  - Runner must keep this token in-memory only by injecting it through child-process environment variables.
  - The token must never be written to Codex config files, workspace files, or CLI argv.
  - Follow-up hardening: replace with short-lived ticket exchange.

- `R3` workspace isolation level:
  - Runner runtime state is task-scoped under `${MBOS_AGENT_CODEX_STATE_ROOT:-$HOME/.mbos/notebook-codex-runner}/<runtime_id>` for Codex state, runner metadata, skills, caches, and user-mode installs.
  - `<runtime_id>` is derived from the visible workspace root, not from the bare `task_id`: `${basename(normalized_visible_root)}-${sha256(normalized_visible_root).slice(0,16)}`.
  - Real workspace files remain shared at `cwd`; notebook/file-library behavior and `cwd/.artifacts` deliverables are unchanged.
  - External e2e runners set `MBOS_AGENT_CODEX_STATE_ROOT` under the temporary workspace root so runtime state is cleaned with the test workspace.
  - Ops must enforce periodic cleanup and disk monitoring for long-lived runner hosts.
