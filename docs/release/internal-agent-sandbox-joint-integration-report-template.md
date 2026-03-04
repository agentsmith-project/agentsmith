# Internal Agent Sandbox — Joint Integration Report

> **Date:** YYYY-MM-DD
> **Participants:** AgentSmith Team, Sandbox Team

## Environment

| Component | URL / Version | Status |
|-----------|---------------|--------|
| AgentSmith API | `http://localhost:20000` | |
| AgentSmith Web | `http://localhost:3001` | |
| Sandbox Manager | `http://sandbox-manager:8080` | |
| Keycloak | `http://localhost:18080` | |
| Agent Image | `registry.example.com/agent-codex:vX` | |

## Preflight

- [ ] `make sandbox-preflight` — PASS
- [ ] Sandbox Manager `/healthz` → 200
- [ ] Sandbox Manager `/readyz` → 200
- [ ] Agent image pullable from cluster
- [ ] JuiceFS PVC writable

## Checklist Execution

### 1. Create Internal Agent

- [ ] POST agent with `mode=internal`, `config.image`, `endpoint_id` → 201
- [ ] Auto-generated service key stored in DB
- [ ] `_internal_raw_key` stripped from API response
- Evidence: _paste agent response JSON_

### 2. First Cold Start (Notebook)

- [ ] First message triggers `sandbox_starting` trace event
- [ ] PUT Pod → 201 Created
- [ ] Pod reaches Running phase
- [ ] Agent runner started via `/exec`
- [ ] Agent WS connects, `server.hello` includes `resource_proxy.base_url`
- [ ] Stream returns `delta` events and terminal `done`
- Cold start latency: ___s
- Evidence: _paste SSE stream excerpt_

### 3. Multi-Turn Warm Path

- [ ] Second message on same task → `ensureAgentReady` returns immediately
- [ ] Response latency significantly lower than cold start
- Warm path latency: ___ms
- Evidence: _timing comparison_

### 4. Keepalive Verification

- [ ] Keepalive calls made every 60s during stream
- [ ] Pod `expires_at` annotation updated
- Evidence: _kubectl describe pod excerpt_

### 5. Idle Timeout Recovery

- [ ] Pod reclaimed by cleaner after idle timeout (or manual delete)
- [ ] New message triggers cold start again
- [ ] `/workspace` data intact after Pod recreation
- [ ] Codex `resume --last` activates (runner logs show `hasPersistedSession=true`)
- Evidence: _agent runner log excerpt_

### 6. Task Archive → Pod Release

- [ ] PATCH task status=archived → 200
- [ ] `releasePod` called → Pod deleted
- Evidence: _kubectl get pods before/after_

### 7. Chat Internal Path

- [ ] Chat session with internal agent → cold start/warm path works
- Evidence: _SSE stream excerpt_

### 8. Resume Semantics

- [ ] After Pod recycle, `/workspace/.codex/sessions` persisted
- [ ] Runner detects → codex args include `resume --last`
- Evidence: _runner log excerpt_

### 9. Presence State Transitions

- [ ] Created: `managed`
- [ ] WS connected: `online`
- [ ] WS disconnected: `managed`
- Evidence: _API GET agent responses at each state_

### 10. Error Paths

- [ ] Bad image → `AGENT_SANDBOX_POD_FAILED` surfaced
- [ ] Sandbox not configured → `AGENT_SANDBOX_NOT_CONFIGURED` surfaced
- Evidence: _error response bodies_

## Security Assertions

- [ ] No direct LLM call from runner (codex config `base_url` → proxy)
- [ ] User bearer token not in runner logs
- [ ] Keepalive timer cleaned up after stream ends
- [ ] `_internal_raw_key` not in any API response
- [ ] Pod security context: `runAsUser: 1000`, `automountServiceAccountToken: false`

## Smoke & Release Evidence

- [ ] `make sandbox-joint-smoke` — PASS
- [ ] `make release-core-smoke` — PASS
- [ ] `make e2e-int-agent-local-api` — PASS
- Artifact files:
  - `artifacts/sandbox-integration/smoke-YYYYMMDD-HHMMSS.log`
  - `artifacts/release-reports/report-YYYYMMDD-HHMMSS.json`

## Blockers / Issues Found

| # | Description | Severity | Resolution |
|---|-------------|----------|------------|
| | | | |

## Decision

- [ ] Joint integration: **PASS** — ready for staging deployment
- [ ] Joint integration: **BLOCKED** — issues listed above
