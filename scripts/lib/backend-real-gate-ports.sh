#!/usr/bin/env bash

port_listener_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"${port}" -sTCP:LISTEN -Pn 2>/dev/null || true
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "( sport = :${port} )" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u || true
  fi
}

wait_port_free() {
  local port="$1"
  local label="$2"
  for _ in $(seq 1 30); do
    if [[ -z "$(port_listener_pids "${port}")" ]]; then
      return 0
    fi
    sleep 1
  done
  echo "[backend-real-gate-ports] ${label} port ${port} did not become free" >&2
  return 1
}

cleanup_gate_ports() {
  local api_port="$1"
  local web_port="$2"
  local spec_pattern="$3"
  local pid

  for pid in $(pgrep -f 'scripts/run-integration-e2e-full.sh' 2>/dev/null || true); do
    local cmd
    cmd="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
    if [[ -n "${spec_pattern}" && "${cmd}" == *"${spec_pattern}"* ]]; then
      kill "${pid}" >/dev/null 2>&1 || true
    fi
  done

  for pid in $(pgrep -f 'tsx src/index.ts' 2>/dev/null || true); do
    if [[ -r "/proc/${pid}/environ" ]] && grep -zq "INTEGRATION_API_PORT=${api_port}" "/proc/${pid}/environ"; then
      kill "${pid}" >/dev/null 2>&1 || true
    fi
  done

  for pid in $(pgrep -f "next dev --port ${web_port}" 2>/dev/null || true); do
    kill "${pid}" >/dev/null 2>&1 || true
  done

  for pid in $(port_listener_pids "${api_port}") $(port_listener_pids "${web_port}"); do
    [[ -n "${pid}" ]] || continue
    kill "${pid}" >/dev/null 2>&1 || true
  done

  wait_port_free "${api_port}" "api"
  wait_port_free "${web_port}" "web"
}
