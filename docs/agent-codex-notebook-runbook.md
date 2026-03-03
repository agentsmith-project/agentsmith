# AgentSmith Notebook External Agent (Codex) Runbook

## Scope of current internal release

This runbook covers the supported internal release path focused on `Files + Notebook + External Agent + Trace + Artifacts`.

Governance surfaces such as `Members` and `Resource Policy` are now part of the current internal real-backend baseline. They already support effective access explain, matched policy explain, downstream membership lifecycle effects, and the enforced governance paths documented in the release capability matrix. For demos, use the release capability matrix as the source of truth for exact enforcement scope rather than treating these pages as `partial`.

`Audit` and `Usage` are now backed by real `api-entry-node` routes with persisted governance data (first-stage coverage) and are available in real-backend mode for internal workflows.

### Governance Coverage (Current internal backend)

- `Audit` (`/audit`)
  - persisted audit events with paging/filtering/sorting
  - first-stage coverage: notebook task lifecycle/input changes/artifacts, chat message/attachment/run lifecycle
- `Usage` (`/usage`, `/usage/kpi`)
  - persisted usage facts aggregated by `day|hour`
  - first-stage coverage: notebook task runs, chat runs, endpoint proxy requests
- `Members`
  - real backend coverage for reads/writes, effective access explain, membership lifecycle cleanup, and permission/quota visibility
  - backend route authz reflects unified backend authorization decisions
  - member quota overrides/templates provide enforced runtime quota effects within the documented scope
- `Resource Policy`
  - real backend coverage for reads/writes, matched policy explain, and enforced governance paths in the current internal baseline
  - current enforcement scope covers allow-all / allow-list checks for `endpoint` and notebook/chat `agent` paths
  - allow-list matching supports user and group subjects
  - endpoint `requests_per_minute` rate limiting is enforced
  - endpoint `daily_token_limit` quota enforcement is enforced
  - `source_library.max_total_files` and `source_library.max_file_size_bytes` are enforced on create/upload flows

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
  - End-to-end Notebook external agent pipeline with real GLM (`glm-5`) returns `turn.completed`.

## 3. End-to-End Flow
1. User creates Notebook task with notebook-capable external agent.
2. User posts task message (`role=user`).
3. Backend creates assistant placeholder, marks task run active.
4. Backend dispatches `server.request.start` to external runtime with:
   - normal chat payload (`messages`, `model`, etc.)
   - `runtime_context` (`workspace_id/project_id/task_id/run_id/username/user_bearer_token/wire_api/model`)
   - static proxy config comes from `server.hello.resource_proxy.base_url`
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

### 5.3.1 Unified Env Switch Reference (quick lookup)
- Runner (`agent-codex-runner`)
  - `MBOS_AGENT_WS_URL`, `MBOS_AGENT_KEY`, `CODEX_BIN`
  - `MBOS_AGENT_TASK_TIMEOUT_SEC`
  - `MBOS_AGENT_RUNNER_DEBUG`
  - `MBOS_AGENT_CODEX_YOLO`
- API (`@mbos/api-entry-node`)
  - `DEBUG_AGENT_RUNTIME`, `DEBUG_ENDPOINT_PROXY`, `DEBUG_NOTEBOOK_RUNTIME`
  - `AGENT_RUNTIME_REQUEST_TIMEOUT_MS`
  - `NOTEBOOK_TRACE_MAX_EVENTS`, `NOTEBOOK_TRACE_DETAILS_MAX_BYTES`, `NOTEBOOK_SSE_HISTORY_MAX_EVENTS`
- Web / frontend (`next dev`)
  - `NEXT_PUBLIC_API_BASE`
  - `NEXT_PUBLIC_USE_MSW`
  - `NEXT_PUBLIC_KEYCLOAK_URL`, `NEXT_PUBLIC_KEYCLOAK_REALM`, `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID`
  - `NEXT_PUBLIC_NOTEBOOK_SSE_DEBUG_PANEL=1` (development-only; shows `SSE Debug (latest 5)` panel)
- Demo bootstrap (`make notebook-agent-demo-up`)
  - `DEMO_START_API`, `DEMO_START_WEB`, `DEMO_START_RUNNER`
  - `DEMO_REFRESH_TOKEN`, `DEMO_REFRESH_TOKEN_FORCE`, `DEMO_REFRESH_TIMEOUT_SEC`
  - `DEMO_INIT_RESOURCES`, `DEMO_WEB_PORT_AUTO_FALLBACK`
  - `PORT_API`, `PORT_WEB`, `WORKSPACE_ID`, `LOCALE`
  - `GLM_API_KEY`, `GLM_BASE_URL`, `GLM_MODEL`
- Note:
  - This runbook is the current **single place** for notebook/external-agent runtime switches.
  - Repo-wide frontend-only switches outside notebook scope may still be documented in feature-specific docs.

### 5.3.2 Default Personal Upload Library (Chat object-first attachments)
- Chat local uploads now use an object-first flow:
  1. ensure backend default personal library (`GET /source-libraries/default-personal`)
  2. upload object under `chat/<session_id>/uploads/`
  3. create chat attachment from the library object
- Current local backend policy:
  - deterministic library name: `My Uploads`
  - per-user + per-project
  - ensure route is idempotent (create or return existing)
  - default personal library is protected from rename/delete on standard library routes
  - default personal library is marked with `system_managed_kind=default_personal_uploads`

### 5.3.3 Notebook URL Inputs (object-first)
- Notebook "Add URL" now stores the generated URL note file in the backend default personal library, then attaches it as a first-class `url` input ref (with imported object provenance) to the task.
- This keeps notebook URL inputs aligned with the object-first input architecture while preserving URL semantics in `attached_inputs`.

### 5.3.4 Notebook Artifact Inputs (output-to-input loop)
- Notebook artifacts can be attached back into task inputs as first-class `artifact` refs.
- The runner `notebook-inputs` helper can fetch artifact inputs via the task artifact download route, enabling output-to-input iteration in Codex notebook flows.

### 5.3.5 Notebook Local Upload Inputs (object-first)
- Notebook local file uploads now follow the same object-first flow as Chat uploads:
  1. ensure backend default personal library
  2. upload local files as library objects under `notebook/<task_id>/inputs/`
  3. attach task inputs as `library_object` refs
- Notebook local uploads no longer create `source` records directly.
- `source` inputs remain supported, but are treated as a derived/processed input type (for example AI-ready/indexed content), not the primary raw file ingestion path.

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

### 5.4.3 One-Command Demo Bootstrap (manual showcase)
- For demos/manual walkthroughs, use:
```bash
GLM_API_KEY='***' make notebook-agent-demo-up
```
- This script will:
  - start/reuse API and Web (real backend mode)
  - refresh token (or reuse a valid existing token)
  - initialize notebook resources (project/credential/endpoint/agent/key)
  - start a managed external `agent-codex-runner`
  - print the notebook URL, log file paths, and a health summary (`API/Web/Runner/Token/Agent`)
- Stop the managed demo processes with:
```bash
make notebook-agent-demo-down
```
- Check current demo status (managed pids + health + token + agent presence):
```bash
make notebook-agent-demo-status
```
- Run a non-destructive demo readiness check (status + metadata files + endpoint proxy reachability):
```bash
make notebook-agent-demo-check
```
- Restart only the managed runner (keeps API/Web running):
```bash
make notebook-agent-demo-restart-runner
```
- Important Keycloak redirect constraint:
  - token refresh currently uses browser PKCE (`scripts/notebook-agent-refresh-token.js`)
  - if Web falls back to a non-`3001` port (for example `3016`) and the Keycloak client does not allow that redirect URI, refresh will fail
  - current script behavior:
    - reuses an existing valid token if present
    - otherwise fails fast with a clear error and remediation steps (free `3001`, add Keycloak redirect URI, or provide a valid token)
- Release-quality smoke bundle (recommended before demos and internal release validation):
```bash
make notebook-agent-release-smoke
```
- Default bundle includes:
  - `make notebook-agent-smoke-task`
  - `make notebook-agent-inputrefs-loop-smoke`
- Optional matplotlib image-artifact smoke:
```bash
RUN_MATPLOTLIB_SMOKE=1 make notebook-agent-release-smoke
```
- One-command release readiness check (refreshes token if needed, runs `demo-check`, then runs release smoke bundle):
```bash
make notebook-agent-release-smoke-full
```
- Governance pages (real backend mode) smoke check (Audit / Usage / Members / Resource Policy):
```bash
make governance-pages-real-backend-smoke
```
- Governance pages (real backend mode) interaction smoke check (basic filters/editor/table interactions):
```bash
make governance-pages-real-backend-interaction-smoke
```
- Governance pages (real backend mode) bundled smoke (open + interaction):
```bash
make governance-release-smoke
```
- Governance policy effect smoke (real backend endpoint rate limit -> audit/usage evidence):
```bash
make governance-policy-effect-smoke
```
- Notes:
  - Uses Playwright + Keycloak login and current `/tmp/agentsmith_project_id.txt`
  - Fails fast with a clear error if the current project URL is stale after local in-memory backend reset
  - Intended for real backend mode page validation (not MSW-only UI smoke)
  - `governance-policy-effect-smoke` temporarily patches the current endpoint policy (RPM=1), validates a 429 rate-limit hit, checks Audit/Usage evidence, then restores the original policy

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
- It is now **disabled by default**, even in development.
- Enable explicitly when troubleshooting browser SSE behavior:
  - `NEXT_PUBLIC_NOTEBOOK_SSE_DEBUG_PANEL=1 npm run dev -- --port 3001`
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
  - `GET /api/v1/internal/notebook-runtime-metrics/prometheus` (Prometheus text format)
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
  - trace query metrics:
    - `task_traces_queries_total`
    - `task_traces_queries_message_scoped_total`
    - `task_traces_queries_run_scoped_total`
    - `task_traces_query_latency_ms_total`
    - `task_traces_query_latency_ms_max`
    - `trace_query_latency_by_scope` (`task|message|run|message_run`)
- Notes:
  - metrics are process-local (reset on API restart)
  - in `docStore` mode, notebook data persists, but this endpoint still reports current process counters/gauges
  - both endpoints are authenticated (bearer required)

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
- It also includes `/traces` query indicators:
  - `traces_q`, `traces_q_msg`, `traces_q_run`
  - `traces_q_msg_max_ms` (max observed message-scoped traces query latency in current process)

### 7.4.2 Prometheus Scrape (Minimal Example)
- If auth is handled upstream (e.g. reverse proxy / sidecar), Prometheus can scrape:
```yaml
scrape_configs:
  - job_name: agentsmith_notebook_runtime
    metrics_path: /api/v1/internal/notebook-runtime-metrics/prometheus
    static_configs:
      - targets: ['127.0.0.1:20000']
```
- Suggested metrics to watch first:
  - `notebook_task_runs_failed_total`
  - `notebook_task_runs_terminal_without_done_total`
  - `notebook_trace_events_truncated_records_total`
  - `notebook_trace_details_truncated_total`
  - `notebook_active_runs`
  - `notebook_task_traces_query_duration_ms_*` (histogram; focus on `scope="message"`)

### 7.4.3 Prometheus Alert Rules (Starting Point)
- Example alerts (tune after baseline data is collected):
```yaml
groups:
  - name: agentsmith_notebook_runtime
    rules:
      - alert: AgentSmithNotebookRuntimeTerminalWithoutDone
        expr: increase(notebook_task_runs_terminal_without_done_total[10m]) > 0
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Notebook runtime stream finalized without terminal event"

      - alert: AgentSmithNotebookRuntimeFailuresHigh
        expr: increase(notebook_task_runs_failed_total[15m]) >= 3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Notebook runtime task failures increased"

      - alert: AgentSmithNotebookTraceDetailsTruncationSpike
        expr: increase(notebook_trace_details_truncated_total[15m]) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Notebook trace details truncation spike (payloads too large)"

      - alert: AgentSmithNotebookActiveRunsStuck
        expr: notebook_active_runs > 0 and increase(notebook_task_runs_completed_total[15m]) == 0 and increase(notebook_task_runs_failed_total[15m]) == 0
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Notebook active runs may be stuck"
```
- Notes:
  - Use these as bootstrap rules only; tune thresholds after collecting real baseline data.
  - If upstream provider instability is expected, set failure thresholds by SLO/error budget rather than raw count.

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

### 7.5.4 Load Matrix (Repeatable Baseline)
- Use the matrix wrapper to run multiple `requests x concurrency` cases and persist results:
```bash
make notebook-agent-load-matrix
```

- Default matrix:
  - `MATRIX=10x2,10x3,20x3`
- Custom matrix example:
```bash
MATRIX=4x2,6x2,8x3 make notebook-agent-load-matrix
```

- Optional controls (passed through to each case):
```bash
POLL_MAX=120 POLL_INTERVAL_SEC=2 PROMPT='reply exactly: chain ok' make notebook-agent-load-matrix
```

- Output:
  - directory under `/tmp/agentsmith-load-matrix-<timestamp>/`
  - per-case:
    - `case-*/stdout.log`
    - `case-*/result.json` (summary + metrics snapshot)
  - aggregate:
    - `summary.csv`
    - `summary.jsonl`

- Recommended usage:
  - keep `PROMPT` constant across runs
  - compare `summary.csv` across commits/branches for p95/p99 regressions
  - run `make notebook-agent-monitor` in another terminal during the matrix run
  - inspect `notebook_task_traces_query_duration_ms_*` after matrix runs to detect `/traces` query regressions

### 7.5.5 Standard Baseline Command (Team Default)
- Use the standard baseline profile wrapper (recommended for weekly/regression checks):
```bash
make notebook-agent-benchmark-baseline
```
- Default baseline matrix (moderate, repeatable):
  - `6x2,6x3,10x3`
- Override example:
```bash
MATRIX=10x2,10x4,20x4 make notebook-agent-benchmark-baseline
```
- Output:
  - `/tmp/agentsmith-benchmark-baseline-<timestamp>/summary.csv`
  - `/tmp/agentsmith-benchmark-baseline-<timestamp>/summary.jsonl`
- Team usage suggestion:
  - store selected baseline outputs (CSV/JSONL) as CI artifacts or benchmark snapshots for trend comparison

### 7.5.6 Memory vs Mongo Baseline Comparison (Recommended)
- Goal:
  - compare end-to-end task latency and `/traces` query behavior between:
    - memory `docStore`
    - Mongo `docStore`
- Step 1: run baseline in memory mode (default API startup)
```bash
OUT_DIR=/tmp/agentsmith-baseline-memory make notebook-agent-benchmark-baseline
```
- Step 2: restart API with Mongo/docStore enabled, then re-init resources and runner, run baseline again
```bash
# example (adjust MONGO_URL / DB name to your environment)
MONGO_URL='mongodb://localhost:27017' MONGO_DB_NAME='mbos' \
PORT=20000 KEYCLOAK_BASE_URL=http://localhost:18080 KEYCLOAK_REALM=mbos \
npm run dev -w @mbos/api-entry-node

# in another terminal, rebuild test resources (memory-mode ids are not reusable after API restart)
make notebook-agent-refresh-token
GLM_API_KEY='***' make notebook-agent-init-resources
make notebook-agent-runner

OUT_DIR=/tmp/agentsmith-baseline-mongo make notebook-agent-benchmark-baseline
```
- Step 3: compare outputs
```bash
BASELINE_A_LABEL=memory BASELINE_A_DIR=/tmp/agentsmith-baseline-memory \
BASELINE_B_LABEL=mongo  BASELINE_B_DIR=/tmp/agentsmith-baseline-mongo \
make notebook-agent-benchmark-compare
```
- What to compare first:
  - `success_rate`
  - `latency_ms.p95 / p99`
  - Prometheus histogram `notebook_task_traces_query_duration_ms_*{scope="message"}`
  - monitor output `traces_q_msg_max_ms`
- Interpretation guidance:
  - if end-to-end latency increases but `traces` query histogram is stable:
    - bottleneck is likely upstream model/runtime, not notebook traces API
  - if `traces_q_msg_max_ms` / histogram shifts significantly:
    - inspect Mongo indexes and query filters for `notebook_task_trace_events`

### 7.5.7 Message-Scoped Traces Query Benchmark (Execution Details Path)
- Purpose:
  - benchmark the notebook execution-details lazy-load query path directly:
    - `GET /tasks/:taskId/traces?message_id=<messageId>`
  - isolate `/traces` query latency from upstream model/runtime variability
- Command:
```bash
make notebook-agent-traces-query-bench
```
- Defaults:
  - uses `/tmp/agentsmith_project_id.txt`
  - uses `/tmp/agentsmith_last_task_id.txt`
  - resolves the latest agent `message_id` automatically
  - `REQUESTS=50`, `CONCURRENCY=5`, `WARMUP=5`
- Useful overrides:
```bash
TASK_ID=task_000123 MESSAGE_ID=msg_000456 REQUESTS=200 CONCURRENCY=20 make notebook-agent-traces-query-bench
PAGE_SIZE=50 make notebook-agent-traces-query-bench
```
- Output includes:
  - request latency stats (`avg/p50/p95/p99/max`)
  - failure codes
  - notebook runtime metrics snapshot (JSON)
  - Prometheus histogram lines for `scope="message"`
- Recommendation:
  - run this after a baseline task run in both memory and Mongo modes
  - compare:
    - script p95/p99
    - `notebook_task_traces_query_duration_ms_*{scope="message"}`

### 7.5.8 Message-Scoped Traces Query Page-Size Sweep
- Purpose:
  - compare the execution-details query path across different `page_size` values
  - identify whether larger trace slices materially affect p95/p99 in memory vs Mongo modes
- Command:
```bash
make notebook-agent-traces-query-sweep
```
- Defaults:
  - `PAGE_SIZES=20,50,200,500`
  - `REQUESTS=100`
  - `CONCURRENCY=10`
  - `WARMUP=10`
- Output:
  - `/tmp/agentsmith-traces-query-sweep-<timestamp>/summary.csv`
  - `/tmp/agentsmith-traces-query-sweep-<timestamp>/summary.jsonl`
  - per-page directories with `result.json` and `stdout.log`
- Usage patterns:
  - reuse an existing task/message:
```bash
TASK_ID=task_000123 MESSAGE_ID=msg_000456 make notebook-agent-traces-query-sweep
```
  - auto-generate a multi-turn task to increase trace volume:
```bash
PREPARE_TASK=1 TURNS=8 make notebook-agent-traces-query-sweep
```
- Compare memory vs Mongo:
  - run the sweep in each mode with the same `PAGE_SIZES/REQUESTS/CONCURRENCY`
  - compare `summary.csv` p95/p99 and Prometheus histogram `scope="message"`
  - or use the helper to compare two sweep output dirs by `page_size`:
```bash
SWEEP_A_DIR=/tmp/agentsmith-traces-query-sweep-long-memory \
SWEEP_B_DIR=/tmp/agentsmith-traces-query-sweep-long-mongo \
SWEEP_A_LABEL=memory \
SWEEP_B_LABEL=mongo \
make notebook-agent-traces-query-sweep-compare
```
  - output is JSON keyed by `page_size`, including `avg/p95/p99/max` delta percentages

### 7.5.9 Benchmark Result Archiving (Team Baseline Records)
- Purpose:
  - archive benchmark outputs under the repo for future regression comparisons
  - attach metadata (commit SHA, environment parameters, source dir)
- Command:
```bash
SOURCE_DIR=/tmp/agentsmith-traces-query-sweep-final-long-mongo \
LABEL=mongo-traces-sweep-final \
MODE_LABEL=mongo \
COMMIT_SHA=$(git rev-parse HEAD) \
make notebook-agent-benchmark-archive
```
- Output:
  - `artifacts/benchmarks/<timestamp>__<kind>__<label>/`
  - includes:
    - `summary.csv` / `summary.jsonl` (if present)
    - nested per-case `result.json` / `stdout.log` / `metrics.json` (if present)
    - `metadata.json` (archive metadata and key env params)
- Recommendation:
  - archive at least one `memory` and one `mongo` baseline set per release candidate
  - keep the compare output (`benchmark-compare` / `traces-query-sweep-compare`) next to the archived dirs in release notes or CI artifacts

## 8. Known Risks (Recorded)
- R1: User bearer token forwarded to runner process env for proxy auth/audit.
- R3: Workdir is namespace isolation only (`/tmp/<username>/<task_id>`), not full sandbox.

## 8.1 Deployment Model and Runtime Coordination Limits
- Current notebook runtime coordination is optimized for a single API instance (or sticky-session routing to one API instance).
- The following coordination state is in-process memory in `api-entry-node`:
  - active task run guard (`ACTIVE_RUNS_BY_TASK`)
  - notebook task SSE client subscriptions
  - notebook task SSE replay buffer (`last_event_id` replay source)
- Implications in multi-instance deployments (without sticky routing / shared coordination):
  - duplicate user POSTs to `/tasks/:id/messages` can bypass per-task active-run guard across instances
  - `/tasks/:id/events` replay continuity may be incomplete after reconnects that land on another instance
  - live SSE subscriptions are instance-local (expected)
- Recommended current deployment pattern:
  - single API instance for notebook external-agent runtime, or
  - sticky routing by task/session when using multiple API instances
- Future hardening path (not implemented in v1):
  - distributed task-run lock (e.g. Redis)
  - shared replay/event source for notebook task SSE

## 8.4 Notebook Headless Execution and Artifact Convention

Notebook tasks executed by `@mbos/agent-codex-runner` use a runner-enforced headless policy:

- treat execution as headless (no visible GUI on the client)
- avoid interactive display calls (for example `matplotlib.pyplot.show()`)
- save generated charts/files into the task artifact directory:
  - `<task_cwd>/artifacts/`

Runner runtime-context/task-input behavior:

- notebook attached inputs are passed in `runtime_context.task_inputs`
- runner also receives `runtime_context.api_base` for notebook helper tooling (source downloads)
- runner writes a task input manifest to:
  - `<task_cwd>/.mbos/task-inputs.json`
- runner writes a task-local `AGENTS.md` with mandatory notebook rules (headless/artifacts/input helper)
- runner installs a task-local Codex skill:
  - `./.codex/skills/notebook-inputs/`
  - helper command: `node ./.codex/skills/notebook-inputs/fetch_input.mjs ...`
- Codex is instructed to use the manifest and produce file outputs in `artifacts/`

Session continuity behavior:

- runner reuses the same task cwd (`/tmp/<username>/<task_id>`)
- first turn runs `codex exec ...`
- subsequent notebook turns in the same task cwd use `codex exec resume --last ...` (runner-managed)

Runner artifact reporting behavior:

- after Codex process exit, runner scans `<task_cwd>/artifacts/`
- for each discovered output, runner emits:
  - `agent.response.artifact` (structured artifact payload)
  - `agent.response.event` with `category=artifact` (diagnostic trace)
- backend notebook task artifact storage applies idempotency for repeated runtime artifact frames using the runtime path metadata (for example `task_relative_path`), reducing duplicate artifacts after repeated scans in the same task

Notes:

- image artifacts may be inlined as data URLs (size-limited) for local notebook preview
- text artifacts may include truncated preview content (size-limited)
- task artifact records returned by `/tasks/{taskId}/artifacts` may include `task_relative_path` for runtime-originated outputs (relative path inside task cwd)
- notebook Attached Inputs panel fetches attached input details from task-scoped route `GET /tasks/{taskId}/inputs` (avoids loading the full Files list for display)

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
