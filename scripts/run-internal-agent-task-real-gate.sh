#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX_ROOT="$(cd "${ROOT_DIR}/../mbos-sandbox-v1" && pwd)"
KIND_CONFIG_PATH="${ROOT_DIR}/infra/deploy/demo/kind/config.yaml"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/k8s-external-services.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
source "${ROOT_DIR}/scripts/lib/internal-backend-real-gate.sh"
source "${ROOT_DIR}/scripts/lib/runner-image-common.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-gate-ports.sh"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/scenarios/common.sh"
GATE_MODE="workspace"
if [[ "${1:-}" == "--skills-runtime" ]]; then
  GATE_MODE="skills-runtime"
  shift
fi
if [[ "$#" -ne 0 ]]; then
  echo "[internal-real-gate] unsupported arguments: $*" >&2
  exit 1
fi
ORIGINAL_INTEGRATION_API_PORT="${INTEGRATION_API_PORT:-}"
ORIGINAL_INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT:-}"
load_backend_real_env
if [[ -n "${ORIGINAL_INTEGRATION_API_PORT}" ]]; then
  export INTEGRATION_API_PORT="${ORIGINAL_INTEGRATION_API_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_WEB_PORT}" ]]; then
  export INTEGRATION_WEB_PORT="${ORIGINAL_INTEGRATION_WEB_PORT}"
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
CSI_DRIVER="${INTERNAL_AGENT_JUICEFS_CSI_DRIVER:-csi.juicefs.com}"
RUNNER_KIND="${INTEGRATION_INTERNAL_AGENT_RUNNER_KIND:-agent-task}"
RUNNER_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-$(runner_default_image "${RUNNER_KIND}")}"
RUNNER_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_BASE_IMAGE:-$(runner_default_base_image "${RUNNER_KIND}")}"
BUILD_RUNNER_IMAGE="${INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE:-1}"
DOCKER_BUILD_PROXY_VALUE="${INTEGRATION_DOCKER_BUILD_PROXY:-${DOCKER_BUILD_PROXY:-}}"
WORKSPACE_CAPACITY="${INTERNAL_AGENT_WORKSPACE_CAPACITY:-1Pi}"
STORAGE_CLASS_NAME="${INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME:-}"
MOUNT_OPTIONS="${INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS:-}"
SUBDIR="${INTERNAL_AGENT_JUICEFS_SUBDIR:-}"
MOUNT_SERVICE_ACCOUNT="${INTERNAL_AGENT_JUICEFS_MOUNT_SERVICE_ACCOUNT:-}"
MOUNT_IMAGE_OVERRIDE="${INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE:-}"
JUICEFS_MOUNT_IMAGE="${INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE:-juicedata/mount:ce-v1.3.1}"
JUICEFS_CSI_VERSION="${JUICEFS_CSI_VERSION:-v0.31.3}"
JUICEFS_CSI_MANIFEST_PATH="${JUICEFS_CSI_MANIFEST_PATH:-${ROOT_DIR}/infra/deploy/cluster/addons/juicefs-csi/upstream-manifest.yaml}"
JUICEFS_CSI_NAMESPACE="${JUICEFS_CSI_NAMESPACE:-kube-system}"
ensure_backend_real_state
INTERNAL_REAL_DIR="${INTERNAL_REAL_DIR:-$(backend_real_tmp_file internal)}"
mkdir -p "${INTERNAL_REAL_DIR}"
INTERNAL_REAL_DIR="$(realpath -m "${INTERNAL_REAL_DIR}")"
export RUNTIME_LINE_ID="${RUNTIME_LINE_ID:-$(basename "${INTERNAL_REAL_DIR}")}"
export RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-managed_runner}"
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
CLEANER_LOG="${INTERNAL_SANDBOX_CLEANER_LOG:-${INTERNAL_REAL_DIR}/sandbox-cleaner.log}"
CLEANER_LOG="$(realpath -m "${CLEANER_LOG}")"
CLEANER_LOG_DIR="$(dirname "${CLEANER_LOG}")"
mkdir -p "${CLEANER_LOG_DIR}"
SANDBOX_LOG="$(realpath -m "${SANDBOX_LOG}")"
SANDBOX_LOG_DIR="$(dirname "${SANDBOX_LOG}")"
mkdir -p "${SANDBOX_LOG_DIR}"
CLEANER_INTERVAL_SECONDS="${INTERNAL_SANDBOX_CLEANER_INTERVAL_SECONDS:-15}"
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

prepare_internal_backend_real_gate_runtime
gate_record_preflight_check "${INTERNAL_REAL_DIR}" "kind_cluster" "passed" "${KIND_CLUSTER_NAME}"
record_service kind_cluster ready "${KIND_CLUSTER_NAME}"
gate_record_preflight_check "${INTERNAL_REAL_DIR}" "juicefs_csi" "passed" "${CSI_DRIVER}"
record_service juicefs_csi ready "${CSI_DRIVER}"
gate_record_preflight_check "${INTERNAL_REAL_DIR}" "external_dependency_services" "passed" "${EXTERNAL_DEPS_MANIFEST}"
record_service external_dependency_services ready "${EXTERNAL_DEPS_MANIFEST}"

cleanup() {
  if [[ "${KEEP_FAILED_ENV}" == "1" && "${GATE_STATUS}" -ne 0 ]]; then
    info "keeping failed sandbox manager environment for inspection"
    if [[ -n "${CURRENT_SANDBOX_STATE_FILE}" && -f "${CURRENT_SANDBOX_STATE_FILE}" ]]; then
      # shellcheck disable=SC1090
      source "${CURRENT_SANDBOX_STATE_FILE}"
      info "sandbox_log=${SANDBOX_LOG}"
      info "cleaner_log=${CLEANER_LOG}"
      info "state_file=${CURRENT_SANDBOX_STATE_FILE}"
    else
      info "sandbox_log=${SANDBOX_LOG}"
      info "cleaner_log=${CLEANER_LOG}"
      info "state_file=${STATE_FILE}"
    fi
    info "visual_artifacts=${INTERNAL_VISUAL_ARTIFACT_DIR}"
    return 0
  fi
  if [[ -n "${CURRENT_SANDBOX_STATE_FILE}" ]]; then
    INTERNAL_SANDBOX_REAL_STATE_FILE="${CURRENT_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-cleaner >/dev/null 2>&1 || true
    INTERNAL_SANDBOX_REAL_STATE_FILE="${CURRENT_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ "${GATE_MODE}" == "skills-runtime" ]]; then
  info "running internal agent-task skills runtime real integration"
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
      INTERNAL_AGENT_JUICEFS_CSI_DRIVER="${CSI_DRIVER}" \
      INTERNAL_AGENT_WORKSPACE_CAPACITY="${WORKSPACE_CAPACITY}" \
      INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME}" \
      INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS="${MOUNT_OPTIONS}" \
      INTERNAL_AGENT_JUICEFS_SUBDIR="${SUBDIR}" \
      INTERNAL_AGENT_JUICEFS_MOUNT_SERVICE_ACCOUNT="${MOUNT_SERVICE_ACCOUNT}" \
      INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE="${MOUNT_IMAGE_OVERRIDE}" \
      INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE="${INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE}" \
      INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE="${INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE_VALUE}" \
      JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT="${JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT_VALUE}" \
      INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE_VALUE}" \
      INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE_VALUE}" \
      INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE}" \
      INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
      INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
      INTEGRATION_INTERNAL_AGENT_BASE_IMAGE="${RUNNER_BASE_IMAGE}" \
      INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE:-1}" \
      INTEGRATION_INTERNAL_AGENT_REBUILD_IMAGE=0 \
      AGENT_EXECUTION_WS_BASE_URL="${spec_agent_execution_ws_base_url}" \
      INTERNAL_REAL_VISUAL_ARTIFACT_DIR="${INTERNAL_VISUAL_ARTIFACT_DIR}" \
      INTERNAL_SANDBOX_REAL_STATE_FILE="${spec_state_file}" \
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
  local spec_api_port="$3"
  local spec_web_port="$4"
  local spec_slug
  local spec_state_file
  local spec_status

  spec_slug="$(basename "${spec}" .spec.ts)-${spec_api_port}"
  cleanup_gate_ports "${spec_api_port}" "${spec_web_port}" "${spec}"
  spec_state_file="$(prepare_internal_backend_real_spec_runtime "${spec_slug}" "with-cleaner")"
  gate_record_preflight_check "${INTERNAL_REAL_DIR}" "${spec_slug}_sandbox_manager" "passed" "port ${SANDBOX_PORT}"
  if [[ -n "${label}" ]]; then
    info "running ${spec} --grep ${label}"
    run_internal_spec "${spec}" "${spec_api_port}" "${spec_web_port}" "${spec_state_file}" --grep "${label}"
  else
    info "running ${spec}"
    run_internal_spec "${spec}" "${spec_api_port}" "${spec_web_port}" "${spec_state_file}"
  fi
  spec_status=$?
  if [[ "${spec_status}" -eq 0 ]]; then
    gate_record_preflight_check "${INTERNAL_REAL_DIR}" "${spec_slug}" "passed" "${spec}"
  else
    gate_record_failure "${INTERNAL_REAL_DIR}" "scenario_assertion_failed" "${spec_slug}" "${spec} failed with status ${spec_status}"
  fi
  if [[ "${KEEP_FAILED_ENV}" != "1" || "${spec_status}" -eq 0 ]]; then
    INTERNAL_SANDBOX_REAL_STATE_FILE="${spec_state_file}" bash "${CONTROL_SCRIPT}" stop-cleaner >/dev/null 2>&1 || true
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
    run_internal_spec_grep e2e/integration-context-store-isolation.spec.ts "member context stays private between workspace members" 20079 3101 || skills_status=$?
  fi
  if [[ "${skills_status}" -eq 0 ]]; then
    run_internal_spec_grep e2e/integration-context-store-isolation.spec.ts "task context stays private to the task owner within the same workspace" 20080 3041 || skills_status=$?
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

WORKSPACE_STATE_FILE="$(prepare_internal_backend_real_spec_runtime "integration-internal-agent-task-workspace" "with-cleaner")"
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
  INTERNAL_SANDBOX_REAL_STATE_FILE="${WORKSPACE_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-cleaner >/dev/null 2>&1 || true
  INTERNAL_SANDBOX_REAL_STATE_FILE="${WORKSPACE_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true

  RECLAIM_STATE_FILE="$(prepare_internal_backend_real_spec_runtime "integration-internal-sandbox-reclaim" "with-cleaner")"
  gate_record_preflight_check "${INTERNAL_REAL_DIR}" "reclaim_spec_sandbox_manager" "passed" "port ${SANDBOX_PORT}"
  run_internal_spec e2e/integration-internal-sandbox-reclaim.spec.ts "$((API_PORT + 1))" "$((WEB_PORT + 1))" "${RECLAIM_STATE_FILE}"
  RECLAIM_STATUS=$?
  if [[ "${RECLAIM_STATUS}" -eq 0 ]]; then
    gate_record_preflight_check "${INTERNAL_REAL_DIR}" "reclaim_spec" "passed" "integration-internal-sandbox-reclaim"
  else
    gate_record_failure "${INTERNAL_REAL_DIR}" "scenario_assertion_failed" "reclaim_spec" "integration-internal-sandbox-reclaim failed with status ${RECLAIM_STATUS}"
  fi
  INTERNAL_SANDBOX_REAL_STATE_FILE="${RECLAIM_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-cleaner >/dev/null 2>&1 || true
  INTERNAL_SANDBOX_REAL_STATE_FILE="${RECLAIM_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true
elif [[ "${KEEP_FAILED_ENV}" != "1" ]]; then
  INTERNAL_SANDBOX_REAL_STATE_FILE="${WORKSPACE_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-cleaner >/dev/null 2>&1 || true
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
