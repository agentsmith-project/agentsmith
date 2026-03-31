#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION=1
init_local_manual_env

service_status() {
  local pid_file="$1"
  local ready_file="$2"
  local url="$3"
  local code pid
  code="$(curl -sS -o /dev/null -w '%{http_code}' "${url}" || true)"
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  if [[ -f "${ready_file}" && ( "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ) ]]; then
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      printf 'up (pid=%s)  http=%s\n' "${pid}" "${code}"
    else
      printf 'up  http=%s\n' "${code}"
    fi
  elif [[ "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ]]; then
    printf 'reachable (untracked)  http=%s\n' "${code}"
  else
    printf 'down  http=%s\n' "${code}"
  fi
}

runner_status() {
  local pid
  local runner_count
  pid="$(cat "${RUNNER_PID_FILE}" 2>/dev/null || true)"
  runner_count="$(count_matching_processes 'make notebook-agent-runner')"
  if [[ -f "${RUNNER_READY_FILE}" ]]; then
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      printf 'up (pid=%s)' "${pid}"
    else
      printf 'up'
    fi
    if (( runner_count > 1 )); then
      printf '  WARN: %s runner processes detected\n' "${runner_count}"
    else
      printf '\n'
    fi
  else
    if (( runner_count > 0 )); then
      printf 'down  WARN: %s untracked runner processes detected\n' "${runner_count}"
    else
      printf 'down\n'
    fi
  fi
}

echo "Scenario: $(current_active_scenario || true)"
echo "Substrate: $(curl -sS -o /dev/null -w '%{http_code}' "${MBOS_UNIVERSAL_PROXY_BASE_URL}/admin/state" || true) proxy / $(curl -sS -o /dev/null -w '%{http_code}' "${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" || true) keycloak"
APP_MODE=local-manual SUBSTRATE="${SUBSTRATE}" ENV_FILE="${ENV_FILE}" bash "${ROOT_DIR}/scripts/app/status.sh"
printf 'Runner: '
runner_status

PROJECT_ID="$(state_get project.id)"
if [[ -n "${PROJECT_ID}" ]]; then
  echo "Notebook: http://localhost:${PORT_WEB}/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/notebook"
fi
