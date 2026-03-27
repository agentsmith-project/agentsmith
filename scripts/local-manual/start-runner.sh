#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_local_manual_env

wait_runner_connected() {
  local timeout="${1:-60}"
  local start
  start="$(date +%s)"
  while true; do
    if rg -q "\\[agent-codex-runner\\] connected|websocket open" "${RUNNER_LOG}" 2>/dev/null; then
      info "runner connected"
      return 0
    fi
    if (( "$(date +%s)" - start > timeout )); then
      err "runner did not connect in time"
      tail -n 120 "${RUNNER_LOG}" || true
      return 1
    fi
    sleep 1
  done
}

launch_detached "${RUNNER_PID_FILE}" "${RUNNER_LOG}" "
  cd '${ROOT_DIR}' && \
  export MBOS_AGENT_RUNNER_DEBUG='${MBOS_AGENT_RUNNER_DEBUG:-1}' \
    MBOS_AGENT_TASK_TIMEOUT_SEC='${MBOS_AGENT_TASK_TIMEOUT_SEC:-120}' \
    MBOS_AGENT_CODEX_YOLO='${MBOS_AGENT_CODEX_YOLO:-1}' && \
  exec make notebook-agent-runner
"
wait_runner_connected 60
write_ready_file "${RUNNER_READY_FILE}"
