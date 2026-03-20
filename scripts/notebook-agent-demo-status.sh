#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"
ensure_real_lane_state

PORT_API="${PORT_API:-20000}"
LOCALE="${LOCALE:-zh-CN}"
PORT_WEB_DEFAULT="${PORT_WEB:-3001}"
WORKSPACE_ID="${WORKSPACE_ID:-$(state_get workspace.id ws_default)}"
TOKEN_FILE="${TOKEN_FILE:-$(real_lane_token_file)}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"

API_PID_FILE="${API_PID_FILE:-/tmp/agentsmith_demo_api.pid}"
WEB_PID_FILE="${WEB_PID_FILE:-/tmp/agentsmith_demo_web.pid}"
RUNNER_PID_FILE="${RUNNER_PID_FILE:-/tmp/agentsmith_demo_runner.pid}"
WEB_LOG="${WEB_LOG:-/tmp/agentsmith_demo_web.log}"
RUNNER_LOG="${RUNNER_LOG:-/tmp/agentsmith_demo_runner.log}"

info() { echo "[demo-status] $*"; }

pid_status() {
  local pid_file="$1"
  local label="$2"
  if [[ ! -f "${pid_file}" ]]; then
    info "${label}: none"
    return 0
  fi
  local pid
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]]; then
    info "${label}: invalid-pid-file"
    return 0
  fi
  if kill -0 "${pid}" >/dev/null 2>&1; then
    info "${label}: alive pid=${pid}"
  else
    info "${label}: dead pid=${pid}"
  fi
}

infer_web_port() {
  if [[ -f "${WEB_PID_FILE}" ]]; then
    local pid args port
    pid="$(cat "${WEB_PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      args="$(ps -p "${pid}" -o args= 2>/dev/null || true)"
      port="$(printf '%s' "${args}" | sed -nE 's/.*--port[ =]([0-9]+).*/\1/p' | head -n1)"
      if [[ -n "${port}" ]]; then
        printf '%s\n' "${port}"
        return 0
      fi
    fi
  fi
  printf '%s\n' "${PORT_WEB_DEFAULT}"
}

http_status() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' "${url}" 2>/dev/null || true
}

token_status() {
  if [[ ! -f "${TOKEN_FILE}" ]]; then
    info "Token: missing"
    return 0
  fi
  local token code
  token="$(cat "${TOKEN_FILE}" 2>/dev/null || true)"
  if [[ -z "${token}" ]]; then
    info "Token: empty"
    return 0
  fi
  code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      "${KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/userinfo" \
      -H "Authorization: Bearer ${token}" 2>/dev/null || true
  )"
  if [[ "${code}" == "200" ]]; then
    info "Token: valid"
  else
    info "Token: invalid (userinfo ${code:-n/a})"
  fi
}

agent_status() {
  local project_id agent_id token
  project_id="$(state_get project.id)"
  agent_id="$(state_get agent.id)"
  token="$(cat "${TOKEN_FILE}" 2>/dev/null || true)"
  if [[ -z "${project_id}" || -z "${agent_id}" || -z "${token}" ]]; then
    info "Agent: unknown (missing token/project/agent metadata)"
    return 0
  fi
  local body presence
  body="$(
    curl -sS "http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}/agents/${agent_id}/diagnostics" \
      -H "Authorization: Bearer ${token}" 2>/dev/null || true
  )"
  presence="$(printf '%s' "${body}" | sed -nE 's/.*"presence":"([^"]+)".*/\1/p' | head -n1)"
  if [[ -n "${presence}" ]]; then
    info "Agent: ${presence} (${agent_id})"
  else
    info "Agent: unknown"
  fi
}

main() {
  local web_port
  web_port="$(infer_web_port)"

  info "PID status"
  pid_status "${API_PID_FILE}" "API"
  pid_status "${WEB_PID_FILE}" "Web"
  pid_status "${RUNNER_PID_FILE}" "Runner"

  info "HTTP health"
  info "API openapi: $(http_status "http://localhost:${PORT_API}/api/v1/openapi.json")"
  info "Web login (${web_port}): $(http_status "http://localhost:${web_port}/${LOCALE}/login")"

  token_status
  agent_status

  if [[ -f "${RUNNER_LOG}" ]]; then
    info "Runner log tail:"
    tail -n 10 "${RUNNER_LOG}" | sed 's/^/[demo-status]   /'
  fi
  if [[ -f "${WEB_LOG}" ]]; then
    info "Web log tail:"
    tail -n 5 "${WEB_LOG}" | sed 's/^/[demo-status]   /'
  fi
}

main "$@"
