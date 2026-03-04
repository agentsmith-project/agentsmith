#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT_API="${PORT_API:-20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
SANDBOX_MANAGER_URL="${SANDBOX_MANAGER_URL:-}"
SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY:-}"
GLM_MODEL="${GLM_MODEL:-GLM-5}"
RUNNER_LOG="${RUNNER_LOG:-/tmp/agentsmith_demo_runner.log}"
RUNNER_PID_FILE="${RUNNER_PID_FILE:-/tmp/agentsmith_demo_runner.pid}"
DEMO_REQUIRE_RUNNER="${DEMO_REQUIRE_RUNNER:-1}"

info() { echo "[demo-check] $*"; }
err() { echo "[demo-check] ERROR: $*" >&2; }

pid_is_alive() {
  local pid_file="$1"
  [[ -f "${pid_file}" ]] || return 1
  local pid
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  [[ -n "${pid}" ]] || return 1
  kill -0 "${pid}" 2>/dev/null
}

require_file() {
  local path="$1"
  [[ -f "${path}" ]] || { err "missing file: ${path}"; return 1; }
}

token_is_valid() {
  local token="$1"
  [[ -n "${token}" ]] || return 1
  local code
  code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      "${KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/userinfo" \
      -H "Authorization: Bearer ${token}" 2>/dev/null || true
  )"
  [[ "${code}" == "200" ]]
}

main() {
  info "running demo-status"
  (cd "${ROOT_DIR}" && make notebook-agent-demo-status)

  local token project_id agent_id endpoint_id ws_url agent_key
  require_file "${TOKEN_FILE}"
  require_file /tmp/agentsmith_project_id.txt
  require_file /tmp/agentsmith_agent_id.txt
  require_file /tmp/agentsmith_endpoint_id.txt
  require_file /tmp/agentsmith_ws_url.txt
  require_file /tmp/agentsmith_agent_key.txt

  token="$(cat "${TOKEN_FILE}")"
  project_id="$(cat /tmp/agentsmith_project_id.txt)"
  agent_id="$(cat /tmp/agentsmith_agent_id.txt)"
  endpoint_id="$(cat /tmp/agentsmith_endpoint_id.txt)"
  ws_url="$(cat /tmp/agentsmith_ws_url.txt)"
  agent_key="$(cat /tmp/agentsmith_agent_key.txt)"

  [[ -n "${token}" && -n "${project_id}" && -n "${agent_id}" && -n "${endpoint_id}" && -n "${ws_url}" && -n "${agent_key}" ]] || {
    err "one or more /tmp metadata files are empty"
    exit 1
  }
  if ! token_is_valid "${token}"; then
    err "token is invalid/expired; run: BASE_URL=http://localhost:3001 make notebook-agent-refresh-token"
    exit 1
  fi

  info "checking endpoint proxy reachability"
  local endpoint_get_code
  endpoint_get_code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      "http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}/endpoints/${endpoint_id}" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${endpoint_get_code}" == "404" ]]; then
    err "endpoint metadata is stale (endpoint ${endpoint_id} not found on current API instance)"
    err "re-run demo resource initialization: GLM_API_KEY='***' make notebook-agent-init-resources"
    exit 1
  fi
  if [[ "${endpoint_get_code}" != "200" ]]; then
    err "failed to read endpoint ${endpoint_id} (HTTP ${endpoint_get_code})"
    exit 1
  fi

  local proxy_code
  proxy_code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      "http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}/endpoints/${endpoint_id}/proxy/chat/completions" \
      -H "Authorization: Bearer ${token}" \
      -H 'Content-Type: application/json' \
      --data "$(node -e 'console.log(JSON.stringify({model:process.argv[1],messages:[{role:"user",content:"ping"}]}))' "${GLM_MODEL}")" || true
  )"
  if [[ "${proxy_code}" == "429" ]]; then
    info "endpoint proxy reachable but currently rate-limited (HTTP 429)"
  elif [[ "${proxy_code}" != "200" ]]; then
    err "endpoint proxy check failed (HTTP ${proxy_code}); verify endpoint configuration/upstream provider and API state"
    exit 1
  else
    info "endpoint proxy reachable (HTTP 200)"
  fi

  info "checking agent websocket metadata"
  if [[ "${ws_url}" != ws://localhost:${PORT_API}/api/v1/agent-runtime/ws\?agent_id=* ]]; then
    err "unexpected ws_url format: ${ws_url}"
    exit 1
  fi
  if [[ "${agent_key}" != ask_* ]]; then
    err "unexpected agent key format"
    exit 1
  fi
  info "agent metadata files look sane"

  if [[ "${DEMO_REQUIRE_RUNNER}" == "1" ]]; then
    if ! pid_is_alive "${RUNNER_PID_FILE}"; then
      err "managed runner is not running (${RUNNER_PID_FILE}); run: make notebook-agent-demo-up"
      exit 1
    fi
  fi

  if [[ -f "${RUNNER_LOG}" ]]; then
    if rg -q "\\[agent-codex-runner\\] connected|websocket open" "${RUNNER_LOG}" 2>/dev/null; then
      info "runner log shows websocket connected"
    else
      err "runner log does not show websocket connection (${RUNNER_LOG})"
      exit 1
    fi
    if rg -q "builtin_skills_mounted\"\\s*:\\s*\\[[^]]*\"source-read\"" "${RUNNER_LOG}" 2>/dev/null; then
      info "runner log shows source-read mounted"
    else
      info "runner log has no source-read mount evidence yet (expected before first task execution)"
    fi
  else
    info "runner log not found; skip runner log check (${RUNNER_LOG})"
  fi

  if [[ -n "${SANDBOX_MANAGER_URL}" || -n "${SANDBOX_SERVICE_KEY}" ]]; then
    if [[ -z "${SANDBOX_MANAGER_URL}" || -z "${SANDBOX_SERVICE_KEY}" ]]; then
      err "sandbox env is incomplete: SANDBOX_MANAGER_URL and SANDBOX_SERVICE_KEY must both be set"
      exit 1
    fi
    info "checking sandbox manager readyz"
    local sandbox_ready_code
    sandbox_ready_code="$(
      curl -sS -o /dev/null -w '%{http_code}' \
        "${SANDBOX_MANAGER_URL%/}/readyz" \
        -H "X-Service-Key: ${SANDBOX_SERVICE_KEY}" || true
    )"
    if [[ "${sandbox_ready_code}" != "200" ]]; then
      err "sandbox manager readyz failed (HTTP ${sandbox_ready_code})"
      exit 1
    fi
    info "sandbox manager readyz OK"
  else
    info "sandbox manager check skipped (optional integration not configured)"
  fi

  info "demo-check OK"
}

main "$@"
