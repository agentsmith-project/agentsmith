#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MOCK_STATE_DIR="${ROOT_DIR}/artifacts/mock-lane/current"
mkdir -p "${MOCK_STATE_DIR}"
PORT_WEB="${PORT_WEB:-3001}"
BASE_URL="http://127.0.0.1:${PORT_WEB}"
HEALTH_URL="${BASE_URL}/zh-CN/login"
WARM_URLS_DEFAULT=$'/zh-CN/login\n/en-US/login/workspace\n/en-US/workspaces/overview\n/en-US/workspaces/ws_default/projects/proj_001/files'

PID_FILE="${MOCK_STATE_DIR}/web.pid"
LOG_FILE="${MOCK_STATE_DIR}/web.log"
MOCK_WORKSPACE_PROVISIONING_PATH="artifacts/system-workspace-provisioning.mock"
STARTED_BY_SCRIPT=0
LAST_PLAYWRIGHT_LOG=""
MAX_ATTEMPTS="${MOCK_LANE_MAX_ATTEMPTS:-3}"

info() { echo "[mock-lane] $*"; }
err() { echo "[mock-lane] ERROR: $*" >&2; }

reset_next_dev_artifacts_if_corrupt() {
  if grep -q "Cannot find module './vendor-chunks/next.js'" "${LOG_FILE}" 2>/dev/null; then
    info "detected corrupted Next.js dev artifacts; clearing .next before retry"
    rm -rf "${ROOT_DIR}/.next"
  fi
}

cleanup() {
  if [[ "${STARTED_BY_SCRIPT}" == "1" ]] && [[ -f "${PID_FILE}" ]]; then
    local pid
    pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
      sleep 1
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
    rm -f "${PID_FILE}"
  fi
  rm -rf "${ROOT_DIR}/${MOCK_WORKSPACE_PROVISIONING_PATH}"
}
trap cleanup EXIT

is_server_alive() {
  if [[ ! -f "${PID_FILE}" ]]; then
    is_port_listening
    return $?
  fi
  local pid
  pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]]; then
    is_port_listening
    return $?
  fi
  if kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi
  is_port_listening
}

is_port_listening() {
  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"${PORT_WEB}" -sTCP:LISTEN -Pn >/dev/null 2>&1; then
    return 0
  fi
  if command -v ss >/dev/null 2>&1 && ss -ltn | grep -qE "[\\[\\]:*]${PORT_WEB}[[:space:]]"; then
    return 0
  fi
  if command -v fuser >/dev/null 2>&1 && fuser -n tcp "${PORT_WEB}" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

is_port_listening_value() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"${port}" -sTCP:LISTEN -Pn >/dev/null 2>&1; then
    return 0
  fi
  if command -v ss >/dev/null 2>&1 && ss -ltn | grep -qE "[\\[\\]:*]${port}[[:space:]]"; then
    return 0
  fi
  if command -v fuser >/dev/null 2>&1 && fuser -n tcp "${port}" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

kill_port_listeners() {
  local pids=""
  local lsof_pids=""
  local fuser_pids=""
  if command -v lsof >/dev/null 2>&1; then
    lsof_pids="$(lsof -tiTCP:${PORT_WEB} -sTCP:LISTEN -Pn 2>/dev/null || true)"
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser_pids="$(fuser -n tcp "${PORT_WEB}" 2>/dev/null | tr ' ' '\n' || true)"
  fi
  pids="$(printf '%s\n%s\n' "${lsof_pids}" "${fuser_pids}" | awk 'NF && !seen[$0]++')"
  if [[ -z "${pids}" ]]; then
    return 0
  fi
  info "stopping existing listener(s) on :${PORT_WEB}: ${pids//$'\n'/ }"
  while IFS= read -r pid; do
    [[ -z "${pid}" ]] && continue
    kill "${pid}" >/dev/null 2>&1 || true
  done <<< "${pids}"
  sleep 1
  while IFS= read -r pid; do
    [[ -z "${pid}" ]] && continue
    kill -9 "${pid}" >/dev/null 2>&1 || true
  done <<< "${pids}"
}

pick_free_port() {
  local candidate="${PORT_WEB}"
  if ! is_port_listening_value "${candidate}"; then
    echo "${candidate}"
    return 0
  fi

  for candidate in $(seq 3010 3099); do
    if ! is_port_listening_value "${candidate}"; then
      echo "${candidate}"
      return 0
    fi
  done
  return 1
}

rebind_urls_for_port() {
  local port="$1"
  PORT_WEB="${port}"
  BASE_URL="http://127.0.0.1:${PORT_WEB}"
  HEALTH_URL="${BASE_URL}/zh-CN/login"
}

wait_http_ok() {
  local max="${1:-120}"
  local i
  for i in $(seq 1 "${max}"); do
    if [[ "${STARTED_BY_SCRIPT}" == "1" ]] && [[ -f "${PID_FILE}" ]]; then
      local pid
      pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
      if [[ -n "${pid}" ]] && ! kill -0 "${pid}" >/dev/null 2>&1 && ! is_port_listening; then
        return 1
      fi
    fi
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${HEALTH_URL}" 2>/dev/null || true)"
    if [[ "${code}" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_stable_health() {
  local consecutive_target="${1:-2}"
  local consecutive=0
  local max_checks="${2:-30}"
  local i
  for i in $(seq 1 "${max_checks}"); do
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${HEALTH_URL}" 2>/dev/null || true)"
    if [[ "${code}" == "200" ]]; then
      consecutive=$((consecutive + 1))
      if [[ "${consecutive}" -ge "${consecutive_target}" ]]; then
        return 0
      fi
    else
      consecutive=0
    fi
    sleep 1
  done
  return 1
}

warm_route() {
  local route="$1"
  local attempts="${2:-5}"
  local i
  for i in $(seq 1 "${attempts}"); do
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}${route}" 2>/dev/null || true)"
    if [[ "${code}" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

warm_routes() {
  local warm_routes_raw="${MOCK_LANE_WARM_URLS:-${WARM_URLS_DEFAULT}}"
  local warmed_any=0
  while IFS= read -r route; do
    [[ -z "${route}" ]] && continue
    warmed_any=1
    info "warming route ${route}"
    warm_route "${route}" || return 1
  done <<< "${warm_routes_raw}"

  if [[ "${warmed_any}" == "1" ]]; then
    info "verifying mock web stability after route warm-up"
    wait_for_stable_health 2 20 || return 1
  fi
}

start_mock_server() {
  local launch_attempt=1
  while [[ "${launch_attempt}" -le 3 ]]; do
    rm -rf "${ROOT_DIR}/${MOCK_WORKSPACE_PROVISIONING_PATH}"

    if is_port_listening; then
      info "mock lane requires deterministic MSW mode; restarting :${PORT_WEB}"
      kill_port_listeners
    fi

    if is_port_listening; then
      info "port :${PORT_WEB} is still busy after cleanup; finding an alternate free port"
      fallback_port="$(pick_free_port || true)"
      if [[ -z "${fallback_port}" ]]; then
        err "failed to find a free port for mock lane"
        exit 1
      fi
      rebind_urls_for_port "${fallback_port}"
      info "using fallback port :${PORT_WEB}"
    fi

    info "starting mock web server on :${PORT_WEB} (log: ${LOG_FILE}) [attempt ${launch_attempt}/3]"
    : > "${LOG_FILE}"
    (
      cd "${ROOT_DIR}"
      exec env \
        MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}" \
        MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}" \
        NEXT_PUBLIC_USE_MSW=true \
        AGENTSMITH_ENABLE_TEST_ROUTES=true \
        SYSTEM_WORKSPACE_PROVISIONING_PATH="${MOCK_WORKSPACE_PROVISIONING_PATH}" \
        npm run dev:test -- --port "${PORT_WEB}"
    ) >>"${LOG_FILE}" 2>&1 &
    echo $! > "${PID_FILE}"
    STARTED_BY_SCRIPT=1

    if wait_http_ok 120; then
      if ! warm_routes; then
        info "mock web responded to health checks but did not stabilize after route warm-up"
      else
        return 0
      fi
    fi

    if wait_http_ok 20 && warm_routes; then
      return 0
    fi

    if [[ "${launch_attempt}" -ge 3 ]]; then
      err "web server is not ready at ${HEALTH_URL}"
      tail -n 120 "${LOG_FILE}" 2>/dev/null || true
      exit 1
    fi

    info "mock web server failed to become ready; restarting lane bootstrap (${launch_attempt}/3)"
    reset_next_dev_artifacts_if_corrupt
    kill_port_listeners
    rm -f "${PID_FILE}"
    sleep 2
    launch_attempt=$((launch_attempt + 1))
  done
}

run_playwright_once() {
  LAST_PLAYWRIGHT_LOG="$(mktemp "${MOCK_STATE_DIR}/playwright.XXXXXX.log")"
  set +e
  (
    cd "${ROOT_DIR}"
    env PW_EXCLUDE_LANE_REAL=true BASE_URL="${BASE_URL}" NEXT_PUBLIC_USE_MSW=true npx playwright test "$@"
  ) 2>&1 | tee "${LAST_PLAYWRIGHT_LOG}"
  local exit_code=${PIPESTATUS[0]}
  set -e
  return "${exit_code}"
}

is_transient_playwright_failure() {
  [[ -n "${LAST_PLAYWRIGHT_LOG}" ]] && grep -Eq \
    'ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE|ECONNRESET|EPIPE|socket hang up|Target closed' \
    "${LAST_PLAYWRIGHT_LOG}"
}
start_mock_server

attempt=1
while [[ "${attempt}" -le "${MAX_ATTEMPTS}" ]]; do
  if run_playwright_once "$@"; then
    exit 0
  fi

  if [[ "${attempt}" -ge "${MAX_ATTEMPTS}" ]]; then
    break
  fi

  if is_transient_playwright_failure || ! is_server_alive; then
    info "detected transient web/execution-service failure; restarting mock lane and retrying (${attempt}/${MAX_ATTEMPTS})"
    kill_port_listeners
    start_mock_server
    attempt=$((attempt + 1))
    continue
  fi
  break
done

exit 1
