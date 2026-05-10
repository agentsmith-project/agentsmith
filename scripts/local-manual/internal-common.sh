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
INTERNAL_SANDBOX_CLEANER_LOG="${INTERNAL_SANDBOX_CLEANER_LOG:-${INTERNAL_REAL_DIR}/sandbox-cleaner.log}"
INTERNAL_SANDBOX_MANAGER_CONFIG="${INTERNAL_SANDBOX_MANAGER_CONFIG:-${INTERNAL_REAL_DIR}/sandbox-manager.yaml}"
INTERNAL_SANDBOX_CLEANER_INTERVAL_SECONDS="${INTERNAL_SANDBOX_CLEANER_INTERVAL_SECONDS:-15}"
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
  local current_runner_provider
  current_runner_provider="$(state_get agent_runner.runner_provider)"
  if ! runner_socket_is_connected || [[ -z "$(state_get project.id)" || -z "$(state_get agent_runner.id)" || "${current_runner_provider}" != "managed" ]]; then
    internal_info "preparing agent-task diagnostic resources"
    AGENT_RUNNER_SEED_MODE=managed_agent_task LOCAL_MANUAL_ENABLE_INTERNAL=0 bash "${ROOT_DIR}/scripts/local-manual/seed-agent-task-diagnostics.sh"
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
CLEANER_LOG="${INTERNAL_SANDBOX_CLEANER_LOG}"
CLEANER_INTERVAL_SECONDS="${INTERNAL_SANDBOX_CLEANER_INTERVAL_SECONDS}"
AFSCP_STORAGE_CSI_DRIVER="${CSI_DRIVER}"
AFSCP_STORAGE_CAPACITY="${STORAGE_CAPACITY}"
AFSCP_STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME}"
AFSCP_STORAGE_CSI_MOUNT_OPTIONS="${MOUNT_OPTIONS}"
AFSCP_STORAGE_CSI_SUBDIR="${SUBDIR}"
AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT="${MOUNT_SERVICE_ACCOUNT}"
AFSCP_STORAGE_CSI_MOUNT_IMAGE="${MOUNT_IMAGE_OVERRIDE}"
AFSCP_BASE_URL="${AFSCP_BASE_URL:-http://127.0.0.1:28090}"
AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-manager}"
AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-agentsmith-local-afscp-orchestrator-token}"
AFSCP_ORCHESTRATOR_ACTOR_TYPE="${AFSCP_ORCHESTRATOR_ACTOR_TYPE:-system}"
AFSCP_ORCHESTRATOR_ACTOR_ID="${AFSCP_ORCHESTRATOR_ACTOR_ID:-${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-agentsmith-sandbox-manager}}"
AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT:-}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"
KUBECONFIG="${KUBECONFIG:-}"
EOF
}

stop_internal_runtime() {
  if [[ -f "${INTERNAL_SANDBOX_STATE_FILE}" ]]; then
    INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-cleaner >/dev/null 2>&1 || true
    INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true
  fi
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
  stop_internal_runtime
  kubectl delete pod -n "${K8S_NAMESPACE}" -l app=managed-workload --ignore-not-found --wait=true >/dev/null 2>&1 || true
  kubectl delete pod -n "${K8S_NAMESPACE}" -l app=sandbox --ignore-not-found --wait=true >/dev/null 2>&1 || true
  INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" start-manager
  INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" start-cleaner
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
  local token project_id endpoint_id existing_runner current_runner_provider
  token="$(cat "$(backend_real_token_file)" 2>/dev/null || true)"
  project_id="$(state_get project.id)"
  endpoint_id="$(state_get endpoint.id)"
  existing_runner="$(state_get agent_runner.id)"
  current_runner_provider="$(state_get agent_runner.runner_provider)"
  [[ -n "${token}" && -n "${project_id}" && -n "${endpoint_id}" ]] || {
    internal_info "agent-task diagnostic state missing after internal API restart; preparing agent-task diagnostic resources"
    ensure_agent_task_diagnostics_ready
    token="$(cat "$(backend_real_token_file)" 2>/dev/null || true)"
    project_id="$(state_get project.id)"
    endpoint_id="$(state_get endpoint.id)"
    existing_runner="$(state_get agent_runner.id)"
    [[ -n "${token}" && -n "${project_id}" && -n "${endpoint_id}" ]] || {
      internal_err "missing agent-task diagnostic state; run make local-manual-seed-agent-task first"
      exit 1
    }
  }

  if [[ -n "${existing_runner}" && "${current_runner_provider}" == "managed" ]]; then
    local status
    status="$(curl -sS -o /dev/null -w '%{http_code}' \
      "http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}/agent-runners/${existing_runner}" \
      -H "Authorization: Bearer ${token}" || true)"
    if [[ "${status}" == "200" ]]; then
      return 0
    fi
  fi

  internal_info "managed agent-task runner state missing after internal API restart; preparing agent-task diagnostic resources"
  AGENT_RUNNER_SEED_MODE=managed_agent_task LOCAL_MANUAL_ENABLE_INTERNAL=0 bash "${ROOT_DIR}/scripts/local-manual/seed-agent-task-diagnostics.sh"
}
