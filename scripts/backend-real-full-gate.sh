#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
load_backend_real_env "${ROOT_DIR}/.env.backend-real"
export_backend_real_endpoint_env
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL:-${PUBLIC_KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}}"
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}"
MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"
API_PORT="${PORT_API:-20000}"
WEB_PORT="${PORT_WEB:-3001}"
RUN_ID="${RELEASE_REAL_VISUAL_RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
ARTIFACT_DIR="${RELEASE_REAL_VISUAL_ARTIFACT_DIR:-${ROOT_DIR}/artifacts/backend-real-visual/${RUN_ID}}"
LOCAL_READY_LOG_DIR="${RELEASE_REAL_READY_LOG_DIR:-${ROOT_DIR}/artifacts/backend-real/current/release-ready}"
gate_evidence_init "${LOCAL_READY_LOG_DIR}" "release_backend_real"
export RUNTIME_LINE_ID="${RUN_ID}"
export RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-external_host}"
resolve_loopback_runtime_addresses "${API_PORT}" "${WEB_PORT}" 18080
gate_write_runtime_descriptor "${LOCAL_READY_LOG_DIR}" "release_backend_real"
gate_write_resolved_env "${LOCAL_READY_LOG_DIR}"
gate_record_task_summary "${LOCAL_READY_LOG_DIR}" "{\"line_kind\":\"release_backend_real\",\"run_id\":\"${RUN_ID}\",\"api_port\":\"${API_PORT}\",\"web_port\":\"${WEB_PORT}\"}"
API_LOG="${LOCAL_READY_LOG_DIR}/api.log"
WEB_LOG="${LOCAL_READY_LOG_DIR}/web.log"
LOCAL_API_PID=""
LOCAL_WEB_PID=""

record_service() {
  local service_name="$1"
  local status="$2"
  local detail="${3:-}"
  gate_record_service_status "${LOCAL_READY_LOG_DIR}" "${service_name}" "${status}" "${detail}"
}


if [[ -z "${BACKEND_REAL_API_KEY_VALUE}" ]]; then
  gate_record_failure "${LOCAL_READY_LOG_DIR}" "infra_dependency_unready" "endpoint_env" "Missing PRESET_ENDPOINT_API_KEY"
  echo "[backend-real-full-gate] Missing PRESET_ENDPOINT_API_KEY." >&2
  echo "[backend-real-full-gate] Export PRESET_ENDPOINT_API_KEY before running this gate." >&2
  exit 1
fi

info() { echo "[backend-real-full-gate] $*"; }

run_clean() {
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY "$@"
}

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

start_background_job() {
  local log_file="$1"
  shift
  mkdir -p "$(dirname "${log_file}")"
  "$@" >"${log_file}" 2>&1 &
  echo $!
}

kill_process_tree() {
  local pid="$1"
  [[ -n "${pid}" ]] || return 0
  local child
  while read -r child; do
    [[ -n "${child}" ]] && kill_process_tree "${child}"
  done < <(pgrep -P "${pid}" 2>/dev/null || true)
  kill -TERM "${pid}" >/dev/null 2>&1 || true
}

stop_background_job() {
  local pid="$1"
  [[ -n "${pid}" ]] || return 0
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi
  kill_process_tree "${pid}"
  for _ in $(seq 1 10); do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  while read -r child; do
    [[ -n "${child}" ]] && kill -KILL "${child}" >/dev/null 2>&1 || true
  done < <(pgrep -P "${pid}" 2>/dev/null || true)
  kill -KILL "${pid}" >/dev/null 2>&1 || true
}


ensure_local_release_stack() {
  mkdir -p "${LOCAL_READY_LOG_DIR}"

  if ! is_port_listening "${API_PORT}"; then
    info "starting local API on :${API_PORT} for release readiness"
    LOCAL_API_PID="$(
      PORT="${API_PORT}" \
      KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
      PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
      INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
      KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL}" \
      KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
      DATABASE_URL="${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:15432/mbos}" \
      MONGO_URL="${MONGO_URL}" \
      MONGO_DB_NAME="${MONGO_DB_NAME}" \
      REDIS_URL="${REDIS_URL:-redis://localhost:16379}" \
      MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}" \
      MINIO_PORT="${MINIO_PORT:-19000}" \
      MINIO_USE_SSL="${MINIO_USE_SSL:-false}" \
      MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}" \
      MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}" \
      MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}" \
      start_background_job "${API_LOG}" run_clean npm run api:node:dev
    )"
  fi

  if ! is_port_listening "${WEB_PORT}"; then
    info "starting local Web on :${WEB_PORT} for release readiness"
    LOCAL_WEB_PID="$(
      MONGO_URL="${MONGO_URL}" \
      MONGO_DB_NAME="${MONGO_DB_NAME}" \
      NEXT_PUBLIC_USE_MSW=false \
      AGENTSMITH_ENABLE_TEST_ROUTES=true \
      NEXT_PUBLIC_API_BASE="http://localhost:${API_PORT}/api/v1" \
      NEXT_PUBLIC_KEYCLOAK_URL="${KEYCLOAK_BASE_URL}/realms" \
      NEXT_PUBLIC_KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
      NEXT_PUBLIC_KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
      KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
      PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
      INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
      start_background_job "${WEB_LOG}" run_clean npm run dev:test -- --port "${WEB_PORT}"
    )"
  fi

  gate_wait_for_http "${LOCAL_READY_LOG_DIR}" "http://localhost:${API_PORT}/api/v1/workspaces" 120 infra_dependency_unready api_ready || {
    gate_record_failure "${LOCAL_READY_LOG_DIR}" "infra_dependency_unready" "api_ready" "local API did not become ready"
    tail -n 120 "${API_LOG}" >&2 || true
    exit 1
  }
  gate_record_preflight_check "${LOCAL_READY_LOG_DIR}" "api_ready" "passed" "http://localhost:${API_PORT}/api/v1/workspaces"
  record_service api ready "http://localhost:${API_PORT}/api/v1/workspaces"
  gate_wait_for_http "${LOCAL_READY_LOG_DIR}" "http://localhost:${WEB_PORT}/api/public/workspaces" 120 infra_dependency_unready web_ready || {
    gate_record_failure "${LOCAL_READY_LOG_DIR}" "infra_dependency_unready" "web_ready" "local Web did not become ready"
    tail -n 120 "${WEB_LOG}" >&2 || true
    exit 1
  }
  gate_record_preflight_check "${LOCAL_READY_LOG_DIR}" "web_ready" "passed" "http://localhost:${WEB_PORT}/api/public/workspaces"
  record_service web ready "http://localhost:${WEB_PORT}/api/public/workspaces"
}

cleanup() {
  stop_background_job "${LOCAL_WEB_PID}"
  stop_background_job "${LOCAL_API_PID}"
}
trap cleanup EXIT

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
gate_record_preflight_check "${LOCAL_READY_LOG_DIR}" "default_gate" "passed" "npm run gate:default"
run_cmd "MONGO_URL='${MONGO_URL}' MONGO_DB_NAME='${MONGO_DB_NAME}' KEYCLOAK_BASE_URL='${KEYCLOAK_BASE_URL}' KEYCLOAK_REALM='${KEYCLOAK_REALM}' KEYCLOAK_CLIENT_ID='${KEYCLOAK_CLIENT_ID}' npm run backend-real:bootstrap"
gate_record_preflight_check "${LOCAL_READY_LOG_DIR}" "backend_bootstrap" "passed" "backend-real bootstrap completed"
ensure_local_release_stack
ACCESS_TOKEN="$(gate_run_auth_preflight "${LOCAL_READY_LOG_DIR}" "${KEYCLOAK_BASE_URL}" "${KEYCLOAK_REALM}" "${KEYCLOAK_CLIENT_ID}" "${INTEGRATION_DEV_ADMIN_USERNAME:-dev-admin}" "${INTEGRATION_DEV_ADMIN_PASSWORD:-dev-admin-123}" "http://localhost:${API_PORT}/api/v1/me/profile" "failed to obtain release-ready token" "release-ready token missing access_token" "authenticated /api/v1/me/profile unavailable")" || exit 1
record_service auth ready "release-ready dev-admin token bootstrap"
run_cmd "API_BASE='http://localhost:${API_PORT}' BASE_URL='http://localhost:${WEB_PORT}' KEYCLOAK_BASE_URL='${KEYCLOAK_BASE_URL}' npm run backend-real:ready"
gate_record_preflight_check "${LOCAL_READY_LOG_DIR}" "backend_ready" "passed" "backend-real ready"
record_service backend_ready ready "backend-real ready"
run_real_cmd 20050 3051 "BACKEND_REAL_API_KEY='${BACKEND_REAL_API_KEY_VALUE}' npm run backend-real:run"
run_real_cmd 20080 3081 "BACKEND_REAL_API_KEY='${BACKEND_REAL_API_KEY_VALUE}' RELEASE_REAL_VISUAL_ARTIFACT_DIR='${ARTIFACT_DIR}' npm run test:visual:backend-real:review"
run_cmd "npm run backend-real:report"

info "release-grade real verification passed"
info "artifacts written to ${ARTIFACT_DIR}"
gate_record_success "${LOCAL_READY_LOG_DIR}" "release_backend_real"
