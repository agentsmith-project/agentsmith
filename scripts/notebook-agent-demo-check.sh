#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT_API="${PORT_API:-20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"

info() { echo "[demo-check] $*"; }
err() { echo "[demo-check] ERROR: $*" >&2; }

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
      --data '{"model":"glm-4.7","messages":[{"role":"user","content":"ping"}]}' || true
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

  info "demo-check OK"
}

main "$@"
