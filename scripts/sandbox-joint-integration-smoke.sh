#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Agent Task Sandbox — Joint Integration Smoke
#
# Executes the checklist from:
#   docs/plans/internal-agent-sandbox-joint-dev-checklist.md
#
# Prerequisites:
#   - make sandbox-preflight passes
#   - make agent-runner-refresh-token has been run (token exists)
#   - A managed Agent Runner has been created (AGENT_RUNNER_ID set or cached)
#
# Usage:
#   SANDBOX_MANAGER_URL=http://... SANDBOX_SERVICE_KEY=sk_xxx \
#     AGENT_RUNNER_ID=agr_xxx PROJECT_ID=proj_xxx \
#     ./scripts/sandbox-joint-integration-smoke.sh
# ---------------------------------------------------------------------------
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
ensure_backend_real_state

API_BASE="${API_BASE:-http://localhost:20000}"
WORKSPACE_ID="${WORKSPACE_ID:-$(state_get workspace.id ws_default)}"
TOKEN_FILE="${TOKEN_FILE:-$(backend_real_token_file)}"
PROJECT_ID="${PROJECT_ID:-$(state_get project.id)}"
AGENT_RUNNER_ID="${AGENT_RUNNER_ID:-$(state_get agent_runner.id)}"
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

if [[ -z "${PROJECT_ID}" || -z "${AGENT_RUNNER_ID}" ]]; then
  log "Missing PROJECT_ID or AGENT_RUNNER_ID"
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
log "=== Phase 1: Verify managed Agent Runner exists ==="
AGENT_RUNNER_JSON="$(api GET "/agent-runners/${AGENT_RUNNER_ID}")"
AGENT_RUNNER_DEFAULT_ENDPOINT="$(echo "${AGENT_RUNNER_JSON}" | jq -r '.default_endpoint_id // empty')"
if [[ -n "${AGENT_RUNNER_DEFAULT_ENDPOINT}" ]]; then
  pass "Agent Runner ${AGENT_RUNNER_ID} has default endpoint ${AGENT_RUNNER_DEFAULT_ENDPOINT}"
else
  fail "Agent Runner ${AGENT_RUNNER_ID} is missing default endpoint"
  log "Agent Runner response: ${AGENT_RUNNER_JSON}"
  exit 1
fi

LEAKED_KEY="$(echo "${AGENT_RUNNER_JSON}" | jq -r '.. | objects | ._internal_raw_key? // empty' | head -n1)"
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
log "=== Phase 3: Create agent-task → cold start ==="
TASK_JSON="$(api POST "/tasks" -d "{
  \"title\": \"Sandbox integration smoke $(date +%H%M%S)\"
}")"
TASK_ID="$(echo "${TASK_JSON}" | jq -r '.id // empty')"
if [[ -n "${TASK_ID}" ]]; then
  pass "Task created: ${TASK_ID}"
else
  fail "Task creation failed: ${TASK_JSON}"
  exit 1
fi

log "  Starting first run (cold start)..."
RUN_JSON="$(api POST "/tasks/${TASK_ID}/runs" -d "{
  \"intent\": \"${PROMPT}\"
}")"
RUN_ACTIVITY_ID="$(echo "${RUN_JSON}" | jq -r '.id // empty')"
if [[ -n "${RUN_ACTIVITY_ID}" ]]; then
  pass "First run started: ${RUN_ACTIVITY_ID}"
else
  fail "First run start failed: ${RUN_JSON}"
fi

log "  Polling for runner output (cold start may take up to 120s)..."
POLL_MAX=60
for i in $(seq 1 ${POLL_MAX}); do
  ACTIVITY="$(api GET "/tasks/${TASK_ID}/activity")"
  RUNNER_OUTPUT="$(echo "${ACTIVITY}" | jq -r '[.items[]? // .[]? | select(.actor=="runner" and .kind=="runner_output")] | last | .content // empty')"
  if [[ -n "${RUNNER_OUTPUT}" ]]; then
    pass "Cold start: runner produced output"
    log "  Response: ${RUNNER_OUTPUT}"
    break
  fi
  if [[ $i -eq ${POLL_MAX} ]]; then
    fail "Cold start: no runner output after ${POLL_MAX} polls"
  fi
  sleep 3
done

# ───────────────────────────────────────────────────────────────
log "=== Phase 4: Multi-turn warm path ==="
log "  Starting second run (warm path)..."
WARM_START="$(date +%s%N)"
RUN2_JSON="$(api POST "/tasks/${TASK_ID}/runs" -d "{
  \"intent\": \"reply exactly: warm path ok\"
}")"

for i in $(seq 1 30); do
  ACTIVITY="$(api GET "/tasks/${TASK_ID}/activity")"
  RUNNER_OUTPUT_COUNT="$(echo "${ACTIVITY}" | jq '[.items[]? // .[]? | select(.actor=="runner" and .kind=="runner_output")] | length')"
  if [[ "${RUNNER_OUTPUT_COUNT}" -ge 2 ]]; then
    WARM_END="$(date +%s%N)"
    WARM_MS=$(( (WARM_END - WARM_START) / 1000000 ))
    pass "Warm path: runner produced output (${WARM_MS}ms total)"
    break
  fi
  if [[ $i -eq 30 ]]; then
    fail "Warm path: no second runner output"
  fi
  sleep 2
done

# ───────────────────────────────────────────────────────────────
log "=== Phase 5: Agent Runner presence check ==="
AGENT_RUNNER_DIAGNOSTICS="$(api GET "/agent-runners/${AGENT_RUNNER_ID}/diagnostics")"
PRESENCE="$(echo "${AGENT_RUNNER_DIAGNOSTICS}" | jq -r '.presence // empty')"
log "  Agent Runner presence: ${PRESENCE}"
if [[ "${PRESENCE}" == "online" || "${PRESENCE}" == "managed" ]]; then
  pass "Agent Runner presence is '${PRESENCE}' while task is active"
else
  fail "Agent Runner presence is '${PRESENCE}', expected online or managed"
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

AGENT_RUNNER_POST_ARCHIVE="$(api GET "/agent-runners/${AGENT_RUNNER_ID}/diagnostics")"
PRESENCE_POST="$(echo "${AGENT_RUNNER_POST_ARCHIVE}" | jq -r '.presence // empty')"
log "  Agent Runner presence after archive: ${PRESENCE_POST}"
if [[ "${PRESENCE_POST}" == "managed" || "${PRESENCE_POST}" == "offline" ]]; then
  pass "Agent Runner presence settled after task release"
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
