#!/usr/bin/env bash

runner_lifecycle_latest_log_transition_stream() {
  local current_state="stale"
  local current_reason="no_socket_transition_observed"
  local line

  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" =~ \[agent-task-runner\]\ runner_state=(connected|shutting_down|disconnected)([[:space:]]+reason=([^[:space:]]+))? ]]; then
      current_state="${BASH_REMATCH[1]}"
      current_reason="${BASH_REMATCH[3]:-lifecycle_log}"
      continue
    fi

    case "${line}" in
      *"[agent-task-runner] shutting down ("*)
        current_state="shutting_down"
        current_reason="${line#*shutting down (}"
        current_reason="${current_reason%%)*}"
        if [[ "${current_reason}" == "${line}" || -z "${current_reason}" ]]; then
          current_reason="legacy_shutting_down"
        fi
        ;;
      *"[agent-task-runner] connected"*)
        current_state="connected"
        current_reason="legacy_connected"
        ;;
      *"websocket open"*)
        current_state="connected"
        current_reason="debug_websocket_open"
        ;;
      *"[agent-task-runner] disconnected"*)
        current_state="disconnected"
        current_reason="legacy_disconnected"
        ;;
    esac
  done

  printf '%s\t%s\n' "${current_state}" "${current_reason}"
}

runner_lifecycle_latest_log_transition_text() {
  local logs="${1:-}"
  printf '%s\n' "${logs}" | runner_lifecycle_latest_log_transition_stream
}

runner_lifecycle_latest_log_transition_file() {
  local log_file="$1"
  if [[ ! -f "${log_file}" ]]; then
    printf 'stale\tlog_file_missing\n'
    return 0
  fi
  runner_lifecycle_latest_log_transition_stream < "${log_file}"
}

runner_lifecycle_latest_log_state_file() {
  local transition state reason
  transition="$(runner_lifecycle_latest_log_transition_file "$1")"
  IFS=$'\t' read -r state reason <<< "${transition}"
  printf '%s\n' "${state:-stale}"
}

runner_lifecycle_latest_log_state_text() {
  local transition state reason
  transition="$(runner_lifecycle_latest_log_transition_text "${1:-}")"
  IFS=$'\t' read -r state reason <<< "${transition}"
  printf '%s\n' "${state:-stale}"
}

runner_lifecycle_log_file_is_connected() {
  [[ "$(runner_lifecycle_latest_log_state_file "$1")" == "connected" ]]
}

runner_lifecycle_logs_connected() {
  [[ "$(runner_lifecycle_latest_log_state_text "${1:-}")" == "connected" ]]
}
