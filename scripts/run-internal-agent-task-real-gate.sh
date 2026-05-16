#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX_ROOT="$(cd "${ROOT_DIR}/../mbos-sandbox-v1" && pwd)"
KIND_CONFIG_PATH="${ROOT_DIR}/infra/deploy/unified/local-kind/config.yaml"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/k8s-external-services.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
source "${ROOT_DIR}/scripts/lib/internal-backend-real-gate.sh"
source "${ROOT_DIR}/scripts/lib/runner-image-common.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-gate-ports.sh"
source "${ROOT_DIR}/scripts/lib/run-readiness-state.sh"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/scenarios/common.sh"
GATE_MODE="workspace"
PLAYWRIGHT_PASSTHROUGH_ARGS=()
if [[ "${1:-}" == "--skills-runtime" ]]; then
  GATE_MODE="skills-runtime"
  shift
elif [[ "${1:-}" == "--visual-review" ]]; then
  GATE_MODE="visual-review"
  shift
elif [[ "${1:-}" == "--files-restore-continue" ]]; then
  GATE_MODE="files-restore-continue"
  shift
fi
if [[ "${1:-}" == "--" ]]; then
  shift
  PLAYWRIGHT_PASSTHROUGH_ARGS=("$@")
  set --
fi
if [[ "$#" -ne 0 ]]; then
  echo "[internal-real-gate] unsupported arguments: $*" >&2
  exit 1
fi
ORIGINAL_INTEGRATION_API_PORT="${INTEGRATION_API_PORT:-}"
ORIGINAL_INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT:-}"
ORIGINAL_INTEGRATION_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT:-}"
ORIGINAL_INTEGRATION_MONGO_PORT="${INTEGRATION_MONGO_PORT:-}"
ORIGINAL_INTEGRATION_REDIS_PORT="${INTEGRATION_REDIS_PORT:-}"
ORIGINAL_INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT:-}"
ORIGINAL_INTEGRATION_MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT:-}"
ORIGINAL_INTEGRATION_KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT:-}"
load_backend_real_env
if [[ -n "${ORIGINAL_INTEGRATION_API_PORT}" ]]; then
  export INTEGRATION_API_PORT="${ORIGINAL_INTEGRATION_API_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_WEB_PORT}" ]]; then
  export INTEGRATION_WEB_PORT="${ORIGINAL_INTEGRATION_WEB_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_POSTGRES_PORT}" ]]; then
  export INTEGRATION_POSTGRES_PORT="${ORIGINAL_INTEGRATION_POSTGRES_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_MONGO_PORT}" ]]; then
  export INTEGRATION_MONGO_PORT="${ORIGINAL_INTEGRATION_MONGO_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_REDIS_PORT}" ]]; then
  export INTEGRATION_REDIS_PORT="${ORIGINAL_INTEGRATION_REDIS_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_MINIO_API_PORT}" ]]; then
  export INTEGRATION_MINIO_API_PORT="${ORIGINAL_INTEGRATION_MINIO_API_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_MINIO_CONSOLE_PORT}" ]]; then
  export INTEGRATION_MINIO_CONSOLE_PORT="${ORIGINAL_INTEGRATION_MINIO_CONSOLE_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_KEYCLOAK_PORT}" ]]; then
  export INTEGRATION_KEYCLOAK_PORT="${ORIGINAL_INTEGRATION_KEYCLOAK_PORT}"
fi
export_backend_real_endpoint_env

API_PORT="${INTEGRATION_API_PORT:-20072}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3072}"
INTEGRATION_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT:-25432}"
INTEGRATION_MONGO_PORT="${INTEGRATION_MONGO_PORT:-27027}"
INTEGRATION_REDIS_PORT="${INTEGRATION_REDIS_PORT:-26379}"
INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT:-29000}"
INTEGRATION_MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT:-29001}"
INTEGRATION_KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT:-28081}"
SANDBOX_PORT="${INTERNAL_SANDBOX_MANAGER_PORT:-28080}"
SANDBOX_SERVICE_KEY_VALUE="${SANDBOX_SERVICE_KEY:-agentsmith-internal-test-key}"
K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-sandbox}"
CSI_DRIVER="${AFSCP_STORAGE_CSI_DRIVER:-csi.juicefs.com}"
RUNNER_KIND="${INTEGRATION_INTERNAL_AGENT_RUNNER_KIND:-agent-task}"
RUNNER_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-$(runner_default_image "${RUNNER_KIND}")}"
RUNNER_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_BASE_IMAGE:-$(runner_default_base_image "${RUNNER_KIND}")}"
BUILD_RUNNER_IMAGE="${INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE:-1}"
DOCKER_BUILD_PROXY_VALUE="${INTEGRATION_DOCKER_BUILD_PROXY:-${DOCKER_BUILD_PROXY:-}}"
STORAGE_CAPACITY="${AFSCP_STORAGE_CAPACITY:-1Pi}"
STORAGE_CLASS_NAME="${AFSCP_STORAGE_CLASS_NAME:-}"
MOUNT_OPTIONS="${AFSCP_STORAGE_CSI_MOUNT_OPTIONS:-}"
SUBDIR="${AFSCP_STORAGE_CSI_SUBDIR:-}"
MOUNT_SERVICE_ACCOUNT="${AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT:-}"
MOUNT_IMAGE_OVERRIDE="${AFSCP_STORAGE_CSI_MOUNT_IMAGE:-}"
AFSCP_STORAGE_CSI_MOUNT_IMAGE="${AFSCP_STORAGE_CSI_MOUNT_IMAGE:-juicedata/mount:ce-v1.3.1}"
AFSCP_STORAGE_CSI_VERSION="${AFSCP_STORAGE_CSI_VERSION:-v0.31.3}"
AFSCP_STORAGE_CSI_MANIFEST_PATH="${AFSCP_STORAGE_CSI_MANIFEST_PATH:-${ROOT_DIR}/infra/deploy/unified/local-kind/juicefs-csi/upstream-manifest.yaml}"
AFSCP_STORAGE_CSI_NAMESPACE="${AFSCP_STORAGE_CSI_NAMESPACE:-kube-system}"
ensure_backend_real_state
INTERNAL_REAL_DIR="${INTERNAL_REAL_DIR:-$(backend_real_tmp_file internal)}"
mkdir -p "${INTERNAL_REAL_DIR}"
INTERNAL_REAL_DIR="$(realpath -m "${INTERNAL_REAL_DIR}")"
export RUNTIME_LINE_ID="${RUNTIME_LINE_ID:-$(basename "${INTERNAL_REAL_DIR}")}"
export RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-managed_runner}"
AFSCP_BASE_URL="${AFSCP_BASE_URL:-http://127.0.0.1:$((API_PORT + 9030))}"
AFSCP_EXPORT_GATEWAY_BASE_URL="${AFSCP_EXPORT_GATEWAY_BASE_URL:-http://127.0.0.1:$((API_PORT + 9031))}"
AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID:-vol_internal_${API_PORT}}"
AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE:-agentsmith-api}"
AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE:-agentsmith-bootstrap}"
AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-manager}"
AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN:-agentsmith-local-afscp-product-token}"
AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN:-agentsmith-local-afscp-bootstrap-token}"
AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-agentsmith-local-afscp-orchestrator-token}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
clear_runtime_stack_env
resolve_loopback_runtime_stack "${API_PORT}" "${WEB_PORT}" "${INTEGRATION_KEYCLOAK_PORT}" "${KEYCLOAK_REALM}" "${KEYCLOAK_CLIENT_ID}"
gate_evidence_init "${INTERNAL_REAL_DIR}" "internal_backend_real"
gate_write_runtime_descriptor "${INTERNAL_REAL_DIR}" "internal_backend_real"
gate_write_resolved_env "${INTERNAL_REAL_DIR}"
SANDBOX_LOG="${INTERNAL_SANDBOX_MANAGER_LOG:-${INTERNAL_REAL_DIR}/sandbox-manager.log}"
CONFIG_PATH="${INTERNAL_SANDBOX_MANAGER_CONFIG:-${INTERNAL_REAL_DIR}/sandbox-manager.yaml}"
CONFIG_PATH="$(realpath -m "${CONFIG_PATH}")"
CONTROL_SCRIPT="${ROOT_DIR}/scripts/lib/internal-sandbox-real-control.sh"
STATE_FILE="${INTERNAL_REAL_DIR}/sandbox-control.env"
SANDBOX_LOG="$(realpath -m "${SANDBOX_LOG}")"
SANDBOX_LOG_DIR="$(dirname "${SANDBOX_LOG}")"
mkdir -p "${SANDBOX_LOG_DIR}"
INTERNAL_VISUAL_ARTIFACT_DIR="${INTERNAL_REAL_VISUAL_ARTIFACT_DIR:-${ROOT_DIR}/artifacts/backend-real-visual/internal-$(date +%Y%m%d-%H%M%S)}"
KEEP_FAILED_ENV="${INTERNAL_REAL_KEEP_FAILED_ENV:-0}"
GATE_STATUS=0
CURRENT_SANDBOX_STATE_FILE=""
CONTEXT_NAME="$(kubectl config current-context 2>/dev/null || true)"
DEFAULT_KIND_CLUSTER_NAME="agentsmith"
if [[ -z "${INTERNAL_AGENT_KIND_CLUSTER_NAME:-}" ]] && kind get clusters 2>/dev/null | grep -qx 'mbos'; then
  DEFAULT_KIND_CLUSTER_NAME="mbos"
fi
KIND_CLUSTER_NAME="${INTERNAL_AGENT_KIND_CLUSTER_NAME:-${DEFAULT_KIND_CLUSTER_NAME}}"
KIND_CONTEXT_NAME="kind-${KIND_CLUSTER_NAME}"
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:${INTEGRATION_MONGO_PORT}/admin}"
MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"

info() { echo "[internal-real-gate] $*"; }

ensure_internal_integration_deps_for_afscp() {
  (
    cd "${ROOT_DIR}" && \
      POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}" \
      MONGO_PORT="${INTEGRATION_MONGO_PORT}" \
      REDIS_PORT="${INTEGRATION_REDIS_PORT}" \
      MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}" \
      MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT}" \
      KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT}" \
      make deps-bootstrap && \
      POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}" \
      npm run integration:deps:init:postgres
  )
}

wait_for_internal_integration_deps_for_afscp() {
  gate_wait_for_tcp "${INTERNAL_REAL_DIR}" "127.0.0.1" "${INTEGRATION_POSTGRES_PORT}" 120 infra_dependency_unready postgres_ready
  gate_wait_for_tcp "${INTERNAL_REAL_DIR}" "127.0.0.1" "${INTEGRATION_MONGO_PORT}" 120 infra_dependency_unready mongo_ready
  gate_wait_for_tcp "${INTERNAL_REAL_DIR}" "127.0.0.1" "${INTEGRATION_REDIS_PORT}" 120 infra_dependency_unready redis_ready
  gate_wait_for_http "${INTERNAL_REAL_DIR}" "http://127.0.0.1:${INTEGRATION_MINIO_API_PORT}/minio/health/live" 120 infra_dependency_unready minio_ready 200
  gate_wait_for_http "${INTERNAL_REAL_DIR}" "http://127.0.0.1:${INTEGRATION_KEYCLOAK_PORT}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" 180 infra_dependency_unready keycloak_ready 200
}

enable_files_restore_continuation_afscp_restore_recovery() {
  if [[ "${GATE_MODE}" == "files-restore-continue" ]]; then
    export AFSCP_RESTORE_RECOVERY_ENABLED="${AFSCP_RESTORE_RECOVERY_ENABLED:-true}"
  fi
}

prepare_internal_spec_port_pair() {
  local api_port="$1"
  local web_port="$2"

  backend_real_gate_cleanup_listener "${api_port}" api || return 1
  backend_real_gate_cleanup_listener "${web_port}" web || return 1
  wait_port_free "${api_port}" api || return 1
  wait_port_free "${web_port}" web || return 1
}

resolve_internal_spec_port_pair() {
  local preferred_api_port="$1"
  local preferred_web_port="$2"
  local spec="$3"
  local api_base="${INTERNAL_REAL_SPEC_API_PORT_BASE:-23000}"
  local web_base="${INTERNAL_REAL_SPEC_WEB_PORT_BASE:-33000}"
  local attempts="${INTERNAL_REAL_SPEC_PORT_SCAN_ATTEMPTS:-200}"
  local offset api_port web_port

  if prepare_internal_spec_port_pair "${preferred_api_port}" "${preferred_web_port}"; then
    printf '%s %s\n' "${preferred_api_port}" "${preferred_web_port}"
    return 0
  fi

  echo "[internal-real-gate] preferred ports api=${preferred_api_port} web=${preferred_web_port} unavailable for ${spec}; selecting isolated fallback ports" >&2
  for offset in $(seq 0 "${attempts}"); do
    api_port="$((api_base + offset))"
    web_port="$((web_base + offset))"
    if [[ "${api_port}" == "${preferred_api_port}" || "${web_port}" == "${preferred_web_port}" ]]; then
      continue
    fi
    if prepare_internal_spec_port_pair "${api_port}" "${web_port}"; then
      echo "[internal-real-gate] using isolated fallback ports api=${api_port} web=${web_port} for ${spec}" >&2
      printf '%s %s\n' "${api_port}" "${web_port}"
      return 0
    fi
  done

  echo "[internal-real-gate] unable to find isolated ports for ${spec} after ${attempts} attempts" >&2
  return 1
}

ensure_internal_afscp_local_runtime() {
  info "ensuring AFSCP local runtime at ${AFSCP_BASE_URL}"
  (
    export INTERNAL_REAL_DIR
    export ENV_FILE=/dev/null
    export INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}"
    export AFSCP_BASE_URL
    export AFSCP_EXPORT_GATEWAY_BASE_URL
    export AFSCP_DEFAULT_VOLUME_ID
    export AFSCP_CALLER_SERVICE
    export AFSCP_BOOTSTRAP_CALLER_SERVICE
    export AFSCP_ORCHESTRATOR_CALLER_SERVICE
    export AFSCP_SERVICE_TOKEN
    export AFSCP_BOOTSTRAP_SERVICE_TOKEN
    export AFSCP_ORCHESTRATOR_SERVICE_TOKEN
    export LOCAL_MANUAL_INTERNAL_ENV_FILE=/dev/null
    export DATABASE_URL="postgresql://mbos:mbos_dev_password@localhost:${INTEGRATION_POSTGRES_PORT}/mbos?sslmode=disable"
    export AFSCP_DATABASE_URL="${DATABASE_URL}"
    export AFSCP_POSTGRES_DSN="${DATABASE_URL}"
    export AFSCP_API_POSTGRES_DSN="${DATABASE_URL}"
    export AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN="${DATABASE_URL}"
    export AFSCP_EXPORT_GATEWAY_POSTGRES_DSN="${DATABASE_URL}"
    export POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}"
    export MONGO_PORT="${INTEGRATION_MONGO_PORT}"
    export REDIS_PORT="${INTEGRATION_REDIS_PORT}"
    export MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}"
    export MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT}"
    export KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT}"
    export SUBSTRATE_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}"
    export SUBSTRATE_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}"
    export MINIO_PORT="${INTEGRATION_MINIO_API_PORT}"
    export MINIO_ENDPOINT="localhost"
    export MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
    export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
    export MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"
    export AFSCP_STORAGE_CSI_DRIVER="${CSI_DRIVER}"
    export AFSCP_STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME}"
    export AFSCP_STORAGE_CSI_MOUNT_OPTIONS="${MOUNT_OPTIONS}"
    export AFSCP_STORAGE_CSI_SUBDIR="${SUBDIR}"
    export AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT="${MOUNT_SERVICE_ACCOUNT}"
    export AFSCP_STORAGE_CSI_MOUNT_IMAGE="${AFSCP_STORAGE_CSI_MOUNT_IMAGE}"
    export AFSCP_STORAGE_CSI_NAMESPACE="${AFSCP_STORAGE_CSI_NAMESPACE}"
    # shellcheck disable=SC1091
    source "${ROOT_DIR}/scripts/local-manual/internal-common.sh"
    ensure_afscp_local_runtime
  )
}

stop_internal_afscp_local_runtime() {
  (
    export INTERNAL_REAL_DIR
    export ENV_FILE=/dev/null
    export INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}"
    export AFSCP_BASE_URL
    export AFSCP_EXPORT_GATEWAY_BASE_URL
    export AFSCP_DEFAULT_VOLUME_ID
    export AFSCP_CALLER_SERVICE
    export AFSCP_BOOTSTRAP_CALLER_SERVICE
    export AFSCP_ORCHESTRATOR_CALLER_SERVICE
    export AFSCP_SERVICE_TOKEN
    export AFSCP_BOOTSTRAP_SERVICE_TOKEN
    export AFSCP_ORCHESTRATOR_SERVICE_TOKEN
    export LOCAL_MANUAL_INTERNAL_ENV_FILE=/dev/null
    export POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}"
    export MONGO_PORT="${INTEGRATION_MONGO_PORT}"
    export REDIS_PORT="${INTEGRATION_REDIS_PORT}"
    export MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}"
    export MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT}"
    export KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT}"
    # shellcheck disable=SC1091
    source "${ROOT_DIR}/scripts/local-manual/internal-common.sh"
    stop_afscp_local_runtime
  ) >/dev/null 2>&1 || true
}

reset_internal_afscp_local_runtime() {
  info "resetting owned AFSCP local runtime before gate start"
  stop_internal_afscp_local_runtime
  (
    export INTERNAL_REAL_DIR
    export ENV_FILE=/dev/null
    export INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}"
    export AFSCP_BASE_URL
    export AFSCP_EXPORT_GATEWAY_BASE_URL
    export AFSCP_DEFAULT_VOLUME_ID
    export AFSCP_CALLER_SERVICE
    export AFSCP_BOOTSTRAP_CALLER_SERVICE
    export AFSCP_ORCHESTRATOR_CALLER_SERVICE
    export AFSCP_SERVICE_TOKEN
    export AFSCP_BOOTSTRAP_SERVICE_TOKEN
    export AFSCP_ORCHESTRATOR_SERVICE_TOKEN
    export LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION=1
    export LOCAL_MANUAL_INTERNAL_ENV_FILE=/dev/null
    export DATABASE_URL="postgresql://mbos:mbos_dev_password@localhost:${INTEGRATION_POSTGRES_PORT}/mbos?sslmode=disable"
    export AFSCP_DATABASE_URL="${DATABASE_URL}"
    export AFSCP_POSTGRES_DSN="${DATABASE_URL}"
    export AFSCP_API_POSTGRES_DSN="${DATABASE_URL}"
    export AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN="${DATABASE_URL}"
    export AFSCP_EXPORT_GATEWAY_POSTGRES_DSN="${DATABASE_URL}"
    export AFSCP_ENVIRONMENT=local-real
    export POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}"
    export MONGO_PORT="${INTEGRATION_MONGO_PORT}"
    export REDIS_PORT="${INTEGRATION_REDIS_PORT}"
    export MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}"
    export MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT}"
    export KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT}"
    export SUBSTRATE_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}"
    export SUBSTRATE_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}"
    export MINIO_PORT="${INTEGRATION_MINIO_API_PORT}"
    export MINIO_ENDPOINT="localhost"
    export MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
    export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
    export MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"
    export AFSCP_STORAGE_CSI_DRIVER="${CSI_DRIVER}"
    export AFSCP_STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME}"
    export AFSCP_STORAGE_CSI_MOUNT_OPTIONS="${MOUNT_OPTIONS}"
    export AFSCP_STORAGE_CSI_SUBDIR="${SUBDIR}"
    export AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT="${MOUNT_SERVICE_ACCOUNT}"
    export AFSCP_STORAGE_CSI_MOUNT_IMAGE="${AFSCP_STORAGE_CSI_MOUNT_IMAGE}"
    export AFSCP_STORAGE_CSI_NAMESPACE="${AFSCP_STORAGE_CSI_NAMESPACE}"
    # shellcheck disable=SC1091
    source "${ROOT_DIR}/scripts/local-manual/internal-common.sh"
    reset_owned_afscp_local_runtime_data
  )
}

record_service() {
  local service_name="$1"
  local status="$2"
  local detail="${3:-}"
  gate_record_service_status "${INTERNAL_REAL_DIR}" "${service_name}" "${status}" "${detail}"
}

if [[ -z "${BACKEND_REAL_API_KEY_VALUE}" ]]; then
  gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "endpoint_env" "Missing PRESET_ENDPOINT_API_KEY"
  echo "[internal-backend-real-gate] Missing PRESET_ENDPOINT_API_KEY." >&2
  exit 1
fi

cleanup() {
  if [[ "${KEEP_FAILED_ENV}" == "1" && "${GATE_STATUS}" -ne 0 ]]; then
    info "keeping failed sandbox manager environment for inspection"
    if [[ -n "${CURRENT_SANDBOX_STATE_FILE}" && -f "${CURRENT_SANDBOX_STATE_FILE}" ]]; then
      # shellcheck disable=SC1090
      source "${CURRENT_SANDBOX_STATE_FILE}"
      info "sandbox_log=${SANDBOX_LOG}"
      info "state_file=${CURRENT_SANDBOX_STATE_FILE}"
    else
      info "sandbox_log=${SANDBOX_LOG}"
      info "state_file=${STATE_FILE}"
    fi
    info "visual_artifacts=${INTERNAL_VISUAL_ARTIFACT_DIR}"
    return 0
  fi
  stop_internal_afscp_local_runtime
  if [[ -n "${CURRENT_SANDBOX_STATE_FILE}" ]]; then
    INTERNAL_SANDBOX_REAL_STATE_FILE="${CURRENT_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

stop_internal_afscp_local_runtime
ensure_internal_integration_deps_for_afscp
wait_for_internal_integration_deps_for_afscp
reset_internal_afscp_local_runtime
enable_files_restore_continuation_afscp_restore_recovery
prepare_internal_backend_real_gate_runtime
gate_record_preflight_check "${INTERNAL_REAL_DIR}" "kind_cluster" "passed" "${KIND_CLUSTER_NAME}"
record_service kind_cluster ready "${KIND_CLUSTER_NAME}"
gate_record_preflight_check "${INTERNAL_REAL_DIR}" "afscp_storage_csi" "passed" "${CSI_DRIVER}"
record_service afscp_storage_csi ready "${CSI_DRIVER}"
gate_record_preflight_check "${INTERNAL_REAL_DIR}" "external_dependency_services" "passed" "${EXTERNAL_DEPS_MANIFEST}"
record_service external_dependency_services ready "${EXTERNAL_DEPS_MANIFEST}"
gate_record_preflight_check "${INTERNAL_REAL_DIR}" "afscp_local_runtime" "passed" "${AFSCP_BASE_URL}"
record_service afscp_local_runtime ready "${AFSCP_BASE_URL}"

if [[ "${GATE_MODE}" == "skills-runtime" ]]; then
  info "running internal agent-task skills runtime real integration"
elif [[ "${GATE_MODE}" == "visual-review" ]]; then
  info "running backend-real visual review with internal managed Agent Task sandbox"
elif [[ "${GATE_MODE}" == "files-restore-continue" ]]; then
  info "running Files restore continuation with internal managed Agent Task sandbox"
else
  info "running internal agent-task workspace real integration"
fi
info "internal screenshots and review artifacts will be written to:"
info "  ${INTERNAL_VISUAL_ARTIFACT_DIR}"
run_internal_spec() {
  local spec="$1"
  local spec_api_port="$2"
  local spec_web_port="$3"
  local spec_state_file="$4"
  shift 4
  local spec_log_dir
  local spec_agent_execution_ws_base_url
  spec_log_dir="$(dirname "${spec_state_file}")/integration"
  spec_agent_execution_ws_base_url="ws://${KIND_GATEWAY}:${spec_api_port}"
  (
    cd "${ROOT_DIR}" && \
      BACKEND_REAL_API_KEY="${BACKEND_REAL_API_KEY_VALUE}" \
      SANDBOX_MANAGER_URL="${SANDBOX_MANAGER_URL_VALUE}" \
      SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY_VALUE}" \
      DATABASE_URL="postgresql://mbos:mbos_dev_password@127.0.0.1:${INTEGRATION_POSTGRES_PORT}/mbos" \
      MONGO_URL="${MONGO_URL}" \
      MONGO_DB_NAME="${MONGO_DB_NAME}" \
      REDIS_URL="redis://127.0.0.1:${INTEGRATION_REDIS_PORT}" \
      MINIO_ENDPOINT="127.0.0.1" \
      MINIO_PORT="${INTEGRATION_MINIO_API_PORT}" \
      KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
      KEYCLOAK_URL="${KEYCLOAK_BASE_URL%/}/realms" \
      INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}" \
      AFSCP_STORAGE_CSI_DRIVER="${CSI_DRIVER}" \
      AFSCP_STORAGE_CAPACITY="${STORAGE_CAPACITY}" \
      AFSCP_STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME}" \
      AFSCP_STORAGE_CSI_MOUNT_OPTIONS="${MOUNT_OPTIONS}" \
      AFSCP_STORAGE_CSI_SUBDIR="${SUBDIR}" \
      AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT="${MOUNT_SERVICE_ACCOUNT}" \
      AFSCP_STORAGE_CSI_MOUNT_IMAGE="${MOUNT_IMAGE_OVERRIDE}" \
      AFSCP_STORAGE_CSI_NAMESPACE="${AFSCP_STORAGE_CSI_NAMESPACE}" \
      AFSCP_BASE_URL="${AFSCP_BASE_URL}" \
      AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE}" \
      AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN}" \
      AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE}" \
      AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN}" \
      AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE}" \
      AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID}" \
      AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE}" \
      RELEASE_REAL_VISUAL_ARTIFACT_DIR="${RELEASE_REAL_VISUAL_ARTIFACT_DIR:-${INTERNAL_VISUAL_ARTIFACT_DIR}}" \
      UX_TRACE_OUTPUT_ROOT="${UX_TRACE_OUTPUT_ROOT:-${INTERNAL_VISUAL_ARTIFACT_DIR}/ux-traces}" \
      INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
      INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
      INTEGRATION_INTERNAL_AGENT_BASE_IMAGE="${RUNNER_BASE_IMAGE}" \
      INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE:-1}" \
      INTEGRATION_INTERNAL_AGENT_REBUILD_IMAGE=0 \
      AGENT_EXECUTION_WS_BASE_URL="${spec_agent_execution_ws_base_url}" \
      INTERNAL_REAL_VISUAL_ARTIFACT_DIR="${INTERNAL_VISUAL_ARTIFACT_DIR}" \
      INTERNAL_SANDBOX_REAL_STATE_FILE="${spec_state_file}" \
      INTEGRATION_AFSCP_LOCAL_RUNTIME=0 \
      INTEGRATION_KEEP_FAILED_ENV="${KEEP_FAILED_ENV}" \
      POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}" \
      MONGO_PORT="${INTEGRATION_MONGO_PORT}" \
      REDIS_PORT="${INTEGRATION_REDIS_PORT}" \
      MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}" \
      MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT}" \
      KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT}" \
      INTEGRATION_API_PORT="${spec_api_port}" \
      INTEGRATION_WEB_PORT="${spec_web_port}" \
      INTEGRATION_API_BASE="http://127.0.0.1:${spec_api_port}" \
      INTEGRATION_BASE_URL="http://localhost:${spec_web_port}" \
      INTEGRATION_LOG_DIR="${spec_log_dir}" \
      bash scripts/run-integration-e2e-full.sh "${spec}" "$@"
  )
}

run_internal_spec_grep() {
  local spec="$1"
  local label="$2"
  local preferred_api_port="$3"
  local preferred_web_port="$4"
  shift 4
  local extra_args=("$@")
  local spec_api_port
  local spec_web_port
  local spec_slug
  local spec_state_file
  local spec_status
  local resolved_ports

  if ! resolved_ports="$(resolve_internal_spec_port_pair "${preferred_api_port}" "${preferred_web_port}" "${spec}")"; then
    return 1
  fi
  read -r spec_api_port spec_web_port <<< "${resolved_ports}"
  spec_slug="$(basename "${spec}" .spec.ts)-${spec_api_port}"
  spec_state_file="$(prepare_internal_backend_real_spec_runtime "${spec_slug}")"
  gate_record_preflight_check "${INTERNAL_REAL_DIR}" "${spec_slug}_sandbox_manager" "passed" "port ${SANDBOX_PORT}"
  if [[ -n "${label}" ]]; then
    info "running ${spec} --grep ${label}"
    run_internal_spec "${spec}" "${spec_api_port}" "${spec_web_port}" "${spec_state_file}" --grep "${label}" "${extra_args[@]}"
  else
    info "running ${spec}"
    run_internal_spec "${spec}" "${spec_api_port}" "${spec_web_port}" "${spec_state_file}" "${extra_args[@]}"
  fi
  spec_status=$?
  if [[ "${spec_status}" -eq 0 ]]; then
    gate_record_preflight_check "${INTERNAL_REAL_DIR}" "${spec_slug}" "passed" "${spec}"
  else
    gate_record_failure "${INTERNAL_REAL_DIR}" "scenario_assertion_failed" "${spec_slug}" "${spec} failed with status ${spec_status}"
  fi
  if [[ "${KEEP_FAILED_ENV}" != "1" || "${spec_status}" -eq 0 ]]; then
    INTERNAL_SANDBOX_REAL_STATE_FILE="${spec_state_file}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true
  fi
  return "${spec_status}"
}

run_skills_runtime_specs() {
  local skills_status=0

  run_internal_spec_grep e2e/integration-agent-task-runner.spec.ts "reads task context through mbos-context in a real Agent Task run resolved by the default Agent Runner" 20073 3066 || skills_status=$?
  if [[ "${skills_status}" -eq 0 ]]; then
    run_internal_spec_grep e2e/integration-agent-task-runner.spec.ts "writes task context through mbos-context and persists it for the task owner" 20074 3069 || skills_status=$?
  fi
  if [[ "${skills_status}" -eq 0 ]]; then
    run_internal_spec_grep e2e/integration-agent-task-runner.spec.ts "uses jira-ops task context before member context in a real Agent Task run resolved by the default Agent Runner" 20075 3070 || skills_status=$?
  fi
  if [[ "${skills_status}" -eq 0 ]]; then
    run_internal_spec_grep e2e/integration-agent-task-runner.spec.ts "uses feishu-docs managed credential projection in a real Agent Task run resolved by the default Agent Runner" 20076 3071 || skills_status=$?
  fi
  if [[ "${skills_status}" -eq 0 ]]; then
    run_internal_spec_grep e2e/integration-agent-task-runner.spec.ts "reads task context through mbos-context inside a real Agent Task terminal session resolved by the default Agent Runner" 20077 3081 || skills_status=$?
  fi
  if [[ "${skills_status}" -eq 0 ]]; then
    run_internal_spec_grep e2e/integration-agent-task-runner.spec.ts "rejects shared workspace context writes inside a real Agent Task terminal session resolved by the default Agent Runner" 20078 3091 || skills_status=$?
  fi
  if [[ "${skills_status}" -eq 0 ]]; then
    run_internal_spec_grep e2e/integration-context-store-isolation.spec.ts "member context stays private between workspace members" 23079 33079 || skills_status=$?
  fi
  if [[ "${skills_status}" -eq 0 ]]; then
    run_internal_spec_grep e2e/integration-context-store-isolation.spec.ts "task context stays private to the task owner within the same workspace" 23080 33080 || skills_status=$?
  fi

  return "${skills_status}"
}

set +e
if [[ "${GATE_MODE}" == "skills-runtime" ]]; then
  run_skills_runtime_specs
  GATE_STATUS=$?
  set -e
  if [[ "${GATE_STATUS}" -ne 0 ]]; then
    exit "${GATE_STATUS}"
  fi
  info "internal agent-task skills runtime real gate passed"
  gate_record_success "${INTERNAL_REAL_DIR}" "skills_runtime_specs"
  exit 0
fi

if [[ "${GATE_MODE}" == "visual-review" ]]; then
  VISUAL_REVIEW_STATUS=0
  VISUAL_REVIEW_STATE_FILE="$(prepare_internal_backend_real_spec_runtime "integration-visual-review")" || VISUAL_REVIEW_STATUS=$?
  if [[ "${VISUAL_REVIEW_STATUS}" -eq 0 ]]; then
    gate_record_preflight_check "${INTERNAL_REAL_DIR}" "visual_review_spec_sandbox_manager" "passed" "port ${SANDBOX_PORT}"
    run_internal_spec e2e/integration-visual-review.spec.ts "${API_PORT}" "${WEB_PORT}" "${VISUAL_REVIEW_STATE_FILE}" || VISUAL_REVIEW_STATUS=$?
  fi
  if [[ "${VISUAL_REVIEW_STATUS}" -eq 0 ]]; then
    gate_record_preflight_check "${INTERNAL_REAL_DIR}" "visual_review_spec" "passed" "integration-visual-review"
  else
    gate_record_failure "${INTERNAL_REAL_DIR}" "scenario_assertion_failed" "visual_review_spec" "integration-visual-review failed with status ${VISUAL_REVIEW_STATUS}"
  fi
  if [[ -n "${VISUAL_REVIEW_STATE_FILE:-}" && ( "${KEEP_FAILED_ENV}" != "1" || "${VISUAL_REVIEW_STATUS}" -eq 0 ) ]]; then
    INTERNAL_SANDBOX_REAL_STATE_FILE="${VISUAL_REVIEW_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true
  fi
  GATE_STATUS="${VISUAL_REVIEW_STATUS}"
  set -e
  if [[ "${GATE_STATUS}" -ne 0 ]]; then
    exit "${GATE_STATUS}"
  fi
  info "backend-real visual review internal managed Agent Task gate passed"
  gate_record_success "${INTERNAL_REAL_DIR}" "visual_review_spec"
  exit 0
fi

if [[ "${GATE_MODE}" == "files-restore-continue" ]]; then
  RESTORE_CONTINUATION_STATUS=0
  run_internal_spec_grep e2e/integration-files-user-stories.spec.ts "same task can continue after Files restore" 21020 3121 "${PLAYWRIGHT_PASSTHROUGH_ARGS[@]}" || RESTORE_CONTINUATION_STATUS=$?
  GATE_STATUS="${RESTORE_CONTINUATION_STATUS}"
  set -e
  if [[ "${GATE_STATUS}" -ne 0 ]]; then
    exit "${GATE_STATUS}"
  fi
  info "Files restore continuation internal managed Agent Task gate passed"
  gate_record_success "${INTERNAL_REAL_DIR}" "files_restore_continuation_spec"
  exit 0
fi

WORKSPACE_STATE_FILE="$(prepare_internal_backend_real_spec_runtime "integration-internal-agent-task-workspace")"
gate_record_preflight_check "${INTERNAL_REAL_DIR}" "workspace_spec_sandbox_manager" "passed" "port ${SANDBOX_PORT}"
run_internal_spec e2e/integration-agent-task-runner.spec.ts "${API_PORT}" "${WEB_PORT}" "${WORKSPACE_STATE_FILE}" --grep "reads task context through mbos-context in a real Agent Task run resolved by the default Agent Runner"
WORKSPACE_STATUS=$?
RECLAIM_STATUS=0
if [[ "${WORKSPACE_STATUS}" -eq 0 ]]; then
  gate_record_preflight_check "${INTERNAL_REAL_DIR}" "workspace_spec" "passed" "integration-agent-task-runner"
else
  gate_record_failure "${INTERNAL_REAL_DIR}" "scenario_assertion_failed" "workspace_spec" "integration-agent-task-runner failed with status ${WORKSPACE_STATUS}"
fi
if [[ "${WORKSPACE_STATUS}" -eq 0 ]]; then
  INTERNAL_SANDBOX_REAL_STATE_FILE="${WORKSPACE_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true

  RECLAIM_STATE_FILE="$(prepare_internal_backend_real_spec_runtime "integration-internal-sandbox-reclaim")"
  gate_record_preflight_check "${INTERNAL_REAL_DIR}" "reclaim_spec_sandbox_manager" "passed" "port ${SANDBOX_PORT}"
  run_internal_spec e2e/integration-internal-sandbox-reclaim.spec.ts "$((API_PORT + 1))" "$((WEB_PORT + 1))" "${RECLAIM_STATE_FILE}"
  RECLAIM_STATUS=$?
  if [[ "${RECLAIM_STATUS}" -eq 0 ]]; then
    gate_record_preflight_check "${INTERNAL_REAL_DIR}" "reclaim_spec" "passed" "integration-internal-sandbox-reclaim"
  else
    gate_record_failure "${INTERNAL_REAL_DIR}" "scenario_assertion_failed" "reclaim_spec" "integration-internal-sandbox-reclaim failed with status ${RECLAIM_STATUS}"
  fi
  INTERNAL_SANDBOX_REAL_STATE_FILE="${RECLAIM_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true
elif [[ "${KEEP_FAILED_ENV}" != "1" ]]; then
  INTERNAL_SANDBOX_REAL_STATE_FILE="${WORKSPACE_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true
fi
set -e

if [[ "${WORKSPACE_STATUS}" -ne 0 ]]; then
  GATE_STATUS="${WORKSPACE_STATUS}"
fi
if [[ "${RECLAIM_STATUS}" -ne 0 && "${GATE_STATUS}" -eq 0 ]]; then
  GATE_STATUS="${RECLAIM_STATUS}"
fi
if [[ "${GATE_STATUS}" -ne 0 ]]; then
  exit "${GATE_STATUS}"
fi

info "internal agent-task workspace real gate passed"
gate_record_success "${INTERNAL_REAL_DIR}" "internal_specs"
