#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
source "${ROOT_DIR}/scripts/lib/local-runtime-processes.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-gate-ports.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/scenarios/common.sh"
load_backend_real_env "${ROOT_DIR}/.env.backend-real"
export_backend_real_endpoint_env
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}"
MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"
API_PORT="${PORT_API:-20000}"
WEB_PORT="${PORT_WEB:-3001}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-18080}"
RUN_ID="${RELEASE_REAL_VISUAL_RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
ARTIFACT_DIR="${RELEASE_REAL_VISUAL_ARTIFACT_DIR:-${ROOT_DIR}/artifacts/backend-real-visual/${RUN_ID}}"
RELEASE_RUN_ROOT="${RELEASE_REAL_RUN_ROOT:-$(BACKEND_REAL_RUN_ID="${RUN_ID}" backend_real_new_run_dir release-real)}"
LOCAL_READY_LOG_DIR="${RELEASE_REAL_READY_LOG_DIR:-${RELEASE_RUN_ROOT}/release-ready}"
export LOCAL_RUNTIME_RUN_ID="${RUN_ID}"
export LOCAL_RUNTIME_LINE_KIND="release_backend_real"
export LOCAL_RUNTIME_OWNER_TOKEN="${RUN_ID}:release_backend_real:$$"
export LOCAL_RUNTIME_PROCESS_STATE_DIR="${RELEASE_RUN_ROOT}/processes"
export CURRENT_GATE_RESULT_GATE_ID="${CURRENT_GATE_RESULT_GATE_ID:-lane-backend-real-release}"
export CURRENT_GATE_RESULT_NPM_SCRIPT="${CURRENT_GATE_RESULT_NPM_SCRIPT:-lane:backend-real:release}"
export CURRENT_GATE_RESULT_LINE_KIND="${CURRENT_GATE_RESULT_LINE_KIND:-release_backend_real}"
backend_real_prune_forbidden_current_entries
backend_real_mark_run_status "${RELEASE_RUN_ROOT}" incomplete
gate_evidence_init "${LOCAL_READY_LOG_DIR}" "release_backend_real"
export RUNTIME_LINE_ID="${RUN_ID}"
export RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-external_host}"
resolve_loopback_runtime_stack "${API_PORT}" "${WEB_PORT}" "${KEYCLOAK_PORT}" "mbos" "agentsmith"
gate_write_runtime_descriptor "${LOCAL_READY_LOG_DIR}" "release_backend_real"
gate_write_resolved_env "${LOCAL_READY_LOG_DIR}"
gate_record_task_summary "${LOCAL_READY_LOG_DIR}" "{\"line_kind\":\"release_backend_real\",\"run_id\":\"${RUN_ID}\",\"api_port\":\"${API_PORT}\",\"web_port\":\"${WEB_PORT}\"}"
API_LOG="${LOCAL_READY_LOG_DIR}/api.log"
WEB_LOG="${LOCAL_READY_LOG_DIR}/web.log"
NEXT_WEB_PID_FILE="${LOCAL_READY_LOG_DIR}/next-dev.pid"
LOCAL_API_ROOT_PID=""
LOCAL_API_PID=""
LOCAL_WEB_PID=""
FINAL_STATUS="failed"

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

ensure_local_release_stack() {
  mkdir -p "${LOCAL_READY_LOG_DIR}"

  if ! local_runtime_port_is_listening "${API_PORT}"; then
    info "starting local API on :${API_PORT} for release readiness"
    LOCAL_API_ROOT_PID="$(
      local_runtime_start_owned_service api "${API_PORT}" "${API_LOG}" env \
        -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
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
        npm run api:node:dev
    )"
    LOCAL_API_PID="$(local_runtime_capture_authoritative_service_pid "${LOCAL_API_ROOT_PID}" api "${API_PORT}" 120)"
  fi

  if ! local_runtime_port_is_listening "${WEB_PORT}"; then
    info "starting local Web on :${WEB_PORT} for release readiness"
    LOCAL_WEB_PID="$(
      local_runtime_start_owned_service web "${WEB_PORT}" "${WEB_LOG}" env \
        -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
        MONGO_URL="${MONGO_URL}" \
        MONGO_DB_NAME="${MONGO_DB_NAME}" \
        NEXT_GENERATED_ROOT_MANAGED=1 \
        NEXT_DEV_PID_FILE="${NEXT_WEB_PID_FILE}" \
        NEXT_PUBLIC_USE_MSW=false \
        AGENTSMITH_ENABLE_TEST_ROUTES=true \
        NEXT_PUBLIC_API_BASE="http://localhost:${API_PORT}/api/v1" \
        NEXT_PUBLIC_KEYCLOAK_URL="${KEYCLOAK_BASE_URL}/realms" \
        NEXT_PUBLIC_KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
        NEXT_PUBLIC_KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
        KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
        PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
        INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
        bash scripts/run-next-dev-safe.sh --port "${WEB_PORT}"
    )"
  fi

  gate_wait_for_tcp "${LOCAL_READY_LOG_DIR}" "127.0.0.1" "${API_PORT}" 120 infra_dependency_unready api_ready || {
    gate_record_failure "${LOCAL_READY_LOG_DIR}" "infra_dependency_unready" "api_ready" "local API port did not become ready"
    tail -n 120 "${API_LOG}" >&2 || true
    exit 1
  }
  gate_record_preflight_check "${LOCAL_READY_LOG_DIR}" "api_ready" "passed" "127.0.0.1:${API_PORT}"
  record_service api ready "127.0.0.1:${API_PORT}"
  gate_wait_for_http "${LOCAL_READY_LOG_DIR}" "${RUNTIME_HOST_WEB_BASE_URL}/api/public/workspaces" 120 infra_dependency_unready web_ready || {
    gate_record_failure "${LOCAL_READY_LOG_DIR}" "infra_dependency_unready" "web_ready" "local Web did not become ready"
    tail -n 120 "${WEB_LOG}" >&2 || true
    exit 1
  }
  gate_record_preflight_check "${LOCAL_READY_LOG_DIR}" "web_ready" "passed" "${RUNTIME_HOST_WEB_BASE_URL}/api/public/workspaces"
  record_service web ready "${RUNTIME_HOST_WEB_BASE_URL}/api/public/workspaces"
}

prewarm_internal_kind_cluster() {
  if ! command -v kind >/dev/null 2>&1; then
    gate_record_failure "${LOCAL_READY_LOG_DIR}" "infra_dependency_unready" "kind_missing" "kind is required for internal notebook backend-real coverage"
    echo "[backend-real-full-gate] kind is required for internal notebook backend-real coverage." >&2
    exit 1
  fi
  if ! command -v kubectl >/dev/null 2>&1; then
    gate_record_failure "${LOCAL_READY_LOG_DIR}" "infra_dependency_unready" "kubectl_missing" "kubectl is required for internal notebook backend-real coverage"
    echo "[backend-real-full-gate] kubectl is required for internal notebook backend-real coverage." >&2
    exit 1
  fi

  info "prewarming local kind cluster for internal notebook backend-real coverage"
  LOCAL_KIND_CLUSTER_NAME="${INTERNAL_AGENT_KIND_CLUSTER_NAME:-agentsmith}" \
  LOCAL_KIND_CONFIG_PATH="${ROOT_DIR}/infra/deploy/demo/kind/config.yaml" \
  LOCAL_KIND_CONTROL_PLANE_NODE_NAME="${INTERNAL_AGENT_KIND_CLUSTER_NAME:-agentsmith}-control-plane" \
    ensure_local_kind_cluster
}

cleanup() {
  local_runtime_stop_owned_process_tree "${LOCAL_WEB_PID}" web "${WEB_PORT}" || true
  local_runtime_stop_owned_process_tree "${LOCAL_API_ROOT_PID}" api "${API_PORT}" || true
  local_runtime_wait_port_free "${WEB_PORT}" web 10 || true
  local_runtime_wait_port_free "${API_PORT}" api 10 || true
  rm -f "${NEXT_WEB_PID_FILE}"
  backend_real_mark_run_status "${RELEASE_RUN_ROOT}" "${FINAL_STATUS}"
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
  cleanup_gate_ports "${api_port}" "${web_port}" "${command}"
  info "INTEGRATION_API_PORT=${api_port} INTEGRATION_WEB_PORT=${web_port} ${command}"
  (
    cd "${ROOT_DIR}" && \
      INTEGRATION_API_PORT="${api_port}" \
      INTEGRATION_WEB_PORT="${web_port}" \
      eval "${command}"
  )
}

run_cmd "MONGO_URL='${MONGO_URL}' MONGO_DB_NAME='${MONGO_DB_NAME}' KEYCLOAK_BASE_URL='${KEYCLOAK_BASE_URL}' KEYCLOAK_REALM='${KEYCLOAK_REALM}' KEYCLOAK_CLIENT_ID='${KEYCLOAK_CLIENT_ID}' npm run backend-real:bootstrap"
gate_record_preflight_check "${LOCAL_READY_LOG_DIR}" "backend_bootstrap" "passed" "backend-real bootstrap completed"
prewarm_internal_kind_cluster
gate_record_preflight_check "${LOCAL_READY_LOG_DIR}" "kind_cluster_ready" "passed" "${INTERNAL_AGENT_KIND_CLUSTER_NAME:-agentsmith}"
ensure_local_release_stack
ACCESS_TOKEN="$(gate_run_auth_preflight "${LOCAL_READY_LOG_DIR}" "${KEYCLOAK_BASE_URL}" "${KEYCLOAK_REALM}" "${KEYCLOAK_CLIENT_ID}" "${INTEGRATION_DEV_ADMIN_USERNAME:-dev-admin}" "${INTEGRATION_DEV_ADMIN_PASSWORD:-dev-admin-123}" "${RUNTIME_HOST_API_BASE_URL}/api/v1/me/profile" "failed to obtain release-ready token" "release-ready token missing access_token" "authenticated /api/v1/me/profile unavailable")" || exit 1
record_service auth ready "release-ready dev-admin token bootstrap"
run_cmd "env -u INTEGRATION_API_PORT -u INTEGRATION_WEB_PORT BACKEND_REAL_STATE_DIR='${RELEASE_RUN_ROOT}' API_PORT='${API_PORT}' WEB_PORT='${WEB_PORT}' API_BASE='${RUNTIME_HOST_API_BASE_URL}' BASE_URL='${RUNTIME_BROWSER_WEB_BASE_URL}' KEYCLOAK_BASE_URL='${KEYCLOAK_BASE_URL}' npm run backend-real:ready"
gate_record_preflight_check "${LOCAL_READY_LOG_DIR}" "backend_ready" "passed" "backend-real ready"
record_service backend_ready ready "backend-real ready"
run_real_cmd 20050 3051 "BACKEND_REAL_API_KEY='${BACKEND_REAL_API_KEY_VALUE}' npm run backend-real:run"
run_real_cmd 20080 3081 "BACKEND_REAL_API_KEY='${BACKEND_REAL_API_KEY_VALUE}' RELEASE_REAL_VISUAL_ARTIFACT_DIR='${ARTIFACT_DIR}' npm run test:visual:backend-real:review"
UX_TRACE_VALIDATION_REPORT="${ARTIFACT_DIR}/ux-trace-validation.json"
UX_TRACE_VALID_BUNDLES="${ARTIFACT_DIR}/ux-trace-valid-bundles.txt"
if ! run_cmd "npx tsx scripts/governance/run-release-full-aggregate.ts validate-ux-trace-root --campaign-id release-full --step-id gate-release --path '${ARTIFACT_DIR}/ux-traces' --report '${UX_TRACE_VALIDATION_REPORT}' --valid-paths '${UX_TRACE_VALID_BUNDLES}'"; then
  gate_record_failure "${LOCAL_READY_LOG_DIR}" "evidence_missing" "backend_real_ux_trace_bundle" "invalid backend-real UX trace evidence under ${ARTIFACT_DIR}/ux-traces"
  exit 1
fi
mapfile -t ux_trace_bundle_dirs < "${UX_TRACE_VALID_BUNDLES}"
if [[ "${#ux_trace_bundle_dirs[@]}" -eq 0 ]]; then
  gate_record_failure "${LOCAL_READY_LOG_DIR}" "evidence_missing" "backend_real_ux_trace_bundle" "missing release-authoritative backend-real UX trace bundle under ${ARTIFACT_DIR}/ux-traces"
  exit 1
fi
{
  printf '# Backend-real visual review\n\n'
  printf -- '- run_id: %s\n' "${RUN_ID}"
  printf -- '- artifact_dir: %s\n' "${ARTIFACT_DIR}"
  printf -- '- ux_trace_bundle_count: %s\n' "${#ux_trace_bundle_dirs[@]}"
  printf -- '- ux_trace_validation_report: %s\n\n' "${UX_TRACE_VALIDATION_REPORT}"
  printf '## Review Bundles\n\n'
  for bundle_dir in "${ux_trace_bundle_dirs[@]}"; do
    printf -- '- %s\n' "${bundle_dir}/review.md"
  done
} > "${ARTIFACT_DIR}/review.md"
run_cmd "npm run backend-real:report"

info "release-grade real verification passed"
info "artifacts written to ${ARTIFACT_DIR}"
gate_record_success "${LOCAL_READY_LOG_DIR}" "release_backend_real"
FINAL_STATUS="success"
