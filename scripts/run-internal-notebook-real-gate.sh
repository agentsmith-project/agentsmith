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
RUNNER_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-agentsmith-codex-runner:local}"
RUNNER_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_BASE_IMAGE:-agentsmith-codex-runner-base:local}"
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
ensure_backend_real_state
INTERNAL_REAL_DIR="${INTERNAL_REAL_DIR:-$(backend_real_tmp_file internal)}"
mkdir -p "${INTERNAL_REAL_DIR}"
INTERNAL_REAL_DIR="$(realpath -m "${INTERNAL_REAL_DIR}")"
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
CONTEXT_NAME="$(kubectl config current-context 2>/dev/null || true)"
DEFAULT_KIND_CLUSTER_NAME="agentsmith"
if [[ -z "${INTERNAL_AGENT_KIND_CLUSTER_NAME:-}" ]] && kind get clusters 2>/dev/null | grep -qx 'mbos'; then
  DEFAULT_KIND_CLUSTER_NAME="mbos"
fi
KIND_CLUSTER_NAME="${INTERNAL_AGENT_KIND_CLUSTER_NAME:-${DEFAULT_KIND_CLUSTER_NAME}}"
KIND_CONTEXT_NAME="kind-${KIND_CLUSTER_NAME}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:${INTEGRATION_KEYCLOAK_PORT}}"
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:${INTEGRATION_MONGO_PORT}/admin}"
MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"

info() { echo "[internal-real-gate] $*"; }

if [[ -z "${BACKEND_REAL_API_KEY_VALUE}" ]]; then
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
  if kind get clusters 2>/dev/null | grep -qx "${KIND_CLUSTER_NAME}"; then
    info "using existing kind cluster ${KIND_CLUSTER_NAME}"
  else
    info "creating kind cluster ${KIND_CLUSTER_NAME}"
    kind create cluster --name "${KIND_CLUSTER_NAME}" --config "${KIND_CONFIG_PATH}" >/dev/null
  fi

  kubectl config use-context "${KIND_CONTEXT_NAME}" >/dev/null
  CONTEXT_NAME="${KIND_CONTEXT_NAME}"
}

ensure_kind_cluster

if [[ "${BUILD_RUNNER_IMAGE}" == "1" ]]; then
  if ! docker image inspect "${RUNNER_BASE_IMAGE}" >/dev/null 2>&1; then
    info "building internal runner base image ${RUNNER_BASE_IMAGE}"
    BUILD_ARGS=(build -t "${RUNNER_BASE_IMAGE}" -f "${ROOT_DIR}/infra/runner/Dockerfile.agent-codex-runner-base" "${ROOT_DIR}")
    if [[ -n "${DOCKER_BUILD_PROXY_VALUE}" ]]; then
      BUILD_ARGS=(build --build-arg "HTTP_PROXY=${DOCKER_BUILD_PROXY_VALUE}" --build-arg "HTTPS_PROXY=${DOCKER_BUILD_PROXY_VALUE}" --build-arg "NO_PROXY=127.0.0.1,localhost,host.docker.internal" -t "${RUNNER_BASE_IMAGE}" -f "${ROOT_DIR}/infra/runner/Dockerfile.agent-codex-runner-base" "${ROOT_DIR}")
    fi
    docker "${BUILD_ARGS[@]}" >/dev/null
  fi
  info "building internal runner image ${RUNNER_IMAGE} from current workspace"
  BUILD_ARGS=(build --build-arg "RUNNER_BASE_IMAGE=${RUNNER_BASE_IMAGE}" -t "${RUNNER_IMAGE}" -f "${ROOT_DIR}/infra/runner/Dockerfile.agent-codex-runner" "${ROOT_DIR}")
  if [[ -n "${DOCKER_BUILD_PROXY_VALUE}" ]]; then
    BUILD_ARGS=(build --build-arg "HTTP_PROXY=${DOCKER_BUILD_PROXY_VALUE}" --build-arg "HTTPS_PROXY=${DOCKER_BUILD_PROXY_VALUE}" --build-arg "NO_PROXY=127.0.0.1,localhost,host.docker.internal" --build-arg "RUNNER_BASE_IMAGE=${RUNNER_BASE_IMAGE}" -t "${RUNNER_IMAGE}" -f "${ROOT_DIR}/infra/runner/Dockerfile.agent-codex-runner" "${ROOT_DIR}")
  fi
  docker "${BUILD_ARGS[@]}" >/dev/null
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

ensure_juicefs_csi() {
  local csi_namespace
  if ! kubectl get csidriver "${CSI_DRIVER}" >/dev/null 2>&1; then
    info "installing JuiceFS CSI driver ${CSI_DRIVER}"
    kubectl apply --validate=false -f https://raw.githubusercontent.com/juicedata/juicefs-csi-driver/master/deploy/k8s.yaml >/dev/null
  fi

  csi_namespace="$(
    kubectl get statefulset -A --no-headers 2>/dev/null \
      | awk '$2=="juicefs-csi-controller"{print $1; exit}' \
      | tr -d '[:space:]'
  )"
  if [[ -z "${csi_namespace}" ]]; then
    csi_namespace="$(
      kubectl get daemonset -A --no-headers 2>/dev/null \
        | awk '$2=="juicefs-csi-node"{print $1; exit}' \
        | tr -d '[:space:]'
    )"
  fi
  if [[ -z "${csi_namespace}" ]]; then
    csi_namespace="juicefs-system"
  fi

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

    info "patching local JuiceFS CSI workloads for kind"
    kubectl scale statefulset/juicefs-csi-controller -n "${csi_namespace}" --replicas=1 >/dev/null
    kubectl patch statefulset/juicefs-csi-controller -n "${csi_namespace}" --type='json' -p='[{"op":"remove","path":"/spec/template/spec/containers/3"}]' >/dev/null || true
    kubectl patch daemonset/juicefs-csi-node -n "${csi_namespace}" --type='json' -p='[{"op":"remove","path":"/spec/template/spec/containers/2"}]' >/dev/null || true
    kubectl delete pod -n "${csi_namespace}" -l app=juicefs-csi-controller >/dev/null 2>&1 || true
    kubectl delete pod -n "${csi_namespace}" -l app=juicefs-csi-node >/dev/null 2>&1 || true
  fi

  info "waiting for JuiceFS CSI readiness"
  kubectl rollout status statefulset/juicefs-csi-controller -n "${csi_namespace}" --timeout=180s >/dev/null
  kubectl rollout status daemonset/juicefs-csi-node -n "${csi_namespace}" --timeout=180s >/dev/null
}

kubectl create namespace "${K8S_NAMESPACE}" --dry-run=client -o yaml | kubectl apply --validate=false -f - >/dev/null

KIND_NODE_NAME="${KIND_CLUSTER_NAME}-control-plane"
if [[ "${CONTEXT_NAME}" == kind-* ]]; then
  info "loading ${RUNNER_IMAGE} into kind node ${KIND_NODE_NAME}"
  ensure_kind_image "${RUNNER_IMAGE}"
fi

ensure_juicefs_csi

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
INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE="${INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE:-http://$(k8s_external_minio_fqdn "${K8S_NAMESPACE}"):9000}"
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
  INTERNAL_SANDBOX_REAL_STATE_FILE="${STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-cleaner >/dev/null 2>&1 || true
  INTERNAL_SANDBOX_REAL_STATE_FILE="${STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true
}
trap cleanup EXIT

INTERNAL_SANDBOX_REAL_STATE_FILE="${STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-cleaner >/dev/null 2>&1 || true
INTERNAL_SANDBOX_REAL_STATE_FILE="${STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true
kubectl delete pod -n "${K8S_NAMESPACE}" -l app=managed-workload --ignore-not-found --wait=true >/dev/null 2>&1 || true
kubectl delete pod -n "${K8S_NAMESPACE}" -l app=sandbox --ignore-not-found --wait=true >/dev/null 2>&1 || true

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

cat > "${STATE_FILE}" <<EOF
ROOT_DIR="${ROOT_DIR}"
SANDBOX_ROOT="${SANDBOX_ROOT}"
INTERNAL_REAL_DIR="${INTERNAL_REAL_DIR}"
CONFIG_PATH="${CONFIG_PATH}"
SANDBOX_PORT="${SANDBOX_PORT}"
SANDBOX_SERVICE_KEY_VALUE="${SANDBOX_SERVICE_KEY_VALUE}"
K8S_NAMESPACE="${K8S_NAMESPACE}"
SANDBOX_LOG="${SANDBOX_LOG}"
CLEANER_LOG="${CLEANER_LOG}"
CLEANER_INTERVAL_SECONDS="${CLEANER_INTERVAL_SECONDS}"
INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE="${INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"
KUBECONFIG="${KUBECONFIG:-}"
EOF

info "starting local sandbox manager on :${SANDBOX_PORT}"
INTERNAL_SANDBOX_REAL_STATE_FILE="${STATE_FILE}" bash "${CONTROL_SCRIPT}" start-manager
info "starting local sandbox cleaner loop"
INTERNAL_SANDBOX_REAL_STATE_FILE="${STATE_FILE}" bash "${CONTROL_SCRIPT}" start-cleaner

info "running internal notebook workspace real integration"
info "internal screenshots and review artifacts will be written to:"
info "  ${INTERNAL_VISUAL_ARTIFACT_DIR}"
(
  cd "${ROOT_DIR}" && \
    BACKEND_REAL_API_KEY="${BACKEND_REAL_API_KEY_VALUE}" \
    SANDBOX_MANAGER_URL="http://127.0.0.1:${SANDBOX_PORT}" \
    SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY_VALUE}" \
    DATABASE_URL="postgresql://mbos:mbos_dev_password@localhost:${INTEGRATION_POSTGRES_PORT}/mbos" \
    MONGO_URL="${MONGO_URL}" \
    MONGO_DB_NAME="${MONGO_DB_NAME}" \
    REDIS_URL="redis://localhost:${INTEGRATION_REDIS_PORT}" \
    MINIO_ENDPOINT="localhost" \
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
    INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="${INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE}" \
    INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE_VALUE}" \
    INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE_VALUE}" \
    INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="${INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE}" \
    INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
    AGENT_EXECUTION_WS_BASE_URL="${AGENT_EXECUTION_WS_BASE_URL_VALUE}" \
    INTERNAL_REAL_VISUAL_ARTIFACT_DIR="${INTERNAL_VISUAL_ARTIFACT_DIR}" \
    INTERNAL_SANDBOX_REAL_STATE_FILE="${STATE_FILE}" \
    POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}" \
    MONGO_PORT="${INTEGRATION_MONGO_PORT}" \
    REDIS_PORT="${INTEGRATION_REDIS_PORT}" \
    MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}" \
    MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT}" \
    KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT}" \
    INTEGRATION_API_PORT="${API_PORT}" \
    INTEGRATION_WEB_PORT="${WEB_PORT}" \
    bash scripts/run-integration-e2e-full.sh \
      e2e/integration-internal-notebook-workspace.spec.ts \
      e2e/integration-internal-sandbox-reclaim.spec.ts
)

info "internal notebook workspace real gate passed"
