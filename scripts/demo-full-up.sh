#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT_API="${PORT_API:-20000}"
PORT_WEB="${PORT_WEB:-3001}"
DEMO_INIT_RESOURCES="${DEMO_INIT_RESOURCES:-1}"

info() { echo "[demo-full-up] $*"; }
err() { echo "[demo-full-up] ERROR: $*" >&2; }

kill_pid() {
  local pid="$1"
  kill "${pid}" >/dev/null 2>&1 || true
}

kill_port_listeners() {
  local port="$1"
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -t -iTCP:"${port}" -sTCP:LISTEN -n -P 2>/dev/null || true)"
  elif command -v ss >/dev/null 2>&1; then
    pids="$(
      ss -ltnp 2>/dev/null \
        | awk -v p=":${port}" '$4 ~ p {print $NF}' \
        | sed -nE 's/.*pid=([0-9]+).*/\1/p' \
        | sort -u
    )"
  fi
  [[ -n "${pids}" ]] || return 0
  info "killing port ${port} listeners: ${pids}"
  for pid in ${pids}; do
    kill_pid "${pid}"
  done
  sleep 1
  for pid in ${pids}; do
    kill -9 "${pid}" >/dev/null 2>&1 || true
  done
}

kill_pattern() {
  local pattern="$1"
  local pids
  pids="$(ps -ef | awk -v pat="${pattern}" '$0 ~ pat && $0 !~ /awk/ {print $2}' | sort -u)"
  [[ -n "${pids}" ]] || return 0
  info "killing pattern '${pattern}': ${pids}"
  for pid in ${pids}; do
    kill_pid "${pid}"
  done
  sleep 1
  for pid in ${pids}; do
    kill -9 "${pid}" >/dev/null 2>&1 || true
  done
}

require_resources_or_key() {
  if [[ "${DEMO_INIT_RESOURCES}" == "0" ]]; then
    return 0
  fi
  if [[ -n "${GLM_API_KEY:-}" ]]; then
    return 0
  fi
  if [[ -s "/tmp/agentsmith_project_id.txt" && -s "/tmp/agentsmith_endpoint_id.txt" && -s "/tmp/agentsmith_agent_id.txt" && -s "/tmp/agentsmith_agent_key.txt" && -s "/tmp/agentsmith_ws_url.txt" ]]; then
    info "GLM_API_KEY missing, falling back to existing /tmp demo metadata"
    export DEMO_INIT_RESOURCES=0
    return 0
  fi
  err "GLM_API_KEY is required for first-time resource initialization."
  err "Example: GLM_API_KEY='***' make demo-full-up"
  return 1
}

main() {
  info "stopping managed demo processes"
  (cd "${ROOT_DIR}" && make notebook-agent-demo-down >/dev/null 2>&1 || true)

  info "killing unmanaged leftovers"
  kill_port_listeners "${PORT_API}"
  kill_port_listeners "${PORT_WEB}"
  kill_pattern "next dev --port ${PORT_WEB}"
  kill_pattern "tsx src/index.ts"
  kill_pattern "agent-codex-runner"

  require_resources_or_key

  info "starting dependencies"
  # deps-init already depends on deps-ready, and deps-ready depends on deps-up.
  # Call once to avoid duplicated bootstrap logs/work.
  (cd "${ROOT_DIR}" && make deps-init)

  info "starting/recovering full demo environment"
  (cd "${ROOT_DIR}" && make notebook-agent-demo-up PORT_API="${PORT_API}" PORT_WEB="${PORT_WEB}" DEMO_INIT_RESOURCES="${DEMO_INIT_RESOURCES}")

  info "running readiness check"
  (cd "${ROOT_DIR}" && make notebook-agent-demo-check PORT_API="${PORT_API}")

  info "done"
  info "web: http://localhost:${PORT_WEB}"
  info "api: http://localhost:${PORT_API}/api/v1/openapi.json"
}

main "$@"
