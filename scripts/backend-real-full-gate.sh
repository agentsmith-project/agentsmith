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
POSTGRES_PORT="${POSTGRES_PORT:-${INTEGRATION_POSTGRES_PORT:-25432}}"
MONGO_PORT="${MONGO_PORT:-${INTEGRATION_MONGO_PORT:-27027}}"
REDIS_PORT="${REDIS_PORT:-${INTEGRATION_REDIS_PORT:-26379}}"
MINIO_API_PORT="${MINIO_API_PORT:-${INTEGRATION_MINIO_API_PORT:-29000}}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-${INTEGRATION_MINIO_CONSOLE_PORT:-29001}}"
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:${MONGO_PORT}/admin}"
MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"
API_PORT="${PORT_API:-${API_PORT:-20090}}"
WEB_PORT="${PORT_WEB:-${WEB_PORT:-3091}}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-${INTEGRATION_KEYCLOAK_PORT:-28081}}"
RUN_ID="${RELEASE_REAL_VISUAL_RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
ARTIFACT_DIR="${RELEASE_REAL_VISUAL_ARTIFACT_DIR:-${ROOT_DIR}/artifacts/backend-real-visual/${RUN_ID}}"
AUTHORITATIVE_UX_TRACE_ROOT="${ARTIFACT_DIR}/ux-traces"
VISUAL_REVIEW_ARTIFACT_DIR="${ARTIFACT_DIR}/visual-review"
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


if [[ -z "${PRESET_ENDPOINT_API_KEY_VALUE}" ]]; then
  gate_record_failure "${LOCAL_READY_LOG_DIR}" "infra_dependency_unready" "endpoint_env" "Missing PRESET_ENDPOINT_API_KEY"
  echo "[backend-real-full-gate] Missing PRESET_ENDPOINT_API_KEY." >&2
  echo "[backend-real-full-gate] Export PRESET_ENDPOINT_API_KEY before running this gate." >&2
  exit 1
fi

info() { echo "[backend-real-full-gate] $*"; }

run_clean() {
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY "$@"
}

fail_if_release_stack_port_already_in_use() {
  local service_kind="$1"
  local port="$2"

  if ! local_runtime_port_is_listening "${port}"; then
    return 0
  fi

  gate_record_failure "${LOCAL_READY_LOG_DIR}" "environment_conflict" "release_stack_${service_kind}_port" "parent stack reuse requires release-owned API/Web ports; ${service_kind} port ${port} was already in use before this gate started it"
  echo "[backend-real-full-gate] parent stack reuse requires release-owned API/Web ports; ${service_kind} port ${port} is already in use before this gate started it." >&2
  exit 1
}

ensure_local_release_stack() {
  mkdir -p "${LOCAL_READY_LOG_DIR}"

  fail_if_release_stack_port_already_in_use api "${API_PORT}"
  fail_if_release_stack_port_already_in_use web "${WEB_PORT}"

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
      DATABASE_URL="${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:${POSTGRES_PORT}/mbos}" \
      MONGO_URL="${MONGO_URL}" \
      MONGO_DB_NAME="${MONGO_DB_NAME}" \
      REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}}" \
      MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}" \
      MINIO_PORT="${MINIO_PORT:-${MINIO_API_PORT}}" \
      MINIO_USE_SSL="${MINIO_USE_SSL:-false}" \
      MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}" \
      MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}" \
      MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}" \
      npm run api:node:dev
  )"
  LOCAL_API_PID="$(local_runtime_capture_authoritative_service_pid "${LOCAL_API_ROOT_PID}" api "${API_PORT}" 120)"

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
  local kind_cluster_name
  local kind_context_name
  kind_cluster_name="${INTERNAL_AGENT_KIND_CLUSTER_NAME:-agentsmith}"
  kind_context_name="kind-${kind_cluster_name}"

  if ! command -v kind >/dev/null 2>&1; then
    gate_record_failure "${LOCAL_READY_LOG_DIR}" "infra_dependency_unready" "kind_missing" "kind is required for internal agent-task backend-real coverage"
    echo "[backend-real-full-gate] kind is required for internal agent-task backend-real coverage." >&2
    exit 1
  fi
  if ! command -v kubectl >/dev/null 2>&1; then
    gate_record_failure "${LOCAL_READY_LOG_DIR}" "infra_dependency_unready" "kubectl_missing" "kubectl is required for internal agent-task backend-real coverage"
    echo "[backend-real-full-gate] kubectl is required for internal agent-task backend-real coverage." >&2
    exit 1
  fi

  kubectl config use-context "${kind_context_name}" >/dev/null 2>&1 || true

  info "ensuring local kind cluster for internal agent-task backend-real coverage"
  LOCAL_KIND_CLUSTER_NAME="${kind_cluster_name}" \
  LOCAL_KIND_CONFIG_PATH="${ROOT_DIR}/infra/deploy/unified/local-kind/config.yaml" \
  LOCAL_KIND_CONTROL_PLANE_NODE_NAME="${kind_cluster_name}-control-plane" \
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
  info "INTEGRATION_API_PORT=${api_port} INTEGRATION_WEB_PORT=${web_port} PRESET_ENDPOINT_API_KEY=<redacted> ${command}"
  (
    cd "${ROOT_DIR}"
    export INTEGRATION_API_PORT="${api_port}"
    export INTEGRATION_WEB_PORT="${web_port}"
    export PRESET_ENDPOINT_API_KEY="${PRESET_ENDPOINT_API_KEY_VALUE}"
    eval "${command}"
  )
}

run_release_browser_trace_specs() {
  run_release_browser_trace_spec "e2e/integration-system-admin-entry.spec.ts"
  run_release_browser_trace_spec "e2e/integration-workspace-public-login.spec.ts"
  run_release_browser_trace_spec "e2e/integration-workspace-entry.spec.ts"
  run_release_browser_trace_spec "e2e/integration-workspace-publish-usable.spec.ts"
  run_release_browser_trace_spec "e2e/integration-workspace-settings-directory.spec.ts"
}

run_release_browser_trace_spec() {
  local spec_file="$1"
  local spec_slug
  spec_slug="$(basename "${spec_file}" .spec.ts)"
  info "reusing parent-owned release stack for ${spec_file}"
  (
    cd "${ROOT_DIR}"
    export INTEGRATION_PARENT_STACK_REUSE=true
    export INTEGRATION_PARENT_STACK_DEPS_READY=true
    export INTEGRATION_PARENT_STACK_DEPS_INIT_READY=true
    export INTEGRATION_PARENT_STACK_OWNER_TOKEN="${LOCAL_RUNTIME_OWNER_TOKEN}"
    export INTEGRATION_PARENT_STACK_RUN_ROOT="${RELEASE_RUN_ROOT}"
    export INTEGRATION_PARENT_STACK_PROCESS_STATE_DIR="${LOCAL_RUNTIME_PROCESS_STATE_DIR}"
    export INTEGRATION_PARENT_STACK_API_ROOT_PID="${LOCAL_API_ROOT_PID}"
    export INTEGRATION_PARENT_STACK_API_PID="${LOCAL_API_PID}"
    export INTEGRATION_PARENT_STACK_WEB_ROOT_PID="${LOCAL_WEB_PID}"
    export INTEGRATION_PARENT_STACK_API_PORT="${API_PORT}"
    export INTEGRATION_PARENT_STACK_WEB_PORT="${WEB_PORT}"
    export INTEGRATION_PARENT_STACK_POSTGRES_PORT="${POSTGRES_PORT}"
    export INTEGRATION_PARENT_STACK_MONGO_PORT="${MONGO_PORT}"
    export INTEGRATION_PARENT_STACK_REDIS_PORT="${REDIS_PORT}"
    export INTEGRATION_PARENT_STACK_MINIO_API_PORT="${MINIO_API_PORT}"
    export INTEGRATION_PARENT_STACK_MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT}"
    export INTEGRATION_PARENT_STACK_KEYCLOAK_PORT="${KEYCLOAK_PORT}"
    export INTEGRATION_PARENT_STACK_API_BASE="${RUNTIME_HOST_API_BASE_URL}"
    export INTEGRATION_PARENT_STACK_WEB_BASE_URL="${RUNTIME_BROWSER_WEB_BASE_URL}"
    export INTEGRATION_PARENT_STACK_HOST_WEB_BASE_URL="${RUNTIME_HOST_WEB_BASE_URL}"
    export INTEGRATION_PARENT_STACK_KEYCLOAK_BASE_URL="http://127.0.0.1:${KEYCLOAK_PORT}"
    export INTEGRATION_PARENT_STACK_KEYCLOAK_REALM="${KEYCLOAK_REALM}"
    export INTEGRATION_PARENT_STACK_KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}"
    export INTEGRATION_PARENT_STACK_MONGO_URL="${MONGO_URL}"
    export INTEGRATION_PARENT_STACK_MONGO_DB_NAME="${MONGO_DB_NAME}"
    export INTEGRATION_PARENT_STACK_DATABASE_URL="${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:${POSTGRES_PORT}/mbos}"
    export INTEGRATION_PARENT_STACK_REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}}"
    export INTEGRATION_PARENT_STACK_MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
    export INTEGRATION_PARENT_STACK_MINIO_PORT="${MINIO_PORT:-${MINIO_API_PORT}}"
    export INTEGRATION_API_PORT="${API_PORT}"
    export INTEGRATION_WEB_PORT="${WEB_PORT}"
    export INTEGRATION_POSTGRES_PORT="${POSTGRES_PORT}"
    export INTEGRATION_MONGO_PORT="${MONGO_PORT}"
    export INTEGRATION_REDIS_PORT="${REDIS_PORT}"
    export INTEGRATION_MINIO_API_PORT="${MINIO_API_PORT}"
    export INTEGRATION_MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT}"
    export INTEGRATION_KEYCLOAK_PORT="${KEYCLOAK_PORT}"
    export INTEGRATION_BASE_URL="${RUNTIME_BROWSER_WEB_BASE_URL}"
    export INTEGRATION_API_BASE="${RUNTIME_HOST_API_BASE_URL}"
    export INTEGRATION_RUN_ID="${RUN_ID}-${spec_slug}"
    export INTEGRATION_RUN_ROOT="${RELEASE_RUN_ROOT}/browser-trace-specs/${spec_slug}"
    export INTEGRATION_LOG_DIR="${RELEASE_RUN_ROOT}/browser-trace-specs/${spec_slug}/integration"
    export UX_TRACE_OUTPUT_ROOT="${AUTHORITATIVE_UX_TRACE_ROOT}"
    export PRESET_ENDPOINT_API_KEY="${PRESET_ENDPOINT_API_KEY_VALUE}"
    export DATABASE_URL="${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:${POSTGRES_PORT}/mbos}"
    export REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}}"
    export MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
    export MINIO_PORT="${MINIO_PORT:-${MINIO_API_PORT}}"
    bash scripts/run-integration-e2e-full.sh "${spec_file}"
  )
}

run_cmd "POSTGRES_PORT='${POSTGRES_PORT}' MONGO_PORT='${MONGO_PORT}' REDIS_PORT='${REDIS_PORT}' MINIO_API_PORT='${MINIO_API_PORT}' MINIO_CONSOLE_PORT='${MINIO_CONSOLE_PORT}' KEYCLOAK_PORT='${KEYCLOAK_PORT}' API_PORT='${API_PORT}' WEB_PORT='${WEB_PORT}' MONGO_URL='${MONGO_URL}' MONGO_DB_NAME='${MONGO_DB_NAME}' KEYCLOAK_BASE_URL='${KEYCLOAK_BASE_URL}' KEYCLOAK_REALM='${KEYCLOAK_REALM}' KEYCLOAK_CLIENT_ID='${KEYCLOAK_CLIENT_ID}' npm run backend-real:bootstrap"
gate_record_preflight_check "${LOCAL_READY_LOG_DIR}" "backend_bootstrap" "passed" "backend-real bootstrap completed"
prewarm_internal_kind_cluster
gate_record_preflight_check "${LOCAL_READY_LOG_DIR}" "kind_cluster_ready" "passed" "${INTERNAL_AGENT_KIND_CLUSTER_NAME:-agentsmith}"
ensure_local_release_stack
ACCESS_TOKEN="$(gate_run_auth_preflight "${LOCAL_READY_LOG_DIR}" "${KEYCLOAK_BASE_URL}" "${KEYCLOAK_REALM}" "${KEYCLOAK_CLIENT_ID}" "${INTEGRATION_DEV_ADMIN_USERNAME:-dev-admin}" "${INTEGRATION_DEV_ADMIN_PASSWORD:-dev-admin-123}" "${RUNTIME_HOST_API_BASE_URL}/api/v1/me/profile" "failed to obtain release-ready token" "release-ready token missing access_token" "authenticated /api/v1/me/profile unavailable")" || exit 1
record_service auth ready "release-ready dev-admin token bootstrap"
run_cmd "env -u INTEGRATION_API_PORT -u INTEGRATION_WEB_PORT BACKEND_REAL_READY_PROBE_ONLY=1 INTEGRATION_PARENT_STACK_REUSE=true BACKEND_REAL_STATE_DIR='${RELEASE_RUN_ROOT}' API_PORT='${API_PORT}' WEB_PORT='${WEB_PORT}' KEYCLOAK_PORT='${KEYCLOAK_PORT}' API_BASE='${RUNTIME_HOST_API_BASE_URL}' BASE_URL='${RUNTIME_BROWSER_WEB_BASE_URL}' KEYCLOAK_BASE_URL='${KEYCLOAK_BASE_URL}' npm run backend-real:ready"
gate_record_preflight_check "${LOCAL_READY_LOG_DIR}" "backend_ready" "passed" "backend-real ready"
record_service backend_ready ready "backend-real ready"
run_real_cmd 20050 3051 "npm run backend-real:run"
run_real_cmd 21020 3121 "npm run test:e2e:integration:files:user-stories:restore-continue"
run_real_cmd 20080 3081 "RELEASE_REAL_VISUAL_ARTIFACT_DIR='${VISUAL_REVIEW_ARTIFACT_DIR}' npm run test:visual:backend-real:review"
run_release_browser_trace_specs
run_real_cmd 20074 3074 "ARTIFACT_DIR='${ARTIFACT_DIR}' RESET_FIRST=0 bash scripts/run-integration-release-user-story.sh"
UX_TRACE_VALIDATION_REPORT="${ARTIFACT_DIR}/ux-trace-validation.json"
UX_TRACE_VALID_BUNDLES="${ARTIFACT_DIR}/ux-trace-valid-bundles.txt"
if ! run_cmd "npx tsx scripts/governance/run-release-full-aggregate.ts validate-ux-trace-root --campaign-id release-full --step-id gate-release --path '${AUTHORITATIVE_UX_TRACE_ROOT}' --report '${UX_TRACE_VALIDATION_REPORT}' --valid-paths '${UX_TRACE_VALID_BUNDLES}'"; then
  gate_record_failure "${LOCAL_READY_LOG_DIR}" "evidence_missing" "backend_real_ux_trace_bundle" "invalid backend-real UX trace evidence under ${AUTHORITATIVE_UX_TRACE_ROOT}"
  exit 1
fi
mapfile -t ux_trace_bundle_dirs < "${UX_TRACE_VALID_BUNDLES}"
if [[ "${#ux_trace_bundle_dirs[@]}" -eq 0 ]]; then
  gate_record_failure "${LOCAL_READY_LOG_DIR}" "evidence_missing" "backend_real_ux_trace_bundle" "missing release-authoritative backend-real UX trace bundle under ${AUTHORITATIVE_UX_TRACE_ROOT}"
  exit 1
fi
{
  printf '# Backend-real Release Gate\n\n'
  printf -- '- run_id: %s\n' "${RUN_ID}"
  printf -- '- artifact_dir: %s\n' "${ARTIFACT_DIR}"
  printf -- '- authoritative_ux_trace_root: %s\n' "${AUTHORITATIVE_UX_TRACE_ROOT}"
  printf -- '- visual_review_artifact_dir: %s\n' "${VISUAL_REVIEW_ARTIFACT_DIR}"
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
