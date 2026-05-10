#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_local_manual_env
if [[ -z "${MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT:-}" ]]; then
  MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT="${ROOT_DIR}/.local-manual/ags-workspace"
  MBOS_AGENT_WORKSPACE_ROOT="${MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT}"
  export MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT
  export MBOS_AGENT_WORKSPACE_ROOT
fi
RUNNER_LAUNCH_STARTED=0
RUNNER_LAUNCH_PID=""
RUNNER_LAUNCH_OWNER_TOKEN=""

rollback_untracked_runner_launch() {
  local pid="${RUNNER_LAUNCH_PID:-}"
  [[ -n "${pid}" ]] || return 0

  if declare -F local_runtime_stop_owned_process_tree >/dev/null 2>&1; then
    LOCAL_RUNTIME_OWNER_TOKEN="${RUNNER_LAUNCH_OWNER_TOKEN:-}" \
      local_runtime_stop_owned_process_tree "${pid}" runner "0" || true
  fi

  rm -f \
    "${RUNNER_PID_FILE}" \
    "${RUNNER_READY_FILE}" \
    "${RUNNER_HEALTH_FILE}" \
    "${RUNNER_HEALTH_MONITOR_PID_FILE}" \
    "${RUNNER_OWNER_STATE_FILE}"
}

cleanup_on_exit() {
  local exit_code="${1:-0}"
  if [[ "${exit_code}" == "0" ]]; then
    return 0
  fi
  if [[ "${RUNNER_LAUNCH_STARTED}" == "1" ]]; then
    stop_local_manual_runner_owner_aware rollback_launch || true
    return 0
  fi
  rollback_untracked_runner_launch || true
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

wait_runner_api_runtime_ready() {
  local timeout="${1:-60}"
  local start token project_id runner_id status payload ready
  token="$(cat "$(backend_real_token_file)" 2>/dev/null || true)"
  project_id="$(state_get project.id)"
  runner_id="$(state_get agent_runner.id)"
  if [[ -z "${token}" || -z "${project_id}" || -z "${runner_id}" ]]; then
    err "runner API runtime readiness cannot be checked without token/project/runner state"
    return 1
  fi

  start="$(date +%s)"
  while true; do
    payload="$(
      curl -sS \
        -H "Authorization: Bearer ${token}" \
        "http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}/agent-runners/${runner_id}/diagnostics" \
        -w '\n%{http_code}' || true
    )"
    status="$(printf '%s\n' "${payload}" | tail -n 1)"
    if [[ "${status}" == "200" ]]; then
      ready="$(
        printf '%s\n' "${payload}" | sed '$d' | node -e '
let raw = "";
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(raw);
    const readyAt = payload && payload.runtime_metadata && payload.runtime_metadata.ready_at;
    if (typeof readyAt === "string" && readyAt.trim()) {
      process.stdout.write("ready");
    }
  } catch {
    // keep polling
  }
});
' 2>/dev/null || true
      )"
      if [[ "${ready}" == "ready" ]]; then
        info "runner API runtime ready"
        return 0
      fi
    fi
    if (( "$(date +%s)" - start > timeout )); then
      err "runner API runtime did not become ready in time"
      printf '%s\n' "${payload}" >&2 || true
      tail -n 120 "${RUNNER_LOG}" || true
      return 1
    fi
    sleep 1
  done
}

info "ensuring a single local agent-task runner instance"
# common.sh delegates tracked runner ownership checks to owner-janitor.ts.
if ! stop_local_manual_runner_owner_aware replace_runner; then
  err "runner ownership is unverified; refusing to replace the tracked local-manual runner"
  exit 1
fi
rm -f "${RUNNER_READY_FILE}"
rm -f "${RUNNER_HEALTH_FILE}" "${RUNNER_HEALTH_MONITOR_PID_FILE}" "${RUNNER_OWNER_STATE_FILE}"
rm -f "${RUNNER_LOG}"

if ! declare -F local_runtime_start_owned_service >/dev/null 2>&1; then
  err "local runtime ownership helpers are unavailable; refusing to launch an untracked runner"
  exit 1
fi

RUNNER_OWNER_TOKEN="$(local_manual_resolve_runner_owner_token)"
export LOCAL_RUNTIME_OWNER_TOKEN="${RUNNER_OWNER_TOKEN}"
export LOCAL_RUNTIME_LINE_KIND="${LOCAL_RUNTIME_LINE_KIND:-local_manual}"
runner_start_fn="local_runtime_start_owned_service"
if declare -F local_runtime_start_detached_owned_service >/dev/null 2>&1; then
  runner_start_fn="local_runtime_start_detached_owned_service"
fi
runner_pid="$("${runner_start_fn}" runner "0" "${RUNNER_LOG}" bash -lc "
  cd '${ROOT_DIR}' && \
  export MBOS_AGENT_RUNNER_DEBUG='${MBOS_AGENT_RUNNER_DEBUG:-1}' \
    MBOS_AGENT_TASK_RUNNER_MODE='developer' \
    MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT='${MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT}' \
    MBOS_AGENT_WORKSPACE_ROOT='${MBOS_AGENT_TASK_DEVELOPER_WORKSPACE_ROOT}' \
    MBOS_AGENT_TASK_TIMEOUT_SEC='${MBOS_AGENT_TASK_TIMEOUT_SEC:-120}' \
    MBOS_AGENT_CODEX_YOLO='${MBOS_AGENT_CODEX_YOLO:-1}' && \
  exec make agent-task-runner-from-state
")"
RUNNER_LAUNCH_PID="${runner_pid}"
RUNNER_LAUNCH_OWNER_TOKEN="${RUNNER_OWNER_TOKEN}"
printf '%s\n' "${runner_pid}" > "${RUNNER_PID_FILE}"
local_manual_write_runner_owner_state "${RUNNER_OWNER_STATE_FILE}" "${runner_pid}" "${RUNNER_OWNER_TOKEN}"
RUNNER_LAUNCH_STARTED=1
start_runner_health_monitor
wait_runner_connected 60
wait_runner_api_runtime_ready 60
write_ready_file "${RUNNER_READY_FILE}"
trap - EXIT
