#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT_WEB="${PORT_WEB:-3001}"
BASE_URL="http://127.0.0.1:${PORT_WEB}"
HEALTH_URL="${BASE_URL}/zh-CN/login"

PID_FILE="/tmp/agentsmith_mock_lane_web.pid"
LOG_FILE="/tmp/agentsmith_mock_lane_web.log"
STARTED_BY_SCRIPT=0

info() { echo "[mock-lane] $*"; }
err() { echo "[mock-lane] ERROR: $*" >&2; }

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
}
trap cleanup EXIT

is_port_listening() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${PORT_WEB}" -sTCP:LISTEN -Pn >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn | grep -qE "[\\[\\]:*]${PORT_WEB}[[:space:]]"
    return $?
  fi
  return 1
}

wait_http_ok() {
  local max="${1:-120}"
  local i
  for i in $(seq 1 "${max}"); do
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${HEALTH_URL}" || true)"
    if [[ "${code}" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if is_port_listening; then
  info "reusing existing web server on :${PORT_WEB}"
else
  info "starting mock web server on :${PORT_WEB} (log: ${LOG_FILE})"
  : > "${LOG_FILE}"
  (
    cd "${ROOT_DIR}"
    exec env NEXT_PUBLIC_USE_MSW=true npm run dev:test -- --port "${PORT_WEB}"
  ) >>"${LOG_FILE}" 2>&1 &
  echo $! > "${PID_FILE}"
  STARTED_BY_SCRIPT=1
fi

if ! wait_http_ok 120; then
  err "web server is not ready at ${HEALTH_URL}"
  tail -n 120 "${LOG_FILE}" 2>/dev/null || true
  exit 1
fi

cd "${ROOT_DIR}"
exec env BASE_URL="${BASE_URL}" NEXT_PUBLIC_USE_MSW=true npx playwright test "$@"
