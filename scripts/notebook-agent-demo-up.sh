#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

PORT_API="${PORT_API:-20000}"
PORT_WEB="${PORT_WEB:-3001}"
WEB_PORT="${PORT_WEB}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
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

DEMO_REFRESH_TOKEN="${DEMO_REFRESH_TOKEN:-1}"
DEMO_INIT_RESOURCES="${DEMO_INIT_RESOURCES:-1}"
DEMO_START_API="${DEMO_START_API:-1}"
DEMO_START_WEB="${DEMO_START_WEB:-1}"
DEMO_START_RUNNER="${DEMO_START_RUNNER:-1}"
DEMO_WEB_PORT_AUTO_FALLBACK="${DEMO_WEB_PORT_AUTO_FALLBACK:-1}"

API_LOG="${API_LOG:-/tmp/agentsmith_demo_api.log}"
WEB_LOG="${WEB_LOG:-/tmp/agentsmith_demo_web.log}"
RUNNER_LOG="${RUNNER_LOG:-/tmp/agentsmith_demo_runner.log}"
API_PID_FILE="${API_PID_FILE:-/tmp/agentsmith_demo_api.pid}"
WEB_PID_FILE="${WEB_PID_FILE:-/tmp/agentsmith_demo_web.pid}"
RUNNER_PID_FILE="${RUNNER_PID_FILE:-/tmp/agentsmith_demo_runner.pid}"

GLM_API_KEY="${GLM_API_KEY:-}"
GLM_BASE_URL="${GLM_BASE_URL:-https://open.bigmodel.cn/api/coding/paas/v4}"
GLM_MODEL="${GLM_MODEL:-glm-5}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
DEMO_REFRESH_TIMEOUT_SEC="${DEMO_REFRESH_TIMEOUT_SEC:-180}"
DEMO_REFRESH_TOKEN_FORCE="${DEMO_REFRESH_TOKEN_FORCE:-0}"

info() { echo "[demo-up] $*"; }
err() { echo "[demo-up] ERROR: $*" >&2; }

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

wait_http_200() {
  local url="$1"
  local label="$2"
  local max="${3:-60}"
  for i in $(seq 1 "${max}"); do
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${url}" || true)"
    if [[ "${code}" == "200" ]]; then
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
  [[ -f "/tmp/agentsmith_project_id.txt" ]] || return 1
  [[ -f "/tmp/agentsmith_agent_id.txt" ]] || return 1
  token_file_is_valid || return 1
  local token project_id agent_id body
  token="$(cat "${TOKEN_FILE}" 2>/dev/null || true)"
  project_id="$(cat /tmp/agentsmith_project_id.txt 2>/dev/null || true)"
  agent_id="$(cat /tmp/agentsmith_agent_id.txt 2>/dev/null || true)"
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
      MINIO_ENDPOINT='${MINIO_ENDPOINT}' \
      MINIO_PORT='${MINIO_PORT}' \
      MINIO_USE_SSL='${MINIO_USE_SSL}' \
      MINIO_ACCESS_KEY='${MINIO_ACCESS_KEY}' \
      MINIO_SECRET_KEY='${MINIO_SECRET_KEY}' \
      MINIO_BUCKET='${MINIO_BUCKET}' \
      DEBUG_AGENT_RUNTIME='${DEBUG_AGENT_RUNTIME:-1}' \
      DEBUG_ENDPOINT_PROXY='${DEBUG_ENDPOINT_PROXY:-0}' \
      DEBUG_NOTEBOOK_RUNTIME='${DEBUG_NOTEBOOK_RUNTIME:-0}' \
      AGENT_RUNTIME_REQUEST_TIMEOUT_MS='${AGENT_RUNTIME_REQUEST_TIMEOUT_MS:-180000}' \
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
      npm run dev:test -- --port '${target_port}'
  "
  post_start_validate_or_reuse_external "${WEB_PID_FILE}" "${target_port}" "Web" "${WEB_LOG}"
  WEB_PORT="${target_port}"
}

restart_demo_runner() {
  [[ "${DEMO_START_RUNNER}" == "1" ]] || { info "skipping runner start (DEMO_START_RUNNER=0)"; return 0; }
  stop_pid_file_if_running "${RUNNER_PID_FILE}"

  local ws_url agent_key
  ws_url="${AGENT_WS_URL:-$(cat /tmp/agentsmith_ws_url.txt 2>/dev/null || true)}"
  agent_key="${AGENT_KEY:-$(cat /tmp/agentsmith_agent_key.txt 2>/dev/null || true)}"
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
      MBOS_AGENT_RUNNER_DEBUG='${MBOS_AGENT_RUNNER_DEBUG:-1}' \
      MBOS_AGENT_TASK_TIMEOUT_SEC='${MBOS_AGENT_TASK_TIMEOUT_SEC:-120}' \
      MBOS_AGENT_CODEX_YOLO='${MBOS_AGENT_CODEX_YOLO:-1}' \
      npm run agent:codex-runner
  "

  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if rg -q "\\[agent-codex-runner\\] connected|websocket open" "${RUNNER_LOG}" 2>/dev/null; then
      info "runner websocket connected"
      return 0
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

  wait_http_200 "http://localhost:${PORT_API}/api/v1/openapi.json" "API" 90
  wait_http_200 "http://localhost:${WEB_PORT}/${LOCALE}/login" "Web" 120

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
    if [[ -z "${GLM_API_KEY}" ]]; then
      err "GLM_API_KEY is required when DEMO_INIT_RESOURCES=1"
      err "Example: GLM_API_KEY='***' make notebook-agent-demo-up"
      exit 1
    fi
    info "initializing notebook demo resources (project/endpoint/agent/key)"
    (
      cd "${ROOT_DIR}" && \
      GLM_API_KEY="${GLM_API_KEY}" \
      GLM_BASE_URL="${GLM_BASE_URL}" \
      GLM_MODEL="${GLM_MODEL}" \
      API_BASE="http://localhost:${PORT_API}" \
      WORKSPACE_ID="${WORKSPACE_ID}" \
      make notebook-agent-init-resources
    )
  fi

  restart_demo_runner

  local project_id agent_id
  project_id="$(cat /tmp/agentsmith_project_id.txt 2>/dev/null || true)"
  agent_id="$(cat /tmp/agentsmith_agent_id.txt 2>/dev/null || true)"

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
