#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GLM_API_KEY_VALUE="${GLM_API_KEY:-}"
RUN_ID="${RELEASE_REAL_VISUAL_RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
ARTIFACT_DIR="${RELEASE_REAL_VISUAL_ARTIFACT_DIR:-${ROOT_DIR}/artifacts/release-real-visual/${RUN_ID}}"

if [[ -z "${GLM_API_KEY_VALUE}" ]]; then
  echo "[release-real-full-gate] Missing GLM_API_KEY." >&2
  echo "[release-real-full-gate] Export GLM_API_KEY before running this gate." >&2
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

run_cmd "npm run contracts:check"
run_cmd "npm run contracts:check-openapi"
run_cmd "npm run openapi:check-generated"
run_cmd "npx tsc --noEmit"
run_cmd "npm run test:mainline:strict"
run_cmd "npm run test:governance:strict"
run_cmd "npm run test:visual:strict"
run_real_cmd 20050 3051 "GLM_API_KEY='${GLM_API_KEY_VALUE}' npm run test:mainline:strict:real"
run_real_cmd 20060 3061 "GLM_API_KEY='${GLM_API_KEY_VALUE}' npm run test:smoke:real:notebook-mainline"
run_real_cmd 20070 3071 "GLM_API_KEY='${GLM_API_KEY_VALUE}' RELEASE_REAL_VISUAL_ARTIFACT_DIR='${ARTIFACT_DIR}' npm run test:visual:real:review"

info "release-grade real verification passed"
info "artifacts written to ${ARTIFACT_DIR}"
