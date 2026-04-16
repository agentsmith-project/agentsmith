#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_local_manual_env
RUNNER_LAUNCH_STARTED=0

cleanup_on_exit() {
  local exit_code="${1:-0}"
  if [[ "${exit_code}" != "0" && "${RUNNER_LAUNCH_STARTED}" == "1" ]]; then
    stop_local_manual_runner_owner_aware rollback_launch || true
  fi
}
trap 'cleanup_on_exit $?' EXIT

wait_runner_connected() {
  local timeout="${1:-60}"
  local start state
  start="$(date +%s)"
  while true; do
    state="$(runner_socket_health_state)"
    if [[ "${state}" == "connected" ]]; then
      info "runner connected"
      return 0
    fi
    if [[ "${state}" == "shutting_down" ]]; then
      err "runner entered shutting_down before it became connected"
      if [[ -f "${RUNNER_HEALTH_FILE}" ]]; then
        cat "${RUNNER_HEALTH_FILE}" >&2 || true
      fi
      tail -n 120 "${RUNNER_LOG}" || true
      return 1
    fi
    if (( "$(date +%s)" - start > timeout )); then
      err "runner did not connect in time (socket=${state})"
      if [[ -f "${RUNNER_HEALTH_FILE}" ]]; then
        cat "${RUNNER_HEALTH_FILE}" >&2 || true
      fi
      tail -n 120 "${RUNNER_LOG}" || true
      return 1
    fi
    sleep 1
  done
}

info "ensuring a single local external runner instance"
# common.sh delegates tracked runner ownership checks to owner-janitor.ts.
if ! stop_local_manual_runner_owner_aware replace_runner; then
  err "runner ownership is unverified; refusing to replace the tracked local-manual runner"
  exit 1
fi
rm -f "${RUNNER_READY_FILE}"
rm -f "${RUNNER_HEALTH_FILE}" "${RUNNER_HEALTH_MONITOR_PID_FILE}"
rm -f "${RUNNER_LOG}"

launch_detached "${RUNNER_PID_FILE}" "${RUNNER_LOG}" "
  cd '${ROOT_DIR}' && \
  export MBOS_RUNNER_MODE='${MBOS_RUNNER_MODE:-host_external}' \
    MBOS_AGENT_RUNNER_DEBUG='${MBOS_AGENT_RUNNER_DEBUG:-1}' \
    MBOS_AGENT_TASK_TIMEOUT_SEC='${MBOS_AGENT_TASK_TIMEOUT_SEC:-120}' \
    MBOS_AGENT_CODEX_YOLO='${MBOS_AGENT_CODEX_YOLO:-1}' && \
  exec make notebook-agent-runner
"
RUNNER_LAUNCH_STARTED=1
start_runner_health_monitor
wait_runner_connected 60
write_ready_file "${RUNNER_READY_FILE}"
trap - EXIT
