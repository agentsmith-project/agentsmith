#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_local_manual_env

stop_pid_file_if_running() {
  local pid_file="$1"
  local label="$2"
  if [[ ! -f "${pid_file}" ]]; then
    return 0
  fi
  local pid
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  rm -f "${pid_file}"
  [[ -n "${pid}" ]] || return 0
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi
  info "stopping ${label} pid=${pid}"
  kill "${pid}" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  kill -9 "${pid}" >/dev/null 2>&1 || true
}

stop_listeners_on_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "${pids}" ]] || return 0
  info "stopping listeners on port ${port}: ${pids//$'\n'/ }"
  xargs -r kill >/dev/null 2>&1 <<< "${pids}" || true
  sleep 1
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "${pids}" ]] || return 0
  xargs -r kill -9 >/dev/null 2>&1 <<< "${pids}" || true
}

stop_matching_processes() {
  local pattern="$1"
  local pids
  pids="$(pgrep -f "${pattern}" || true)"
  [[ -n "${pids}" ]] || return 0
  info "stopping processes matching ${pattern}: ${pids//$'\n'/ }"
  xargs -r kill >/dev/null 2>&1 <<< "${pids}" || true
  sleep 1
  pids="$(pgrep -f "${pattern}" || true)"
  [[ -n "${pids}" ]] || return 0
  xargs -r kill -9 >/dev/null 2>&1 <<< "${pids}" || true
}

stop_pid_file_if_running "${RUNNER_PID_FILE}" "runner"
stop_pid_file_if_running "${WEB_PID_FILE}" "web"
stop_pid_file_if_running "${API_PID_FILE}" "api"
stop_pid_file_if_running "${PROXY_PID_FILE}" "universal-proxy"

stop_matching_processes 'run-next-dev-safe.sh --port 3001'
stop_matching_processes 'npm run dev:test --port 3001'
stop_matching_processes 'next dev --port 3001'
stop_matching_processes 'node .*/node_modules/.bin/tsx src/index.ts'
stop_matching_processes 'llm-universal-proxy --config'
stop_matching_processes 'make notebook-agent-runner'

stop_listeners_on_port 3001
stop_listeners_on_port 20000
stop_listeners_on_port 38080

remove_local_manual_runtime_files
reset_local_manual_state

docker ps --format '{{.Names}}' | rg 'agentsmith-demo|agentsmith-control-plane' | xargs -r docker rm -f >/dev/null 2>&1 || true
(cd "${ROOT_DIR}" && make deps-down >/dev/null 2>&1 || true)

info "done"
