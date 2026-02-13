# External Agent Runtime Protocol (WS, v1)

Last updated: 2026-02-13
Owner: Backend + Frontend

## 1. Scope

This contract defines the runtime protocol between MBOS server and external agents over WebSocket.

- Transport: WebSocket
- Auth: `Authorization: Bearer ask_*` (agent service key)
- Endpoint: `GET /api/v1/agent-runtime/ws?agent_id={agentId}`
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
  - payload: `{ "protocol_version": "1.0", "heartbeat_interval_sec": 15 }`
- `server.request.start`
  - payload:
    - `model: string`
    - `stream: true`
    - `messages: OpenAI-compatible message array` (supports multimodal content parts and data URLs)
- `server.request.cancel`
  - payload: `{ "reason": "client_cancelled" }`
- `server.ping`
  - payload: `{}`

## 4. Agent -> Server Events

- `agent.ready`
  - payload: runtime metadata/capabilities
- `agent.pong`
  - payload: `{}`
- `agent.response.delta`
  - required: `request_id`
  - payload: `{ "delta": "text token chunk" }`
- `agent.response.done`
  - required: `request_id`
  - payload: `{ "finish_reason": "stop|length|cancelled|...", "usage_tokens": number }`
- `agent.response.error`
  - required: `request_id`
  - payload: `{ "error_code": "string", "error_message": "string" }`

## 5. Chat Mapping Semantics

When a chat session is bound to `external_agent_id`, server maps runtime events to chat SSE:

- `agent.response.delta` -> SSE `delta`
- `agent.response.done` -> SSE `done`
- `agent.response.error` -> SSE `error`

The frontend keeps the same chat SSE consumption model used by endpoint streaming.

## 6. Runtime Constraints (v1)

- One active connection per `agent_id` (new connection replaces old one).
- No offline queue (fail-fast if agent is offline).
- Server default timeout per request: 60s.
- Attachments are passed as data URLs in multimodal messages.
- Strict protocol validation:
  - `agent.response.delta.payload.delta` must be `string`; otherwise request fails with `AGENT_PROTOCOL_ERROR`.
  - Unsupported `agent.response.*` types with a valid `request_id` fail that request with `AGENT_PROTOCOL_ERROR`.
  - Invalid JSON frame closes socket with close code `1003` (`invalid_json`).

## 7. Chat Stream Error Mapping

When chat session is bound to `external_agent_id`, server returns explicit API error codes for stream bootstrap failures:

- `AGENT_OFFLINE`: no active runtime WS connection for the selected agent
- `AGENT_TIMEOUT`: runtime request timeout
- `AGENT_PROTOCOL_ERROR`: invalid runtime frame format/content
- `AGENT_UPSTREAM_ERROR`: agent reported upstream error

Frontend maps these codes to explicit user-facing error banners.
## 8. Related REST APIs

- `GET /api/v1/workspaces/{ws}/projects/{project}/agents/{agentId}/connection-info`
- `GET/POST /api/v1/workspaces/{ws}/projects/{project}/agents/{agentId}/keys`
- `DELETE /api/v1/workspaces/{ws}/projects/{project}/agents/{agentId}/keys/{keyId}`
- `GET /api/v1/workspaces/{ws}/projects/{project}/agents/{agentId}/runtime-config`

## 9. Echo Example

Reference implementation:

- `packages/api-entry-node/examples/external-agent-echo.ts`
- `packages/api-entry-node/examples/external-agent-test-runner.ts` (used by integration E2E)

Run with:

```bash
MBOS_AGENT_WS_URL='ws://localhost:20000/api/v1/agent-runtime/ws?agent_id=ag_xxx' \
MBOS_AGENT_KEY='ask_xxx' \
tsx packages/api-entry-node/examples/external-agent-echo.ts
```
