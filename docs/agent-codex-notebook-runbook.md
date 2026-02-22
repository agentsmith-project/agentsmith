# AgentSmith Notebook External Agent (Codex) Runbook

## 1. Scope
- Target: external agent for Notebook task execution/testing.
- Executor: OpenAI Codex CLI (`codex exec`, script/non-interactive mode).
- Runtime path: AgentSmith task message -> MBOS external-agent runtime websocket -> `agent-codex-runner` -> endpoint proxy -> LLM.
- Workdir rule: `/tmp/<username>/<task_id>`.

## 2. Current Delivery Status
- Implemented:
  - Notebook task message streaming execution in API node backend.
  - `runtime_context` protocol extension for external runtime.
  - External runner package `@mbos/agent-codex-runner`.
  - Agent config UI (`Notebook Endpoint ID`) and backend validation.
  - OpenAPI/AsyncAPI/Protocol docs updates.
  - Integration keycloak redirect auto-fix for custom web ports.
  - Responses-to-chat compatibility translation in endpoint proxy (including streaming SSE translation).
  - Codex runner per-task watchdog timeout and task auto-close protections.
  - Codex runner task workdir `.codex/config.toml` generation and noisy warning filtering.
- Verified:
  - `packages/api-entry-node/src/http-utils.test.ts` (responses/chat translation) passing.
  - End-to-end Notebook external agent pipeline with real GLM (`glm-4.7`) returns `turn.completed`.

## 3. End-to-End Flow
1. User creates Notebook task with notebook-capable external agent.
2. User posts task message (`role=user`).
3. Backend creates assistant placeholder, marks task run active.
4. Backend dispatches `server.request.start` to external runtime with:
   - normal chat payload (`messages`, `model`, etc.)
   - `runtime_context` (`workspace_id/project_id/task_id/run_id/username/endpoint_proxy_base/user_bearer_token/wire_api/model`)
5. `agent-codex-runner`:
   - creates `/tmp/<username>/<task_id>`;
   - generates task-scoped `.codex/config.toml`;
   - runs `codex exec` with explicit `-c model_provider=proxy` / `model_providers.proxy.*` overrides;
   - marks current task workdir as trusted project (`projects."<cwd>".trust_level="trusted"`) and disables git requirement (`project_root_markers=[]`, `--skip-git-repo-check`);
   - emits stream frames (`agent.response.delta`, `agent.response.done`/`error`).
6. Backend relays deltas into task assistant message and task SSE.
7. Run finalized, active lock released.

## 4. Component Ownership (Parallel Work)
### Track A: Backend Runtime/Task
- Files:
  - `packages/api-entry-node/src/task-route-handler.ts`
  - `packages/api-entry-node/src/agent-runtime-service.ts`
  - `packages/api-entry-node/src/request-handler.ts`
- Responsibilities:
  - task run lifecycle, conflict control (`TASK_STREAM_CONFLICT`), SSE fanout.
  - protocol mapping, runtime_context assembly, auth token forwarding.
  - route permission gates.

### Track B: External Runner
- Files:
  - `packages/agent-codex-runner/src/index.ts`
  - `Makefile` target `agent-codex-runner`
- Responsibilities:
  - websocket session management, cancel semantics.
  - codex process management and output chunk streaming.
  - working directory isolation.

### Track C: Frontend Config + UX
- Files:
  - `src/components/agents/CreateAgentDialog.tsx`
  - `src/components/agents/EditAgentDialog.tsx`
  - `src/lib/api/endpoints/agents.ts`
  - `src/messages/en-US.json`, `src/messages/zh-CN.json`
- Responsibilities:
  - notebook endpoint configuration UX.
  - payload contract (`runtime_preferences.notebook`).
  - validation/error copy/i18n.

### Track D: Contracts + QA
- Files:
  - `docs/contracts/specs/openapi.yaml|json`
  - `docs/contracts/specs/asyncapi.yaml|json`
  - `docs/contracts/agent-runtime-protocol.md`
  - `packages/api-entry-node/src/index.test.ts`
  - `e2e/integration-agents-external.spec.ts`
- Responsibilities:
  - contract consistency and generated artifact checks.
  - integration/e2e coverage for notebook chain.

## 5. Required Configuration
### 5.1 Agent config
- Agent mode: `external`
- Interaction mode: `notebook` or `both`
- Runtime preferences:
  - `runtime_preferences.notebook.endpoint_id` (required)
  - optional: `wire_api` (`chat` or `responses`)
  - optional: `model`

### 5.2 Runner env vars
- `MBOS_AGENT_WS_URL` (runtime websocket URL from agent connection info)
- `MBOS_AGENT_KEY` (agent service key `ask_...`)
- `CODEX_BIN` (optional; default `codex`)
- `MBOS_AGENT_TASK_TIMEOUT_SEC` (optional; task watchdog, default currently 55s in code)
- `MBOS_AGENT_RUNNER_DEBUG=1` (optional; logs spawn args/workdir/timeout)
- `MBOS_AGENT_CODEX_YOLO=1` (optional; run codex with `--dangerously-bypass-approvals-and-sandbox`)

### 5.3 API debug env vars (recommended for troubleshooting)
- `DEBUG_AGENT_RUNTIME=1` (runtime websocket accept/timeout logs)
- `DEBUG_ENDPOINT_PROXY=1` (proxy request summaries + SSE translation counters)
- `DEBUG_NOTEBOOK_RUNTIME=1` (task/run/request_id level dispatch + terminal events)

### 5.4 Local commands
```bash
# Start API with debugging for notebook/runtime/proxy troubleshooting
PORT=20000 \
KEYCLOAK_BASE_URL=http://localhost:18080 \
KEYCLOAK_REALM=mbos \
AGENT_RUNTIME_REQUEST_TIMEOUT_MS=180000 \
DEBUG_AGENT_RUNTIME=1 \
DEBUG_ENDPOINT_PROXY=1 \
DEBUG_NOTEBOOK_RUNTIME=1 \
npm run dev -w @mbos/api-entry-node

# Start external codex runner (default full-auto)
make agent-codex-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-runtime/ws?agent_id=ag_xxx' AGENT_KEY='ask_xxx'

# Start external codex runner in YOLO mode
MBOS_AGENT_CODEX_YOLO=1 \
MBOS_AGENT_TASK_TIMEOUT_SEC=120 \
make agent-codex-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-runtime/ws?agent_id=ag_xxx' AGENT_KEY='ask_xxx'

# External agent integration e2e (auto deps + api + web)
make e2e-int-agent-auto PORT_API=20030 PORT_WEB=3011
```

### 5.4.1 Manual Real-Backend Notebook + Agent Test (4 terminals, recommended)
- Use this flow when manually testing notebook + external codex runner against the real local backend (not MSW).
- Preconditions:
  - Keycloak is running at `http://localhost:18080`
  - GLM API key is available

Terminal 1 (`API :20000`)
```bash
cd /home/percy/works/mbos-v1/agentsmith

env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
PORT=20000 \
KEYCLOAK_BASE_URL=http://localhost:18080 \
KEYCLOAK_REALM=mbos \
AGENT_RUNTIME_REQUEST_TIMEOUT_MS=180000 \
DEBUG_AGENT_RUNTIME=1 \
DEBUG_ENDPOINT_PROXY=1 \
DEBUG_NOTEBOOK_RUNTIME=1 \
npm run dev -w @mbos/api-entry-node
```

Terminal 2 (`Web :3001`, real backend)
```bash
cd /home/percy/works/mbos-v1/agentsmith

env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
NEXT_PUBLIC_API_BASE=http://localhost:20000 \
NEXT_PUBLIC_USE_MSW=false \
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:18080/realms \
NEXT_PUBLIC_KEYCLOAK_REALM=mbos \
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=agentsmith \
npm run dev -- --port 3001
```

Terminal 3 (bootstrap resources; run once per fresh environment)
```bash
cd /home/percy/works/mbos-v1/agentsmith

make notebook-agent-refresh-token

GLM_API_KEY='***' make notebook-agent-init-resources
```

Optional quick smoke before manual UI testing:
```bash
make notebook-agent-smoke-full
```

Terminal 4 (keep external runner online for manual notebook chat)
```bash
cd /home/percy/works/mbos-v1/agentsmith

make notebook-agent-runner
```

Open browser:
- Login: `http://localhost:3001/zh-CN/login`
- Notebook project URL:
  - project id from `/tmp/agentsmith_project_id.txt`
  - `http://localhost:3001/zh-CN/workspaces/ws_default/projects/<PROJECT_ID>/notebook`

Expected behavior:
- send a message -> page shows `Agent 正在执行...` (or localized equivalent)
- task completes -> final reply appears without page refresh
- in `next dev`, notebook task page shows `SSE Debug (latest 5)` for frontend stream diagnostics

Helper files written by bootstrap:
- `/tmp/agentsmith_project_id.txt`
- `/tmp/agentsmith_agent_id.txt`
- `/tmp/agentsmith_agent_key.txt`
- `/tmp/agentsmith_ws_url.txt`

### 5.4.2 Stop Local Test Services (manual)
- If you started services in separate terminals, stop with `Ctrl+C` in each terminal.
- If you need a cleanup command (ports used by this workflow):
```bash
for p in 20000 3001 3010 3015; do
  fuser -k "${p}/tcp" 2>/dev/null || true
done
```

## 5.5 Important Codex Config Behavior (Root Cause Note)
- Codex docs state project-scoped `.codex/config.toml` is only loaded for **trusted projects**.
- Our task workdirs are ephemeral (`/tmp/<username>/<task_id>`) and are not trusted by default.
- Result: relying only on task workdir `.codex/config.toml` can fail, and Codex may fall back to ChatGPT-account provider mode.
- Operational fix (implemented): pass `-c model_provider="proxy"` and `-c model_providers.proxy.*` explicitly on `codex exec`, while also forcing trusted cwd metadata:
  - `-c 'project_root_markers=[]'`
  - `-c 'projects."<cwd>".trust_level="trusted"'`

## 6. Acceptance Checklist
- Task message POST triggers external runtime request.
- Concurrent second POST while active run returns `409 TASK_STREAM_CONFLICT`.
- Assistant message receives streamed deltas and final content.
- Runner creates `/tmp/<username>/<task_id>`.
- Proxy auth uses user bearer token; endpoint request succeeds.
- Cancel request terminates codex process and runtime stream exits.

## 7. Error Codes / Operational Signals
- `TASK_STREAM_CONFLICT`: active run already exists for task.
- `TASK_AGENT_ENDPOINT_NOT_CONFIGURED`: missing notebook endpoint binding.
- `AGENT_OFFLINE`: no active runtime websocket for selected agent.
- `AGENT_PROTOCOL_ERROR`: invalid runtime response frame shape.
- `AGENT_TIMEOUT`: runner or runtime timeout while waiting for codex/agent stream.

## 7.1 Debug Log Correlation (Recommended)
- `notebook-runtime` logs (`DEBUG_NOTEBOOK_RUNTIME=1`)
  - carries `task_id`, `run_id`, `request_id`, `agent_id`, `endpoint_id`
- `agent-codex-runner` debug logs (`MBOS_AGENT_RUNNER_DEBUG=1`)
  - carries same `request_id`, codex argv, timeout/hard-kill, exit code
- `endpoint-proxy` logs (`DEBUG_ENDPOINT_PROXY=1`)
  - request summary, upstream response mode, SSE translation counters/terminal reason
- `agent-runtime` logs (`DEBUG_AGENT_RUNTIME=1`)
  - websocket accept/reject, request timeout signals

## 7.2 Frontend Notebook SSE Debug Panel (Development Only)
- In `next dev` (`NODE_ENV=development`), the notebook task page shows `SSE Debug (latest 5)` above the conversation panel.
- Purpose:
  - quickly verify whether browser SSE is connected and receiving events without opening DevTools Network every time.
  - distinguish UI rendering issues vs backend/runtime event delivery issues.
- Typical readings:
  - repeated `message type=message` and `message type=task_update`:
    - SSE is healthy and backend is emitting task updates.
    - if UI still looks blank, focus on message rendering/decoding logic.
  - `reconnect_scheduled` / `sse_error`:
    - browser SSE connection is unstable (auth, network, endpoint route, or server-side stream close).
  - no events after `connect_start`:
    - inspect `/tasks/:id/events` response in browser network and backend auth handling (`ticket` / bearer).
- This panel is intentionally lightweight and non-persistent (latest 5 only).

## 7.3 Execution Details Pagination (Message Trace Panel)
- Notebook agent message bubbles support expandable execution details (trace timeline).
- Trace panel supports view modes:
  - `Timeline` / `时间线` (default)
  - `Raw` / `原始事件` (high-fidelity event list close to Codex CLI output semantics)
- Trace panel supports local display filters (frontend-only; does not change stored traces):
  - `All`, `Progress`, `Tool`, `Alerts`, `Debug`
  - useful for long runs when raw event volume is high
- Trace panel shows lightweight stats (current filtered slice):
  - event count
  - duration
  - warning/error counts
  - truncated hint (when `has_more=true`)
- Trace panel supports `Copy trace logs` / `复制执行日志`:
  - copies the currently loaded trace slice for the message as JSON (filtered subset if a filter is active)
  - useful for bug reports / debugging
- Traces are lazily loaded per `message_id` when the user clicks `View execution details` / `查看执行详情`.
- Backend trace list response now includes pagination hints:
  - `has_more`
  - `next_after_id`
- Notebook local backend storage behavior:
  - when `api-entry-node` runs with a `docStore` backend (for example `MONGO_URL` configured), notebook `tasks/messages/artifacts/traces` are persisted (write-through + lazy read-through)
  - in pure in-memory local mode, notebook data remains process-local and is cleared on API restart
- Trace retention / payload controls (API env):
  - `NOTEBOOK_TRACE_MAX_EVENTS` (default `1000`) caps in-memory + persisted per-task trace retention
  - `NOTEBOOK_TRACE_DETAILS_MAX_BYTES` (default `16384`) truncates oversized `trace.details` payloads before storage/streaming
- Mongo (`docStore`) index recommendations for notebook trace workloads (production):
  - collection: `notebook_task_trace_events`
    - `{ task_id: 1, seq: 1 }` (task timeline scans)
    - `{ task_id: 1, message_id: 1, seq: 1 }` (message-scoped trace panel lazy loading)
    - `{ task_id: 1, run_id: 1, seq: 1 }` (run-scoped diagnostics)
  - collection: `notebook_task_messages`
    - `{ task_id: 1, created_at: 1 }`
  - collection: `notebook_tasks`
    - `{ workspace_id: 1, project_id: 1, updated_at: -1 }`
- Semantics:
  - `has_more=true` means the current panel is showing only the most recent trace slice.
  - `next_after_id` is the cursor for loading an earlier slice (older events) with:
    - `GET /tasks/:taskId/traces?message_id=<msg>&before_id=<next_after_id>&page_size=500`
- Frontend behavior:
  - shows `More execution logs are available...` / `还有更多执行日志...`
  - shows `Load earlier logs` / `加载更早日志`
  - merges older traces into the same message timeline (deduplicated by trace `id`)
  - in `Raw` view, renders event fields directly (`seq/category/phase/status/name/summary/details`) for high-fidelity inspection
- Troubleshooting:
  - If a message shows `No execution details yet`, check:
    - whether the task ran through the new `trace_event` pipeline
    - runner/API versions are up to date
    - `/tasks/:taskId/traces?message_id=<msg>` returns items for that message

## 7.4 Notebook Runtime Metrics (Internal, Authenticated)
- API exposes a lightweight process-local metrics snapshot for notebook runtime/task execution:
  - `GET /api/v1/internal/notebook-runtime-metrics`
- Authentication:
  - requires a valid bearer token (same user token used for notebook APIs).
- Purpose:
  - quick runtime health checks during real-environment validation/load tests
  - observe run outcomes and trace truncation behavior without scraping logs
- Example fields:
  - counters:
    - `task_runs_started`
    - `task_runs_completed`
    - `task_runs_failed`
    - `task_runs_terminal_without_done`
    - `trace_events_recorded`
    - `trace_events_truncated_records`
    - `trace_details_truncated`
  - gauges:
    - `active_runs`
    - `task_sse_clients`
  - `in_memory`:
    - tasks/messages/artifacts/traces counts
  - `limits`:
    - `max_trace_events_per_task`
    - `max_trace_details_bytes`
    - `max_task_sse_events_per_task`
- Notes:
  - metrics are process-local (reset on API restart)
  - in `docStore` mode, notebook data persists, but this endpoint still reports current process counters/gauges

### 7.4.1 Monitor Script
- Use the built-in polling script:
```bash
make notebook-agent-monitor
```
- Common options:
```bash
COUNT=30 INTERVAL_SEC=1 make notebook-agent-monitor
API_BASE=http://localhost:20000 TOKEN_FILE=/tmp/agentsmith_user_token.txt make notebook-agent-monitor
```
- Output is a compact line summary suitable for terminal monitoring during smoke/load runs.

## 7.5 Real-Environment Load Test (Notebook + External Agent)
- Purpose:
  - validate runtime stability under concurrent notebook task submissions
  - confirm trace retention/limits behave as expected
  - capture latency distribution (`avg/p50/p95/p99`) and failure samples
- Preconditions:
  - API + Web + external `agent-codex-runner` are running
  - token refreshed (`make notebook-agent-refresh-token`)
  - test resources initialized (`make notebook-agent-init-resources`)
  - runner connected (`make notebook-agent-runner`)

### 7.5.1 Load Test Script
```bash
make notebook-agent-load-test
```

- Recommended starting profile (real GLM/Codex path):
```bash
REQUESTS=10 CONCURRENCY=3 POLL_MAX=90 POLL_INTERVAL_SEC=2 make notebook-agent-load-test
```

- Higher pressure example (increase gradually):
```bash
REQUESTS=30 CONCURRENCY=5 POLL_MAX=120 POLL_INTERVAL_SEC=2 make notebook-agent-load-test
```

- Optional controls:
  - `WAIT_AGENT_ONLINE=0` to skip runner-online guard (useful for race/failure injection)
  - `PROMPT='reply exactly: chain ok'` to keep workload stable/reproducible

### 7.5.2 Output Interpretation
- Script prints:
  - aggregate result summary (`success/failed/success_rate`)
  - latency stats (`avg/p50/p95/p99/max`)
  - sample failures (first 10)
  - final `notebook-runtime-metrics` snapshot
- Use together with:
  - `make notebook-agent-monitor`
  - API logs (`DEBUG_NOTEBOOK_RUNTIME=1`, `DEBUG_AGENT_RUNTIME=1`, `DEBUG_ENDPOINT_PROXY=1`)
  - runner logs (`MBOS_AGENT_RUNNER_DEBUG=1`)

### 7.5.3 Minimum Acceptance (Suggested)
- For a baseline validation run (e.g. `REQUESTS=10`, `CONCURRENCY=3`):
  - no API crashes / no runner crash
  - success rate is acceptable for current upstream provider conditions
  - `task_runs_terminal_without_done` remains `0` (or investigated immediately)
  - truncation counters (`trace_events_truncated_records`, `trace_details_truncated`) match expectations for the test profile
  - p95 latency is recorded and tracked over time (regression detection)

## 8. Known Risks (Recorded)
- R1: User bearer token forwarded to runner process env for proxy auth/audit.
- R3: Workdir is namespace isolation only (`/tmp/<username>/<task_id>`), not full sandbox.

## 9. Next Hardening Items
1. Replace direct bearer forwarding with short-lived ticket exchange.
2. Add stronger runtime isolation (container/jail/seccomp profile).
3. Add notebook-specific integration spec for full task->runner->proxy stream assertions.

## 10. Team Task Breakdown (Parallel)
### Sprint A (Backend/API, 2-3 days)
- A1: runtime_context correctness and request-host derived proxy base.
- A2: task run lifecycle guards (`TASK_STREAM_CONFLICT`, finalize cleanup).
- A3: notebook endpoint binding validation (`interaction_mode=notebook|both`).
- A4: API tests for notebook run + conflict + runtime context.

Dependencies:
- A2 depends on A1.
- A4 depends on A1-A3.

### Sprint B (Runner, 1-2 days)
- B1: codex process lifecycle (start/stream/cancel/kill fallback).
- B2: `/tmp/<username>/<task_id>` workspace enforcement.
- B3: proxy env injection (`OPENAI_BASE_URL`, `OPENAI_API_KEY`).

Dependencies:
- B3 depends on A1 contract stability.

### Sprint C (Frontend, 1 day)
- C1: agent create/edit notebook endpoint input + validation.
- C2: request payload alignment (`runtime_preferences.notebook.*`).
- C3: i18n copy and error messaging.

Dependencies:
- C2 depends on A3 contract.

### Sprint D (QA/Integration, 1-2 days)
- D1: external-agent chat integration regression.
- D2: notebook integration spec (task->runtime->proxy->stream).
- D3: environment bootstrap checks (Keycloak redirect URI consistency).

Dependencies:
- D2 depends on A1/B3 and endpoint route availability.

## 11. CI Mapping
- Workflow file: `.github/workflows/integration-e2e.yml`
- Jobs:
  - `integration-agent` -> `make e2e-int-agent-auto PORT_API=20030 PORT_WEB=3011`
  - `integration-notebook-agent` -> `make e2e-int-notebook-agent-auto PORT_API=20031 PORT_WEB=3013`
- Trigger:
  - `pull_request` on integration/runtime related paths.
  - manual `workflow_dispatch` with `suite=all|agent|notebook-agent`.
- Failure attribution:
  - summary tags such as `INT-KEYCLOAK-REDIRECT`, `INT-INFRA-BOOT`, `INT-AGENT-OFFLINE`, `INT-NOTEBOOK-RUNTIME`.
- Troubleshooting:
  - `docs/ci-integration-troubleshooting.md`
