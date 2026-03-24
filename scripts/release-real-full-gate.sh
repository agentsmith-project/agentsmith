#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "${ROOT_DIR}/.env.real.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env.real.local"
  set +a
fi
REAL_LANE_API_KEY_VALUE="${REAL_LANE_API_KEY:-}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}"
MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"
API_PORT="${PORT_API:-20000}"
WEB_PORT="${PORT_WEB:-3001}"
RUN_ID="${RELEASE_REAL_VISUAL_RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
ARTIFACT_DIR="${RELEASE_REAL_VISUAL_ARTIFACT_DIR:-${ROOT_DIR}/artifacts/release-real-visual/${RUN_ID}}"

if [[ -z "${REAL_LANE_API_KEY_VALUE}" ]]; then
  echo "[release-real-full-gate] Missing REAL_LANE_API_KEY." >&2
  echo "[release-real-full-gate] Export REAL_LANE_API_KEY before running this gate." >&2
  exit 1
fi

info() { echo "[release-real-full-gate] $*"; }

is_port_listening() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"${port}" -sTCP:LISTEN -Pn >/dev/null 2>&1; then
    return 0
  fi
  if command -v ss >/dev/null 2>&1 && ss -ltn | grep -qE "[\\[\\]:*]${port}[[:space:]]"; then
    return 0
  fi
  if command -v fuser >/dev/null 2>&1 && fuser -n tcp "${port}" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

kill_port_listeners() {
  local port="$1"
  local pids=""
  local lsof_pids=""
  local fuser_pids=""
  if command -v lsof >/dev/null 2>&1; then
    lsof_pids="$(lsof -tiTCP:${port} -sTCP:LISTEN -Pn 2>/dev/null || true)"
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser_pids="$(fuser -n tcp "${port}" 2>/dev/null | tr ' ' '\n' || true)"
  fi
  pids="$(printf '%s\n%s\n' "${lsof_pids}" "${fuser_pids}" | awk 'NF && !seen[$0]++')"
  [[ -z "${pids}" ]] && return 0
  info "stopping existing listener(s) on :${port}: ${pids//$'\n'/ }"
  while IFS= read -r pid; do
    [[ -z "${pid}" ]] && continue
    kill "${pid}" >/dev/null 2>&1 || true
  done <<< "${pids}"
  sleep 1
  while IFS= read -r pid; do
    [[ -z "${pid}" ]] && continue
    kill -9 "${pid}" >/dev/null 2>&1 || true
  done <<< "${pids}"
}

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

run_real_cmd() {
  local api_port="$1"
  local web_port="$2"
  shift 2
  local command="$*"
  if is_port_listening "${api_port}"; then
    kill_port_listeners "${api_port}"
  fi
  if is_port_listening "${web_port}"; then
    kill_port_listeners "${web_port}"
  fi
  info "INTEGRATION_API_PORT=${api_port} INTEGRATION_WEB_PORT=${web_port} ${command}"
  (
    cd "${ROOT_DIR}" && \
      INTEGRATION_API_PORT="${api_port}" \
      INTEGRATION_WEB_PORT="${web_port}" \
      eval "${command}"
  )
}

run_cmd "npm run gate:default"
run_cmd "MONGO_URL='${MONGO_URL}' MONGO_DB_NAME='${MONGO_DB_NAME}' KEYCLOAK_BASE_URL='${KEYCLOAK_BASE_URL}' KEYCLOAK_REALM='${KEYCLOAK_REALM}' KEYCLOAK_CLIENT_ID='${KEYCLOAK_CLIENT_ID}' npm run release:real:bootstrap"
run_cmd "API_BASE='http://localhost:${API_PORT}' BASE_URL='http://localhost:${WEB_PORT}' KEYCLOAK_BASE_URL='${KEYCLOAK_BASE_URL}' npm run release:real:ready"
run_real_cmd 20050 3051 "REAL_LANE_API_KEY='${REAL_LANE_API_KEY_VALUE}' npm run lane:real:core"
run_real_cmd 20080 3081 "REAL_LANE_API_KEY='${REAL_LANE_API_KEY_VALUE}' RELEASE_REAL_VISUAL_ARTIFACT_DIR='${ARTIFACT_DIR}' npm run test:visual:real:review"
run_cmd "npm run release:real:report"

info "release-grade real verification passed"
info "artifacts written to ${ARTIFACT_DIR}"
