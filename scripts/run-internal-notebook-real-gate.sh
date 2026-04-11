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
source "${ROOT_DIR}/scripts/lib/runner-image-common.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/scenarios/common.sh"
load_backend_real_env
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
RUNNER_KIND="${INTEGRATION_INTERNAL_AGENT_RUNNER_KIND:-notebook}"
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
export RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-external_host,internal_k8s}"
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

if ! command -v kubectl >/dev/null 2>&1; then
  echo "[internal-real-gate] kubectl is required." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[internal-real-gate] docker is required." >&2
  exit 1
fi

if ! command -v kind >/dev/null 2>&1; then
  echo "[internal-real-gate] kind is required." >&2
  exit 1
fi

ensure_kind_cluster() {
  LOCAL_KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME}" \
  LOCAL_KIND_CONFIG_PATH="${KIND_CONFIG_PATH}" \
  LOCAL_KIND_CONTROL_PLANE_NODE_NAME="${KIND_CLUSTER_NAME}-control-plane" \
    ensure_local_kind_cluster
  kubectl config use-context "${KIND_CONTEXT_NAME}" >/dev/null
  CONTEXT_NAME="${KIND_CONTEXT_NAME}"
}

ensure_kind_cluster
gate_record_preflight_check "${INTERNAL_REAL_DIR}" "kind_cluster" "passed" "${KIND_CLUSTER_NAME}"
record_service kind_cluster ready "${KIND_CLUSTER_NAME}"

if [[ "${BUILD_RUNNER_IMAGE}" == "1" ]]; then
  info "building internal runner image ${RUNNER_IMAGE} from current workspace"
  build_runner_image "${RUNNER_KIND}" "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY_VALUE}" "0" "1"
elif ! docker image inspect "${RUNNER_IMAGE}" >/dev/null 2>&1; then
  echo "[internal-real-gate] runner image not found: ${RUNNER_IMAGE}" >&2
  echo "[internal-real-gate] build it first or leave INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=1." >&2
  exit 1
fi

ensure_kind_image() {
  local image="$1"
  local tarball
  tarball="$(mktemp /tmp/kind-image.XXXXXX.tar)"
  docker save "${image}" -o "${tarball}"
  cat "${tarball}" | docker exec -i "${KIND_NODE_NAME}" sh -lc 'cat > /tmp/image.tar && ctr -n k8s.io images import /tmp/image.tar && rm -f /tmp/image.tar'
  rm -f "${tarball}"
}

ensure_local_image() {
  local image="$1"
  if docker image inspect "${image}" >/dev/null 2>&1; then
    return 0
  fi
  info "pulling required image ${image}"
  docker pull "${image}" >/dev/null
}

wait_for_juicefs_pods() {
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

wait_for_juicefs_ready() {
  local namespace="$1"
  wait_for_juicefs_pods "${namespace}" 'app=juicefs-csi-controller'
  kubectl wait --for=condition=Ready pod -l app=juicefs-csi-controller -n "${namespace}" --timeout=600s >/dev/null
  wait_for_juicefs_pods "${namespace}" 'app=juicefs-csi-node'
  kubectl wait --for=condition=Ready pod -l app=juicefs-csi-node -n "${namespace}" --timeout=600s >/dev/null
}

ensure_juicefs_csi() {
  local csi_namespace
  local csi_manifest
  info "reconciling JuiceFS CSI driver ${CSI_DRIVER}"
  csi_manifest="${JUICEFS_CSI_MANIFEST_PATH}"
  if [[ ! -f "${csi_manifest}" ]]; then
    csi_manifest="$(mktemp "${INTERNAL_REAL_DIR}/juicefs-csi.XXXXXX.yaml")"
    curl -fsSL --max-time 30 "https://raw.githubusercontent.com/juicedata/juicefs-csi-driver/master/deploy/k8s.yaml" -o "${csi_manifest}"
  fi
  kubectl apply --validate=false --request-timeout=30s -f "${csi_manifest}" >/dev/null

  csi_namespace="${JUICEFS_CSI_NAMESPACE}"

  if [[ "${CONTEXT_NAME}" == kind-* ]]; then
    info "loading CSI images into kind node ${KIND_NODE_NAME}"
    ensure_local_image "${JUICEFS_MOUNT_IMAGE}"
    ensure_kind_image "juicedata/juicefs-csi-driver:${JUICEFS_CSI_VERSION}"
    ensure_kind_image "juicedata/csi-dashboard:${JUICEFS_CSI_VERSION}"
    ensure_kind_image "${JUICEFS_MOUNT_IMAGE}"
    ensure_kind_image "registry.k8s.io/sig-storage/csi-provisioner:v3.6.0"
    ensure_kind_image "registry.k8s.io/sig-storage/csi-resizer:v1.9.0"
    ensure_kind_image "registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0"
    ensure_kind_image "registry.k8s.io/sig-storage/livenessprobe:v2.11.0"

    kubectl scale statefulset/juicefs-csi-controller -n "${csi_namespace}" --replicas=1 >/dev/null
    kubectl delete pod -n "${csi_namespace}" -l app=juicefs-csi-controller >/dev/null 2>&1 || true
    kubectl delete pod -n "${csi_namespace}" -l app=juicefs-csi-node >/dev/null 2>&1 || true
  fi

  info "waiting for JuiceFS CSI readiness"
  wait_for_juicefs_ready "${csi_namespace}"
}

kubectl create namespace "${K8S_NAMESPACE}" --dry-run=client -o yaml | kubectl apply --validate=false -f - >/dev/null

KIND_NODE_NAME="${KIND_CLUSTER_NAME}-control-plane"
if [[ "${CONTEXT_NAME}" == kind-* ]]; then
  info "loading ${RUNNER_IMAGE} into kind node ${KIND_NODE_NAME}"
  ensure_kind_image "${RUNNER_IMAGE}"
fi

ensure_juicefs_csi
gate_record_preflight_check "${INTERNAL_REAL_DIR}" "juicefs_csi" "passed" "${CSI_DRIVER}"
record_service juicefs_csi ready "${CSI_DRIVER}"

KIND_GATEWAY=""
if docker network inspect kind >/dev/null 2>&1; then
  KIND_GATEWAY="$(
    docker network inspect kind -f '{{range .IPAM.Config}}{{println .Gateway}}{{end}}' 2>/dev/null \
      | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' \
      | head -n1 \
      || true
  )"
fi
if [[ -z "${KIND_GATEWAY}" ]]; then
  KIND_GATEWAY="host.docker.internal"
fi
if ! is_ipv4_address "${KIND_GATEWAY}"; then
  echo "[internal-real-gate] unable to resolve a routable kind gateway IP for external dependency services." >&2
  exit 1
fi
AGENT_EXECUTION_WS_BASE_URL_VALUE="ws://${KIND_GATEWAY}:${API_PORT}"
INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE="${INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE:-$(k8s_external_postgres_fqdn "${K8S_NAMESPACE}")}"
INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE_VALUE="${INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE:-5432}"
JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT_VALUE="${JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT:-http://$(k8s_external_minio_fqdn "${K8S_NAMESPACE}"):9000}"
INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE_VALUE="${INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE:-127.0.0.1}"
INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE_VALUE="${INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE:-${INTEGRATION_POSTGRES_PORT}}"
INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE="${INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE:-http://127.0.0.1:${INTEGRATION_MINIO_API_PORT}}"

EXTERNAL_DEPS_MANIFEST="${INTERNAL_REAL_DIR}/external-dependencies.yaml"
render_k8s_external_dependency_services \
  "${EXTERNAL_DEPS_MANIFEST}" \
  "${K8S_NAMESPACE}" \
  "${KIND_GATEWAY}" \
  "${INTEGRATION_POSTGRES_PORT}" \
  "${KIND_GATEWAY}" \
  "${INTEGRATION_MINIO_API_PORT}"
kubectl apply -f "${EXTERNAL_DEPS_MANIFEST}" >/dev/null
gate_record_preflight_check "${INTERNAL_REAL_DIR}" "external_dependency_services" "passed" "${EXTERNAL_DEPS_MANIFEST}"
record_service external_dependency_services ready "${EXTERNAL_DEPS_MANIFEST}"

cat > "${CONFIG_PATH}" <<EOF
version: 1

server:
  httpPort: ${SANDBOX_PORT}
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

storage:
  endpoint: localhost:${INTEGRATION_MINIO_API_PORT}
  accessKey: ${MINIO_ACCESS_KEY:-mbos}
  secretKey: ${MINIO_SECRET_KEY:-mbos_dev_password}
  bucket: ${MINIO_BUCKET:-mbos-dev}
  useSSL: false

buffer:
  capacity: 10000
EOF

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

write_sandbox_state_file() {
  local state_file="$1"
  local config_path="$2"
  local sandbox_log="$3"
  local cleaner_log="$4"
  cat > "${state_file}" <<EOF
ROOT_DIR="${ROOT_DIR}"
SANDBOX_ROOT="${SANDBOX_ROOT}"
INTERNAL_REAL_DIR="${INTERNAL_REAL_DIR}"
CONFIG_PATH="${config_path}"
SANDBOX_PORT="${SANDBOX_PORT}"
SANDBOX_SERVICE_KEY_VALUE="${SANDBOX_SERVICE_KEY_VALUE}"
K8S_NAMESPACE="${K8S_NAMESPACE}"
SANDBOX_LOG="${sandbox_log}"
CLEANER_LOG="${cleaner_log}"
CLEANER_INTERVAL_SECONDS="${CLEANER_INTERVAL_SECONDS}"
JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT_VALUE="${JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT_VALUE}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"
KUBECONFIG="${KUBECONFIG:-}"
EOF
}

reset_sandbox_runtime() {
  local state_file="$1"
  INTERNAL_SANDBOX_REAL_STATE_FILE="${state_file}" bash "${CONTROL_SCRIPT}" stop-cleaner >/dev/null 2>&1 || true
  INTERNAL_SANDBOX_REAL_STATE_FILE="${state_file}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true
  kubectl delete pod -n "${K8S_NAMESPACE}" -l app=managed-workload --ignore-not-found --wait=true >/dev/null 2>&1 || true
  kubectl delete pod -n "${K8S_NAMESPACE}" -l app=sandbox --ignore-not-found --wait=true >/dev/null 2>&1 || true

  local existing_sandbox_pid
  existing_sandbox_pid="$(lsof -tiTCP:${SANDBOX_PORT} -sTCP:LISTEN -n -P 2>/dev/null | head -n1 || true)"
  if [[ -n "${existing_sandbox_pid}" ]]; then
    info "terminating stale sandbox manager on :${SANDBOX_PORT} (pid=${existing_sandbox_pid})"
    kill "${existing_sandbox_pid}" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      if ! kill -0 "${existing_sandbox_pid}" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    if kill -0 "${existing_sandbox_pid}" >/dev/null 2>&1; then
      echo "[internal-real-gate] failed to stop stale sandbox manager on :${SANDBOX_PORT}" >&2
      exit 1
    fi
  fi
}

prepare_internal_spec_runtime() {
  local spec_slug="$1"
  local cleaner_mode="$2"
  local spec_runtime_dir spec_state_file spec_config_path spec_sandbox_log spec_cleaner_log
  spec_runtime_dir="${INTERNAL_REAL_DIR}/${spec_slug}"
  mkdir -p "${spec_runtime_dir}"
  spec_state_file="${spec_runtime_dir}/sandbox-control.env"
  spec_config_path="${spec_runtime_dir}/sandbox-manager.yaml"
  spec_sandbox_log="${spec_runtime_dir}/sandbox-manager.log"
  spec_cleaner_log="${spec_runtime_dir}/sandbox-cleaner.log"

  cp "${CONFIG_PATH}" "${spec_config_path}"
  write_sandbox_state_file "${spec_state_file}" "${spec_config_path}" "${spec_sandbox_log}" "${spec_cleaner_log}"
  reset_sandbox_runtime "${spec_state_file}"

  echo "[internal-real-gate] starting isolated sandbox manager for ${spec_slug} on :${SANDBOX_PORT}" >&2
  INTERNAL_SANDBOX_REAL_STATE_FILE="${spec_state_file}" bash "${CONTROL_SCRIPT}" start-manager 1>&2
  if [[ "${cleaner_mode}" == "with-cleaner" ]]; then
    echo "[internal-real-gate] starting isolated sandbox cleaner for ${spec_slug}" >&2
    INTERNAL_SANDBOX_REAL_STATE_FILE="${spec_state_file}" bash "${CONTROL_SCRIPT}" start-cleaner 1>&2
  fi
  CURRENT_SANDBOX_STATE_FILE="${spec_state_file}"
  printf '%s\n' "${spec_state_file}"
}

info "running internal notebook workspace real integration"
info "internal screenshots and review artifacts will be written to:"
info "  ${INTERNAL_VISUAL_ARTIFACT_DIR}"
run_internal_spec() {
  local spec="$1"
  local spec_api_port="$2"
  local spec_web_port="$3"
  local spec_state_file="$4"
  local spec_slug
  local spec_agent_execution_ws_base_url
  spec_slug="$(basename "${spec}" .spec.ts)"
  spec_agent_execution_ws_base_url="ws://${KIND_GATEWAY}:${spec_api_port}"
  (
    cd "${ROOT_DIR}" && \
      BACKEND_REAL_API_KEY="${BACKEND_REAL_API_KEY_VALUE}" \
      SANDBOX_MANAGER_URL="http://127.0.0.1:${SANDBOX_PORT}" \
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
      INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
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
      INTEGRATION_LOG_DIR="${INTERNAL_REAL_DIR}/${spec_slug}" \
      bash scripts/run-integration-e2e-full.sh "${spec}"
  )
}

set +e
WORKSPACE_STATE_FILE="$(prepare_internal_spec_runtime "integration-internal-notebook-workspace" "with-cleaner")"
gate_record_preflight_check "${INTERNAL_REAL_DIR}" "workspace_spec_sandbox_manager" "passed" "port ${SANDBOX_PORT}"
run_internal_spec e2e/integration-internal-notebook-workspace.spec.ts "${API_PORT}" "${WEB_PORT}" "${WORKSPACE_STATE_FILE}"
WORKSPACE_STATUS=$?
RECLAIM_STATUS=0
if [[ "${WORKSPACE_STATUS}" -eq 0 ]]; then
  gate_record_preflight_check "${INTERNAL_REAL_DIR}" "workspace_spec" "passed" "integration-internal-notebook-workspace"
else
  gate_record_failure "${INTERNAL_REAL_DIR}" "scenario_assertion_failed" "workspace_spec" "integration-internal-notebook-workspace failed with status ${WORKSPACE_STATUS}"
fi
if [[ "${WORKSPACE_STATUS}" -eq 0 ]]; then
  INTERNAL_SANDBOX_REAL_STATE_FILE="${WORKSPACE_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-cleaner >/dev/null 2>&1 || true
  INTERNAL_SANDBOX_REAL_STATE_FILE="${WORKSPACE_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true

  RECLAIM_STATE_FILE="$(prepare_internal_spec_runtime "integration-internal-sandbox-reclaim" "with-cleaner")"
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

info "internal notebook workspace real gate passed"
gate_record_success "${INTERNAL_REAL_DIR}" "internal_specs"
