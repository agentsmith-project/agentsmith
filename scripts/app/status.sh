#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
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
  local pid
  pid="$(cat "${RUNNER_PID_FILE}" 2>/dev/null || true)"
  if [[ -f "${RUNNER_READY_FILE}" ]]; then
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      printf 'up (pid=%s)\n' "${pid}"
    else
      printf 'up\n'
    fi
  else
    printf 'down\n'
  fi
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
