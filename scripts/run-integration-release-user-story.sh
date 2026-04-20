#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX_ROOT="$(cd "${ROOT_DIR}/../mbos-sandbox-v1" && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
source "${ROOT_DIR}/scripts/lib/k8s-external-services.sh"
source "${ROOT_DIR}/scripts/lib/docker-buildx-common.sh"
source "${ROOT_DIR}/scripts/lib/kind-cluster-bootstrap.sh"
source "${ROOT_DIR}/scripts/lib/runner-image-common.sh"
ensure_backend_real_state

load_backend_real_env "${ROOT_DIR}/.env.backend-real"
export_backend_real_endpoint_env

API_PORT="${INTEGRATION_API_PORT:-20074}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3074}"
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
EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE="${EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE:-127.0.0.1}"
EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE_VALUE="${EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE:-15432}"
EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE="${EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE:-http://127.0.0.1:19000}"
RESET_FIRST="${RESET_FIRST:-1}"

info() { echo "[integration-release-user-story] $*"; }

if [[ -z "${BACKEND_REAL_API_KEY_VALUE}" ]]; then
  echo "[integration-release-user-story] Missing PRESET_ENDPOINT_API_KEY." >&2
  exit 1
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "[integration-release-user-story] kubectl is required." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[integration-release-user-story] docker is required." >&2
  exit 1
fi

if [[ "${RESET_FIRST}" == "1" ]]; then
  info "running clean reset"
  bash "${ROOT_DIR}/scripts/backend-real-reset.sh"
fi

ensure_backend_real_state
INTEGRATION_DIR="$(backend_real_tmp_file integration-release-user-story)"
SANDBOX_LOG="$(backend_real_resolve_runtime_path "${INTEGRATION_SANDBOX_LOG:-${INTEGRATION_DIR}/sandbox-manager.log}")"
CONFIG_PATH="$(backend_real_resolve_runtime_path "${INTEGRATION_SANDBOX_CONFIG:-${INTEGRATION_DIR}/sandbox-manager.yaml}")"
mkdir -p "${INTEGRATION_DIR}" "$(dirname "${SANDBOX_LOG}")" "$(dirname "${CONFIG_PATH}")"

if [[ "${BUILD_RUNNER_IMAGE}" == "1" ]]; then
  info "building internal runner image ${RUNNER_IMAGE}"
  build_runner_image "${RUNNER_KIND}" "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY_VALUE}" "1" "1" "${ROOT_DIR}"
elif ! docker image inspect "${RUNNER_IMAGE}" >/dev/null 2>&1; then
  echo "[integration-release-user-story] runner image not found: ${RUNNER_IMAGE}" >&2
  exit 1
fi

CONTEXT_NAME="$(kubectl config current-context 2>/dev/null || true)"
KIND_CLUSTER_NAME="$(
  kind_cluster_name_from_context_or_override \
    "${INTERNAL_AGENT_KIND_CLUSTER_NAME:-}" \
    "${CONTEXT_NAME}"
)"
KIND_NODE_NAME="$(
  kind_control_plane_node_name_from_context_or_override \
    "${CONTEXT_NAME}" \
    "${LOCAL_KIND_CONTROL_PLANE_NODE_NAME:-}" \
    "${INTERNAL_AGENT_KIND_CLUSTER_NAME:-}"
)"

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
  info "reconciling JuiceFS CSI driver ${CSI_DRIVER}"
  local csi_manifest="${JUICEFS_CSI_MANIFEST_PATH}"
  if [[ ! -f "${csi_manifest}" ]]; then
    csi_manifest="https://raw.githubusercontent.com/juicedata/juicefs-csi-driver/master/deploy/k8s.yaml"
  fi
  kubectl apply --validate=false -f "${csi_manifest}" >/dev/null

  if [[ "${CONTEXT_NAME}" == kind-* ]]; then
    info "loading images into kind cluster ${KIND_CLUSTER_NAME}"
    ensure_local_image "${JUICEFS_MOUNT_IMAGE}"
    ensure_kind_image "${RUNNER_IMAGE}"
    ensure_kind_image "juicedata/juicefs-csi-driver:${JUICEFS_CSI_VERSION}"
    ensure_kind_image "juicedata/csi-dashboard:${JUICEFS_CSI_VERSION}"
    ensure_kind_image "${JUICEFS_MOUNT_IMAGE}"
    ensure_kind_image "registry.k8s.io/sig-storage/csi-provisioner:v3.6.0"
    ensure_kind_image "registry.k8s.io/sig-storage/csi-resizer:v1.9.0"
    ensure_kind_image "registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0"
    ensure_kind_image "registry.k8s.io/sig-storage/livenessprobe:v2.11.0"

    kubectl scale statefulset/juicefs-csi-controller -n "${JUICEFS_CSI_NAMESPACE}" --replicas=1 >/dev/null || true
    kubectl delete pod -n "${JUICEFS_CSI_NAMESPACE}" -l app=juicefs-csi-controller >/dev/null 2>&1 || true
    kubectl delete pod -n "${JUICEFS_CSI_NAMESPACE}" -l app=juicefs-csi-node >/dev/null 2>&1 || true
  fi

  wait_for_juicefs_ready "${JUICEFS_CSI_NAMESPACE}"
}

kubectl create namespace "${K8S_NAMESPACE}" --dry-run=client -o yaml | kubectl apply --validate=false -f - >/dev/null

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
  echo "[integration-release-user-story] unable to resolve a routable kind gateway IP for external dependency services." >&2
  exit 1
fi
AGENT_EXECUTION_WS_BASE_URL_VALUE="ws://${KIND_GATEWAY}:${API_PORT}"
INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE="${INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE:-$(k8s_external_postgres_fqdn "${K8S_NAMESPACE}")}"
INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE_VALUE="${INTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE:-5432}"
JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT_VALUE="${JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT:-http://$(k8s_external_minio_fqdn "${K8S_NAMESPACE}"):9000}"

EXTERNAL_DEPS_MANIFEST="${INTEGRATION_DIR}/external-dependencies.yaml"
render_k8s_external_dependency_services \
  "${EXTERNAL_DEPS_MANIFEST}" \
  "${K8S_NAMESPACE}" \
  "${KIND_GATEWAY}" \
  15432 \
  "${KIND_GATEWAY}" \
  19000
kubectl apply -f "${EXTERNAL_DEPS_MANIFEST}" >/dev/null

cat > "${CONFIG_PATH}" <<EOF
version: 1

server:
  httpPort: ${SANDBOX_PORT}

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

sandbox:
  defaults:
    namespace: ${K8S_NAMESPACE}
    runnerImage: ${RUNNER_IMAGE}
    imagePullPolicy: IfNotPresent
    ttlSeconds: 900
    podReadyWait: 30s
    podPollInterval: 500ms
    terminationGraceSeconds: 1
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

exec:
  defaultTimeout: 30s
  maxTimeout: 300s
  stdoutMaxBytes: 1048576
  stderrMaxBytes: 1048576
  preserveTailBytes: 4096
  shell:
    bin: sh
    args: ["-lc"]

files:
  rootPrefix: /workspace

storage:
  endpoint: localhost:19000
  accessKey: ${MINIO_ACCESS_KEY:-mbos}
  secretKey: ${MINIO_SECRET_KEY:-mbos_dev_password}
  bucket: ${MINIO_BUCKET:-mbos-dev}
  useSSL: false

buffer:
  capacity: 10000
EOF

SANDBOX_PID=""
cleanup() {
  if [[ -n "${SANDBOX_PID}" ]] && kill -0 "${SANDBOX_PID}" >/dev/null 2>&1; then
    kill "${SANDBOX_PID}" >/dev/null 2>&1 || true
    wait "${SANDBOX_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

existing_sandbox_pid="$(lsof -tiTCP:${SANDBOX_PORT} -sTCP:LISTEN -n -P 2>/dev/null | head -n1 || true)"
if [[ -n "${existing_sandbox_pid}" ]]; then
  info "terminating stale sandbox manager on :${SANDBOX_PORT}"
  kill "${existing_sandbox_pid}" >/dev/null 2>&1 || true
  sleep 2
fi

info "starting local sandbox manager"
(
  cd "${SANDBOX_ROOT}/manager-service" && \
    env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
    CONFIG_PATH="${CONFIG_PATH}" \
    SERVICE_KEYS="${SANDBOX_SERVICE_KEY_VALUE}" \
    JUICEFS_STORAGE_ENDPOINT="${JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT_VALUE}" \
    JUICEFS_STORAGE_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}" \
    JUICEFS_STORAGE_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}" \
    STORAGE_ENDPOINT="localhost:19000" \
    STORAGE_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}" \
    STORAGE_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}" \
    STORAGE_BUCKET="${MINIO_BUCKET:-mbos-dev}" \
    STORAGE_USE_SSL="false" \
    go run ./cmd/manager
) >"${SANDBOX_LOG}" 2>&1 &
SANDBOX_PID=$!

for _ in $(seq 1 90); do
  if curl -fsS -H "X-Service-Key: ${SANDBOX_SERVICE_KEY_VALUE}" "http://127.0.0.1:${SANDBOX_PORT}/readyz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS -H "X-Service-Key: ${SANDBOX_SERVICE_KEY_VALUE}" "http://127.0.0.1:${SANDBOX_PORT}/readyz" >/dev/null 2>&1; then
  echo "[integration-release-user-story] sandbox manager failed to become ready." >&2
  tail -n 120 "${SANDBOX_LOG}" >&2 || true
  exit 1
fi

info "running full integration release user story"
(
  cd "${ROOT_DIR}" && \
    BACKEND_REAL_API_KEY="${BACKEND_REAL_API_KEY_VALUE}" \
    BACKEND_REAL_ANTHROPIC_BASE_URL="${BACKEND_REAL_ANTHROPIC_BASE_URL_VALUE}" \
    BACKEND_REAL_OPENAI_BASE_URL="${BACKEND_REAL_OPENAI_BASE_URL_VALUE}" \
    BACKEND_REAL_MODEL="${BACKEND_REAL_MODEL_VALUE}" \
    SANDBOX_MANAGER_URL="http://127.0.0.1:${SANDBOX_PORT}" \
    SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY_VALUE}" \
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
    INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
    AGENT_EXECUTION_WS_BASE_URL="${AGENT_EXECUTION_WS_BASE_URL_VALUE}" \
    EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE="${EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE}" \
    EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE="${EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE_VALUE}" \
    EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="${EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE}" \
    UX_TRACE_OUTPUT_ROOT="${ARTIFACT_DIR}/ux-traces" \
    INTEGRATION_API_PORT="${API_PORT}" \
    INTEGRATION_WEB_PORT="${WEB_PORT}" \
    bash scripts/run-integration-e2e-full.sh e2e/integration-release-user-story.spec.ts
)

info "integration release user story passed"
