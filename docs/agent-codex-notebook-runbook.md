# AgentSmith Notebook External Agent (Codex) Runbook

术语边界：本文出现的 `release` / `engineering gate` 命令名是仓库内工程脚本命名（smoke、验收、诊断）；`permission gate` 仅表示产品权限门禁语义，不表示 AgentSmith 平台提供 DevOps 发布编排功能。

Release closure companion:

- [Workspace Feishu + Notebook Release Checklist](./design/workspace-feishu-notebook-release-checklist-v1.md)
- [Internal Agent Workspace Binding Model](./contracts/internal-agent-workspace-binding-model-v1.md)

Dependency truth:

- internal notebook workloads depend on the workspace-backed PVC/CSI path documented in `../mbos-sandbox-v1/docs/JUICEFS_CSI_WORKSPACE_MODEL.md`
- the legacy snapshot/restore sandbox path is not the product truth for current persistent notebook file libraries

## Scope of current MVP

This runbook covers the supported MVP path focused on `Files + Notebook + External Agent + Trace + Artifacts`.

Governance surfaces such as `Members` and `Resource Policy` are part of current real-backend coverage. They support effective access explain, matched policy explain, and membership lifecycle effects within the current MVP scope.

`Audit` and `Usage` are now backed by real `api-entry-node` routes with persisted governance data (first-stage coverage) and are available in real-backend mode for internal workflows.

### Governance Coverage (Current internal backend)

- `Audit` (`/audit`)
  - persisted audit events with paging/filtering/sorting
  - first-stage coverage: notebook task lifecycle/input changes/artifacts, chat message/attachment/run lifecycle
- `Usage` (`/usage`)
  - persisted usage facts aggregated by `day|hour`
  - first-stage coverage: notebook task runs, chat runs, endpoint proxy requests
- `Members`
  - real backend coverage for reads/writes, effective access explain, membership lifecycle cleanup, and permission/limit visibility
  - backend route authz reflects unified backend authorization decisions
  - member limit overrides/templates provide enforced request limit effects within the documented scope
- `Resource Policy`
  - real backend coverage for reads/writes, matched policy explain, and enforced governance paths in the current internal baseline
  - current enforcement scope covers allow-all / allow-list checks for `endpoint` and notebook/chat `agent` paths
  - allow-list matching supports user and group subjects
  - endpoint `requests_per_minute` rate limiting is enforced
  - endpoint `daily_token_limit` limit enforcement is enforced
  - file upload and browsing in the current Files mainline use project `file-libraries`

## 1. Scope
- Target: notebook task execution with persistent file-library workspaces.
- Executor: OpenAI Codex CLI (`codex exec`, script/non-interactive mode).
- Execution path: AgentSmith task message -> MBOS external-agent execution websocket -> `agent-codex-runner` -> endpoint proxy -> LLM.
- Workdir rule:
  - persistent workspace mode (Phase 1 current truth):
    - external bare: `~/ags-workspaces/<workspace_dir_name>`
    - external docker: `/workspace/ags-workspaces/<workspace_dir_name>`
    - internal k8s: `/workspace`
  - the mounted workspace root is the selected notebook task file library root
  - task runtime state is namespaced inside the persistent file library root:
    - `.codex/tasks/<taskId>/`
    - `.mbos/tasks/<taskId>/`
    - `.artifacts/tasks/<taskId>/`
  - deliverables should be written to `./.artifacts/tasks/<taskId>/`

## 2. Current Delivery Status
- Implemented:
  - Notebook task message streaming execution in API node backend.
  - `execution_context` protocol extension for external execution service.
  - External runner package `@mbos/agent-codex-runner`.
  - Agent config UI (`Notebook Endpoint ID`) and backend validation.
  - OpenAPI/AsyncAPI/Protocol docs updates.
  - Integration keycloak redirect auto-fix for custom web ports.
  - Responses-to-chat compatibility translation in endpoint proxy (including streaming SSE translation).
  - Codex runner per-task watchdog timeout and task auto-close protections.
  - Codex runner task namespace generation for `.codex/.mbos/.artifacts`.
  - Internal-k8s notebook execution path using JuiceFS CSI pre-mounted `/workspace`.
  - Internal lazy start / reclaim / resume without snapshot restore.
- Verified:
  - `packages/api-entry-node/src/http-utils.test.ts` (responses/chat translation) passing.
  - End-to-end Notebook external agent pipeline with real GLM (`glm-5`) returns `turn.completed`.
  - Internal notebook workspace real gate writes task artifacts into `.artifacts/tasks/<taskId>/` inside the selected file library root and resumes after workload reclaim.

## 3. End-to-End Flow
1. User creates Notebook task with notebook-capable external agent.
2. User posts task message (`role=user`).
3. Backend creates assistant placeholder, marks task run active.
4. Backend dispatches `server.request.start` to external execution service with:
   - normal chat payload (`messages`, `model`, etc.)
   - `execution_context` (`workspace_id/project_id/task_id/run_id/username/user_bearer_token/wire_api/model`)
   - static proxy config comes from `server.hello.resource_proxy.base_url`
5. `agent-codex-runner`:
   - resolves task workspace access from AgentSmith;
   - in persistent workspace mode, mounts the task-bound JuiceFS file library root;
   - uses the mounted workspace as cwd;
   - writes task-scoped runtime state under `.codex/tasks/<taskId>/`, `.mbos/tasks/<taskId>/`, and `.artifacts/tasks/<taskId>/`;
   - runs `codex exec` with explicit `-c model_provider=proxy` / `model_providers.proxy.*` overrides;
   - marks current task workdir as trusted project (`projects."<cwd>".trust_level="trusted"`) and disables git requirement (`project_root_markers=[]`, `--skip-git-repo-check`);
   - emits stream frames (`agent.response.delta`, `agent.response.done`/`error`).
6. Backend relays deltas into task assistant message and task SSE.
7. Run finalized, active lock released.

## 4. Component Ownership (Parallel Work)
### Track A: Backend Execution/Task
- Files:
  - `packages/api-entry-node/src/task-route-handler.ts`
  - `packages/api-entry-node/src/agent-execution-service.ts`
  - `packages/api-entry-node/src/request-handler.ts`
- Responsibilities:
  - task run lifecycle, conflict control (`TASK_STREAM_CONFLICT`), SSE fanout.
  - protocol mapping, execution_context assembly, auth token forwarding.
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
  - payload contract (`execution_preferences.notebook`).
  - validation/error copy/i18n.

### Track D: Contracts + QA
- Files:
  - `docs/contracts/specs/openapi.yaml|json`
  - `docs/contracts/specs/asyncapi.yaml|json`
  - `docs/contracts/agent-execution-protocol.md`
  - `packages/api-entry-node/src/index.test.ts`
  - `e2e/integration-agents-external.spec.ts`
- Responsibilities:
  - contract consistency and generated artifact checks.
  - integration/e2e coverage for notebook chain.

## 5. Required Configuration
### 5.1 Agent config
- Agent mode: `external`
- Interaction mode: `notebook` or `both`
- Execution preferences:
  - `execution_preferences.notebook.endpoint_id` (required)
  - optional: `wire_api` (`chat` or `responses`)
  - optional: `model`

### 5.2 Runner env vars
- `MBOS_AGENT_WS_URL` (execution websocket URL from agent connection info)
- `MBOS_AGENT_KEY` (agent service key `ask_...`)
- `CODEX_BIN` (optional; default `codex`)
- `MBOS_AGENT_TASK_TIMEOUT_SEC` (optional; task watchdog, default currently 55s in code)
- `MBOS_AGENT_RUNNER_DEBUG=1` (optional; logs spawn args/workdir/timeout)
- `MBOS_AGENT_CODEX_YOLO=1` (optional; run codex with `--dangerously-bypass-approvals-and-sandbox`)
- `MBOS_AGENT_BUILTIN_SKILLS_DIR` (optional; default `<repo>/packages/agent-codex-runner/builtin-skills`)
- `MBOS_AGENT_BUILTIN_SKILLS` (optional; default `.system,feishu-docs,jira-ops,file-read`)
- `MBOS_AGENT_BUILTIN_SKILLS_REQUIRED` (optional; default `1`, fail-fast when builtin skill missing)
- `MBOS_AGENT_WORKSPACE_ROOT` (optional; base directory for mounted notebook workspaces)

### 5.2.1 External Docker runner prerequisites
- `juicefs` CLI must be available in the runner image
- FUSE support must be enabled for the container runtime
- recommended Docker flags for the current local baseline:
  - `--privileged`
  - `--device /dev/fuse`
  - `--security-opt apparmor:unconfined`
- the workspace root inside the container is `/workspace/ags-workspaces`
- build-time proxy may be required in local environments; do not persist proxy env vars in the final image

### 5.3 API debug env vars (recommended for troubleshooting)
- `DEBUG_AGENT_EXECUTION=1` (execution websocket accept/reject logs)
- `DEBUG_ENDPOINT_PROXY=1` (proxy request summaries + SSE translation counters)
- `DEBUG_NOTEBOOK_EXECUTION=1` (task/run/request_id level dispatch + terminal events)

### 5.3.1 Builtin Skills Bootstrap Policy (MVP)
- Builtin skills are bootstrapped into the persistent workspace root once, under `.codex/skills/`.
- Tasks reuse the shared skills directory instead of copying a new skills tree into each task namespace.
- Default policy is fail-fast if required builtin skills are missing (`MBOS_AGENT_BUILTIN_SKILLS_REQUIRED=1`).

### 5.3.2 Unified Env Switch Reference (quick lookup)
- Runner (`agent-codex-runner`)
  - `MBOS_AGENT_WS_URL`, `MBOS_AGENT_KEY`, `CODEX_BIN`
  - `MBOS_AGENT_TASK_TIMEOUT_SEC`
  - `MBOS_AGENT_RUNNER_DEBUG`
  - `MBOS_AGENT_CODEX_YOLO`
  - `MBOS_AGENT_BUILTIN_SKILLS_DIR`, `MBOS_AGENT_BUILTIN_SKILLS`, `MBOS_AGENT_BUILTIN_SKILLS_REQUIRED`
- API (`@mbos/api-entry-node`)
  - `DEBUG_AGENT_EXECUTION`, `DEBUG_ENDPOINT_PROXY`, `DEBUG_NOTEBOOK_EXECUTION`
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
  - This runbook is the current **single place** for notebook/external-agent execution switches.
  - Repo-wide frontend-only switches outside notebook scope may still be documented in feature-specific docs.

### 5.3.3 Default Project Upload Library (Chat object-first attachments)
- Chat local uploads now use an object-first flow:
  1. ensure backend project upload file library (`GET /file-libraries`, create `Project Uploads` when missing)
  2. upload object under `chat/<session_id>/uploads/`
  3. create chat attachment from the library object
- Current local backend policy:
  - deterministic library name: `Project Uploads`
  - project-level shared library
  - ensure flow is idempotent (reuse existing or create once)
  - uploads land in the new JuiceFS-backed project file library model

### 5.3.4 Notebook URL Inputs (object-first)
- Notebook "Add URL" now stores the generated URL note file in the backend project upload file library, then attaches it as a first-class `url` input ref (with imported object provenance) to the task.
- This keeps notebook URL inputs aligned with the object-first input architecture while preserving URL semantics in `attached_inputs`.

### 5.3.5 Notebook Artifact Inputs (output-to-input loop)
- Notebook artifacts can be attached back into task inputs as first-class `artifact` refs.
- The runner `file-read` helper can fetch artifact inputs via the task artifact download route, enabling output-to-input iteration in Codex notebook flows.

### 5.3.6 Notebook Local Upload Inputs (object-first)
- Notebook local file uploads now follow the same object-first flow as Chat uploads:
  1. ensure backend project upload file library
  2. upload local files as library objects under `notebook/<task_id>/inputs/`
  3. attach task inputs as `library_object` refs
- Notebook local uploads no longer create `source` records directly.
- `source` inputs remain supported as a legacy derived input type, but they are not the primary raw file ingestion path.

### 5.4 Local commands
```bash
# Start API with debugging for notebook execution/proxy troubleshooting
PORT=20000 \
KEYCLOAK_BASE_URL=http://localhost:18080 \
KEYCLOAK_REALM=mbos \
DEBUG_AGENT_EXECUTION=1 \
DEBUG_ENDPOINT_PROXY=1 \
DEBUG_NOTEBOOK_EXECUTION=1 \
npm run dev -w @mbos/api-entry-node

# Start external codex runner (default full-auto)
make agent-codex-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_xxx' AGENT_KEY='ask_xxx'

# Start external codex runner in YOLO mode
MBOS_AGENT_CODEX_YOLO=1 \
MBOS_AGENT_TASK_TIMEOUT_SEC=120 \
make agent-codex-runner AGENT_WS_URL='ws://localhost:20000/api/v1/agent-execution/ws?agent_id=ag_xxx' AGENT_KEY='ask_xxx'

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
DEBUG_AGENT_EXECUTION=1 \
DEBUG_ENDPOINT_PROXY=1 \
DEBUG_NOTEBOOK_EXECUTION=1 \
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
- Recommended smoke bundle (before demos and internal validation):
```bash
make notebook-agent-engineering-smoke
```
- Default bundle includes:
  - `make notebook-agent-smoke-task`
  - `make notebook-agent-file-read-mount-smoke`
  - `make notebook-agent-inputrefs-loop-smoke`
- Smoke auth behavior:
  - notebook smoke scripts now auto-refresh token once on `401` and retry the failed API call (including initial `POST /tasks`).
  - if refresh still fails or retry remains `401`, smoke fails fast with the concrete HTTP error body.
- Optional matplotlib image-artifact smoke:
```bash
RUN_MATPLOTLIB_SMOKE=1 make notebook-agent-engineering-smoke
```
- One-command smoke readiness check (refreshes token if needed, runs `demo-check`, then runs smoke bundle):
```bash
make notebook-agent-engineering-smoke-full
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
make governance-smoke
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

### 5.4.4 Internal Agent Workspace Real Gate
- Required env for internal mode:
```bash
export SANDBOX_MANAGER_URL=http://<sandbox-manager-host>:8080
export SANDBOX_SERVICE_KEY=<sandbox-service-key>
export INTERNAL_AGENT_K8S_NAMESPACE=agentsmith-sandbox
```
- Optional (recommended explicit execution ws base):
```bash
export AGENT_EXECUTION_WS_BASE_URL=ws://localhost:20000
```
- Run:
```bash
npm run test:internal:real:notebook-workspace
```
- Gate proves:
  - internal agent can be selected before pod exists
  - first notebook message lazy-starts workload
  - JuiceFS CSI mounts selected file library root at `/workspace`
  - task writes deliverables into `/workspace/.artifacts`
  - Files 页面与本地 mount 均可见这些 deliverables
  - workload reclaim 后再次消息可恢复
- Contract notes:
  - internal runner uses `workspace_binding_mode=pre_mounted`
  - `workspace_path` is fixed to `/workspace`
  - snapshot/restore no longer participates in this route

## 5.5 Important Codex Config Behavior (Root Cause Note)
- Codex docs state project-scoped `.codex/config.toml` is only loaded for **trusted projects**.
- Our task workdirs are ephemeral (`/tmp/<username>/<task_id>`) and are not trusted by default.
- Result: relying only on task workdir `.codex/config.toml` can fail, and Codex may fall back to ChatGPT-account provider mode.
- Operational fix (implemented): pass `-c model_provider="proxy"` and `-c model_providers.proxy.*` explicitly on `codex exec`, while also forcing trusted cwd metadata:
  - `-c 'project_root_markers=[]'`
  - `-c 'projects."<cwd>".trust_level="trusted"'`

## 6. Acceptance Checklist
- Task message POST triggers external execution service request.
- Concurrent second POST while active run returns `409 TASK_STREAM_CONFLICT`.
- Assistant message receives streamed deltas and final content.
- Runner creates `/tmp/<username>/<task_id>`.
- Proxy auth uses user bearer token; endpoint request succeeds.
- Cancel request terminates codex process and execution stream exits.

## 7. Error Codes / Operational Signals
- `TASK_STREAM_CONFLICT`: active run already exists for task.
- `TASK_AGENT_ENDPOINT_NOT_CONFIGURED`: missing notebook endpoint binding.
- `AGENT_OFFLINE`: no active execution websocket for selected agent.
- `AGENT_PROTOCOL_ERROR`: invalid execution response frame shape.
- `execution.terminal` (trace event name): synthesized backend terminal trace used when execution fails before any trace frame is emitted.

## 7.1 Terminal Fallback Semantics
- For notebook runs, backend must not leave tasks in an indeterminate "no traces forever" state.
- If dispatch/stream fails before any execution trace arrives:
  - backend emits synthesized terminal trace event:
    - `name=execution.terminal`
    - `phase=end`
    - `status=error`
    - `details.synthesized=true`
  - task stays reusable; completion/failure is represented by run terminal signals and trace events.
- This fallback is operationally required so smoke/runbook tooling can classify completion deterministically.
- Frontend run-state rule (must stay consistent with runner protocol):
  - step-level trace success (for example `codex.exec`, `runner.artifact`) does **not** end a run;
  - only `run.lifecycle` with `phase=end` or `run.summary` with `phase=end` may clear the active-run busy state.

## 7.2 Debug Log Correlation (Recommended)
- `notebook-execution` logs (`DEBUG_NOTEBOOK_EXECUTION=1`)
  - carries `task_id`, `run_id`, `request_id`, `agent_id`, `endpoint_id`
- `agent-codex-runner` debug logs (`MBOS_AGENT_RUNNER_DEBUG=1`)
  - carries same `request_id`, codex argv, cancellation signal, exit code
- `endpoint-proxy` logs (`DEBUG_ENDPOINT_PROXY=1`)
  - request summary, upstream response mode, SSE translation counters/terminal reason
- `agent-execution` logs (`DEBUG_AGENT_EXECUTION=1`)
  - websocket accept/reject, request dispatch/cancel signals

## 7.3 Frontend Notebook SSE Debug Panel (Development Only)
- In `next dev` (`NODE_ENV=development`), the notebook task page shows `SSE Debug (latest 5)` above the conversation panel.
- It is now **disabled by default**, even in development.
- Enable explicitly when troubleshooting browser SSE behavior:
  - `NEXT_PUBLIC_NOTEBOOK_SSE_DEBUG_PANEL=1 npm run dev -- --port 3001`
- Purpose:
  - quickly verify whether browser SSE is connected and receiving events without opening DevTools Network every time.
  - distinguish UI rendering issues vs backend execution event delivery issues.
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

## 7.4 Notebook Task Metrics (Internal, Authenticated)
- API exposes a lightweight process-local metrics snapshot for notebook execution/task execution:
  - `GET /api/v1/internal/notebook-task-metrics`
  - `GET /api/v1/internal/notebook-task-metrics/prometheus` (Prometheus text format)
- Authentication:
  - requires a valid bearer token (same user token used for notebook APIs).
- Purpose:
  - quick execution health checks during real-environment validation/load tests
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
  - job_name: agentsmith_notebook_execution
    metrics_path: /api/v1/internal/notebook-task-metrics/prometheus
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
  - name: agentsmith_notebook_execution
    rules:
      - alert: AgentSmithNotebookExecutionTerminalWithoutDone
        expr: increase(notebook_task_runs_terminal_without_done_total[10m]) > 0
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Notebook execution stream finalized without terminal event"

      - alert: AgentSmithNotebookExecutionFailuresHigh
        expr: increase(notebook_task_runs_failed_total[15m]) >= 3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Notebook task failures increased"

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
  - validate execution stability under concurrent notebook task submissions
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
  - final `notebook-task-metrics` snapshot
- Use together with:
  - `make notebook-agent-monitor`
  - API logs (`DEBUG_NOTEBOOK_EXECUTION=1`, `DEBUG_AGENT_EXECUTION=1`, `DEBUG_ENDPOINT_PROXY=1`)
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
    - bottleneck is likely upstream model execution, not notebook traces API
  - if `traces_q_msg_max_ms` / histogram shifts significantly:
    - inspect Mongo indexes and query filters for `notebook_task_trace_events`

### 7.5.7 Message-Scoped Traces Query Benchmark (Execution Details Path)
- Purpose:
  - benchmark the notebook execution-details lazy-load query path directly:
    - `GET /tasks/:taskId/traces?message_id=<messageId>`
  - isolate `/traces` query latency from upstream model execution variability
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
  - notebook task metrics snapshot (JSON)
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
  - archive at least one `memory` and one `mongo` baseline set per engineering verification round
  - keep the compare output (`benchmark-compare` / `traces-query-sweep-compare`) next to the archived dirs in verification notes or CI artifacts

## 8. Known Risks (Recorded)
- R1: User bearer token forwarded to runner process env for proxy auth/audit.
- R3: Workdir is namespace isolation only (`/tmp/<username>/<task_id>`), not full sandbox.

## 8.1 Deployment Model and Execution Coordination Limits
- Current notebook execution coordination is optimized for a single API instance (or sticky-session routing to one API instance).
- Shared notebook run coordination is now cache-backed:
  - per-task active-run lease
  - per-task cancel-request marker
  - task detail `run_state` projection
- The following coordination state remains in-process memory in `api-entry-node`:
  - notebook task SSE client subscriptions
  - notebook task SSE replay buffer (`last_event_id` replay source)
  - local cancel callback for the instance that currently owns an executing run
- Implications in multi-instance deployments (without sticky routing / shared coordination):
  - task run visibility and cancel-request intent are shared across instances
  - live SSE subscriptions are still instance-local (expected)
  - `/tasks/:id/events` replay continuity may still be incomplete after reconnects that land on another instance
  - the instance actually running the agent process still owns the local cancel handle
- Recommended current deployment pattern:
  - single API instance for notebook external-agent execution, or
  - sticky routing by task/session when using multiple API instances
- Current SSE ticket behavior is now shared-cache based:
  - short-lived SSE tickets are stored in the configured `CachePort` backend
  - in production, this means Redis-backed ticket validation works across API instance restarts and cross-instance routing
  - the remaining single-instance/sticky requirement is for local execution handles and SSE replay continuity, not for the SSE ticket itself
- Future hardening path (not implemented in v1):
  - shared replay/event source for notebook task SSE
  - stronger multi-instance execution handoff for in-flight notebook runs

## 8.4 Notebook Headless Execution and Artifact Convention

Notebook tasks executed by `@mbos/agent-codex-runner` use a runner-enforced headless policy:

- treat execution as headless (no visible GUI on the client)
- avoid interactive display calls (for example `matplotlib.pyplot.show()`)
- save generated charts/files into the task artifact directory:
  - `<task_cwd>/.artifacts/tasks/<taskId>/`

Runner execution-context/task-input behavior:

- notebook attached inputs are passed in `execution_context.task_inputs`
- runner also receives `execution_context.api_base` for notebook helper tooling (source downloads)
- runner writes a task input manifest to:
  - `<task_cwd>/.mbos/tasks/<taskId>/task-inputs.json`
- runner keeps a stable root `AGENTS.md` that documents persistent workspace conventions and task namespace rules
- runner reuses the shared Codex skill directory:
  - `./.codex/skills/file-read/`
  - helper command: `node ./.codex/skills/file-read/fetch_input.mjs ...`
- Codex is instructed to use the task manifest and produce file outputs in `.artifacts/tasks/<taskId>/`

Session continuity behavior:

- runner reuses the same task cwd (`/tmp/<username>/<task_id>`)
- first turn runs `codex exec ...`
- subsequent notebook turns in the same task cwd use `codex exec resume --last ...` (runner-managed)

Runner artifact reporting behavior:

- after Codex process exit, runner scans `<task_cwd>/.artifacts/tasks/<taskId>/`
- for each discovered output, runner emits:
  - `agent.response.artifact` (structured artifact payload)
  - `agent.response.event` with `category=artifact` (diagnostic trace)
- backend notebook task artifact storage applies idempotency for repeated execution artifact frames using the execution path metadata (for example `task_relative_path`), reducing duplicate artifacts after repeated scans in the same task

Notes:

- image artifacts may be inlined as data URLs (size-limited) for local notebook preview
- text artifacts may include truncated preview content (size-limited)
- task artifact records returned by `/tasks/{taskId}/artifacts` may include `task_relative_path` for execution-originated outputs (relative path inside task cwd)
- notebook Attached Inputs panel fetches attached input details from task-scoped route `GET /tasks/{taskId}/inputs` (avoids loading the full Files list for display)

## 9. Next Hardening Items
1. Replace direct bearer forwarding with short-lived ticket exchange.
2. Add stronger execution isolation (container/jail/seccomp profile).
3. Add notebook-specific integration spec for full task->runner->proxy stream assertions.

## 10. Team Task Breakdown (Parallel)
### Sprint A (Backend/API, 2-3 days)
- A1: execution_context correctness and request-host derived proxy base.
- A2: task run lifecycle guards (`TASK_STREAM_CONFLICT`, finalize cleanup).
- A3: notebook endpoint binding validation (`interaction_mode=notebook|both`).
- A4: API tests for notebook run + conflict + execution context.

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
- C2: request payload alignment (`execution_preferences.notebook.*`).
- C3: i18n copy and error messaging.

Dependencies:
- C2 depends on A3 contract.

### Sprint D (QA/Integration, 1-2 days)
- D1: external-agent chat integration regression.
- D2: notebook integration spec (task->execution->proxy->stream).
- D3: environment bootstrap checks (Keycloak redirect URI consistency).

Dependencies:
- D2 depends on A1/B3 and endpoint route availability.

## 11. CI Mapping
- Workflow file: `.github/workflows/integration-e2e.yml`
- Jobs:
  - `integration-agent` -> `make e2e-int-agent-auto PORT_API=20030 PORT_WEB=3011`
  - `integration-notebook-agent` -> `make e2e-int-notebook-agent-auto PORT_API=20031 PORT_WEB=3013`
- Trigger:
  - `pull_request` on integration/execution related paths.
  - manual `workflow_dispatch` with `suite=all|agent|notebook-agent`.
- Failure attribution:
  - summary tags such as `INT-KEYCLOAK-REDIRECT`, `INT-INFRA-BOOT`, `INT-AGENT-OFFLINE`, `INT-NOTEBOOK-EXECUTION`.
- Troubleshooting:
  - `docs/ci-integration-troubleshooting.md`
