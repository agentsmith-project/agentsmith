#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

API_PID_FILE="${API_PID_FILE:-/tmp/agentsmith_demo_api.pid}"
WEB_PID_FILE="${WEB_PID_FILE:-/tmp/agentsmith_demo_web.pid}"
RUNNER_PID_FILE="${RUNNER_PID_FILE:-/tmp/agentsmith_demo_runner.pid}"

info() { echo "[demo-down] $*"; }

stop_from_pid_file() {
  local pid_file="$1"
  local label="$2"
  if [[ ! -f "${pid_file}" ]]; then
    info "${label}: no managed pid file (${pid_file})"
    return 0
  fi
  local pid
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]]; then
    rm -f "${pid_file}"
    info "${label}: removed empty pid file"
    return 0
  fi
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    rm -f "${pid_file}"
    info "${label}: pid ${pid} already stopped"
    return 0
  fi
  info "${label}: stopping pid ${pid}"
  kill "${pid}" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if kill -0 "${pid}" >/dev/null 2>&1; then
    info "${label}: forcing kill pid ${pid}"
    kill -9 "${pid}" >/dev/null 2>&1 || true
  fi
  rm -f "${pid_file}"
}

stop_from_pid_file "${RUNNER_PID_FILE}" "Runner"
stop_from_pid_file "${WEB_PID_FILE}" "Web"
stop_from_pid_file "${API_PID_FILE}" "API"

info "done"
