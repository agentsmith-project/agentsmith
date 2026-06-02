#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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
elif [[ "${1:-}" == "--core-composite" ]]; then
  GATE_MODE="core-composite"
  shift
elif [[ "${1:-}" == "--visual-review" ]]; then
  GATE_MODE="visual-review"
  shift
elif [[ "${1:-}" == "--files-restore-continue" ]]; then
  GATE_MODE="files-restore-continue"
  shift
elif [[ "${1:-}" == "--runner-projection-smoke" ]]; then
  GATE_MODE="runner-projection-smoke"
  shift
elif [[ "${1:-}" == "--runner-locked-runtime-smoke" ]]; then
  GATE_MODE="runner-locked-runtime-smoke"
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
ASBCP_PORT="${INTERNAL_ASBCP_PORT:-28080}"
ASBCP_INTERNAL_BASE_URL_VALUE="${ASBCP_INTERNAL_BASE_URL:-http://127.0.0.1:${ASBCP_PORT}}"
ASBCP_SERVICE_KEY_VALUE="${ASBCP_SERVICE_KEY:-agentsmith-internal-test-key}"
K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-sandbox}"
CSI_DRIVER="${AFSCP_STORAGE_CSI_DRIVER:-csi.juicefs.com}"
RUNNER_KIND="${INTEGRATION_INTERNAL_AGENT_RUNNER_KIND:-agent-task}"
EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-}"
RUNNER_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-$(runner_default_image "${RUNNER_KIND}")}"
RUNNER_IMAGE_LOCK_PATH="${RUNNER_IMAGE_LOCK_PATH:-${ROOT_DIR}/scripts/governance/__fixtures__/release-boundary/agentsmith-runner-image.lock}"
RUNNER_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_BASE_IMAGE:-$(runner_default_base_image "${RUNNER_KIND}")}"
if [[ "${GATE_MODE}" == "runner-projection-smoke" || "${GATE_MODE}" == "runner-locked-runtime-smoke" ]]; then
  BUILD_RUNNER_IMAGE="${INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE:-0}"
else
  BUILD_RUNNER_IMAGE="${INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE:-1}"
fi
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
internal_real_gate_configure_skills_runtime_runner_image
if [[ "${GATE_MODE}" == "runner-projection-smoke" ]]; then
  export INTEGRATION_RUNNER_PROJECTION_SMOKE=1
  export INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE=1
elif [[ "${GATE_MODE}" == "runner-locked-runtime-smoke" ]]; then
  export INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE=1
  export INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE=1
fi
AFSCP_BASE_URL="${AFSCP_BASE_URL:-http://127.0.0.1:$((API_PORT + 9030))}"
AFSCP_EXPORT_GATEWAY_BASE_URL="${AFSCP_EXPORT_GATEWAY_BASE_URL:-http://127.0.0.1:$((API_PORT + 9031))}"
AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID:-vol_internal_${API_PORT}}"
AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE:-agentsmith-api}"
AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE:-agentsmith-bootstrap}"
AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-control-plane}"
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
ASBCP_LOG="${INTERNAL_ASBCP_LOG:-${INTERNAL_REAL_DIR}/asbcp.log}"
CONFIG_PATH="${INTERNAL_ASBCP_CONFIG:-${INTERNAL_REAL_DIR}/asbcp-config.yaml}"
CONFIG_PATH="$(realpath -m "${CONFIG_PATH}")"
CONTROL_SCRIPT="${ROOT_DIR}/scripts/lib/internal-sandbox-real-control.sh"
STATE_FILE="${INTERNAL_REAL_DIR}/sandbox-control.env"
ASBCP_LOG="$(realpath -m "${ASBCP_LOG}")"
ASBCP_LOG_DIR="$(dirname "${ASBCP_LOG}")"
mkdir -p "${ASBCP_LOG_DIR}"
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

runner_image_lock_value() {
  local key="$1"
  awk -F= -v expected_key="${key}" '$1 == expected_key { sub(/^[^=]*=/, ""); print; exit }' "${RUNNER_IMAGE_LOCK_PATH}"
}

deepseek_openai_host() {
  local raw_url="$1"
  node -e 'const raw = process.argv[1] || ""; try { process.stdout.write(new URL(raw).hostname.toLowerCase()); } catch { process.exit(1); }' "${raw_url}" 2>/dev/null
}

ensure_runner_projection_smoke_deepseek_preconditions() {
  if [[ "${GATE_MODE}" != "runner-projection-smoke" ]]; then
    return 0
  fi
  local openai_base_url="${BACKEND_REAL_OPENAI_BASE_URL:-${BACKEND_REAL_OPENAI_BASE_URL_VALUE:-${PRESET_OPENAI_ENDPOINT_BASE_URL:-}}}"
  local openai_host=""
  local openai_host_for_log="<empty>"
  if [[ -n "${openai_base_url}" ]]; then
    if openai_host="$(deepseek_openai_host "${openai_base_url}")"; then
      openai_host_for_log="${openai_host:-<invalid>}"
    else
      openai_host="<invalid>"
      openai_host_for_log="<invalid>"
    fi
  fi
  if [[ -z "${openai_host}" || ( "${openai_host}" != "api.deepseek.com" && "${openai_host}" != *.deepseek.com ) ]]; then
    gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "runner_projection_smoke_deepseek" "BACKEND_REAL_OPENAI_BASE_URL must resolve to DeepSeek"
    echo "[internal-real-gate] --runner-projection-smoke requires BACKEND_REAL_OPENAI_BASE_URL (or the backend-real default) host to be api.deepseek.com or *.deepseek.com; resolved_host=${openai_host_for_log}" >&2
    exit 1
  fi
  gate_record_preflight_check "${INTERNAL_REAL_DIR}" "runner_projection_smoke_deepseek" "passed" "host=${openai_host}"
}

ensure_runner_projection_smoke_image_preconditions() {
  local smoke_arg smoke_key_prefix
  if [[ "${GATE_MODE}" == "runner-projection-smoke" ]]; then
    smoke_arg="--runner-projection-smoke"
    smoke_key_prefix="runner_projection_smoke"
  elif [[ "${GATE_MODE}" == "runner-locked-runtime-smoke" ]]; then
    smoke_arg="--runner-locked-runtime-smoke"
    smoke_key_prefix="runner_locked_runtime_smoke"
  else
    return 0
  fi
  local image_id locked_image locked_digest
  if ! "${ROOT_DIR}/node_modules/.bin/tsx" "${ROOT_DIR}/scripts/contracts/check-runner-image-lock.ts" --lock "${RUNNER_IMAGE_LOCK_PATH}" >/dev/null; then
    gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "${smoke_key_prefix}_image_lock" "agentsmith-runner image lock check failed"
    echo "[internal-real-gate] ${smoke_arg} requires a valid agentsmith-runner image lock: ${RUNNER_IMAGE_LOCK_PATH}" >&2
    exit 1
  fi
  locked_image="$(runner_image_lock_value image)"
  locked_digest="$(runner_image_lock_value image_digest)"
  if [[ -z "${locked_image}" || -z "${locked_digest}" ]]; then
    gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "${smoke_key_prefix}_image_lock" "agentsmith-runner image lock is missing image/image_digest"
    echo "[internal-real-gate] ${smoke_arg} could not read image/image_digest from ${RUNNER_IMAGE_LOCK_PATH}" >&2
    exit 1
  fi
  if [[ "${locked_image}" != *@sha256:* ]]; then
    gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "${smoke_key_prefix}_image_lock" "agentsmith-runner image lock must contain a digest ref"
    echo "[internal-real-gate] ${smoke_arg} requires image= in ${RUNNER_IMAGE_LOCK_PATH} to be a digest ref; actual=${locked_image}" >&2
    exit 1
  fi
  if [[ "${EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE}" == *agent-task-runner* ]]; then
    gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "${smoke_key_prefix}_image" "INTEGRATION_INTERNAL_AGENT_IMAGE must not reference old agent-task-runner image/path"
    echo "[internal-real-gate] ${smoke_arg} requires a canonical agentsmith-runner image; old agent-task-runner image/path is rejected: INTEGRATION_INTERNAL_AGENT_IMAGE=${EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE}" >&2
    exit 1
  fi
  if [[ -n "${EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE}" && "${EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE}" != "${locked_image}" ]]; then
    gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "${smoke_key_prefix}_image_lock" "INTEGRATION_INTERNAL_AGENT_IMAGE must match locked digest image ref from agentsmith-runner-image.lock"
    echo "[internal-real-gate] ${smoke_arg} requires INTEGRATION_INTERNAL_AGENT_IMAGE to exactly match image= from ${RUNNER_IMAGE_LOCK_PATH}; tag-only or local non-digest images are not accepted." >&2
    echo "[internal-real-gate] expected=${locked_image}" >&2
    echo "[internal-real-gate] actual=${EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE}" >&2
    exit 1
  fi
  BUILD_RUNNER_IMAGE="${INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE:-${BUILD_RUNNER_IMAGE:-0}}"
  if [[ "${BUILD_RUNNER_IMAGE}" != "0" ]]; then
    gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "${smoke_key_prefix}_image" "INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=0 is required"
    echo "[internal-real-gate] ${smoke_arg} requires INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=0 so it cannot fall back to the old monorepo runner image build." >&2
    exit 1
  fi
  RUNNER_IMAGE="${locked_image}"
  EXPLICIT_INTEGRATION_INTERNAL_AGENT_IMAGE="${locked_image}"
  export INTEGRATION_INTERNAL_AGENT_IMAGE="${locked_image}"
  export INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE="${BUILD_RUNNER_IMAGE}"
  if ! command -v docker >/dev/null 2>&1; then
    gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "${smoke_key_prefix}_image" "docker is required to inspect INTEGRATION_INTERNAL_AGENT_IMAGE"
    echo "[internal-real-gate] ${smoke_arg} requires docker to inspect INTEGRATION_INTERNAL_AGENT_IMAGE before running." >&2
    exit 1
  fi
  if ! docker image inspect "${RUNNER_IMAGE}" >/dev/null 2>&1; then
    gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "${smoke_key_prefix}_image" "local docker image not found"
    echo "[internal-real-gate] ${smoke_arg} requires the local docker image to exist: INTEGRATION_INTERNAL_AGENT_IMAGE=${RUNNER_IMAGE}" >&2
    exit 1
  fi
  image_id="$(docker image inspect --format '{{.Id}}' "${RUNNER_IMAGE}" 2>/dev/null | head -n1)"
  if [[ -z "${image_id}" ]]; then
    gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "${smoke_key_prefix}_image" "docker image id not found"
    echo "[internal-real-gate] ${smoke_arg} could not read docker image id for INTEGRATION_INTERNAL_AGENT_IMAGE=${RUNNER_IMAGE}" >&2
    exit 1
  fi
  if [[ "${GATE_MODE}" == "runner-locked-runtime-smoke" ]]; then
    export INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE_IMAGE_ID="${image_id}"
  else
    export INTEGRATION_RUNNER_PROJECTION_SMOKE_IMAGE_ID="${image_id}"
  fi
  gate_record_preflight_check "${INTERNAL_REAL_DIR}" "${smoke_key_prefix}_image_lock" "passed" "image_ref=${RUNNER_IMAGE} image_digest=${locked_digest} image_id=${image_id}"
}

ensure_runner_projection_smoke_deepseek_preconditions
ensure_runner_projection_smoke_image_preconditions

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

ensure_internal_default_workspace_for_afscp() {
  info "ensuring default workspace before child backend-real specs"
  (
    cd "${ROOT_DIR}" && \
      DATABASE_URL="postgresql://mbos:mbos_dev_password@localhost:${INTEGRATION_POSTGRES_PORT}/mbos" \
      MONGO_URL="${MONGO_URL}" \
      MONGO_DB_NAME="${MONGO_DB_NAME}" \
      REDIS_URL="redis://localhost:${INTEGRATION_REDIS_PORT}" \
      MINIO_ENDPOINT="127.0.0.1" \
      MINIO_PORT="${INTEGRATION_MINIO_API_PORT}" \
      MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}" \
      KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
      PUBLIC_KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
      INTERNAL_KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
      KEYCLOAK_URL="${KEYCLOAK_BASE_URL%/}/realms" \
      KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
      KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
      npx tsx scripts/ensure-default-workspace.ts >/dev/null
  )
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
    export PATH="${INTERNAL_REAL_DIR}/bin:${PATH}"
    export LD_LIBRARY_PATH="${INTERNAL_REAL_DIR}/bin/juicefs-lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
    export ENV_FILE=/dev/null
    export INTERNAL_AGENT_KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME}"
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
    mkdir -p "${INTERNAL_REAL_DIR}/bin"
    AFSCP_IMAGE="${AFSCP_LOCAL_RUNTIME_IMAGE:-${AFSCP_IMAGE:-}}" \
      AFSCP_JUICEFS_OUTPUT_PATH="${INTERNAL_REAL_DIR}/bin/juicefs" \
      bash "${ROOT_DIR}/scripts/afscp-jvs-image-smoke.sh"
    # shellcheck disable=SC1091
    source "${ROOT_DIR}/scripts/local-manual/internal-common.sh"
    ensure_afscp_local_runtime
  )
}

stop_internal_afscp_local_runtime() {
  (
    export INTERNAL_REAL_DIR
    export ENV_FILE=/dev/null
    export INTERNAL_AGENT_KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME}"
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

ensure_internal_kind_cluster_for_afscp_reset() {
  local target_kubeconfig

  info "ensuring local kind cluster before AFSCP local runtime reset"
  internal_real_gate_require_host_tools
  KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME:-$(internal_real_gate_default_kind_cluster_name)}"
  KIND_CONTEXT_NAME="${KIND_CONTEXT_NAME:-kind-${KIND_CLUSTER_NAME}}"
  if declare -F scenario_kind_kubeconfig_path >/dev/null 2>&1; then
    target_kubeconfig="$(scenario_kind_kubeconfig_path "${KIND_CLUSTER_NAME}")"
  else
    target_kubeconfig="${LOCAL_KIND_FINAL_KUBECONFIG_PATH:-${HOME}/agentsmith/local-kind/${KIND_CONTEXT_NAME}.kubeconfig}"
  fi
  LOCAL_KIND_FINAL_KUBECONFIG_PATH="${target_kubeconfig}"
  export LOCAL_KIND_FINAL_KUBECONFIG_PATH
  export KUBECONFIG="${LOCAL_KIND_FINAL_KUBECONFIG_PATH}"
  internal_real_gate_ensure_kind_cluster
}

reset_internal_afscp_local_runtime() {
  info "resetting owned AFSCP local runtime before gate start"
  stop_internal_afscp_local_runtime
  (
    export INTERNAL_REAL_DIR
    export ENV_FILE=/dev/null
    export INTERNAL_AGENT_KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME}"
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
    reset_owned_afscp_local_runtime_for_gate
  )
}

record_service() {
  local service_name="$1"
  local status="$2"
  local detail="${3:-}"
  gate_record_service_status "${INTERNAL_REAL_DIR}" "${service_name}" "${status}" "${detail}"
}

child_internal_evidence_slug() {
  local raw="${1:-child-spec}"
  printf '%s\n' "${raw}" | tr -c 'A-Za-z0-9_.-' '-' | sed -E 's/^-+//; s/-+$//; s/-+/-/g' | cut -c1-96
}

redact_child_internal_known_values() {
  local line redacted secret
  while IFS= read -r line || [[ -n "${line}" ]]; do
    redacted="${line}"
    for secret in \
      "${ASBCP_SERVICE_KEY_VALUE:-}" \
      "${ASBCP_SERVICE_KEY:-}" \
      "${AFSCP_ORCHESTRATOR_TOKEN:-}" \
      "${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-}" \
      "${PRESET_ENDPOINT_API_KEY_VALUE:-}" \
      "${PRESET_ENDPOINT_API_KEY:-}"; do
      if [[ "${#secret}" -ge 4 ]]; then
        redacted="${redacted//${secret}/[REDACTED]}"
      fi
    done
    printf '%s\n' "${redacted}"
  done
}

redact_child_internal_secret_patterns() {
  local secret_name_pattern='([[:alnum:]_]*[_-]?(api[_-]?key|token|secret|password|passwd)|([[:alnum:]_]+[_-])?key)'
  sed -E \
    -e "s#(authorization[[:space:]]*:[[:space:]]*bearer[[:space:]]+)[^[:space:]\"',;]+#\\1[REDACTED]#gI" \
    -e "s#(^|[^[:alnum:]_])(${secret_name_pattern}[[:space:]]*[:=][[:space:]]*)\"[^\"]*\"#\\1\\2[REDACTED]#gI" \
    -e "s#(^|[^[:alnum:]_])(${secret_name_pattern}[[:space:]]*[:=][[:space:]]*)'[^']*'#\\1\\2[REDACTED]#gI" \
    -e "s#(^|[^[:alnum:]_])(${secret_name_pattern}[[:space:]]*[:=][[:space:]]*)[^[:space:]\"',;&]+#\\1\\2[REDACTED]#gI" \
    -e "s#(^|[^[:alnum:]._-])sk-[[:alnum:]][[:alnum:]._-]{8,}#\\1[REDACTED]#g"
}

redact_child_internal_evidence() {
  redact_child_internal_known_values | redact_child_internal_secret_patterns
}

run_child_internal_evidence_command() {
  local output_file="$1"
  local timeout_seconds="$2"
  local command_status
  shift 2
  {
    printf '$'
    printf ' %q' "$@"
    printf '\n'
    if command -v timeout >/dev/null 2>&1; then
      timeout "${timeout_seconds}" "$@" 2>&1 | redact_child_internal_evidence
      command_status="${PIPESTATUS[0]}"
    else
      "$@" 2>&1 | redact_child_internal_evidence
      command_status="${PIPESTATUS[0]}"
    fi
    printf '\n[exit_status=%s]\n' "${command_status}"
  } > "${output_file}" || true
}

collect_asbcp_docker_log_evidence() {
  local output_file="$1"
  local container_ref="${2:-}"
  local command_status
  if ! command -v docker >/dev/null 2>&1; then
    printf 'docker command is not available; ASBCP docker logs were not collected.\n' > "${output_file}"
    return 0
  fi
  if [[ -z "${container_ref}" ]]; then
    printf 'ASBCP container id/name could not be resolved; docker logs were not collected.\n' > "${output_file}"
    return 0
  fi
  {
    printf '$ docker logs %q\n' "${container_ref}"
    if command -v timeout >/dev/null 2>&1; then
      timeout 30 docker logs "${container_ref}" 2>&1 | redact_child_internal_evidence
      command_status="${PIPESTATUS[0]}"
    else
      docker logs "${container_ref}" 2>&1 | redact_child_internal_evidence
      command_status="${PIPESTATUS[0]}"
    fi
    printf '\n[exit_status=%s]\n' "${command_status}"
  } > "${output_file}" || true
}

collect_child_internal_failure_evidence() {
  local stage="$1"
  local spec_state_file="${2:-}"
  local safe_stage evidence_dir
  safe_stage="$(child_internal_evidence_slug "${stage}")"
  evidence_dir="${INTERNAL_REAL_DIR}/child-internal-evidence/${safe_stage:-child-spec}"
  mkdir -p "${evidence_dir}" 2>/dev/null || return 0
  (
    set +e
    set +u
    set +o pipefail
    if [[ -n "${spec_state_file}" && -f "${spec_state_file}" ]]; then
      # shellcheck disable=SC1090
      source "${spec_state_file}"
    fi
    child_namespace="${K8S_NAMESPACE:-${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-sandbox}}"
    child_asbcp_container_ref=""
    if [[ -n "${INTERNAL_REAL_DIR:-}" && -f "${INTERNAL_REAL_DIR}/asbcp.container" ]]; then
      child_asbcp_container_ref="$(tr -d '[:space:]' < "${INTERNAL_REAL_DIR}/asbcp.container" 2>/dev/null || true)"
    fi
    if [[ -z "${child_asbcp_container_ref}" && -n "${ASBCP_CONTAINER_NAME:-}" ]]; then
      child_asbcp_container_ref="${ASBCP_CONTAINER_NAME}"
    fi
    if [[ -z "${child_asbcp_container_ref}" && -n "${INTERNAL_REAL_DIR:-}" ]]; then
      child_asbcp_container_ref="agentsmith-asbcp-$(basename "${INTERNAL_REAL_DIR}" | tr -cs 'A-Za-z0-9_.-' '-')"
    fi
    {
      printf 'stage=%s\n' "${stage}"
      printf 'state_file=%s\n' "${spec_state_file:-<none>}"
      printf 'namespace=%s\n' "${child_namespace}"
      printf 'asbcp_container_ref=%s\n' "${child_asbcp_container_ref:-<missing>}"
      printf 'collected_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    } > "${evidence_dir}/summary.txt"

    collect_asbcp_docker_log_evidence "${evidence_dir}/asbcp-docker-logs.txt" "${child_asbcp_container_ref}"
    if command -v kubectl >/dev/null 2>&1; then
      run_child_internal_evidence_command "${evidence_dir}/k8s-pods.txt" 20 kubectl --request-timeout=15s get pods -n "${child_namespace}" -o wide
      run_child_internal_evidence_command "${evidence_dir}/k8s-pod-status.txt" 20 kubectl --request-timeout=15s get pods -n "${child_namespace}" -o jsonpath='{range .items[*]}pod={.metadata.name}{"\n"}phase={.status.phase}{"\n"}conditions={range .status.conditions[*]}{.type}:{.status}:{.reason}{";"}{end}{"\n"}containers={range .status.containerStatuses[*]}{.name}|image={.image}|ready={.ready}|restartCount={.restartCount}|waiting={.state.waiting.reason}|terminated={.state.terminated.reason}|exitCode={.state.terminated.exitCode}{";"}{end}{"\n"}init_containers={range .status.initContainerStatuses[*]}{.name}|image={.image}|ready={.ready}|restartCount={.restartCount}|waiting={.state.waiting.reason}|terminated={.state.terminated.reason}|exitCode={.state.terminated.exitCode}{";"}{end}{"\n---\n"}{end}'
      run_child_internal_evidence_command "${evidence_dir}/k8s-events.txt" 20 kubectl --request-timeout=15s get events -n "${child_namespace}" --sort-by=.metadata.creationTimestamp
    else
      printf 'kubectl command is not available; pod list evidence was not collected.\n' > "${evidence_dir}/k8s-pods.txt"
      printf 'kubectl command is not available; pod status evidence was not collected.\n' > "${evidence_dir}/k8s-pod-status.txt"
      printf 'kubectl command is not available; event evidence was not collected.\n' > "${evidence_dir}/k8s-events.txt"
    fi
  ) || true
  return 0
}

record_child_internal_spec_failure() {
  local stage="$1"
  local message="$2"
  local spec_state_file="${3:-}"
  gate_record_failure "${INTERNAL_REAL_DIR}" "scenario_assertion_failed" "${stage}" "${message}"
  collect_child_internal_failure_evidence "${stage}" "${spec_state_file}" || true
}

if [[ -z "${PRESET_ENDPOINT_API_KEY_VALUE}" ]]; then
  gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "endpoint_env" "Missing PRESET_ENDPOINT_API_KEY"
  echo "[internal-backend-real-gate] Missing PRESET_ENDPOINT_API_KEY." >&2
  exit 1
fi

cleanup() {
  if [[ "${KEEP_FAILED_ENV}" == "1" && "${GATE_STATUS}" -ne 0 ]]; then
    info "keeping failed ASBCP environment for inspection"
    if [[ -n "${CURRENT_SANDBOX_STATE_FILE}" && -f "${CURRENT_SANDBOX_STATE_FILE}" ]]; then
      # shellcheck disable=SC1090
      source "${CURRENT_SANDBOX_STATE_FILE}"
      info "asbcp_log=${ASBCP_LOG:-}"
      info "state_file=${CURRENT_SANDBOX_STATE_FILE}"
    else
      info "asbcp_log=${ASBCP_LOG}"
      info "state_file=${STATE_FILE}"
    fi
    info "visual_artifacts=${INTERNAL_VISUAL_ARTIFACT_DIR}"
    return 0
  fi
  stop_internal_afscp_local_runtime
  if [[ -n "${CURRENT_SANDBOX_STATE_FILE}" ]]; then
    INTERNAL_SANDBOX_REAL_STATE_FILE="${CURRENT_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-asbcp >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

ensure_internal_integration_deps_for_afscp
wait_for_internal_integration_deps_for_afscp
ensure_internal_default_workspace_for_afscp
ensure_internal_kind_cluster_for_afscp_reset
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
elif [[ "${GATE_MODE}" == "core-composite" ]]; then
  info "running internal agent-task core composite real integration"
elif [[ "${GATE_MODE}" == "visual-review" ]]; then
  info "running backend-real visual review with internal managed Agent Task sandbox"
elif [[ "${GATE_MODE}" == "files-restore-continue" ]]; then
  info "running Files restore continuation with internal managed Agent Task sandbox"
elif [[ "${GATE_MODE}" == "runner-projection-smoke" ]]; then
  info "running focused runner projection smoke with canonical agentsmith-runner image"
elif [[ "${GATE_MODE}" == "runner-locked-runtime-smoke" ]]; then
  info "running focused locked runtime smoke with canonical agentsmith-runner image"
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
  local spec_kubeconfig
  spec_log_dir="$(dirname "${spec_state_file}")/integration"
  spec_agent_execution_ws_base_url="ws://${KIND_GATEWAY}:${spec_api_port}"
  spec_kubeconfig="$(internal_real_gate_asbcp_kubeconfig_path)"
  (
    cd "${ROOT_DIR}" && \
      PRESET_ENDPOINT_API_KEY="${PRESET_ENDPOINT_API_KEY_VALUE}" \
      ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL_VALUE}" \
      ASBCP_SERVICE_KEY="${ASBCP_SERVICE_KEY_VALUE}" \
      DATABASE_URL="postgresql://mbos:mbos_dev_password@127.0.0.1:${INTEGRATION_POSTGRES_PORT}/mbos" \
      MONGO_URL="${MONGO_URL}" \
      MONGO_DB_NAME="${MONGO_DB_NAME}" \
      REDIS_URL="redis://127.0.0.1:${INTEGRATION_REDIS_PORT}" \
      MINIO_ENDPOINT="127.0.0.1" \
      MINIO_PORT="${INTEGRATION_MINIO_API_PORT}" \
      KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
      KEYCLOAK_URL="${KEYCLOAK_BASE_URL%/}/realms" \
      KUBECONFIG="${spec_kubeconfig}" \
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
      BACKEND_REAL_OPENAI_BASE_URL="${BACKEND_REAL_OPENAI_BASE_URL:-${BACKEND_REAL_OPENAI_BASE_URL_VALUE}}" \
      INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
      INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
      INTEGRATION_RUNNER_PROJECTION_SMOKE="${INTEGRATION_RUNNER_PROJECTION_SMOKE:-0}" \
      INTEGRATION_RUNNER_PROJECTION_SMOKE_IMAGE_ID="${INTEGRATION_RUNNER_PROJECTION_SMOKE_IMAGE_ID:-}" \
      INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE="${INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE:-0}" \
      INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE_IMAGE_ID="${INTEGRATION_RUNNER_LOCKED_RUNTIME_SMOKE_IMAGE_ID:-}" \
      INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE="${INTEGRATION_DISABLE_SEEDED_MANAGED_RUNNER_REUSE:-0}" \
      INTEGRATION_INTERNAL_AGENT_BASE_IMAGE="${RUNNER_BASE_IMAGE}" \
      INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE:-1}" \
      INTEGRATION_INTERNAL_AGENT_REBUILD_IMAGE=0 \
      AGENT_EXECUTION_WS_BASE_URL="${spec_agent_execution_ws_base_url}" \
      INTERNAL_REAL_VISUAL_ARTIFACT_DIR="${INTERNAL_VISUAL_ARTIFACT_DIR}" \
      INTERNAL_SANDBOX_REAL_STATE_FILE="${spec_state_file}" \
      INTEGRATION_AFSCP_LOCAL_RUNTIME=0 \
      INTEGRATION_BOOTSTRAP_DEPS=false \
      INTEGRATION_INIT_DEPS=false \
      INTEGRATION_ENSURE_DEFAULT_WORKSPACE=false \
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
  gate_record_preflight_check "${INTERNAL_REAL_DIR}" "${spec_slug}_asbcp" "passed" "port ${ASBCP_PORT}"
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
    record_child_internal_spec_failure "${spec_slug}" "${spec} failed with status ${spec_status}" "${spec_state_file}"
  fi
  if [[ "${KEEP_FAILED_ENV}" != "1" || "${spec_status}" -eq 0 ]]; then
    INTERNAL_SANDBOX_REAL_STATE_FILE="${spec_state_file}" bash "${CONTROL_SCRIPT}" stop-asbcp >/dev/null 2>&1 || true
  fi
  return "${spec_status}"
}

run_skills_runtime_specs() {
  local runner_api_port="${1:-20073}"
  local runner_web_port="${2:-3066}"
  local skills_status=0

  run_internal_spec_grep e2e/integration-agent-task-runner.spec.ts "reads task context through mbos-context in a real Agent Task run resolved by the default Agent Runner|writes task context through mbos-context and persists it for the task owner|keeps provider-neutral projection smoke on mbos-context without projected dependencies|reads task context through mbos-context inside a real Agent Task terminal session resolved by the default Agent Runner|rejects shared workspace context writes inside a real Agent Task terminal session resolved by the default Agent Runner" "${runner_api_port}" "${runner_web_port}" || skills_status=$?
  if [[ "${skills_status}" -eq 0 ]]; then
    run_internal_spec_grep e2e/integration-context-store-isolation.spec.ts "member context stays private between workspace members|task context stays private to the task owner within the same workspace" 23079 33079 || skills_status=$?
  fi

  return "${skills_status}"
}

run_runner_projection_smoke_spec() {
  local runner_api_port="${1:-20074}"
  local runner_web_port="${2:-3074}"
  local projection_status=0

  run_internal_spec_grep e2e/integration-agent-task-runner.spec.ts "keeps provider-neutral projection smoke on mbos-context without projected dependencies" "${runner_api_port}" "${runner_web_port}" "${PLAYWRIGHT_PASSTHROUGH_ARGS[@]}" || projection_status=$?
  return "${projection_status}"
}

run_runner_locked_runtime_smoke_spec() {
  local runner_api_port="${1:-20075}"
  local runner_web_port="${2:-3075}"
  local locked_runtime_status=0

  run_internal_spec_grep e2e/integration-agent-task-runner.spec.ts "keeps locked agentsmith-runner image provider-neutral for projection smoke in a real Agent Task run" "${runner_api_port}" "${runner_web_port}" "${PLAYWRIGHT_PASSTHROUGH_ARGS[@]}" || locked_runtime_status=$?
  return "${locked_runtime_status}"
}

run_internal_reclaim_spec() {
  local reclaim_api_port="$1"
  local reclaim_web_port="$2"
  local reclaim_state_file=""
  local reclaim_status=0

  reclaim_state_file="$(prepare_internal_backend_real_spec_runtime "integration-internal-sandbox-reclaim")" || reclaim_status=$?
  if [[ "${reclaim_status}" -eq 0 ]]; then
    gate_record_preflight_check "${INTERNAL_REAL_DIR}" "reclaim_spec_asbcp" "passed" "port ${ASBCP_PORT}"
    run_internal_spec e2e/integration-internal-sandbox-reclaim.spec.ts "${reclaim_api_port}" "${reclaim_web_port}" "${reclaim_state_file}" || reclaim_status=$?
  fi
  if [[ "${reclaim_status}" -eq 0 ]]; then
    gate_record_preflight_check "${INTERNAL_REAL_DIR}" "reclaim_spec" "passed" "integration-internal-sandbox-reclaim"
  else
    record_child_internal_spec_failure "reclaim_spec" "integration-internal-sandbox-reclaim failed with status ${reclaim_status}" "${reclaim_state_file}"
  fi
  if [[ -n "${reclaim_state_file}" && ( "${KEEP_FAILED_ENV}" != "1" || "${reclaim_status}" -eq 0 ) ]]; then
    INTERNAL_SANDBOX_REAL_STATE_FILE="${reclaim_state_file}" bash "${CONTROL_SCRIPT}" stop-asbcp >/dev/null 2>&1 || true
  fi
  return "${reclaim_status}"
}

run_core_composite_specs() {
  local composite_status=0

  run_skills_runtime_specs "${API_PORT}" "${WEB_PORT}" || composite_status=$?
  if [[ "${composite_status}" -eq 0 ]]; then
    run_internal_reclaim_spec "$((API_PORT + 1))" "$((WEB_PORT + 1))" || composite_status=$?
  fi

  return "${composite_status}"
}

run_internal_workspace_specs() {
  local workspace_state_file
  local workspace_status=0
  local reclaim_status=0

  workspace_state_file="$(prepare_internal_backend_real_spec_runtime "integration-internal-agent-task-workspace")" || workspace_status=$?
  if [[ "${workspace_status}" -eq 0 ]]; then
    gate_record_preflight_check "${INTERNAL_REAL_DIR}" "workspace_spec_asbcp" "passed" "port ${ASBCP_PORT}"
    run_internal_spec e2e/integration-agent-task-runner.spec.ts "${API_PORT}" "${WEB_PORT}" "${workspace_state_file}" --grep "reads task context through mbos-context in a real Agent Task run resolved by the default Agent Runner"
    workspace_status=$?
  fi
  if [[ "${workspace_status}" -eq 0 ]]; then
    gate_record_preflight_check "${INTERNAL_REAL_DIR}" "workspace_spec" "passed" "integration-agent-task-runner"
  else
    record_child_internal_spec_failure "workspace_spec" "integration-agent-task-runner failed with status ${workspace_status}" "${workspace_state_file}"
  fi
  if [[ "${workspace_status}" -eq 0 ]]; then
    INTERNAL_SANDBOX_REAL_STATE_FILE="${workspace_state_file}" bash "${CONTROL_SCRIPT}" stop-asbcp >/dev/null 2>&1 || true
    run_internal_reclaim_spec "$((API_PORT + 1))" "$((WEB_PORT + 1))" || reclaim_status=$?
  elif [[ "${KEEP_FAILED_ENV}" != "1" && -n "${workspace_state_file}" ]]; then
    INTERNAL_SANDBOX_REAL_STATE_FILE="${workspace_state_file}" bash "${CONTROL_SCRIPT}" stop-asbcp >/dev/null 2>&1 || true
  fi

  if [[ "${workspace_status}" -ne 0 ]]; then
    return "${workspace_status}"
  fi
  return "${reclaim_status}"
}

set +e
if [[ "${GATE_MODE}" == "runner-projection-smoke" ]]; then
  run_runner_projection_smoke_spec
  GATE_STATUS=$?
  set -e
  if [[ "${GATE_STATUS}" -ne 0 ]]; then
    exit "${GATE_STATUS}"
  fi
  info "focused runner projection smoke passed"
  gate_record_success "${INTERNAL_REAL_DIR}" "runner_projection_smoke_spec"
  exit 0
fi

if [[ "${GATE_MODE}" == "runner-locked-runtime-smoke" ]]; then
  run_runner_locked_runtime_smoke_spec
  GATE_STATUS=$?
  set -e
  if [[ "${GATE_STATUS}" -ne 0 ]]; then
    exit "${GATE_STATUS}"
  fi
  info "focused locked runner runtime smoke passed"
  gate_record_success "${INTERNAL_REAL_DIR}" "runner_locked_runtime_smoke_spec"
  exit 0
fi

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

if [[ "${GATE_MODE}" == "core-composite" ]]; then
  run_core_composite_specs
  GATE_STATUS=$?
  set -e
  if [[ "${GATE_STATUS}" -ne 0 ]]; then
    exit "${GATE_STATUS}"
  fi
  info "internal agent-task core composite real gate passed"
  gate_record_success "${INTERNAL_REAL_DIR}" "core_composite_specs"
  exit 0
fi

if [[ "${GATE_MODE}" == "visual-review" ]]; then
  VISUAL_REVIEW_STATUS=0
  VISUAL_REVIEW_STATE_FILE="$(prepare_internal_backend_real_spec_runtime "integration-visual-review")" || VISUAL_REVIEW_STATUS=$?
  if [[ "${VISUAL_REVIEW_STATUS}" -eq 0 ]]; then
    gate_record_preflight_check "${INTERNAL_REAL_DIR}" "visual_review_spec_asbcp" "passed" "port ${ASBCP_PORT}"
    run_internal_spec e2e/integration-visual-review.spec.ts "${API_PORT}" "${WEB_PORT}" "${VISUAL_REVIEW_STATE_FILE}" || VISUAL_REVIEW_STATUS=$?
  fi
  if [[ "${VISUAL_REVIEW_STATUS}" -eq 0 ]]; then
    gate_record_preflight_check "${INTERNAL_REAL_DIR}" "visual_review_spec" "passed" "integration-visual-review"
  else
    record_child_internal_spec_failure "visual_review_spec" "integration-visual-review failed with status ${VISUAL_REVIEW_STATUS}" "${VISUAL_REVIEW_STATE_FILE}"
  fi
  if [[ -n "${VISUAL_REVIEW_STATE_FILE:-}" && ( "${KEEP_FAILED_ENV}" != "1" || "${VISUAL_REVIEW_STATUS}" -eq 0 ) ]]; then
    INTERNAL_SANDBOX_REAL_STATE_FILE="${VISUAL_REVIEW_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-asbcp >/dev/null 2>&1 || true
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

run_internal_workspace_specs
GATE_STATUS=$?
set -e

if [[ "${GATE_STATUS}" -ne 0 ]]; then
  exit "${GATE_STATUS}"
fi

info "internal agent-task workspace real gate passed"
gate_record_success "${INTERNAL_REAL_DIR}" "internal_specs"
