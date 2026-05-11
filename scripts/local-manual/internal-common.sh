#!/usr/bin/env bash
set -euo pipefail

export LOCAL_MANUAL_ENABLE_INTERNAL=1

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
source "${ROOT_DIR}/scripts/lib/k8s-external-services.sh"
source "${ROOT_DIR}/scripts/lib/runner-image-common.sh"

LOCAL_MANUAL_INTERNAL_COMMON_SOURCE_ENV_INITIALIZED="${LOCAL_MANUAL_INTERNAL_COMMON_SOURCE_ENV_INITIALIZED:-0}"
LOCAL_MANUAL_INTERNAL_COMMON_RUNTIME_ENV_INITIALIZED="${LOCAL_MANUAL_INTERNAL_COMMON_RUNTIME_ENV_INITIALIZED:-0}"

# Keep this file safe to source as a library by loading only env needed for
# source-time defaults here. The substrate-backed runtime init stays lazy.
init_internal_common_source_env() {
  if [[ "${LOCAL_MANUAL_INTERNAL_COMMON_SOURCE_ENV_INITIALIZED}" == "1" ]]; then
    return 0
  fi

  load_runtime_env_stack "local-manual" "${ENV_FILE}"
  load_local_manual_internal_env

  PORT_API="${PORT_API:-20000}"
  PORT_WEB="${PORT_WEB:-3001}"
  LOCAL_MANUAL_ALLOW_UNTRACKED_PORT_CLEANUP="${LOCAL_MANUAL_ALLOW_UNTRACKED_PORT_CLEANUP:-0}"
  LOCAL_MANUAL_ALLOW_UNTRACKED_PROCESS_RESCUE="${LOCAL_MANUAL_ALLOW_UNTRACKED_PROCESS_RESCUE:-0}"
  LOCALE="${LOCALE:-zh-CN}"
  WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"

  LOCAL_MANUAL_INTERNAL_COMMON_SOURCE_ENV_INITIALIZED=1
}

ensure_internal_common_runtime_env() {
  if [[ "${LOCAL_MANUAL_INTERNAL_COMMON_RUNTIME_ENV_INITIALIZED}" == "1" ]]; then
    return 0
  fi

  init_local_manual_env
  LOCAL_MANUAL_INTERNAL_COMMON_RUNTIME_ENV_INITIALIZED=1
}

init_internal_common_source_env

SANDBOX_ROOT="${SANDBOX_ROOT:-$(cd "${ROOT_DIR}/../mbos-sandbox-v1" && pwd)}"
INTERNAL_REAL_DIR="${INTERNAL_REAL_DIR:-$(backend_real_tmp_file internal)}"
INTERNAL_REAL_DIR="$(realpath -m "${INTERNAL_REAL_DIR}")"
INTERNAL_SANDBOX_STATE_FILE="${INTERNAL_SANDBOX_STATE_FILE:-${INTERNAL_REAL_DIR}/sandbox-control.env}"
INTERNAL_SANDBOX_MANAGER_LOG="${INTERNAL_SANDBOX_MANAGER_LOG:-${INTERNAL_REAL_DIR}/sandbox-manager.log}"
INTERNAL_SANDBOX_MANAGER_CONFIG="${INTERNAL_SANDBOX_MANAGER_CONFIG:-${INTERNAL_REAL_DIR}/sandbox-manager.yaml}"
INTERNAL_SANDBOX_MANAGER_URL_VALUE="${SANDBOX_MANAGER_URL:-http://127.0.0.1:28080}"
INTERNAL_SANDBOX_PORT="${INTERNAL_SANDBOX_MANAGER_URL_VALUE##*:}"
INTERNAL_SANDBOX_PORT="${INTERNAL_SANDBOX_PORT%%/*}"
SANDBOX_SERVICE_KEY_VALUE="${SANDBOX_SERVICE_KEY:-agentsmith-internal-test-key}"
KIND_CLUSTER_NAME="${INTERNAL_AGENT_KIND_CLUSTER_NAME:-agentsmith}"
KIND_CONTEXT_NAME="kind-${KIND_CLUSTER_NAME}"
K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-sandbox}"
CSI_DRIVER="${AFSCP_STORAGE_CSI_DRIVER:-csi.juicefs.com}"
STORAGE_CAPACITY="${AFSCP_STORAGE_CAPACITY:-1Pi}"
STORAGE_CLASS_NAME="${AFSCP_STORAGE_CLASS_NAME:-juicefs-sc}"
MOUNT_OPTIONS="${AFSCP_STORAGE_CSI_MOUNT_OPTIONS:-}"
SUBDIR="${AFSCP_STORAGE_CSI_SUBDIR:-}"
MOUNT_SERVICE_ACCOUNT="${AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT:-}"
MOUNT_IMAGE_OVERRIDE="${AFSCP_STORAGE_CSI_MOUNT_IMAGE:-}"
RUNNER_KIND="${LOCAL_MANUAL_INTERNAL_AGENT_RUNNER_KIND:-agent-task}"
RUNNER_IMAGE="${LOCAL_MANUAL_INTERNAL_AGENT_IMAGE:-$(runner_default_image "${RUNNER_KIND}")}"
RUNNER_BASE_IMAGE="${LOCAL_MANUAL_INTERNAL_AGENT_BASE_IMAGE:-$(runner_default_base_image "${RUNNER_KIND}")}"
DOCKER_BUILD_PROXY_VALUE="${LOCAL_MANUAL_INTERNAL_DOCKER_BUILD_PROXY:-${DOCKER_BUILD_PROXY:-${HTTP_PROXY:-}}}"
REBUILD_RUNNER_IMAGE="${LOCAL_MANUAL_INTERNAL_REBUILD_RUNNER_IMAGE:-0}"
AFSCP_STORAGE_CSI_MOUNT_IMAGE="${AFSCP_STORAGE_CSI_MOUNT_IMAGE:-juicedata/mount:ce-v1.3.1}"
AFSCP_STORAGE_CSI_VERSION="${AFSCP_STORAGE_CSI_VERSION:-v0.31.3}"
AFSCP_STORAGE_CSI_MANIFEST_PATH="${AFSCP_STORAGE_CSI_MANIFEST_PATH:-${ROOT_DIR}/infra/deploy/unified/local-kind/juicefs-csi/upstream-manifest.yaml}"
AFSCP_STORAGE_CSI_NAMESPACE="${AFSCP_STORAGE_CSI_NAMESPACE:-kube-system}"
KIND_CONFIG_PATH="${LOCAL_KIND_CONFIG_PATH:-${ROOT_DIR}/infra/deploy/unified/local-kind/config.yaml}"
EXTERNAL_DEPS_MANIFEST="${INTERNAL_REAL_DIR}/external-dependencies.yaml"
CONTROL_SCRIPT="${ROOT_DIR}/scripts/lib/internal-sandbox-real-control.sh"
AFSCP_ROOT="${AFSCP_ROOT:-$(realpath -m "${ROOT_DIR}/../agentsmith-fs-control-plane")}"
AFSCP_BASE_URL="${AFSCP_BASE_URL:-http://127.0.0.1:28090}"
AFSCP_API_PORT="${AFSCP_API_PORT:-$(local_manual_port_from_url "${AFSCP_BASE_URL}" 2>/dev/null || printf '28090')}"
AFSCP_API_LISTEN_ADDR="${AFSCP_API_LISTEN_ADDR:-127.0.0.1:${AFSCP_API_PORT}}"
AFSCP_EXPORT_GATEWAY_BASE_URL="${AFSCP_EXPORT_GATEWAY_BASE_URL:-http://127.0.0.1:28091}"
AFSCP_EXPORT_GATEWAY_PORT="${AFSCP_EXPORT_GATEWAY_PORT:-$(local_manual_port_from_url "${AFSCP_EXPORT_GATEWAY_BASE_URL}" 2>/dev/null || printf '28091')}"
AFSCP_EXPORT_GATEWAY_LISTEN_ADDR="${AFSCP_EXPORT_GATEWAY_LISTEN_ADDR:-127.0.0.1:${AFSCP_EXPORT_GATEWAY_PORT}}"
AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID:-vol_local_manual}"
AFSCP_LOCAL_RUNTIME_WORKLOAD_MOUNT_SECRET_NAME="${AFSCP_LOCAL_RUNTIME_WORKLOAD_MOUNT_SECRET_NAME:-afscp-local-runtime}"
AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE:-agentsmith-api}"
AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE:-agentsmith-bootstrap}"
AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-manager}"
AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN:-agentsmith-local-afscp-product-token}"
AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN:-agentsmith-local-afscp-bootstrap-token}"
AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-agentsmith-local-afscp-orchestrator-token}"
AFSCP_VOLUME_ROOT="${AFSCP_VOLUME_ROOT:-${INTERNAL_REAL_DIR}/afscp-volume-root}"
AFSCP_VOLUME_ROOT_MOUNT_MARKER="${AFSCP_VOLUME_ROOT_MOUNT_MARKER:-${INTERNAL_REAL_DIR}/afscp-volume-root.mount}"
AFSCP_LOCAL_RUNTIME_JUICEFS_MOUNT_LOG="${AFSCP_LOCAL_RUNTIME_JUICEFS_MOUNT_LOG:-${INTERNAL_REAL_DIR}/afscp-juicefs-mount.log}"
AFSCP_LOCAL_RUNTIME_JUICEFS_CACHE_DIR="${AFSCP_LOCAL_RUNTIME_JUICEFS_CACHE_DIR:-${INTERNAL_REAL_DIR}/afscp-juicefs-cache}"
AFSCP_JVS_CWD="${AFSCP_JVS_CWD:-${INTERNAL_REAL_DIR}/afscp-jvs-cwd}"
AFSCP_JVS_RELEASE_BINARY_NAME="${AFSCP_JVS_RELEASE_BINARY_NAME:-jvs-linux-amd64}"
AFSCP_JVS_RELEASE_CACHE_DIR="${AFSCP_JVS_RELEASE_CACHE_DIR:-${INTERNAL_REAL_DIR}/jvs-release}"
AFSCP_JVS_RELEASE_BINARY_CACHE_PATH="${AFSCP_JVS_RELEASE_BINARY_CACHE_PATH:-${AFSCP_JVS_RELEASE_CACHE_DIR}/${AFSCP_JVS_RELEASE_BINARY_NAME}}"
AFSCP_JVS_RELEASE_SHA256SUMS_CACHE_PATH="${AFSCP_JVS_RELEASE_SHA256SUMS_CACHE_PATH:-${AFSCP_JVS_RELEASE_CACHE_DIR}/SHA256SUMS}"
AFSCP_JVS_RELEASE_VERSION="${AFSCP_JVS_RELEASE_VERSION:-v0.4.8}"
AFSCP_JVS_RELEASE_BASE_URL="${AFSCP_JVS_RELEASE_BASE_URL:-https://github.com/agentsmith-project/jvs/releases/download/${AFSCP_JVS_RELEASE_VERSION}}"
AFSCP_JVS_BINARY_PATH="${AFSCP_JVS_BINARY_PATH:-}"
AFSCP_JVS_BINARY_SHA256="${AFSCP_JVS_BINARY_SHA256:-}"
AFSCP_JVS_SHA256SUMS_PATH="${AFSCP_JVS_SHA256SUMS_PATH:-}"
AFSCP_JVS_RELEASE_URL="${AFSCP_JVS_RELEASE_URL:-${AFSCP_JVS_RELEASE_BASE_URL}/${AFSCP_JVS_RELEASE_BINARY_NAME}}"
AFSCP_JVS_SHA256SUMS_URL="${AFSCP_JVS_SHA256SUMS_URL:-${AFSCP_JVS_RELEASE_BASE_URL}/SHA256SUMS}"
AFSCP_LOCAL_RUNTIME_ENV_FILE="${AFSCP_LOCAL_RUNTIME_ENV_FILE:-${INTERNAL_REAL_DIR}/afscp-local-runtime.env}"
AFSCP_API_PID_FILE="${AFSCP_API_PID_FILE:-${INTERNAL_REAL_DIR}/afscp-api.pid}"
AFSCP_API_LOG="${AFSCP_API_LOG:-${INTERNAL_REAL_DIR}/afscp-api.log}"
AFSCP_API_READY_FILE="${AFSCP_API_READY_FILE:-${INTERNAL_REAL_DIR}/afscp-api.ready}"
AFSCP_WORKER_PID_FILE="${AFSCP_WORKER_PID_FILE:-${INTERNAL_REAL_DIR}/afscp-worker.pid}"
AFSCP_WORKER_LOG="${AFSCP_WORKER_LOG:-${INTERNAL_REAL_DIR}/afscp-worker.log}"
AFSCP_WORKER_READY_FILE="${AFSCP_WORKER_READY_FILE:-${INTERNAL_REAL_DIR}/afscp-worker.ready}"
AFSCP_EXPORT_GATEWAY_PID_FILE="${AFSCP_EXPORT_GATEWAY_PID_FILE:-${INTERNAL_REAL_DIR}/afscp-export-gateway.pid}"
AFSCP_EXPORT_GATEWAY_LOG="${AFSCP_EXPORT_GATEWAY_LOG:-${INTERNAL_REAL_DIR}/afscp-export-gateway.log}"
AFSCP_EXPORT_GATEWAY_READY_FILE="${AFSCP_EXPORT_GATEWAY_READY_FILE:-${INTERNAL_REAL_DIR}/afscp-export-gateway.ready}"
AFSCP_WORKER_INTERVAL_SECONDS="${AFSCP_WORKER_INTERVAL_SECONDS:-2}"

mkdir -p "${INTERNAL_REAL_DIR}"

internal_info() { echo "[local-manual-internal] $*"; }
internal_err() { echo "[local-manual-internal] ERROR: $*" >&2; }

require_local_manual_context() {
  local active
  active="$(current_active_scenario || true)"
  if [[ -n "${active}" && "${active}" != "local-manual" ]]; then
    internal_err "active scenario is ${active}; stop it before enabling local-manual internal mode"
    exit 1
  fi
}

ensure_local_manual_ready() {
  require_local_manual_context
  if ! local_manual_platform_is_ready; then
    internal_info "starting default local-manual flow"
    LOCAL_MANUAL_ENABLE_INTERNAL=0 bash "${ROOT_DIR}/scripts/local-manual/up.sh"
  fi
}

ensure_agent_task_diagnostics_ready() {
  ensure_agent_task_diagnostics_state_ready
  ensure_local_manual_runner_connected
}

stop_local_manual_runner_for_internal_api_restart() {
  if ! stop_local_manual_runner_owner_aware internal_api_restart; then
    internal_err "runner ownership is unverified; refusing to continue internal API restart"
    exit 1
  fi
}

ensure_internal_runner_state_before_api_restart() {
  ensure_internal_common_runtime_env
  stop_local_manual_runner_for_internal_api_restart
  ensure_agent_task_diagnostics_state_ready
  stop_local_manual_runner_for_internal_api_restart
}

managed_agent_task_runner_state_is_present() {
  local token project_id endpoint_id existing_runner current_runner_provider status
  token="$(cat "$(backend_real_token_file)" 2>/dev/null || true)"
  project_id="$(state_get project.id)"
  endpoint_id="$(state_get endpoint.id)"
  existing_runner="$(state_get agent_runner.id)"
  current_runner_provider="$(state_get agent_runner.runner_provider)"
  [[ -n "${token}" && -n "${project_id}" && -n "${endpoint_id}" && -n "${existing_runner}" && "${current_runner_provider}" == "managed" ]] || return 1

  status="$(curl -sS -o /dev/null -w '%{http_code}' \
    "http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}/agent-runners/${existing_runner}" \
    -H "Authorization: Bearer ${token}" || true)"
  [[ "${status}" == "200" ]]
}

seed_managed_agent_task_diagnostics_state() {
  AGENT_RUNNER_SEED_MODE=managed_agent_task \
    LOCAL_MANUAL_AGENT_TASK_DIAGNOSTICS_START_RUNNER=0 \
    LOCAL_MANUAL_ENABLE_INTERNAL=0 \
    bash "${ROOT_DIR}/scripts/local-manual/seed-agent-task-diagnostics.sh"
}

ensure_agent_task_diagnostics_state_ready() {
  ensure_internal_common_runtime_env
  if ! managed_agent_task_runner_state_is_present; then
    internal_info "preparing managed agent-task diagnostic state"
    seed_managed_agent_task_diagnostics_state
  fi
}

ensure_kind_cluster() {
  ensure_local_kind_cluster
}

ensure_local_image() {
  local image="$1"
  if docker image inspect "${image}" >/dev/null 2>&1; then
    return 0
  fi
  internal_info "pulling required image ${image}"
  docker pull "${image}" >/dev/null
}

ensure_kind_image() {
  local image="$1"
  local node_name="${KIND_CLUSTER_NAME}-control-plane"
  local tarball
  tarball="$(mktemp /tmp/kind-image.XXXXXX.tar)"
  docker save "${image}" -o "${tarball}"
  cat "${tarball}" | docker exec -i "${node_name}" sh -lc 'cat > /tmp/image.tar && ctr -n k8s.io images import /tmp/image.tar && rm -f /tmp/image.tar'
  rm -f "${tarball}"
}

ensure_internal_runner_image() {
  internal_info "ensuring internal ${RUNNER_KIND} runner image ${RUNNER_IMAGE}"
  build_runner_image "${RUNNER_KIND}" "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY_VALUE}" "0" "${REBUILD_RUNNER_IMAGE}"
  internal_info "loading ${RUNNER_IMAGE} into kind"
  ensure_kind_image "${RUNNER_IMAGE}"
}

wait_for_afscp_storage_csi_pods() {
  local namespace="$1"
  local selector="$2"
  local timeout_seconds="${3:-120}"
  local started
  started="$(date +%s)"
  while true; do
    if kubectl get pod -n "${namespace}" -l "${selector}" --no-headers 2>/dev/null | grep -q .; then
      return 0
    fi
    if (( $(date +%s) - started >= timeout_seconds )); then
      return 1
    fi
    sleep 2
  done
}

wait_for_afscp_storage_csi_ready() {
  local namespace="$1"
  wait_for_afscp_storage_csi_pods "${namespace}" 'app=juicefs-csi-controller'
  kubectl wait --for=condition=Ready pod -l app=juicefs-csi-controller -n "${namespace}" --timeout=600s >/dev/null
  wait_for_afscp_storage_csi_pods "${namespace}" 'app=juicefs-csi-node'
  kubectl wait --for=condition=Ready pod -l app=juicefs-csi-node -n "${namespace}" --timeout=600s >/dev/null
}

ensure_afscp_storage_csi() {
  local csi_namespace
  internal_info "reconciling AFSCP storage CSI driver ${CSI_DRIVER}"
  local csi_manifest="${AFSCP_STORAGE_CSI_MANIFEST_PATH}"
  if [[ ! -f "${csi_manifest}" ]]; then
    csi_manifest="https://raw.githubusercontent.com/juicedata/juicefs-csi-driver/master/deploy/k8s.yaml"
  fi
  kubectl apply --validate=false -f "${csi_manifest}" >/dev/null

  csi_namespace="${AFSCP_STORAGE_CSI_NAMESPACE}"

  internal_info "loading CSI images into kind"
  ensure_local_image "${AFSCP_STORAGE_CSI_MOUNT_IMAGE}"
  ensure_kind_image "juicedata/juicefs-csi-driver:${AFSCP_STORAGE_CSI_VERSION}"
  ensure_kind_image "juicedata/csi-dashboard:${AFSCP_STORAGE_CSI_VERSION}"
  ensure_kind_image "${AFSCP_STORAGE_CSI_MOUNT_IMAGE}"
  ensure_kind_image "registry.k8s.io/sig-storage/csi-provisioner:v3.6.0"
  ensure_kind_image "registry.k8s.io/sig-storage/csi-resizer:v1.9.0"
  ensure_kind_image "registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0"
  ensure_kind_image "registry.k8s.io/sig-storage/livenessprobe:v2.11.0"

  kubectl scale statefulset/juicefs-csi-controller -n "${csi_namespace}" --replicas=1 >/dev/null || true
  kubectl delete pod -n "${csi_namespace}" -l app=juicefs-csi-controller >/dev/null 2>&1 || true
  kubectl delete pod -n "${csi_namespace}" -l app=juicefs-csi-node >/dev/null 2>&1 || true
  wait_for_afscp_storage_csi_ready "${csi_namespace}"
}

resolve_kind_gateway_ip() {
  local gateway=""
  if docker network inspect kind >/dev/null 2>&1; then
    gateway="$(
      docker network inspect kind -f '{{range .IPAM.Config}}{{println .Gateway}}{{end}}' 2>/dev/null \
        | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' \
        | head -n1 \
        || true
    )"
  fi
  if [[ -z "${gateway}" ]]; then
    gateway="host.docker.internal"
  fi
  printf '%s\n' "${gateway}"
}

ensure_internal_external_dependency_services() {
  ensure_internal_common_runtime_env
  local kind_gateway
  kind_gateway="$(resolve_kind_gateway_ip)"
  ensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"
  render_k8s_external_dependency_services \
    "${EXTERNAL_DEPS_MANIFEST}" \
    "${K8S_NAMESPACE}" \
    "${kind_gateway}" \
    "${SUBSTRATE_POSTGRES_PORT}" \
    "${kind_gateway}" \
    "${SUBSTRATE_MINIO_API_PORT}"
  kubectl apply -f "${EXTERNAL_DEPS_MANIFEST}" >/dev/null
}

afscp_jvs_normalize_sha256() {
  local value="$1"
  printf '%s\n' "${value,,}"
}

afscp_jvs_valid_sha256() {
  local value="$1"
  [[ "${value}" =~ ^[0-9a-f]{64}$ ]]
}

afscp_jvs_sha256_from_sums() {
  local sums_path="$1"
  local binary_name="$2"
  [[ -f "${sums_path}" ]] || return 1
  awk -v name="${binary_name}" '
    /^[[:space:]]*#/ || NF < 2 { next }
    {
      hash = tolower($1)
      file = $2
      sub(/^\*/, "", file)
      base = file
      sub(/^.*\//, "", base)
      if (length(hash) == 64 && hash ~ /^[[:xdigit:]]+$/ && (file == name || base == name)) {
        print hash
        found = 1
        exit
      }
    }
    END { if (!found) exit 1 }
  ' "${sums_path}"
}

afscp_file_sha256() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${path}" | awk '{print tolower($1)}'
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${path}" | awk '{print tolower($1)}'
    return 0
  fi
  internal_err "sha256sum or shasum is required to verify the JVS release artifact"
  return 1
}

afscp_verify_jvs_binary_sha256() {
  local binary_path="$1"
  local expected_sha
  expected_sha="$(afscp_jvs_normalize_sha256 "$2")"
  local source_label="$3"
  if [[ ! -f "${binary_path}" ]]; then
    internal_err "missing JVS release artifact for ${source_label}: ${binary_path}"
    return 1
  fi
  if ! afscp_jvs_valid_sha256 "${expected_sha}"; then
    internal_err "JVS SHA-256 from ${source_label} is malformed; local-real fails closed"
    return 1
  fi
  local actual_sha
  actual_sha="$(afscp_file_sha256 "${binary_path}")" || return 1
  if [[ "${actual_sha}" != "${expected_sha}" ]]; then
    internal_err "JVS binary SHA-256 mismatch for ${binary_path}; expected ${expected_sha}, got ${actual_sha}"
    return 1
  fi
}

afscp_use_jvs_release_artifact() {
  local binary_path="$1"
  local sums_path="$2"
  local binary_name="${3:-$(basename "${binary_path}")}"
  local expected_sha
  expected_sha="$(afscp_jvs_sha256_from_sums "${sums_path}" "${binary_name}")" || {
    internal_err "could not resolve ${binary_name} SHA-256 from ${sums_path}"
    return 1
  }
  afscp_verify_jvs_binary_sha256 "${binary_path}" "${expected_sha}" "${sums_path}" || return 1
  AFSCP_JVS_BINARY_PATH="$(realpath -m "${binary_path}")"
  AFSCP_JVS_BINARY_SHA256="${expected_sha}"
  chmod 0755 "${AFSCP_JVS_BINARY_PATH}" >/dev/null 2>&1 || true
}

afscp_download_jvs_release_file() {
  local url="$1"
  local output_path="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 --connect-timeout 10 -o "${output_path}" "${url}"
    return $?
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q -O "${output_path}" "${url}"
    return $?
  fi
  internal_err "curl or wget is required to download configured JVS release artifacts"
  return 1
}

prepare_afscp_jvs_release_artifact() {
  local cache_binary="${AFSCP_JVS_RELEASE_BINARY_CACHE_PATH}"
  local cache_sums="${AFSCP_JVS_RELEASE_SHA256SUMS_CACHE_PATH}"

  if [[ -f "${cache_binary}" && -f "${cache_sums}" ]]; then
    afscp_use_jvs_release_artifact "${cache_binary}" "${cache_sums}" "${AFSCP_JVS_RELEASE_BINARY_NAME}"
    return $?
  fi

  if [[ -n "${AFSCP_JVS_SHA256SUMS_PATH}" ]]; then
    local explicit_sums
    explicit_sums="$(realpath -m "${AFSCP_JVS_SHA256SUMS_PATH}")"
    if [[ ! -f "${explicit_sums}" ]]; then
      internal_err "configured AFSCP_JVS_SHA256SUMS_PATH does not exist: ${explicit_sums}"
      return 1
    fi
    if [[ -f "${cache_binary}" ]]; then
      afscp_use_jvs_release_artifact "${cache_binary}" "${explicit_sums}" "${AFSCP_JVS_RELEASE_BINARY_NAME}"
      return $?
    fi
    local explicit_binary
    explicit_binary="$(realpath -m "$(dirname "${explicit_sums}")/${AFSCP_JVS_RELEASE_BINARY_NAME}")"
    if [[ -f "${explicit_binary}" ]]; then
      afscp_use_jvs_release_artifact "${explicit_binary}" "${explicit_sums}" "${AFSCP_JVS_RELEASE_BINARY_NAME}"
      return $?
    fi
  fi

  if [[ -n "${AFSCP_JVS_RELEASE_URL}" || -n "${AFSCP_JVS_SHA256SUMS_URL}" ]]; then
    if [[ -z "${AFSCP_JVS_RELEASE_URL}" || -z "${AFSCP_JVS_SHA256SUMS_URL}" ]]; then
      internal_err "set both AFSCP_JVS_RELEASE_URL and AFSCP_JVS_SHA256SUMS_URL to download a verified JVS release artifact"
      return 1
    fi
    mkdir -p "${AFSCP_JVS_RELEASE_CACHE_DIR}" "$(dirname "${cache_binary}")" "$(dirname "${cache_sums}")"
    local tmp_binary tmp_sums expected_sha
    tmp_binary="$(mktemp "${AFSCP_JVS_RELEASE_CACHE_DIR}/${AFSCP_JVS_RELEASE_BINARY_NAME}.download.XXXXXX")"
    tmp_sums="$(mktemp "${AFSCP_JVS_RELEASE_CACHE_DIR}/SHA256SUMS.download.XXXXXX")"
    if ! afscp_download_jvs_release_file "${AFSCP_JVS_RELEASE_URL}" "${tmp_binary}"; then
      rm -f "${tmp_binary}" "${tmp_sums}"
      internal_err "failed to download JVS release artifact from AFSCP_JVS_RELEASE_URL; local-real fails closed"
      return 1
    fi
    if ! afscp_download_jvs_release_file "${AFSCP_JVS_SHA256SUMS_URL}" "${tmp_sums}"; then
      rm -f "${tmp_binary}" "${tmp_sums}"
      internal_err "failed to download JVS SHA256SUMS from AFSCP_JVS_SHA256SUMS_URL; local-real fails closed"
      return 1
    fi
    expected_sha="$(afscp_jvs_sha256_from_sums "${tmp_sums}" "${AFSCP_JVS_RELEASE_BINARY_NAME}")" || {
      rm -f "${tmp_binary}" "${tmp_sums}"
      internal_err "downloaded SHA256SUMS does not contain ${AFSCP_JVS_RELEASE_BINARY_NAME}"
      return 1
    }
    afscp_verify_jvs_binary_sha256 "${tmp_binary}" "${expected_sha}" "${AFSCP_JVS_SHA256SUMS_URL}" || {
      rm -f "${tmp_binary}" "${tmp_sums}"
      return 1
    }
    mv "${tmp_binary}" "${cache_binary}"
    mv "${tmp_sums}" "${cache_sums}"
    chmod 0755 "${cache_binary}" >/dev/null 2>&1 || true
    AFSCP_JVS_BINARY_PATH="$(realpath -m "${cache_binary}")"
    AFSCP_JVS_BINARY_SHA256="${expected_sha}"
    return 0
  fi

  internal_err "missing verified JVS release artifact for the AFSCP local-real dependency"
  internal_err "place ${AFSCP_JVS_RELEASE_BINARY_NAME} at ${cache_binary} with ${cache_sums}, or set AFSCP_JVS_RELEASE_URL and AFSCP_JVS_SHA256SUMS_URL"
  internal_err "explicit local paths require AFSCP_JVS_BINARY_PATH plus AFSCP_JVS_BINARY_SHA256 or AFSCP_JVS_SHA256SUMS_PATH; sibling mutable builds are not used by default"
  return 1
}

resolve_afscp_jvs_binary() {
  [[ "${AFSCP_JVS_ENABLED:-true}" == "true" ]] || return 0

  if [[ -n "${AFSCP_JVS_BINARY_PATH}" || -n "${AFSCP_JVS_BINARY_SHA256}" ]]; then
    if [[ -z "${AFSCP_JVS_BINARY_PATH}" ]]; then
      internal_err "AFSCP_JVS_BINARY_SHA256 was set without AFSCP_JVS_BINARY_PATH"
      return 1
    fi
    local explicit_binary explicit_sha
    explicit_binary="$(realpath -m "${AFSCP_JVS_BINARY_PATH}")"
    explicit_sha="${AFSCP_JVS_BINARY_SHA256}"
    if [[ -z "${explicit_sha}" ]]; then
      if [[ -z "${AFSCP_JVS_SHA256SUMS_PATH}" ]]; then
        internal_err "explicit AFSCP_JVS_BINARY_PATH requires AFSCP_JVS_BINARY_SHA256 or AFSCP_JVS_SHA256SUMS_PATH"
        return 1
      fi
      explicit_sha="$(afscp_jvs_sha256_from_sums "${AFSCP_JVS_SHA256SUMS_PATH}" "$(basename "${explicit_binary}")")" || {
        internal_err "could not resolve $(basename "${explicit_binary}") SHA-256 from ${AFSCP_JVS_SHA256SUMS_PATH}"
        return 1
      }
    fi
    explicit_sha="$(afscp_jvs_normalize_sha256 "${explicit_sha}")"
    afscp_verify_jvs_binary_sha256 "${explicit_binary}" "${explicit_sha}" "explicit AFSCP_JVS_BINARY_PATH" || return 1
    AFSCP_JVS_BINARY_PATH="${explicit_binary}"
    AFSCP_JVS_BINARY_SHA256="${explicit_sha}"
    return 0
  fi

  prepare_afscp_jvs_release_artifact
}

afscp_runtime_export_line() {
  local key="$1"
  printf 'export %s=%q\n' "${key}" "${!key}"
}

afscp_default_local_runtime_postgres_dsn() {
  printf 'postgresql://%s:%s@localhost:%s/%s?sslmode=disable' \
    "${SUBSTRATE_DB_USER}" \
    "${SUBSTRATE_DB_PASSWORD}" \
    "${SUBSTRATE_POSTGRES_PORT}" \
    "${SUBSTRATE_DB_NAME}"
}

afscp_substrate_postgres_host_dsn() {
  printf 'postgresql://%s:%s@localhost:%s/%s' \
    "${SUBSTRATE_DB_USER}" \
    "${SUBSTRATE_DB_PASSWORD}" \
    "${SUBSTRATE_POSTGRES_PORT}" \
    "${SUBSTRATE_DB_NAME}"
}

afscp_resolve_local_runtime_postgres_dsn() {
  local substrate_host_dsn
  substrate_host_dsn="$(afscp_substrate_postgres_host_dsn)"
  # The substrate connection env may provide the host-side Postgres DSN without
  # sslmode; AFSCP local-real clients need explicit non-SSL unless overridden.
  if [[ -n "${DATABASE_URL:-}" && "${DATABASE_URL}" != "${substrate_host_dsn}" ]]; then
    printf '%s' "${DATABASE_URL}"
    return 0
  fi
  afscp_default_local_runtime_postgres_dsn
}

afscp_resolve_webdav_export_public_base_url() {
  local base prefix trim_prefix
  base="${1%/}"
  prefix="${2:-/e/}"
  trim_prefix="${prefix#/}"
  trim_prefix="${trim_prefix%/}"
  if [[ -n "${trim_prefix}" && "${base}" == */"${trim_prefix}" ]]; then
    printf '%s' "${base%/${trim_prefix}}"
    return 0
  fi
  printf '%s' "${base}"
}

prepare_afscp_local_runtime_env() {
  ensure_internal_common_runtime_env
  mkdir -p "${AFSCP_VOLUME_ROOT}" "${AFSCP_JVS_CWD}"

  local afscp_local_postgres_dsn
  afscp_local_postgres_dsn="$(afscp_resolve_local_runtime_postgres_dsn)"
  AFSCP_ENVIRONMENT="${AFSCP_ENVIRONMENT:-local-real}"
  AFSCP_SERVICE_NAME="${AFSCP_SERVICE_NAME:-afscp-local-real}"
  AFSCP_LISTEN_ADDR="${AFSCP_LISTEN_ADDR:-${AFSCP_API_LISTEN_ADDR}}"
  AFSCP_READINESS_PROFILE="${AFSCP_READINESS_PROFILE:-runtime}"
  AFSCP_DATABASE_URL="${AFSCP_DATABASE_URL:-${afscp_local_postgres_dsn}}"
  AFSCP_POSTGRES_DSN="${AFSCP_POSTGRES_DSN:-${AFSCP_DATABASE_URL}}"
  AFSCP_API_MODE="${AFSCP_API_MODE:-internal}"
  AFSCP_API_POSTGRES_DSN="${AFSCP_API_POSTGRES_DSN:-${AFSCP_POSTGRES_DSN}}"
  AFSCP_API_SERVICE_TOKENS="${AFSCP_API_SERVICE_TOKENS:-${AFSCP_CALLER_SERVICE}=${AFSCP_SERVICE_TOKEN},${AFSCP_BOOTSTRAP_CALLER_SERVICE}=${AFSCP_BOOTSTRAP_SERVICE_TOKEN},${AFSCP_ORCHESTRATOR_CALLER_SERVICE}=${AFSCP_ORCHESTRATOR_SERVICE_TOKEN}}"
  AFSCP_API_DEPLOYMENT_GLOBAL_ALLOWED_CALLERS="${AFSCP_API_DEPLOYMENT_GLOBAL_ALLOWED_CALLERS:-${AFSCP_CALLER_SERVICE}:product:operation_inspector,${AFSCP_BOOTSTRAP_CALLER_SERVICE}:admin:volume_admin|operation_inspector|operator_admin}"
  AFSCP_API_DEPLOYMENT_NAMESPACE_ALLOWED_CALLERS="${AFSCP_API_DEPLOYMENT_NAMESPACE_ALLOWED_CALLERS:-${AFSCP_BOOTSTRAP_CALLER_SERVICE}:admin:namespace_admin,${AFSCP_CALLER_SERVICE}:product:namespace_admin|repo_admin|repo_lifecycle_admin|restore_admin|template_admin|export_admin|mount_admin|operation_inspector,${AFSCP_ORCHESTRATOR_CALLER_SERVICE}:orchestrator:orchestrator_mount}"
  AFSCP_VOLUME_ROOTS="${AFSCP_VOLUME_ROOTS:-${AFSCP_DEFAULT_VOLUME_ID}=${AFSCP_VOLUME_ROOT}}"
  AFSCP_API_VOLUME_ROOTS="${AFSCP_API_VOLUME_ROOTS:-${AFSCP_VOLUME_ROOTS}}"
  AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS="${AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS:-${AFSCP_DEFAULT_VOLUME_ID}=${K8S_NAMESPACE}/${AFSCP_LOCAL_RUNTIME_WORKLOAD_MOUNT_SECRET_NAME}}"
  AFSCP_EXPORT_GATEWAY_PREFIX="${AFSCP_EXPORT_GATEWAY_PREFIX:-/e/}"
  AFSCP_API_WEBDAV_EXPORT_PUBLIC_BASE_URL="${AFSCP_API_WEBDAV_EXPORT_PUBLIC_BASE_URL:-$(afscp_resolve_webdav_export_public_base_url "${AFSCP_EXPORT_GATEWAY_BASE_URL}" "${AFSCP_EXPORT_GATEWAY_PREFIX}")}"

  AFSCP_STORAGE_ENABLED="${AFSCP_STORAGE_ENABLED:-true}"
  AFSCP_STORAGE_READY="${AFSCP_STORAGE_READY:-true}"
  AFSCP_JVS_ENABLED="${AFSCP_JVS_ENABLED:-true}"
  AFSCP_JVS_READY="${AFSCP_JVS_READY:-true}"
  resolve_afscp_jvs_binary
  AFSCP_WEBDAV_ENABLED="${AFSCP_WEBDAV_ENABLED:-true}"
  AFSCP_WEBDAV_READY="${AFSCP_WEBDAV_READY:-true}"
  AFSCP_MOUNT_ENABLED="${AFSCP_MOUNT_ENABLED:-true}"
  AFSCP_MOUNT_READY="${AFSCP_MOUNT_READY:-true}"
  AFSCP_REPO_TEMPLATE_ENABLED="${AFSCP_REPO_TEMPLATE_ENABLED:-false}"
  AFSCP_REPO_TEMPLATE_READY="${AFSCP_REPO_TEMPLATE_READY:-false}"
  AFSCP_REPO_PURGE_ENABLED="${AFSCP_REPO_PURGE_ENABLED:-false}"
  AFSCP_REPO_PURGE_READY="${AFSCP_REPO_PURGE_READY:-false}"

  AFSCP_WORKER_OPERATION_RECOVERY_ENABLED="${AFSCP_WORKER_OPERATION_RECOVERY_ENABLED:-true}"
  AFSCP_WORKER_OWNER="${AFSCP_WORKER_OWNER:-agentsmith-local-real-afscp-worker}"
  AFSCP_OPERATION_RECOVERY_LIMIT="${AFSCP_OPERATION_RECOVERY_LIMIT:-10}"
  AFSCP_EXPORT_SESSION_RECONCILE_ENABLED="${AFSCP_EXPORT_SESSION_RECONCILE_ENABLED:-true}"
  AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN="${AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN:-${AFSCP_POSTGRES_DSN}}"
  AFSCP_EXPORT_SESSION_RECONCILE_OWNER="${AFSCP_EXPORT_SESSION_RECONCILE_OWNER:-${AFSCP_WORKER_OWNER}}"
  AFSCP_EXPORT_SESSION_RECONCILE_LIMIT="${AFSCP_EXPORT_SESSION_RECONCILE_LIMIT:-${AFSCP_OPERATION_RECOVERY_LIMIT}}"
  AFSCP_WORKER_RUN_ONCE_TIMEOUT="${AFSCP_WORKER_RUN_ONCE_TIMEOUT:-30s}"
  AFSCP_REPO_CREATE_RECOVERY_ENABLED="${AFSCP_REPO_CREATE_RECOVERY_ENABLED:-true}"
  AFSCP_REPO_LIFECYCLE_RECOVERY_ENABLED="${AFSCP_REPO_LIFECYCLE_RECOVERY_ENABLED:-true}"
  AFSCP_REPO_PURGE_RECOVERY_ENABLED="${AFSCP_REPO_PURGE_RECOVERY_ENABLED:-false}"
  AFSCP_SAVE_POINT_RECOVERY_ENABLED="${AFSCP_SAVE_POINT_RECOVERY_ENABLED:-true}"
  AFSCP_TEMPLATE_CREATE_RECOVERY_ENABLED="${AFSCP_TEMPLATE_CREATE_RECOVERY_ENABLED:-false}"
  AFSCP_TEMPLATE_CLONE_RECOVERY_ENABLED="${AFSCP_TEMPLATE_CLONE_RECOVERY_ENABLED:-false}"
  AFSCP_RESTORE_PREVIEW_RECOVERY_ENABLED="${AFSCP_RESTORE_PREVIEW_RECOVERY_ENABLED:-false}"
  AFSCP_RESTORE_PREVIEW_DISCARD_RECOVERY_ENABLED="${AFSCP_RESTORE_PREVIEW_DISCARD_RECOVERY_ENABLED:-false}"
  AFSCP_RESTORE_RUN_RECOVERY_ENABLED="${AFSCP_RESTORE_RUN_RECOVERY_ENABLED:-false}"

  AFSCP_EXPORT_GATEWAY_POSTGRES_DSN="${AFSCP_EXPORT_GATEWAY_POSTGRES_DSN:-${AFSCP_POSTGRES_DSN}}"
  AFSCP_EXPORT_GATEWAY_VOLUME_ROOTS="${AFSCP_EXPORT_GATEWAY_VOLUME_ROOTS:-${AFSCP_VOLUME_ROOTS}}"
  afscp_validate_local_runtime_volume_root_maps || return 1
}

write_afscp_local_runtime_env() {
  prepare_afscp_local_runtime_env
  {
    printf '# Generated by AgentSmith local-real; AFSCP/JVS is a local development/test dependency, not the business deployment path.\n'
    local key
    for key in \
      AFSCP_ENVIRONMENT \
      AFSCP_SERVICE_NAME \
      AFSCP_LISTEN_ADDR \
      AFSCP_READINESS_PROFILE \
      AFSCP_DATABASE_URL \
      AFSCP_POSTGRES_DSN \
      AFSCP_API_MODE \
      AFSCP_API_POSTGRES_DSN \
      AFSCP_API_SERVICE_TOKENS \
      AFSCP_API_DEPLOYMENT_GLOBAL_ALLOWED_CALLERS \
      AFSCP_API_DEPLOYMENT_NAMESPACE_ALLOWED_CALLERS \
      AFSCP_API_VOLUME_ROOTS \
      AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS \
      AFSCP_API_WEBDAV_EXPORT_PUBLIC_BASE_URL \
      AFSCP_STORAGE_ENABLED \
      AFSCP_STORAGE_READY \
      AFSCP_JVS_ENABLED \
      AFSCP_JVS_READY \
      AFSCP_WEBDAV_ENABLED \
      AFSCP_WEBDAV_READY \
      AFSCP_MOUNT_ENABLED \
      AFSCP_MOUNT_READY \
      AFSCP_REPO_TEMPLATE_ENABLED \
      AFSCP_REPO_TEMPLATE_READY \
      AFSCP_REPO_PURGE_ENABLED \
      AFSCP_REPO_PURGE_READY \
      AFSCP_WORKER_OPERATION_RECOVERY_ENABLED \
      AFSCP_WORKER_OWNER \
      AFSCP_OPERATION_RECOVERY_LIMIT \
      AFSCP_EXPORT_SESSION_RECONCILE_ENABLED \
      AFSCP_EXPORT_SESSION_RECONCILE_POSTGRES_DSN \
      AFSCP_EXPORT_SESSION_RECONCILE_OWNER \
      AFSCP_EXPORT_SESSION_RECONCILE_LIMIT \
      AFSCP_WORKER_RUN_ONCE_TIMEOUT \
      AFSCP_REPO_CREATE_RECOVERY_ENABLED \
      AFSCP_REPO_LIFECYCLE_RECOVERY_ENABLED \
      AFSCP_REPO_PURGE_RECOVERY_ENABLED \
      AFSCP_SAVE_POINT_RECOVERY_ENABLED \
      AFSCP_TEMPLATE_CREATE_RECOVERY_ENABLED \
      AFSCP_TEMPLATE_CLONE_RECOVERY_ENABLED \
      AFSCP_RESTORE_PREVIEW_RECOVERY_ENABLED \
      AFSCP_RESTORE_PREVIEW_DISCARD_RECOVERY_ENABLED \
      AFSCP_RESTORE_RUN_RECOVERY_ENABLED \
      AFSCP_JVS_BINARY_PATH \
      AFSCP_JVS_BINARY_SHA256 \
      AFSCP_JVS_CWD \
      AFSCP_VOLUME_ROOTS \
      AFSCP_EXPORT_GATEWAY_LISTEN_ADDR \
      AFSCP_EXPORT_GATEWAY_POSTGRES_DSN \
      AFSCP_EXPORT_GATEWAY_PREFIX \
      AFSCP_EXPORT_GATEWAY_VOLUME_ROOTS; do
      afscp_runtime_export_line "${key}"
    done
  } > "${AFSCP_LOCAL_RUNTIME_ENV_FILE}"
  chmod 0600 "${AFSCP_LOCAL_RUNTIME_ENV_FILE}"
}

ensure_afscp_local_runtime_mounts_and_write_env() {
  ensure_afscp_local_runtime_volume_root
  ensure_afscp_local_runtime_workload_mount_secret_refs
  write_afscp_local_runtime_env
}

afscp_trim() {
  printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

afscp_canonical_path() {
  realpath -m "$1"
}

afscp_normalize_local_runtime_volume_root_map() {
  local var_name="$1"
  local raw_value="$2"
  local canonical_root="$3"
  local configured=0
  local normalized=""
  local -a entries
  local IFS=','
  read -r -a entries <<< "${raw_value}"

  local entry
  for entry in "${entries[@]}"; do
    local pair volume_id volume_path resolved_path
    pair="$(afscp_trim "${entry}")"
    [[ -n "${pair}" ]] || continue
    if [[ "${pair}" != *=* ]]; then
      internal_err "${var_name} must use volume_id=path pairs; local-real fails closed"
      return 1
    fi
    volume_id="$(afscp_trim "${pair%%=*}")"
    volume_path="$(afscp_trim "${pair#*=}")"
    if [[ -z "${volume_id}" || -z "${volume_path}" ]]; then
      internal_err "${var_name} must use non-empty volume_id=path pairs; local-real fails closed"
      return 1
    fi

    if [[ "${volume_id}" == "${AFSCP_DEFAULT_VOLUME_ID}" ]]; then
      configured=$((configured + 1))
      if (( configured > 1 )); then
        internal_err "${var_name} must contain default volume ${AFSCP_DEFAULT_VOLUME_ID} only once; local-real fails closed"
        return 1
      fi
      resolved_path="$(afscp_canonical_path "${volume_path}")"
      if [[ "${resolved_path}" != "${canonical_root}" ]]; then
        internal_err "${var_name} default volume ${AFSCP_DEFAULT_VOLUME_ID} resolves to ${resolved_path}, expected AFSCP_VOLUME_ROOT ${canonical_root}; local-real fails closed"
        return 1
      fi
      volume_path="${canonical_root}"
    fi

    normalized+="${normalized:+,}${volume_id}=${volume_path}"
  done

  if (( configured != 1 )); then
    internal_err "${var_name} must include default volume ${AFSCP_DEFAULT_VOLUME_ID}; local-real fails closed"
    return 1
  fi
  printf '%s' "${normalized}"
}

afscp_validate_local_runtime_volume_root_maps() {
  local canonical_root
  canonical_root="$(afscp_canonical_path "${AFSCP_VOLUME_ROOT}")"
  AFSCP_VOLUME_ROOT="${canonical_root}"

  local var_name raw_value normalized
  for var_name in AFSCP_VOLUME_ROOTS AFSCP_API_VOLUME_ROOTS AFSCP_EXPORT_GATEWAY_VOLUME_ROOTS; do
    raw_value="${!var_name:-}"
    if [[ -z "$(afscp_trim "${raw_value}")" ]]; then
      internal_err "${var_name} is required for local-real AFSCP volume roots; local-real fails closed"
      return 1
    fi
    normalized="$(afscp_normalize_local_runtime_volume_root_map "${var_name}" "${raw_value}" "${canonical_root}")" || return 1
    printf -v "${var_name}" '%s' "${normalized}"
  done
}

afscp_default_local_runtime_juicefs_metaurl() {
  printf 'postgres://%s:%s@%s:5432/%s?sslmode=disable' \
    "${SUBSTRATE_DB_USER}" \
    "${SUBSTRATE_DB_PASSWORD}" \
    "$(k8s_external_postgres_fqdn "${K8S_NAMESPACE}")" \
    "${SUBSTRATE_DB_NAME}"
}

afscp_default_local_runtime_juicefs_bucket() {
  printf 'http://%s:9000/%s' \
    "$(k8s_external_minio_fqdn "${K8S_NAMESPACE}")" \
    "${MINIO_BUCKET}"
}

afscp_default_local_runtime_host_juicefs_metaurl() {
  printf 'postgres://%s:%s@localhost:%s/%s?sslmode=disable' \
    "${SUBSTRATE_DB_USER}" \
    "${SUBSTRATE_DB_PASSWORD}" \
    "${SUBSTRATE_POSTGRES_PORT}" \
    "${SUBSTRATE_DB_NAME}"
}

afscp_default_local_runtime_host_juicefs_bucket() {
  printf 'http://localhost:%s/%s' \
    "${SUBSTRATE_MINIO_API_PORT}" \
    "${MINIO_BUCKET:-${SUBSTRATE_MINIO_BUCKET:-mbos-dev}}"
}

afscp_default_local_runtime_juicefs_name() {
  local raw sanitized
  raw="${AFSCP_DEFAULT_VOLUME_ID:-vol_local_manual}"
  sanitized="$(
    printf '%s' "${raw}" \
      | tr '[:upper:]_' '[:lower:]-' \
      | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
  )"
  if [[ "${#sanitized}" -lt 3 ]]; then
    sanitized="agentsmith-${sanitized}"
  fi
  printf '%s\n' "${sanitized:0:63}" | sed -E 's/-+$//'
}

afscp_local_runtime_juicefs_name() {
  printf '%s' "${AFSCP_LOCAL_RUNTIME_JUICEFS_NAME:-$(afscp_default_local_runtime_juicefs_name)}"
}

afscp_local_runtime_juicefs_storage() {
  printf '%s' "${AFSCP_LOCAL_RUNTIME_JUICEFS_STORAGE:-minio}"
}

afscp_local_runtime_host_juicefs_metaurl() {
  printf '%s' "${AFSCP_LOCAL_RUNTIME_HOST_JUICEFS_METAURL:-$(afscp_default_local_runtime_host_juicefs_metaurl)}"
}

afscp_local_runtime_host_juicefs_bucket() {
  printf '%s' "${AFSCP_LOCAL_RUNTIME_HOST_JUICEFS_BUCKET:-$(afscp_default_local_runtime_host_juicefs_bucket)}"
}

afscp_local_runtime_workload_juicefs_metaurl() {
  printf '%s' "${AFSCP_LOCAL_RUNTIME_JUICEFS_METAURL:-$(afscp_default_local_runtime_juicefs_metaurl)}"
}

afscp_local_runtime_workload_juicefs_bucket() {
  printf '%s' "${AFSCP_LOCAL_RUNTIME_JUICEFS_BUCKET:-$(afscp_default_local_runtime_juicefs_bucket)}"
}

afscp_mountpoint_state() {
  local path="$1"
  local status
  if command -v mountpoint >/dev/null 2>&1; then
    mountpoint -q "${path}"
    status=$?
    if [[ "${status}" == "0" ]]; then
      printf 'mounted'
      return 0
    fi
    if [[ "${status}" == "1" || "${status}" == "32" ]]; then
      printf 'absent'
      return 0
    fi
    internal_err "unable to determine AFSCP_VOLUME_ROOT mountpoint state for ${path} with mountpoint status ${status}; local-real fails closed"
    printf 'unknown'
    return 2
  fi
  if command -v findmnt >/dev/null 2>&1; then
    findmnt -M "${path}" >/dev/null 2>&1
    status=$?
    if [[ "${status}" == "0" ]]; then
      printf 'mounted'
      return 0
    fi
    if [[ "${status}" == "1" ]]; then
      printf 'absent'
      return 0
    fi
    internal_err "unable to determine AFSCP_VOLUME_ROOT mountpoint state for ${path} with findmnt status ${status}; local-real fails closed"
    printf 'unknown'
    return 2
  fi
  internal_err "mountpoint or findmnt is required to validate AFSCP_VOLUME_ROOT; local-real fails closed"
  printf 'unknown'
  return 2
}

afscp_is_mountpoint() {
  local state
  state="$(afscp_mountpoint_state "$1" 2>/dev/null)" || return 1
  [[ "${state}" == "mounted" ]]
}

afscp_validate_juicefs_mount_type() {
  local path="$1"
  local fs_type
  if ! command -v findmnt >/dev/null 2>&1; then
    internal_err "findmnt is required to validate AFSCP_VOLUME_ROOT as JuiceFS; local-real fails closed"
    return 1
  fi
  fs_type="$(findmnt -no FSTYPE -T "${path}" 2>/dev/null | head -n1 || true)"
  if [[ "${fs_type}" != "fuse.juicefs" && "${fs_type}" != "juicefs" ]]; then
    internal_err "AFSCP_VOLUME_ROOT is mounted as ${fs_type:-unknown}, expected JuiceFS; local-real fails closed"
    return 1
  fi
}

afscp_validate_volume_root_rw() {
  local path="$1"
  local probe
  if [[ ! -d "${path}" || ! -r "${path}" || ! -w "${path}" ]]; then
    internal_err "AFSCP_VOLUME_ROOT is not readable and writable: ${path}; local-real fails closed"
    return 1
  fi
  probe="$(mktemp "${path}/.agentsmith-afscp-volume-root-check.XXXXXX")" || {
    internal_err "AFSCP_VOLUME_ROOT write probe failed at ${path}; local-real fails closed"
    return 1
  }
  printf 'agentsmith-afscp-volume-root-check\n' > "${probe}" || {
    rm -f "${probe}"
    internal_err "AFSCP_VOLUME_ROOT write probe failed at ${path}; local-real fails closed"
    return 1
  }
  if [[ "$(cat "${probe}" 2>/dev/null || true)" != "agentsmith-afscp-volume-root-check" ]]; then
    rm -f "${probe}"
    internal_err "AFSCP_VOLUME_ROOT read probe failed at ${path}; local-real fails closed"
    return 1
  fi
  rm -f "${probe}"
}

afscp_validate_local_runtime_volume_root_mount() {
  local path="$1"
  local mount_state
  mount_state="$(afscp_mountpoint_state "${path}")" || return 1
  if [[ "${mount_state}" != "mounted" ]]; then
    internal_err "AFSCP_VOLUME_ROOT is not mounted: ${path}; local-real fails closed"
    return 1
  fi
  afscp_validate_juicefs_mount_type "${path}" || return 1
  afscp_validate_volume_root_rw "${path}" || return 1
}

ensure_afscp_local_runtime_volume_root() {
  prepare_afscp_local_runtime_env
  mkdir -p "${AFSCP_VOLUME_ROOT}" "$(dirname "${AFSCP_VOLUME_ROOT_MOUNT_MARKER}")" "${AFSCP_LOCAL_RUNTIME_JUICEFS_CACHE_DIR}"

  local mount_state
  mount_state="$(afscp_mountpoint_state "${AFSCP_VOLUME_ROOT}")" || return 1
  if [[ "${mount_state}" == "mounted" ]]; then
    afscp_validate_local_runtime_volume_root_mount "${AFSCP_VOLUME_ROOT}" || return 1
    return 0
  fi

  if ! command -v juicefs >/dev/null 2>&1; then
    internal_err "juicefs is required to mount AFSCP_VOLUME_ROOT; local-real fails closed"
    return 1
  fi

  local metaurl bucket storage juicefs_name access_key secret_key
  metaurl="$(afscp_local_runtime_host_juicefs_metaurl)"
  bucket="$(afscp_local_runtime_host_juicefs_bucket)"
  storage="$(afscp_local_runtime_juicefs_storage)"
  juicefs_name="$(afscp_local_runtime_juicefs_name)"
  access_key="${MINIO_ACCESS_KEY:-${SUBSTRATE_MINIO_ACCESS_KEY:-mbos}}"
  secret_key="${MINIO_SECRET_KEY:-${SUBSTRATE_MINIO_SECRET_KEY:-mbos_dev_password}}"

  internal_info "mounting AFSCP local-real volume root with JuiceFS at ${AFSCP_VOLUME_ROOT}"
  if ! ACCESS_KEY="${access_key}" SECRET_KEY="${secret_key}" \
    juicefs format --no-update --storage "${storage}" --bucket "${bucket}" "${metaurl}" "${juicefs_name}" >/dev/null; then
    internal_err "failed to format or validate AFSCP local-real JuiceFS volume; local-real fails closed"
    return 1
  fi
  if ! printf '%s\n' "${AFSCP_VOLUME_ROOT}" > "${AFSCP_VOLUME_ROOT_MOUNT_MARKER}"; then
    internal_err "failed to record AFSCP local-real mount marker; local-real fails closed"
    return 1
  fi
  if ! ACCESS_KEY="${access_key}" SECRET_KEY="${secret_key}" \
    juicefs mount -d --no-usage-report --check-storage --storage "${storage}" --bucket "${bucket}" --cache-dir "${AFSCP_LOCAL_RUNTIME_JUICEFS_CACHE_DIR}" --log "${AFSCP_LOCAL_RUNTIME_JUICEFS_MOUNT_LOG}" "${metaurl}" "${AFSCP_VOLUME_ROOT}" >/dev/null; then
    internal_err "failed to mount AFSCP_VOLUME_ROOT with JuiceFS; local-real fails closed"
    unmount_afscp_local_runtime_volume_root || return 1
    return 1
  fi

  local waited
  for waited in $(seq 1 30); do
    mount_state="$(afscp_mountpoint_state "${AFSCP_VOLUME_ROOT}")" || {
      unmount_afscp_local_runtime_volume_root || return 1
      return 1
    }
    if [[ "${mount_state}" == "mounted" ]]; then
      if afscp_validate_local_runtime_volume_root_mount "${AFSCP_VOLUME_ROOT}"; then
        return 0
      else
        local validation_status=$?
        unmount_afscp_local_runtime_volume_root || return 1
        return "${validation_status}"
      fi
    fi
    sleep 1
  done

  internal_err "timed out waiting for AFSCP_VOLUME_ROOT JuiceFS mount; local-real fails closed"
  unmount_afscp_local_runtime_volume_root || return 1
  return 1
}

unmount_afscp_local_runtime_volume_root() {
  if [[ ! -f "${AFSCP_VOLUME_ROOT_MOUNT_MARKER}" ]]; then
    return 0
  fi

  local mount_path canonical_root canonical_mount_path
  mount_path="$(head -n1 "${AFSCP_VOLUME_ROOT_MOUNT_MARKER}" 2>/dev/null || true)"
  mount_path="$(afscp_trim "${mount_path}")"
  [[ -n "${mount_path}" ]] || {
    rm -f "${AFSCP_VOLUME_ROOT_MOUNT_MARKER}"
    return 0
  }

  canonical_root="$(afscp_canonical_path "${AFSCP_VOLUME_ROOT}")"
  canonical_mount_path="$(afscp_canonical_path "${mount_path}")"
  if [[ "${canonical_mount_path}" != "${canonical_root}" ]]; then
    internal_err "AFSCP local-real mount marker path ${canonical_mount_path} does not match AFSCP_VOLUME_ROOT ${canonical_root}; local-real fails closed"
    return 1
  fi
  mount_path="${canonical_mount_path}"
  [[ -n "${mount_path}" && -d "${mount_path}" ]] || {
    rm -f "${AFSCP_VOLUME_ROOT_MOUNT_MARKER}"
    return 0
  }
  local mount_state
  mount_state="$(afscp_mountpoint_state "${mount_path}")" || return 1
  if [[ "${mount_state}" == "mounted" ]]; then
    internal_info "unmounting AFSCP local-real JuiceFS volume root ${mount_path}"
    if command -v juicefs >/dev/null 2>&1; then
      juicefs umount "${mount_path}" >/dev/null 2>&1 || umount "${mount_path}" >/dev/null 2>&1 || true
    else
      umount "${mount_path}" >/dev/null 2>&1 || true
    fi
    mount_state="$(afscp_mountpoint_state "${mount_path}")" || return 1
    if [[ "${mount_state}" == "mounted" ]]; then
      internal_err "failed to unmount AFSCP local-real JuiceFS volume root ${mount_path}; local-real fails closed"
      return 1
    fi
  fi
  rm -f "${AFSCP_VOLUME_ROOT_MOUNT_MARKER}"
}

afscp_create_local_workload_mount_secret() {
  local secret_namespace="$1"
  local secret_name="$2"
  local metaurl bucket juicefs_name
  metaurl="$(afscp_local_runtime_workload_juicefs_metaurl)"
  bucket="$(afscp_local_runtime_workload_juicefs_bucket)"
  juicefs_name="$(afscp_local_runtime_juicefs_name)"

  local secret_args=(
    create secret generic "${secret_name}"
    -n "${secret_namespace}"
    --dry-run=client
    -o yaml
    "--from-literal=name=${juicefs_name}"
    "--from-literal=metaurl=${metaurl}"
    "--from-literal=storage=$(afscp_local_runtime_juicefs_storage)"
    "--from-literal=bucket=${bucket}"
    "--from-literal=access-key=${MINIO_ACCESS_KEY}"
    "--from-literal=secret-key=${MINIO_SECRET_KEY}"
  )
  if [[ -n "${AFSCP_LOCAL_RUNTIME_JUICEFS_FORMAT_OPTIONS:-}" ]]; then
    secret_args+=("--from-literal=format-options=${AFSCP_LOCAL_RUNTIME_JUICEFS_FORMAT_OPTIONS}")
  fi

  kubectl "${secret_args[@]}" | kubectl apply -f - >/dev/null
  kubectl label secret "${secret_name}" -n "${secret_namespace}" app.kubernetes.io/managed-by=agentsmith --overwrite >/dev/null 2>&1 || true
}

afscp_validate_workload_mount_secret_ref() {
  local secret_namespace="$1"
  local secret_name="$2"
  local secret_json validation_result expected_name expected_storage expected_host_metaurl expected_host_bucket expected_workload_metaurl expected_workload_bucket
  if ! secret_json="$(kubectl get secret "${secret_name}" -n "${secret_namespace}" -o json 2>/dev/null)"; then
    internal_err "AFSCP workload mount SecretRef is not present; local-real fails closed"
    return 1
  fi
  expected_name="$(afscp_local_runtime_juicefs_name)"
  expected_storage="$(afscp_local_runtime_juicefs_storage)"
  expected_host_metaurl="$(afscp_local_runtime_host_juicefs_metaurl)"
  expected_host_bucket="$(afscp_local_runtime_host_juicefs_bucket)"
  expected_workload_metaurl="$(afscp_local_runtime_workload_juicefs_metaurl)"
  expected_workload_bucket="$(afscp_local_runtime_workload_juicefs_bucket)"
  validation_result="$(
    AFSCP_WORKLOAD_MOUNT_SECRET_JSON="${secret_json}" \
    AFSCP_EXPECTED_JUICEFS_NAME="${expected_name}" \
    AFSCP_EXPECTED_JUICEFS_STORAGE="${expected_storage}" \
    AFSCP_EXPECTED_HOST_JUICEFS_METAURL="${expected_host_metaurl}" \
    AFSCP_EXPECTED_HOST_JUICEFS_BUCKET="${expected_host_bucket}" \
    AFSCP_EXPECTED_WORKLOAD_JUICEFS_METAURL="${expected_workload_metaurl}" \
    AFSCP_EXPECTED_WORKLOAD_JUICEFS_BUCKET="${expected_workload_bucket}" \
    node <<'NODE'
const required = ['name', 'metaurl', 'storage', 'bucket', 'access-key', 'secret-key'];
const valueKeys = ['name', 'metaurl', 'storage', 'bucket'];

function decodeSecretValue(data, key) {
  return Buffer.from(data[key], 'base64').toString('utf8');
}

function sortedSearchParams(url) {
  return Array.from(url.searchParams.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const byKey = leftKey.localeCompare(rightKey);
      return byKey === 0 ? leftValue.localeCompare(rightValue) : byKey;
    });
}

function metaIdentity(raw) {
  try {
    const url = new URL(raw);
    const protocol = url.protocol.toLowerCase();
    if (protocol === 'postgres:' || protocol === 'postgresql:') {
      return {
        protocol,
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\/+/, '').replace(/\/+$/u, ''),
        search: sortedSearchParams(url),
      };
    }
    return { protocol, raw };
  } catch {
    return { raw };
  }
}

function bucketIdentity(raw) {
  try {
    const url = new URL(raw);
    return {
      protocol: url.protocol.toLowerCase(),
      bucket: url.pathname.replace(/^\/+/, '').replace(/\/+$/u, ''),
    };
  } catch {
    return { raw };
  }
}

function sameIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addMismatch(mismatches, key) {
  if (!mismatches.includes(key)) {
    mismatches.push(key);
  }
}

try {
  const secret = JSON.parse(process.env.AFSCP_WORKLOAD_MOUNT_SECRET_JSON ?? '{}');
  const data = secret && typeof secret === 'object' && secret.data && typeof secret.data === 'object'
    ? secret.data
    : {};
  const missing = required.filter((key) => typeof data[key] !== 'string' || data[key].length === 0);
  if (missing.length > 0) {
    process.stdout.write(`missing:${missing.join(',')}`);
    process.exit(1);
  }
  const values = Object.fromEntries(valueKeys.map((key) => [key, decodeSecretValue(data, key)]));
  const mismatches = [];
  if (values.name !== process.env.AFSCP_EXPECTED_JUICEFS_NAME) {
    addMismatch(mismatches, 'name');
  }
  if (values.storage !== process.env.AFSCP_EXPECTED_JUICEFS_STORAGE) {
    addMismatch(mismatches, 'storage');
  }
  if (values.metaurl !== process.env.AFSCP_EXPECTED_WORKLOAD_JUICEFS_METAURL) {
    addMismatch(mismatches, 'metaurl');
  }
  if (values.bucket !== process.env.AFSCP_EXPECTED_WORKLOAD_JUICEFS_BUCKET) {
    addMismatch(mismatches, 'bucket');
  }
  if (!sameIdentity(metaIdentity(values.metaurl), metaIdentity(process.env.AFSCP_EXPECTED_HOST_JUICEFS_METAURL ?? ''))) {
    addMismatch(mismatches, 'metaurl');
  }
  if (!sameIdentity(bucketIdentity(values.bucket), bucketIdentity(process.env.AFSCP_EXPECTED_HOST_JUICEFS_BUCKET ?? ''))) {
    addMismatch(mismatches, 'bucket');
  }
  if (mismatches.length > 0) {
    process.stdout.write(`mismatch:${mismatches.join(',')}`);
    process.exit(1);
  }
} catch {
  process.stdout.write('invalid-json');
  process.exit(1);
}
NODE
  )" || {
    case "${validation_result}" in
      missing:*)
        internal_err "AFSCP workload mount SecretRef is missing required JuiceFS CSI keys (${validation_result#missing:}); local-real fails closed"
        ;;
      mismatch:*)
        internal_err "AFSCP workload mount SecretRef does not match AFSCP local-real JuiceFS identity (${validation_result#mismatch:}); local-real fails closed"
        ;;
      *)
        internal_err "AFSCP workload mount SecretRef is invalid (${validation_result:-unknown}); local-real fails closed"
        ;;
    esac
    return 1
  }
}

ensure_afscp_local_runtime_workload_mount_secret_refs() {
  prepare_afscp_local_runtime_env
  local raw_refs="${AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS:-}"
  if [[ -z "$(afscp_trim "${raw_refs}")" ]]; then
    internal_err "AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS is required for local-real workload mounts"
    return 1
  fi

  local ref_pair configured=0
  local -a ref_pairs
  IFS=',' read -r -a ref_pairs <<< "${raw_refs}"
  for ref_pair in "${ref_pairs[@]}"; do
    local pair volume_id secret_ref secret_namespace secret_name
    pair="$(afscp_trim "${ref_pair}")"
    [[ -n "${pair}" ]] || continue
    if [[ "${pair}" != *=* ]]; then
      internal_err "AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS must use volume_id=namespace/name pairs"
      return 1
    fi
    volume_id="$(afscp_trim "${pair%%=*}")"
    secret_ref="$(afscp_trim "${pair#*=}")"
    secret_namespace="$(afscp_trim "${secret_ref%%/*}")"
    secret_name="$(afscp_trim "${secret_ref#*/}")"
    if [[ -z "${volume_id}" || "${secret_ref}" != */* || -z "${secret_namespace}" || -z "${secret_name}" || "${secret_name}" == */* ]]; then
      internal_err "AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS must use volume_id=namespace/name pairs"
      return 1
    fi

    configured=1
    if [[ "${secret_namespace}" == "${K8S_NAMESPACE}" && "${secret_name}" == "${AFSCP_LOCAL_RUNTIME_WORKLOAD_MOUNT_SECRET_NAME}" ]]; then
      internal_info "reconciling local AFSCP workload mount SecretRef for ${volume_id}"
      afscp_create_local_workload_mount_secret "${secret_namespace}" "${secret_name}"
    else
      internal_info "validating configured AFSCP workload mount SecretRef for ${volume_id}"
    fi
    afscp_validate_workload_mount_secret_ref "${secret_namespace}" "${secret_name}" || return 1
  done

  if [[ "${configured}" != "1" ]]; then
    internal_err "AFSCP_API_WORKLOAD_MOUNT_SECRET_REFS did not contain any usable SecretRef"
    return 1
  fi
}

ensure_afscp_local_runtime_prerequisites() {
  if [[ ! -f "${AFSCP_ROOT}/cmd/afscp-api/main.go" ]]; then
    internal_err "missing AFSCP sibling repo at ${AFSCP_ROOT}; set AFSCP_ROOT to a checkout with cmd/afscp-api"
    exit 1
  fi
  if [[ ! -f "${AFSCP_ROOT}/cmd/afscp-worker/main.go" ]]; then
    internal_err "AFSCP checkout at ${AFSCP_ROOT} has no cmd/afscp-worker entrypoint"
    exit 1
  fi
  if [[ ! -f "${AFSCP_ROOT}/cmd/afscp-export-gateway/main.go" ]]; then
    internal_err "AFSCP checkout at ${AFSCP_ROOT} has no cmd/afscp-export-gateway entrypoint"
    exit 1
  fi
  if ! command -v go >/dev/null 2>&1; then
    internal_err "go is required to run the AFSCP local-real dependency"
    exit 1
  fi
  if [[ "${AFSCP_JVS_ENABLED}" == "true" ]]; then
    afscp_verify_jvs_binary_sha256 "${AFSCP_JVS_BINARY_PATH}" "${AFSCP_JVS_BINARY_SHA256}" "resolved AFSCP_JVS_BINARY_PATH" || exit 1
  fi
}

apply_afscp_postgres_migrations() {
  prepare_afscp_local_runtime_env
  local migration
  internal_info "applying AFSCP local-real PostgreSQL migrations"
  for migration in "${AFSCP_ROOT}"/migrations/*.sql; do
    [[ -f "${migration}" ]] || continue
    if command -v psql >/dev/null 2>&1; then
      PGPASSWORD="${SUBSTRATE_DB_PASSWORD}" psql "${AFSCP_POSTGRES_DSN}" -v ON_ERROR_STOP=1 -f "${migration}" >/dev/null
    else
      docker exec -i mbos-postgres psql -v ON_ERROR_STOP=1 -U "${SUBSTRATE_DB_USER}" -d "${SUBSTRATE_DB_NAME}" < "${migration}" >/dev/null
    fi
  done
}

afscp_runtime_shell_prefix() {
  printf 'cd %q && set -a && source %q && set +a' "${AFSCP_ROOT}" "${AFSCP_LOCAL_RUNTIME_ENV_FILE}"
}

afscp_stop_pid_file() {
  local pid_file="$1"
  local label="$2"
  local pid
  [[ -f "${pid_file}" ]] || return 0
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  rm -f "${pid_file}"
  [[ -n "${pid}" ]] || return 0
  if kill -0 "${pid}" >/dev/null 2>&1; then
    internal_info "stopping ${label} pid=${pid}"
    local_manual_stop_reclaimable_launcher_pid "${pid}"
  fi
}

afscp_wait_for_gateway_listener() {
  local timeout="${1:-90}"
  local started
  started="$(date +%s)"
  while true; do
    if lsof -tiTCP:"${AFSCP_EXPORT_GATEWAY_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      write_ready_file "${AFSCP_EXPORT_GATEWAY_READY_FILE}"
      return 0
    fi
    if (( "$(date +%s)" - started > timeout )); then
      internal_err "AFSCP export gateway listener not ready on port ${AFSCP_EXPORT_GATEWAY_PORT}"
      return 1
    fi
    sleep 1
  done
}

afscp_run_worker_once() {
  prepare_afscp_local_runtime_env
  ( cd "${AFSCP_ROOT}" && set -a && source "${AFSCP_LOCAL_RUNTIME_ENV_FILE}" && set +a && go run ./cmd/afscp-worker --run-once )
}

start_afscp_export_gateway() {
  ensure_afscp_local_runtime_mounts_and_write_env
  afscp_stop_pid_file "${AFSCP_EXPORT_GATEWAY_PID_FILE}" "AFSCP export gateway"
  rm -f "${AFSCP_EXPORT_GATEWAY_READY_FILE}"
  wait_port_free "${AFSCP_EXPORT_GATEWAY_PORT}" "AFSCP export gateway"
  internal_info "starting AFSCP export gateway at ${AFSCP_EXPORT_GATEWAY_LISTEN_ADDR}"
  launch_detached "${AFSCP_EXPORT_GATEWAY_PID_FILE}" "${AFSCP_EXPORT_GATEWAY_LOG}" "$(afscp_runtime_shell_prefix) && exec go run ./cmd/afscp-export-gateway --serve"
  afscp_wait_for_gateway_listener 120
  capture_listener_pid "${AFSCP_EXPORT_GATEWAY_PORT}" "${AFSCP_EXPORT_GATEWAY_PID_FILE}" "AFSCP export gateway"
}

start_afscp_api() {
  ensure_afscp_local_runtime_mounts_and_write_env
  afscp_stop_pid_file "${AFSCP_API_PID_FILE}" "AFSCP API"
  rm -f "${AFSCP_API_READY_FILE}"
  wait_port_free "${AFSCP_API_PORT}" "AFSCP API"
  internal_info "starting AFSCP internal API at ${AFSCP_BASE_URL}"
  launch_detached "${AFSCP_API_PID_FILE}" "${AFSCP_API_LOG}" "$(afscp_runtime_shell_prefix) && exec go run ./cmd/afscp-api --serve"
  wait_http "${AFSCP_BASE_URL%/}/readyz" "AFSCP API" 120
  capture_listener_pid "${AFSCP_API_PORT}" "${AFSCP_API_PID_FILE}" "AFSCP API"
  write_ready_file "${AFSCP_API_READY_FILE}"
}

start_afscp_worker_loop() {
  ensure_afscp_local_runtime_mounts_and_write_env
  afscp_stop_pid_file "${AFSCP_WORKER_PID_FILE}" "AFSCP worker"
  rm -f "${AFSCP_WORKER_READY_FILE}"
  internal_info "starting AFSCP worker loop"
  launch_detached "${AFSCP_WORKER_PID_FILE}" "${AFSCP_WORKER_LOG}" "$(afscp_runtime_shell_prefix) && while true; do go run ./cmd/afscp-worker --run-once; sleep ${AFSCP_WORKER_INTERVAL_SECONDS}; done"
  sleep 1
  if [[ -f "${AFSCP_WORKER_PID_FILE}" ]]; then
    local pid
    pid="$(cat "${AFSCP_WORKER_PID_FILE}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      write_ready_file "${AFSCP_WORKER_READY_FILE}"
      return 0
    fi
  fi
  internal_err "AFSCP worker loop failed to start; see ${AFSCP_WORKER_LOG}"
  exit 1
}

afscp_operation_state_from_file() {
  node - <<'NODE' "$1"
const fs = require('node:fs');
const file = process.argv[2];
try {
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  process.stdout.write(String(payload.operation_state ?? ''));
} catch {
  process.exit(1);
}
NODE
}

afscp_operation_id_from_file() {
  node - <<'NODE' "$1"
const fs = require('node:fs');
const file = process.argv[2];
try {
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = payload.operation_id;
  if (typeof id === 'string' && id.length > 0) {
    process.stdout.write(id);
    process.exit(0);
  }
} catch {}
process.exit(1);
NODE
}

afscp_get_operation_state() {
  local operation_id="$1"
  local response_file="${INTERNAL_REAL_DIR}/afscp-operation-${operation_id}.json"
  local status
  status="$(curl -sS -o "${response_file}" -w '%{http_code}' \
    -H "Authorization: Bearer ${AFSCP_BOOTSTRAP_SERVICE_TOKEN}" \
    -H "X-AFSCP-Caller-Service: ${AFSCP_BOOTSTRAP_CALLER_SERVICE}" \
    -H "X-Correlation-Id: agentsmith-local-afscp-operation" \
    "${AFSCP_BASE_URL%/}/internal/v1/operations/${operation_id}" || true)"
  if [[ "${status}" != "200" ]]; then
    printf 'unknown\n'
    return 0
  fi
  afscp_operation_state_from_file "${response_file}" || printf 'unknown\n'
}

afscp_wait_operation_succeeded() {
  local operation_id="$1"
  local state
  for _ in $(seq 1 60); do
    afscp_run_worker_once >> "${AFSCP_WORKER_LOG}" 2>&1 || true
    state="$(afscp_get_operation_state "${operation_id}")"
    case "${state}" in
      succeeded|success|completed|ready)
        return 0
        ;;
      failed|failure|error|errored|cancelled|canceled)
        internal_err "AFSCP operation ${operation_id} failed with state=${state}"
        return 1
        ;;
    esac
    sleep 1
  done
  internal_err "timed out waiting for AFSCP operation ${operation_id}"
  return 1
}

ensure_afscp_default_volume() {
  prepare_afscp_local_runtime_env
  local health_status response_file operation_id status
  response_file="${INTERNAL_REAL_DIR}/afscp-default-volume-bootstrap.json"
  health_status="$(curl -sS -o "${response_file}" -w '%{http_code}' \
    -H "Authorization: Bearer ${AFSCP_BOOTSTRAP_SERVICE_TOKEN}" \
    -H "X-AFSCP-Caller-Service: ${AFSCP_BOOTSTRAP_CALLER_SERVICE}" \
    -H "X-Correlation-Id: agentsmith-local-afscp-volume-health" \
    "${AFSCP_BASE_URL%/}/internal/v1/volumes/${AFSCP_DEFAULT_VOLUME_ID}/health" || true)"
  if [[ "${health_status}" == "200" ]]; then
    return 0
  fi

  internal_info "bootstrapping AFSCP default volume ${AFSCP_DEFAULT_VOLUME_ID}"
  status="$(curl -sS -o "${response_file}" -w '%{http_code}' \
    -X POST \
    -H "Authorization: Bearer ${AFSCP_BOOTSTRAP_SERVICE_TOKEN}" \
    -H "X-AFSCP-Caller-Service: ${AFSCP_BOOTSTRAP_CALLER_SERVICE}" \
    -H "X-Correlation-Id: agentsmith-local-afscp-volume-bootstrap" \
    -H "Idempotency-Key: agentsmith-local-afscp-volume-${AFSCP_DEFAULT_VOLUME_ID}" \
    -H "X-AFSCP-Actor-Type: system" \
    -H "X-AFSCP-Actor-Id: agentsmith-local-real" \
    -H "Content-Type: application/json" \
    --data-binary @- \
    "${AFSCP_BASE_URL%/}/internal/v1/volumes/${AFSCP_DEFAULT_VOLUME_ID}:ensure" <<JSON
{"volume_id":"${AFSCP_DEFAULT_VOLUME_ID}","backend":"juicefs","isolation_class":"shared","status":"active","capabilities":{"webdav_export":true,"workload_mount":true,"jvs_external_control_root":true,"directory_quota":false,"csi_driver":"${CSI_DRIVER}","storage_class":"${STORAGE_CLASS_NAME}","permission_model":"local-real"}}
JSON
  )"
  if [[ "${status}" != "200" ]]; then
    internal_err "failed to create AFSCP default volume operation: http ${status}"
    cat "${response_file}" >&2 || true
    exit 1
  fi
  operation_id="$(afscp_operation_id_from_file "${response_file}")"
  afscp_wait_operation_succeeded "${operation_id}"
}

ensure_afscp_local_runtime() {
  prepare_afscp_local_runtime_env
  ensure_afscp_local_runtime_prerequisites
  ensure_afscp_local_runtime_mounts_and_write_env
  apply_afscp_postgres_migrations
  internal_info "validating AFSCP worker config"
  afscp_run_worker_once >> "${AFSCP_WORKER_LOG}" 2>&1
  start_afscp_export_gateway
  start_afscp_api
  start_afscp_worker_loop
  ensure_afscp_default_volume
}

afscp_api_status() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "${AFSCP_BASE_URL%/}/readyz" 2>/dev/null || true)"
  case "${code}" in
    200) printf 'ready (%s)\n' "${AFSCP_BASE_URL}" ;;
    000|"") printf 'unreachable (%s)\n' "${AFSCP_BASE_URL}" ;;
    *) printf 'not_ready http=%s (%s)\n' "${code}" "${AFSCP_BASE_URL}" ;;
  esac
}

stop_afscp_local_runtime() {
  afscp_stop_pid_file "${AFSCP_WORKER_PID_FILE}" "AFSCP worker"
  afscp_stop_pid_file "${AFSCP_API_PID_FILE}" "AFSCP API"
  afscp_stop_pid_file "${AFSCP_EXPORT_GATEWAY_PID_FILE}" "AFSCP export gateway"
  local unmount_status=0
  unmount_afscp_local_runtime_volume_root || unmount_status=$?
  rm -f "${AFSCP_WORKER_READY_FILE}" "${AFSCP_API_READY_FILE}" "${AFSCP_EXPORT_GATEWAY_READY_FILE}"
  return "${unmount_status}"
}

write_internal_sandbox_config() {
  ensure_internal_common_runtime_env
  cat > "${INTERNAL_SANDBOX_MANAGER_CONFIG}" <<EOF
version: 1

server:
  httpPort: ${INTERNAL_SANDBOX_PORT}
  requestIdHeader: X-Request-Id
  timeouts:
    readHeader: 5s
    read: 30s
    write: 60s
    idle: 120s
  maxHeaderBytes: 1048576
  metrics:
    enabled: true
    path: /metrics
    requireServiceKey: false
  debug:
    configPath: /debug/config
    enablePprof: false

auth:
  enabled: true
  headerName: X-Service-Key
  acceptAuthorization: true
  authorizationScheme: ServiceKey
  failStatusCode: 401

kubernetes:
  qps: 50
  burst: 100
  requestTimeout: 15s
  retry:
    enabled: true
    maxAttempts: 3
    baseBackoff: 200ms
    maxBackoff: 2s

sandbox:
  defaults:
    namespace: ${K8S_NAMESPACE}
    runnerImage: ${RUNNER_IMAGE}
    imagePullPolicy: IfNotPresent
    ttlSeconds: 900
    podReadyWait: 30s
    podPollInterval: 500ms
    terminationGraceSeconds: 1
    activeDeadlineSeconds: 0
    containerName: runner
    workdir: /workspace
    volumes:
      workspace:
        name: workspace
        mountPath: /workspace
        sizeLimit: "0"
      tmp:
        name: tmp
        mountPath: /tmp
        sizeLimit: 256Mi
    resources:
      requests:
        cpu: 100m
        memory: 256Mi
      limits:
        cpu: "1"
        memory: 1Gi
        ephemeralStorage: 2Gi
    labels:
      app: llm-sandbox
    annotations: {}

exec:
  defaultTimeout: 30s
  maxTimeout: 300s
  stdoutMaxBytes: 1048576
  stderrMaxBytes: 1048576
  preserveTailBytes: 4096
  exitCodeMarker:
    key: "__SBX_EXIT_CODE__"
    stream: "stderr"
  shell:
    bin: sh
    args: ["-lc"]
  env:
    allowRegex: "^[A-Z_][A-Z0-9_]*$"
  workdir:
    allowedPrefixes: ["/workspace"]

files:
  rootPrefix: /workspace
  upload:
    defaultDest: /workspace
    maxBytes: 52428800
    format: tar.gz
  download:
    defaultSrc: /workspace
    format: tar.gz
  tar:
    bin: tar
    rejectSymlinks: true

buffer:
  capacity: 10000
EOF
}

write_internal_state_env() {
  ensure_internal_common_runtime_env
  cat > "${INTERNAL_SANDBOX_STATE_FILE}" <<EOF
ROOT_DIR="${ROOT_DIR}"
SANDBOX_ROOT="${SANDBOX_ROOT}"
INTERNAL_REAL_DIR="${INTERNAL_REAL_DIR}"
CONFIG_PATH="${INTERNAL_SANDBOX_MANAGER_CONFIG}"
SANDBOX_PORT="${INTERNAL_SANDBOX_PORT}"
SANDBOX_SERVICE_KEY_VALUE="${SANDBOX_SERVICE_KEY_VALUE}"
K8S_NAMESPACE="${K8S_NAMESPACE}"
SANDBOX_LOG="${INTERNAL_SANDBOX_MANAGER_LOG}"
AFSCP_STORAGE_CSI_DRIVER="${CSI_DRIVER}"
AFSCP_STORAGE_CAPACITY="${STORAGE_CAPACITY}"
AFSCP_STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME}"
AFSCP_STORAGE_CSI_MOUNT_OPTIONS="${MOUNT_OPTIONS}"
AFSCP_STORAGE_CSI_SUBDIR="${SUBDIR}"
AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT="${MOUNT_SERVICE_ACCOUNT}"
AFSCP_STORAGE_CSI_MOUNT_IMAGE="${MOUNT_IMAGE_OVERRIDE}"
AFSCP_BASE_URL="${AFSCP_BASE_URL:-http://127.0.0.1:28090}"
AFSCP_INTERNAL_BASE_URL="${AFSCP_BASE_URL:-http://127.0.0.1:28090}"
AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-manager}"
AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-agentsmith-local-afscp-orchestrator-token}"
AFSCP_ORCHESTRATOR_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-agentsmith-local-afscp-orchestrator-token}"
AFSCP_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-manager}"
AFSCP_ORCHESTRATOR_ACTOR_TYPE="${AFSCP_ORCHESTRATOR_ACTOR_TYPE:-system}"
AFSCP_ORCHESTRATOR_ACTOR_ID="${AFSCP_ORCHESTRATOR_ACTOR_ID:-${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-manager}}"
AFSCP_ACTOR_TYPE="${AFSCP_ORCHESTRATOR_ACTOR_TYPE:-system}"
AFSCP_ACTOR_ID="${AFSCP_ORCHESTRATOR_ACTOR_ID:-${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-manager}}"
AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT:-}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"
KUBECONFIG="${KUBECONFIG:-}"
EOF
}

stop_internal_sandbox_runtime() {
  if [[ -f "${INTERNAL_SANDBOX_STATE_FILE}" ]]; then
    INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true
  fi
  kubectl delete pod -n "${K8S_NAMESPACE}" -l app=managed-workload --ignore-not-found --wait=true >/dev/null 2>&1 || true
  kubectl delete pod -n "${K8S_NAMESPACE}" -l app=sandbox --ignore-not-found --wait=true >/dev/null 2>&1 || true
}

stop_internal_runtime() {
  stop_internal_sandbox_runtime
  stop_afscp_local_runtime
}

restore_local_manual_external_mode() {
  stop_internal_runtime
  rm -f "${INTERNAL_SANDBOX_STATE_FILE}"
  restart_api_with_mode 0
}

start_internal_runtime() {
  ensure_internal_common_runtime_env
  write_internal_sandbox_config
  write_internal_state_env
  stop_internal_sandbox_runtime
  INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" start-manager
}

restart_api_with_mode() {
  ensure_internal_common_runtime_env
  local internal_flag="$1"
  stop_pid_file_if_running "${API_PID_FILE}" "api"
  rm -f "${API_READY_FILE}" "${API_PORT_FILE}" "${API_PID_FILE}"
  if [[ "${internal_flag}" == "1" ]]; then
    local kind_gateway
    kind_gateway="$(resolve_kind_gateway_ip)"
    AGENT_EXECUTION_HTTP_BASE_URL="http://${kind_gateway}:${PORT_API}" \
      AGENT_EXECUTION_WS_BASE_URL="ws://${kind_gateway}:${PORT_API}" \
      LOCAL_MANUAL_ENABLE_INTERNAL="${internal_flag}" \
      bash "${ROOT_DIR}/scripts/local-manual/start-api.sh"
    return
  fi
  LOCAL_MANUAL_ENABLE_INTERNAL="${internal_flag}" bash "${ROOT_DIR}/scripts/local-manual/start-api.sh"
}

ensure_internal_runner_state() {
  ensure_internal_common_runtime_env
  if ! managed_agent_task_runner_state_is_present; then
    internal_info "agent-task diagnostic state missing after internal API restart; preparing managed agent-task diagnostic state"
    seed_managed_agent_task_diagnostics_state
    if ! managed_agent_task_runner_state_is_present; then
      internal_err "missing managed agent-task diagnostic state; run make local-manual-seed-agent-task first"
      exit 1
    fi
  fi
  ensure_local_manual_runner_connected
}
