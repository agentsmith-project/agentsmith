#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION=1
load_app_mode

service_status() {
  local pid_file="$1"
  local ready_file="$2"
  local url="$3"
  local code pid
  code="$(curl -sS -o /dev/null -w '%{http_code}' "${url}" 2>/dev/null || true)"
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  if [[ -f "${ready_file}" && ( "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ) ]]; then
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      printf 'up (pid=%s) http=%s\n' "${pid}" "${code}"
    else
      printf 'up http=%s\n' "${code}"
    fi
  elif [[ "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ]]; then
    printf 'reachable http=%s\n' "${code}"
  else
    printf 'down http=%s\n' "${code}"
  fi
}

runner_status() {
  local pid socket_state
  pid="$(cat "${RUNNER_PID_FILE}" 2>/dev/null || true)"
  socket_state="$(runner_socket_health_state)"
  if [[ "${socket_state}" == "connected" ]]; then
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      printf 'up (pid=%s) socket=%s\n' "${pid}" "${socket_state}"
      return 0
    fi
    printf 'up socket=%s\n' "${socket_state}"
    return 0
  fi

  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    printf 'down (pid=%s) socket=%s\n' "${pid}" "${socket_state}"
    return 0
  fi
  printf 'down socket=%s\n' "${socket_state}"
}

case "${APP_MODE}" in
  local-manual)
    printf 'App mode: %s\n' "${APP_MODE}"
    echo "API: $(service_status "${API_PID_FILE}" "${API_READY_FILE}" "http://localhost:${PORT_API}/api/v1/openapi.json")"
    echo "Web: $(service_status "${WEB_PID_FILE}" "${WEB_READY_FILE}" "http://localhost:${PORT_WEB}/${LOCALE}/login/workspace")"
    echo "Runner: $(runner_status)"
    ;;
  *)
    app_err "unsupported APP_MODE=${APP_MODE}"
    exit 1
    ;;
esac
