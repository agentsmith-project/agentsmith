#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"
ensure_real_lane_state
ENV_FILE="${ROOT_DIR}/.env.local"

PORT_API="${PORT_API:-20000}"
PORT_WEB="${PORT_WEB:-3001}"
WEB_PORT="${PORT_WEB}"
WORKSPACE_ID="${WORKSPACE_ID:-$(state_get workspace.id ws_default)}"
LOCALE="${LOCALE:-zh-CN}"

KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:18080/realms}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"

MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
MINIO_PORT="${MINIO_PORT:-19000}"
MINIO_USE_SSL="${MINIO_USE_SSL:-false}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"
DATABASE_URL="${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:15432/mbos}"
REDIS_URL="${REDIS_URL:-redis://localhost:16379}"
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}"
MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"
PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL:-${PUBLIC_KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}}"
MBOS_UNIVERSAL_PROXY_BASE_URL="${MBOS_UNIVERSAL_PROXY_BASE_URL:-http://127.0.0.1:38080}"

DEMO_REFRESH_TOKEN="${DEMO_REFRESH_TOKEN:-1}"
DEMO_INIT_RESOURCES="${DEMO_INIT_RESOURCES:-1}"
DEMO_START_API="${DEMO_START_API:-1}"
DEMO_START_WEB="${DEMO_START_WEB:-1}"
DEMO_START_RUNNER="${DEMO_START_RUNNER:-1}"
DEMO_WEB_PORT_AUTO_FALLBACK="${DEMO_WEB_PORT_AUTO_FALLBACK:-1}"
DEMO_ALLOW_MISSING_EXECUTION_METADATA="${DEMO_ALLOW_MISSING_EXECUTION_METADATA:-0}"

API_LOG="${API_LOG:-$(real_lane_demo_log_file api)}"
WEB_LOG="${WEB_LOG:-$(real_lane_demo_log_file web)}"
RUNNER_LOG="${RUNNER_LOG:-$(real_lane_demo_log_file runner)}"
API_PID_FILE="${API_PID_FILE:-$(real_lane_demo_pid_file api)}"
WEB_PID_FILE="${WEB_PID_FILE:-$(real_lane_demo_pid_file web)}"
RUNNER_PID_FILE="${RUNNER_PID_FILE:-$(real_lane_demo_pid_file runner)}"

DEMO_ENDPOINT_API_KEY="${DEMO_ENDPOINT_API_KEY:-}"
DEMO_ENDPOINT_BASE_URL="${DEMO_ENDPOINT_BASE_URL:-}"
DEMO_ENDPOINT_MODEL="${DEMO_ENDPOINT_MODEL:-}"
DEMO_ENDPOINT_PROTOCOL="${DEMO_ENDPOINT_PROTOCOL:-}"
DEMO_ENDPOINT_MAX_CONTEXT_TOKENS="${DEMO_ENDPOINT_MAX_CONTEXT_TOKENS:-204800}"
DEMO_ENDPOINT_MAX_OUTPUT_TOKENS="${DEMO_ENDPOINT_MAX_OUTPUT_TOKENS:-8192}"
TOKEN_FILE="${TOKEN_FILE:-$(real_lane_token_file)}"
DEMO_REFRESH_TIMEOUT_SEC="${DEMO_REFRESH_TIMEOUT_SEC:-180}"
DEMO_REFRESH_TOKEN_FORCE="${DEMO_REFRESH_TOKEN_FORCE:-0}"

info() { echo "[demo-up] $*"; }
err() { echo "[demo-up] ERROR: $*" >&2; }

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
  info "loaded local env from ${ENV_FILE}"
fi

init_demo_resources() {
  if [[ -z "${DEMO_ENDPOINT_API_KEY}" || -z "${DEMO_ENDPOINT_BASE_URL}" || -z "${DEMO_ENDPOINT_MODEL}" || -z "${DEMO_ENDPOINT_PROTOCOL}" ]]; then
    err "resource re-init requires DEMO_ENDPOINT_* env"
    err "Example: DEMO_ENDPOINT_API_KEY='***' DEMO_ENDPOINT_BASE_URL='https://api.minimaxi.com/v1' DEMO_ENDPOINT_MODEL='MiniMax-M2.7-highspeed' DEMO_ENDPOINT_PROTOCOL='openai_compatible' make notebook-agent-demo-up"
    return 1
  fi
  info "initializing notebook demo resources (project/endpoint/agent/key)"
  (
    cd "${ROOT_DIR}" && \
    DEMO_ENDPOINT_API_KEY="${DEMO_ENDPOINT_API_KEY}" \
    DEMO_ENDPOINT_BASE_URL="${DEMO_ENDPOINT_BASE_URL}" \
    DEMO_ENDPOINT_MODEL="${DEMO_ENDPOINT_MODEL}" \
    DEMO_ENDPOINT_PROTOCOL="${DEMO_ENDPOINT_PROTOCOL}" \
    DEMO_ENDPOINT_MAX_CONTEXT_TOKENS="${DEMO_ENDPOINT_MAX_CONTEXT_TOKENS}" \
    DEMO_ENDPOINT_MAX_OUTPUT_TOKENS="${DEMO_ENDPOINT_MAX_OUTPUT_TOKENS}" \
    API_BASE="http://localhost:${PORT_API}" \
    WORKSPACE_ID="${WORKSPACE_ID}" \
    make notebook-agent-init-resources
  )
}

has_demo_execution_metadata() {
  [[ -s "${TOKEN_FILE}" ]] \
    && [[ -n "$(state_get project.id)" ]] \
    && [[ -n "$(state_get endpoint.id)" ]] \
    && [[ -n "$(state_get agent.id)" ]] \
    && [[ -n "$(state_get agent.key)" ]] \
    && [[ -n "$(state_get agent.ws_url)" ]]
}

launch_detached() {
  local pid_file="$1"
  local log_file="$2"
  local command="$3"

  : >"${log_file}"
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -lc "${command}" >>"${log_file}" 2>&1 < /dev/null &
  else
    nohup bash -lc "${command}" >>"${log_file}" 2>&1 < /dev/null &
  fi
  echo $! > "${pid_file}"
}

is_port_listening() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    if lsof -iTCP:"${port}" -sTCP:LISTEN -Pn >/dev/null 2>&1; then
      return 0
    fi
  fi
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn | grep -qE "[\\[\\]:*]${port}[[:space:]]"; then
      return 0
    fi
  fi
  return 1
}

find_available_web_port() {
  local start="${1:-3016}"
  local end="${2:-3035}"
  local p
  for p in $(seq "${start}" "${end}"); do
    if ! is_port_listening "${p}"; then
      echo "${p}"
      return 0
    fi
  done
  return 1
}

pid_is_alive() {
  local pid_file="$1"
  [[ -f "${pid_file}" ]] || return 1
  local pid
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  [[ -n "${pid}" ]] || return 1
  kill -0 "${pid}" >/dev/null 2>&1
}

infer_web_port_from_pid_file() {
  local pid_file="$1"
  pid_is_alive "${pid_file}" || return 1
  local pid args port
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  [[ -n "${pid}" ]] || return 1
  args="$(ps -p "${pid}" -o args= 2>/dev/null || true)"
  [[ -n "${args}" ]] || return 1
  port="$(printf '%s' "${args}" | sed -nE 's/.*--port[ =]([0-9]+).*/\1/p' | head -n1)"
  [[ -n "${port}" ]] || return 1
  printf '%s\n' "${port}"
}

post_start_validate_or_reuse_external() {
  local pid_file="$1"
  local port="$2"
  local label="$3"
  local log_file="$4"
  sleep 1
  if pid_is_alive "${pid_file}"; then
    return 0
  fi
  rm -f "${pid_file}"
  if is_port_listening "${port}"; then
    info "${label} start race: managed process exited but port ${port} is now in use; reusing external instance"
    return 0
  fi
  err "${label} failed to start (port ${port} not listening)"
  tail -n 120 "${log_file}" || true
  return 1
}

stop_pid_file_if_running() {
  local pid_file="$1"
  if ! pid_is_alive "${pid_file}"; then
    rm -f "${pid_file}"
    return 0
  fi
  local pid
  pid="$(cat "${pid_file}")"
  info "stopping managed process pid=${pid} (${pid_file})"
  kill "${pid}" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if kill -0 "${pid}" >/dev/null 2>&1; then
    kill -9 "${pid}" >/dev/null 2>&1 || true
  fi
  rm -f "${pid_file}"
}

wait_http_ready() {
  local url="$1"
  local label="$2"
  local max="${3:-60}"
  for i in $(seq 1 "${max}"); do
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${url}" || true)"
    if [[ "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ]]; then
      info "${label} ready (${url})"
      return 0
    fi
    sleep 1
  done
  err "${label} not ready in time (${url})"
  return 1
}

token_file_is_valid() {
  [[ -f "${TOKEN_FILE}" ]] || return 1
  local token
  token="$(cat "${TOKEN_FILE}" 2>/dev/null || true)"
  [[ -n "${token}" ]] || return 1
  local code
  code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      "${KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/userinfo" \
      -H "Authorization: Bearer ${token}" || true
  )"
  [[ "${code}" == "200" ]]
}

agent_presence_status() {
  [[ -n "$(state_get project.id)" ]] || return 1
  [[ -n "$(state_get agent.id)" ]] || return 1
  token_file_is_valid || return 1
  local token project_id agent_id body
  token="$(cat "${TOKEN_FILE}" 2>/dev/null || true)"
  project_id="$(state_get project.id)"
  agent_id="$(state_get agent.id)"
  [[ -n "${token}" && -n "${project_id}" && -n "${agent_id}" ]] || return 1
  body="$(
    curl -sS "http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}/agents/${agent_id}/diagnostics" \
      -H "Authorization: Bearer ${token}" || true
  )"
  printf '%s\n' "${body}" | sed -nE 's/.*"presence":"([^"]+)".*/\1/p' | head -n1
}

print_health_summary() {
  local api_status="down" web_status="down" runner_status="down" token_status="missing" presence="unknown"
  if curl -sS -o /dev/null -w '%{http_code}' "http://localhost:${PORT_API}/api/v1/openapi.json" | grep -q '^200$'; then
    api_status="ok"
  fi
  if curl -sS -o /dev/null -w '%{http_code}' "http://localhost:${WEB_PORT}/${LOCALE}/login" | grep -q '^200$'; then
    web_status="ok"
  fi
  if pid_is_alive "${RUNNER_PID_FILE}" || rg -q "\\[agent-codex-runner\\] connected|websocket open" "${RUNNER_LOG}" 2>/dev/null; then
    runner_status="ok"
  fi
  if token_file_is_valid; then
    token_status="valid"
  elif [[ -f "${TOKEN_FILE}" ]]; then
    token_status="invalid"
  fi
  presence="$(agent_presence_status || true)"
  [[ -n "${presence}" ]] || presence="unknown"
  info "Health:"
  info "  API    ${api_status}"
  info "  Web    ${web_status}"
  info "  Runner ${runner_status}"
  info "  Token  ${token_status}"
  info "  Agent  ${presence}"
}

refresh_runner_connection_metadata() {
  token_file_is_valid || {
    err "cannot refresh runner connection metadata without a valid demo token"
    return 1
  }
  local token project_id agent_id key_resp conn_resp new_key ws_url
  token="$(cat "${TOKEN_FILE}" 2>/dev/null || true)"
  project_id="$(state_get project.id)"
  agent_id="$(state_get agent.id)"
  if [[ -z "${token}" || -z "${project_id}" || -z "${agent_id}" ]]; then
    err "missing token/project/agent metadata; cannot refresh runner connection metadata"
    return 1
  fi

  info "refreshing existing agent runner key"
  key_resp="$(
    curl -sS -X POST \
      "http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}/agents/${agent_id}/keys" \
      -H "Authorization: Bearer ${token}" \
      -H 'Content-Type: application/json' \
      -d '{}' || true
  )"
  new_key="$(printf '%s' "${key_resp}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);if(typeof j.key==="string"&&j.key.trim()){process.stdout.write(j.key.trim());return;}process.exit(2)}catch{process.exit(2)}})' || true)"
  if [[ -z "${new_key}" ]]; then
    err "failed to refresh agent key"
    printf '%s\n' "${key_resp}" >&2
    return 1
  fi
  state_set_string agent.key "${new_key}"

  conn_resp="$(
    curl -sS \
      "http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}/agents/${agent_id}/connection-info" \
      -H "Authorization: Bearer ${token}" || true
  )"
  ws_url="$(printf '%s' "${conn_resp}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);if(typeof j.ws_url==="string"&&j.ws_url.trim()){process.stdout.write(j.ws_url.trim());return;}process.exit(2)}catch{process.exit(2)}})' || true)"
  if [[ -z "${ws_url}" ]]; then
    err "failed to refresh agent websocket url"
    printf '%s\n' "${conn_resp}" >&2
    return 1
  fi
  state_set_string agent.ws_url "${ws_url}"
  info "refreshed existing agent runner connection metadata"
}

start_api_if_needed() {
  if [[ "${DEMO_START_API}" == "0" ]]; then
    info "skipping API start (DEMO_START_API=0)"
    return 0
  fi
  if pid_is_alive "${API_PID_FILE}"; then
    info "managed API already running (pid=$(cat "${API_PID_FILE}"))"
    return 0
  fi
  if is_port_listening "${PORT_API}"; then
    info "API port ${PORT_API} already in use; assuming external API instance"
    return 0
  fi

  info "starting API on :${PORT_API} (log: ${API_LOG})"
  launch_detached "${API_PID_FILE}" "${API_LOG}" "
    cd '${ROOT_DIR}' && \
    exec env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
      PORT='${PORT_API}' \
      KEYCLOAK_BASE_URL='${KEYCLOAK_BASE_URL}' \
      KEYCLOAK_REALM='${KEYCLOAK_REALM}' \
      KEYCLOAK_CLIENT_ID='${KEYCLOAK_CLIENT_ID}' \
      PUBLIC_KEYCLOAK_BASE_URL='${PUBLIC_KEYCLOAK_BASE_URL}' \
      INTERNAL_KEYCLOAK_BASE_URL='${INTERNAL_KEYCLOAK_BASE_URL}' \
      KEYCLOAK_ISSUER_URL='${KEYCLOAK_ISSUER_URL}' \
      DATABASE_URL='${DATABASE_URL}' \
      REDIS_URL='${REDIS_URL}' \
      MONGO_URL='${MONGO_URL}' \
      MONGO_DB_NAME='${MONGO_DB_NAME}' \
      MINIO_ENDPOINT='${MINIO_ENDPOINT}' \
      MINIO_PORT='${MINIO_PORT}' \
      MINIO_USE_SSL='${MINIO_USE_SSL}' \
      MINIO_ACCESS_KEY='${MINIO_ACCESS_KEY}' \
      MINIO_SECRET_KEY='${MINIO_SECRET_KEY}' \
      MINIO_BUCKET='${MINIO_BUCKET}' \
      MBOS_UNIVERSAL_PROXY_BASE_URL='${MBOS_UNIVERSAL_PROXY_BASE_URL}' \
      DEBUG_AGENT_EXECUTION='${DEBUG_AGENT_EXECUTION:-1}' \
      DEBUG_ENDPOINT_PROXY='${DEBUG_ENDPOINT_PROXY:-0}' \
      DEBUG_NOTEBOOK_EXECUTION='${DEBUG_NOTEBOOK_EXECUTION:-0}' \
      npm run api:node:dev
  "
  post_start_validate_or_reuse_external "${API_PID_FILE}" "${PORT_API}" "API" "${API_LOG}"
}

start_web_if_needed() {
  local target_port="${WEB_PORT}"
  if [[ "${DEMO_START_WEB}" == "0" ]]; then
    info "skipping Web start (DEMO_START_WEB=0)"
    return 0
  fi
  if pid_is_alive "${WEB_PID_FILE}"; then
    local inferred_port
    inferred_port="$(infer_web_port_from_pid_file "${WEB_PID_FILE}" || true)"
    if [[ -n "${inferred_port}" ]]; then
      WEB_PORT="${inferred_port}"
      info "managed Web already running (pid=$(cat "${WEB_PID_FILE}"), port=${WEB_PORT})"
    else
      info "managed Web already running (pid=$(cat "${WEB_PID_FILE}"))"
    fi
    return 0
  fi
  if is_port_listening "${target_port}"; then
    info "Web port ${target_port} already in use; assuming external Web instance"
    return 0
  fi

  info "starting Web on :${target_port} (log: ${WEB_LOG})"
  launch_detached "${WEB_PID_FILE}" "${WEB_LOG}" "
    cd '${ROOT_DIR}' && \
    exec env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
      NEXT_PUBLIC_USE_MSW=false \
      NEXT_PUBLIC_API_BASE='http://localhost:${PORT_API}/api/v1' \
      NEXT_PUBLIC_KEYCLOAK_URL='${KEYCLOAK_URL}' \
      NEXT_PUBLIC_KEYCLOAK_REALM='${KEYCLOAK_REALM}' \
      NEXT_PUBLIC_KEYCLOAK_CLIENT_ID='${KEYCLOAK_CLIENT_ID}' \
      KEYCLOAK_BASE_URL='${KEYCLOAK_BASE_URL}' \
      PUBLIC_KEYCLOAK_BASE_URL='${PUBLIC_KEYCLOAK_BASE_URL}' \
      INTERNAL_KEYCLOAK_BASE_URL='${INTERNAL_KEYCLOAK_BASE_URL}' \
      MONGO_URL='${MONGO_URL}' \
      MONGO_DB_NAME='${MONGO_DB_NAME}' \
      npm run dev:test -- --port '${target_port}'
  "
  if post_start_validate_or_reuse_external "${WEB_PID_FILE}" "${target_port}" "Web" "${WEB_LOG}"; then
    WEB_PORT="${target_port}"
    return 0
  fi
  if [[ "${DEMO_WEB_PORT_AUTO_FALLBACK}" != "1" ]] || ! rg -q "EADDRINUSE" "${WEB_LOG}" 2>/dev/null; then
    return 1
  fi
  local fallback_port
  fallback_port="$(find_available_web_port 3016 3035 || true)"
  if [[ -z "${fallback_port}" ]]; then
    err "Web startup failed on :${target_port} and no fallback port available"
    tail -n 120 "${WEB_LOG}" || true
    return 1
  fi
  info "Web port ${target_port} busy; retrying on :${fallback_port}"
  target_port="${fallback_port}"
  launch_detached "${WEB_PID_FILE}" "${WEB_LOG}" "
    cd '${ROOT_DIR}' && \
    exec env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
      NEXT_PUBLIC_USE_MSW=false \
      NEXT_PUBLIC_API_BASE='http://localhost:${PORT_API}/api/v1' \
      NEXT_PUBLIC_KEYCLOAK_URL='${KEYCLOAK_URL}' \
      NEXT_PUBLIC_KEYCLOAK_REALM='${KEYCLOAK_REALM}' \
      NEXT_PUBLIC_KEYCLOAK_CLIENT_ID='${KEYCLOAK_CLIENT_ID}' \
      KEYCLOAK_BASE_URL='${KEYCLOAK_BASE_URL}' \
      PUBLIC_KEYCLOAK_BASE_URL='${PUBLIC_KEYCLOAK_BASE_URL}' \
      INTERNAL_KEYCLOAK_BASE_URL='${INTERNAL_KEYCLOAK_BASE_URL}' \
      MONGO_URL='${MONGO_URL}' \
      MONGO_DB_NAME='${MONGO_DB_NAME}' \
      npm run dev:test -- --port '${target_port}'
  "
  post_start_validate_or_reuse_external "${WEB_PID_FILE}" "${target_port}" "Web" "${WEB_LOG}"
  WEB_PORT="${target_port}"
}

restart_demo_runner() {
  [[ "${DEMO_START_RUNNER}" == "1" ]] || { info "skipping runner start (DEMO_START_RUNNER=0)"; return 0; }
  stop_pid_file_if_running "${RUNNER_PID_FILE}"

  local ws_url agent_key
  ws_url="${AGENT_WS_URL:-$(state_get agent.ws_url)}"
  agent_key="${AGENT_KEY:-$(state_get agent.key)}"
  if [[ -z "${ws_url}" || -z "${agent_key}" ]]; then
    err "missing ws url / agent key (run init resources first)"
    return 1
  fi

  info "starting managed notebook agent runner (log: ${RUNNER_LOG})"
  launch_detached "${RUNNER_PID_FILE}" "${RUNNER_LOG}" "
    cd '${ROOT_DIR}' && \
    exec env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
      MBOS_AGENT_WS_URL='${ws_url}' \
      MBOS_AGENT_KEY='${agent_key}' \
      MBOS_AGENT_BUILTIN_SKILLS_DIR='${MBOS_AGENT_BUILTIN_SKILLS_DIR:-${ROOT_DIR}/packages/agent-codex-runner/builtin-skills}' \
      MBOS_AGENT_BUILTIN_SKILLS='${MBOS_AGENT_BUILTIN_SKILLS:-.system,feishu-docs,jira-ops}' \
      MBOS_AGENT_BUILTIN_SKILLS_REQUIRED='${MBOS_AGENT_BUILTIN_SKILLS_REQUIRED:-1}' \
      MBOS_AGENT_RUNNER_DEBUG='${MBOS_AGENT_RUNNER_DEBUG:-1}' \
      MBOS_AGENT_CODEX_YOLO='${MBOS_AGENT_CODEX_YOLO:-1}' \
      npm run agent:codex-runner
  "

  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if rg -q "\\[agent-codex-runner\\] connected|websocket open" "${RUNNER_LOG}" 2>/dev/null; then
      info "runner websocket connected"
      return 0
    fi
    if rg -q "Unexpected server response: 401|invalid_key|401" "${RUNNER_LOG}" 2>/dev/null; then
      err "runner authentication failed (401/invalid_key)"
      tail -n 80 "${RUNNER_LOG}" || true
      return 42
    fi
    sleep 1
  done
  err "runner did not connect in time; tailing log"
  tail -n 120 "${RUNNER_LOG}" || true
  return 1
}

main() {
  start_api_if_needed
  start_web_if_needed

  wait_http_ready "http://localhost:${PORT_API}/api/v1/openapi.json" "API" 90
  wait_http_ready "http://localhost:${WEB_PORT}/${LOCALE}/login" "Web" 120

  if [[ "${DEMO_REFRESH_TOKEN}" == "1" ]]; then
    if [[ "${DEMO_REFRESH_TOKEN_FORCE}" != "1" ]] && token_file_is_valid; then
      info "reusing existing valid demo token (${TOKEN_FILE})"
    else
      if [[ "${WEB_PORT}" != "3001" ]]; then
        err "cannot refresh token via PKCE on Web port ${WEB_PORT} with current Keycloak client redirect settings"
        err "either free port 3001, configure Keycloak client redirect URI for http://localhost:${WEB_PORT}/${LOCALE}/login/callback, or provide a valid existing token"
        exit 1
      fi
      info "refreshing notebook demo token"
      if ! (
        cd "${ROOT_DIR}" && \
        timeout "${DEMO_REFRESH_TIMEOUT_SEC}"s env \
          BASE_URL="http://localhost:${WEB_PORT}" \
          LOCALE="${LOCALE}" \
          KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
          KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
          KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
          make notebook-agent-refresh-token
      ); then
        if token_file_is_valid; then
          info "token refresh failed/timed out; continuing with existing valid token (${TOKEN_FILE})"
        else
          err "token refresh failed and no valid fallback token is available"
          exit 1
        fi
      elif token_file_is_valid; then
        info "refreshed demo token is valid"
      else
        info "refreshed token did not validate; retrying once"
        if ! (
          cd "${ROOT_DIR}" && \
          timeout "${DEMO_REFRESH_TIMEOUT_SEC}"s env \
            BASE_URL="http://localhost:${WEB_PORT}" \
            LOCALE="${LOCALE}" \
            KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
            KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
            KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
            make notebook-agent-refresh-token
        ); then
          err "token refresh retry failed"
          exit 1
        fi
        if ! token_file_is_valid; then
          err "refreshed token is still invalid after retry"
          exit 1
        fi
        info "refreshed demo token is valid after retry"
      fi
    fi
  fi

  if [[ "${DEMO_INIT_RESOURCES}" == "1" ]]; then
    init_demo_resources || exit 1
  elif ! has_demo_execution_metadata; then
    if [[ "${DEMO_ALLOW_MISSING_EXECUTION_METADATA}" == "1" ]]; then
      info "execution metadata missing; continuing without demo resources because DEMO_ALLOW_MISSING_EXECUTION_METADATA=1"
    else
      info "execution metadata missing; forcing one-time resource init even though DEMO_INIT_RESOURCES=0"
      init_demo_resources || exit 1
    fi
  fi

  restart_demo_runner || {
    rc=$?
    if [[ "${rc}" == "42" ]]; then
      info "detected stale/invalid runner key; refreshing existing runner metadata first"
      if refresh_runner_connection_metadata; then
        restart_demo_runner || exit $?
      fi
      info "runner metadata refresh unavailable or failed; forcing one-time resource re-init and retry"
      init_demo_resources || exit 1
      restart_demo_runner || exit $?
    else
      exit "${rc}"
    fi
  }

  local project_id agent_id
  project_id="$(state_get project.id)"
  agent_id="$(state_get agent.id)"

  info "demo environment ready"
  info "API:  http://localhost:${PORT_API}"
  info "Web:  http://localhost:${WEB_PORT}/${LOCALE}/login"
  if [[ -n "${project_id}" ]]; then
    info "Notebook: http://localhost:${WEB_PORT}/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${project_id}/notebook"
  fi
  if [[ -n "${agent_id}" ]]; then
    info "Agent ID: ${agent_id}"
  fi
  info "Logs:"
  info "  API    ${API_LOG}"
  info "  Web    ${WEB_LOG}"
  info "  Runner ${RUNNER_LOG}"
  print_health_summary
  info "Stop with: make notebook-agent-demo-down"
}

main "$@"
for legacy_key in GLM_API_KEY GLM_BASE_URL GLM_MODEL ENDPOINT_PROTOCOL; do
  if [[ -n "${!legacy_key:-}" ]]; then
    err "legacy env var is not supported: ${legacy_key}"
    err "use DEMO_ENDPOINT_API_KEY / DEMO_ENDPOINT_BASE_URL / DEMO_ENDPOINT_MODEL / DEMO_ENDPOINT_PROTOCOL"
    exit 1
  fi
done
