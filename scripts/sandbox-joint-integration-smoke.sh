#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Internal Agent Sandbox — Joint Integration Smoke
#
# Executes the checklist from:
#   docs/plans/internal-agent-sandbox-joint-dev-checklist.md
#
# Prerequisites:
#   - make sandbox-preflight passes
#   - make notebook-agent-refresh-token has been run (token exists)
#   - An internal agent has been created (AGENT_ID set or cached)
#
# Usage:
#   SANDBOX_MANAGER_URL=http://... SANDBOX_SERVICE_KEY=sk_xxx \
#     AGENT_ID=ag_xxx PROJECT_ID=proj_xxx \
#     ./scripts/sandbox-joint-integration-smoke.sh
# ---------------------------------------------------------------------------
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

API_BASE="${API_BASE:-http://localhost:20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
PROJECT_ID="${PROJECT_ID:-$(cat /tmp/agentsmith_project_id.txt 2>/dev/null || true)}"
AGENT_ID="${AGENT_ID:-$(cat /tmp/agentsmith_agent_id.txt 2>/dev/null || true)}"
SANDBOX_MANAGER_URL="${SANDBOX_MANAGER_URL:?SANDBOX_MANAGER_URL required}"
SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY:?SANDBOX_SERVICE_KEY required}"
PROMPT="${PROMPT:-reply exactly: sandbox smoke ok}"

PASS=0
FAIL=0
EVIDENCE_DIR="${ROOT_DIR}/artifacts/sandbox-integration"
mkdir -p "${EVIDENCE_DIR}"
REPORT_FILE="${EVIDENCE_DIR}/smoke-$(date +%Y%m%d-%H%M%S).log"

log() { echo "[sandbox-smoke] $*" | tee -a "${REPORT_FILE}"; }
pass() { log "  [PASS] $1"; PASS=$((PASS + 1)); }
fail() { log "  [FAIL] $1"; FAIL=$((FAIL + 1)); }

if [[ -z "${PROJECT_ID}" || -z "${AGENT_ID}" ]]; then
  log "Missing PROJECT_ID or AGENT_ID"
  exit 1
fi
if [[ ! -f "${TOKEN_FILE}" ]]; then
  log "Token file not found: ${TOKEN_FILE}"
  exit 1
fi
TOKEN="$(cat "${TOKEN_FILE}")"

BASE="${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}"

api() {
  local method="$1" path="$2"; shift 2
  curl -sS -X "${method}" "${BASE}${path}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    "$@"
}

sandbox_api() {
  local method="$1" path="$2"; shift 2
  curl -sS -X "${method}" "${SANDBOX_MANAGER_URL}${path}" \
    -H "X-Service-Key: ${SANDBOX_SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    "$@"
}

# ───────────────────────────────────────────────────────────────
log "=== Phase 1: Verify agent exists and is internal ==="
AGENT_JSON="$(api GET "/agents/${AGENT_ID}")"
AGENT_MODE="$(echo "${AGENT_JSON}" | jq -r '.mode // empty')"
if [[ "${AGENT_MODE}" == "internal" ]]; then
  pass "Agent ${AGENT_ID} is mode=internal"
else
  fail "Agent ${AGENT_ID} mode=${AGENT_MODE}, expected internal"
  log "Agent response: ${AGENT_JSON}"
  exit 1
fi

LEAKED_KEY="$(echo "${AGENT_JSON}" | jq -r '.config._internal_raw_key // empty')"
if [[ -z "${LEAKED_KEY}" ]]; then
  pass "_internal_raw_key not in API response (stripped)"
else
  fail "_internal_raw_key leaked in API response!"
fi

# ───────────────────────────────────────────────────────────────
log "=== Phase 2: Sandbox Manager health ==="
HEALTH_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "${SANDBOX_MANAGER_URL}/healthz")"
if [[ "${HEALTH_CODE}" == "200" ]]; then
  pass "Sandbox Manager /healthz → 200"
else
  fail "Sandbox Manager /healthz → ${HEALTH_CODE}"
fi

READY_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "${SANDBOX_MANAGER_URL}/readyz")"
if [[ "${READY_CODE}" == "200" ]]; then
  pass "Sandbox Manager /readyz → 200"
else
  fail "Sandbox Manager /readyz → ${READY_CODE}"
fi

# ───────────────────────────────────────────────────────────────
log "=== Phase 3: Create notebook task → cold start ==="
TASK_JSON="$(api POST "/tasks" -d "{
  \"agent_id\": \"${AGENT_ID}\",
  \"title\": \"Sandbox integration smoke $(date +%H%M%S)\"
}")"
TASK_ID="$(echo "${TASK_JSON}" | jq -r '.id // empty')"
if [[ -n "${TASK_ID}" ]]; then
  pass "Task created: ${TASK_ID}"
else
  fail "Task creation failed: ${TASK_JSON}"
  exit 1
fi

log "  Sending first message (cold start)..."
MSG_JSON="$(api POST "/tasks/${TASK_ID}/messages" -d "{
  \"role\": \"user\",
  \"content\": \"${PROMPT}\"
}")"
MSG_ID="$(echo "${MSG_JSON}" | jq -r '.id // empty')"
if [[ -n "${MSG_ID}" ]]; then
  pass "First message sent: ${MSG_ID}"
else
  fail "First message send failed: ${MSG_JSON}"
fi

log "  Polling for assistant response (cold start may take up to 120s)..."
POLL_MAX=60
for i in $(seq 1 ${POLL_MAX}); do
  MSGS="$(api GET "/tasks/${TASK_ID}/messages")"
  ASSISTANT_MSG="$(echo "${MSGS}" | jq -r '[.items[]? // .[]? | select(.role=="assistant")] | last | .content // empty')"
  if [[ -n "${ASSISTANT_MSG}" ]]; then
    pass "Cold start: assistant responded"
    log "  Response: ${ASSISTANT_MSG}"
    break
  fi
  if [[ $i -eq ${POLL_MAX} ]]; then
    fail "Cold start: no assistant response after ${POLL_MAX} polls"
  fi
  sleep 3
done

# ───────────────────────────────────────────────────────────────
log "=== Phase 4: Multi-turn warm path ==="
log "  Sending second message (warm path)..."
WARM_START="$(date +%s%N)"
MSG2_JSON="$(api POST "/tasks/${TASK_ID}/messages" -d "{
  \"role\": \"user\",
  \"content\": \"reply exactly: warm path ok\"
}")"

for i in $(seq 1 30); do
  MSGS="$(api GET "/tasks/${TASK_ID}/messages")"
  ASSISTANT_COUNT="$(echo "${MSGS}" | jq '[.items[]? // .[]? | select(.role=="assistant")] | length')"
  if [[ "${ASSISTANT_COUNT}" -ge 2 ]]; then
    WARM_END="$(date +%s%N)"
    WARM_MS=$(( (WARM_END - WARM_START) / 1000000 ))
    pass "Warm path: assistant responded (${WARM_MS}ms total)"
    break
  fi
  if [[ $i -eq 30 ]]; then
    fail "Warm path: no second assistant response"
  fi
  sleep 2
done

# ───────────────────────────────────────────────────────────────
log "=== Phase 5: Agent presence check ==="
AGENT_FRESH="$(api GET "/agents/${AGENT_ID}")"
PRESENCE="$(echo "${AGENT_FRESH}" | jq -r '.presence // empty')"
log "  Agent presence: ${PRESENCE}"
if [[ "${PRESENCE}" == "online" ]]; then
  pass "Agent presence is 'online' while Pod active"
else
  fail "Agent presence is '${PRESENCE}', expected 'online'"
fi

# ───────────────────────────────────────────────────────────────
log "=== Phase 6: Archive task → release Pod ==="
ARCHIVE_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "${BASE}/tasks/${TASK_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"status": "archived"}')"
if [[ "${ARCHIVE_CODE}" == "200" ]]; then
  pass "Task archived (status=archived)"
else
  fail "Task archive returned ${ARCHIVE_CODE}"
fi

sleep 5

AGENT_POST_ARCHIVE="$(api GET "/agents/${AGENT_ID}")"
PRESENCE_POST="$(echo "${AGENT_POST_ARCHIVE}" | jq -r '.presence // empty')"
log "  Agent presence after archive: ${PRESENCE_POST}"
if [[ "${PRESENCE_POST}" == "managed" || "${PRESENCE_POST}" == "offline" ]]; then
  pass "Agent presence reverted after Pod release"
else
  log "  (info) presence=${PRESENCE_POST} — may need idle timeout for full transition"
fi

# ───────────────────────────────────────────────────────────────
log ""
log "================================================================"
log "  Sandbox Joint Integration Smoke Results"
log "  PASS: ${PASS}  FAIL: ${FAIL}"
log "  Report: ${REPORT_FILE}"
log "================================================================"

if [[ ${FAIL} -gt 0 ]]; then
  exit 1
fi
