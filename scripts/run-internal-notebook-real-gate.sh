#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX_ROOT="$(cd "${ROOT_DIR}/../mbos-sandbox-v1" && pwd)"

if [[ -f "${ROOT_DIR}/.env.real.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env.real.local"
  set +a
fi

GLM_API_KEY_VALUE="${GLM_API_KEY:-}"
API_PORT="${INTEGRATION_API_PORT:-20072}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3072}"
SANDBOX_PORT="${INTERNAL_SANDBOX_MANAGER_PORT:-28080}"
SANDBOX_SERVICE_KEY_VALUE="${SANDBOX_SERVICE_KEY:-agentsmith-internal-test-key}"
K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-sandbox}"
CSI_DRIVER="${INTERNAL_AGENT_JUICEFS_CSI_DRIVER:-csi.juicefs.com}"
RUNNER_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-agentsmith-codex-runner:local}"
WORKSPACE_CAPACITY="${INTERNAL_AGENT_WORKSPACE_CAPACITY:-1Pi}"
JUICEFS_MOUNT_IMAGE="${INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE:-juicedata/mount:ce-v1.3.1}"
SANDBOX_LOG="${INTERNAL_SANDBOX_MANAGER_LOG:-/tmp/agentsmith-sandbox-manager.log}"
CONFIG_PATH="${INTERNAL_SANDBOX_MANAGER_CONFIG:-/tmp/agentsmith-sandbox-manager.yaml}"
INTERNAL_VISUAL_ARTIFACT_DIR="${INTERNAL_REAL_VISUAL_ARTIFACT_DIR:-${ROOT_DIR}/artifacts/release-real-visual/internal-$(date +%Y%m%d-%H%M%S)}"
CONTEXT_NAME="$(kubectl config current-context 2>/dev/null || true)"

info() { echo "[internal-real-gate] $*"; }

if [[ -z "${GLM_API_KEY_VALUE}" ]]; then
  echo "[internal-real-gate] Missing GLM_API_KEY." >&2
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

if ! docker image inspect "${RUNNER_IMAGE}" >/dev/null 2>&1; then
  echo "[internal-real-gate] runner image not found: ${RUNNER_IMAGE}" >&2
  echo "[internal-real-gate] build it first, for example via the external docker notebook path." >&2
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
  if ! kubectl get csidriver "${CSI_DRIVER}" >/dev/null 2>&1; then
    info "installing JuiceFS CSI driver ${CSI_DRIVER}"
    kubectl apply -f https://raw.githubusercontent.com/juicedata/juicefs-csi-driver/master/deploy/k8s.yaml >/dev/null
  fi

  if [[ "${CONTEXT_NAME}" == kind-* ]]; then
    info "loading CSI images into kind node ${KIND_NODE_NAME}"
    ensure_local_image "${JUICEFS_MOUNT_IMAGE}"
    ensure_kind_image "juicedata/juicefs-csi-driver:v0.31.2"
    ensure_kind_image "juicedata/csi-dashboard:v0.31.2"
    ensure_kind_image "${JUICEFS_MOUNT_IMAGE}"
    ensure_kind_image "registry.k8s.io/sig-storage/csi-provisioner:v3.6.0"
    ensure_kind_image "registry.k8s.io/sig-storage/csi-resizer:v1.9.0"
    ensure_kind_image "registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0"
    ensure_kind_image "registry.k8s.io/sig-storage/livenessprobe:v2.11.0"

    info "patching local JuiceFS CSI workloads for kind"
    kubectl scale statefulset/juicefs-csi-controller -n kube-system --replicas=1 >/dev/null
    kubectl patch statefulset/juicefs-csi-controller -n kube-system --type='json' -p='[{"op":"remove","path":"/spec/template/spec/containers/3"}]' >/dev/null || true
    kubectl patch daemonset/juicefs-csi-node -n kube-system --type='json' -p='[{"op":"remove","path":"/spec/template/spec/containers/2"}]' >/dev/null || true
    kubectl delete pod -n kube-system -l app=juicefs-csi-controller >/dev/null 2>&1 || true
    kubectl delete pod -n kube-system -l app=juicefs-csi-node >/dev/null 2>&1 || true
  fi

  info "waiting for JuiceFS CSI readiness"
  kubectl rollout status statefulset/juicefs-csi-controller -n kube-system --timeout=180s >/dev/null
  kubectl rollout status daemonset/juicefs-csi-node -n kube-system --timeout=180s >/dev/null
}

kubectl create namespace "${K8S_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

KIND_NODE_NAME="kind-control-plane"
if [[ "${CONTEXT_NAME}" == kind-* ]]; then
  CLUSTER_NAME="${CONTEXT_NAME#kind-}"
  info "loading ${RUNNER_IMAGE} into kind cluster ${CLUSTER_NAME}"
  kind load docker-image "${RUNNER_IMAGE}" --name "${CLUSTER_NAME}" >/dev/null
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
AGENT_EXECUTION_WS_BASE_URL_VALUE="ws://${KIND_GATEWAY}:${API_PORT}"
INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE="${INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE:-${KIND_GATEWAY}}"
INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE="${INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE:-http://${KIND_GATEWAY}:19000}"

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

info "starting local sandbox manager on :${SANDBOX_PORT}"
(
  cd "${SANDBOX_ROOT}/manager-service" && \
    env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
    CONFIG_PATH="${CONFIG_PATH}" \
    SERVICE_KEYS="${SANDBOX_SERVICE_KEY_VALUE}" \
    STORAGE_ENDPOINT="localhost:19000" \
    STORAGE_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}" \
    STORAGE_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}" \
    STORAGE_BUCKET="${MINIO_BUCKET:-mbos-dev}" \
    STORAGE_USE_SSL="false" \
    go run ./cmd/manager
) >"${SANDBOX_LOG}" 2>&1 &
SANDBOX_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS -H "X-Service-Key: ${SANDBOX_SERVICE_KEY_VALUE}" "http://127.0.0.1:${SANDBOX_PORT}/readyz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS -H "X-Service-Key: ${SANDBOX_SERVICE_KEY_VALUE}" "http://127.0.0.1:${SANDBOX_PORT}/readyz" >/dev/null 2>&1; then
  echo "[internal-real-gate] sandbox manager failed to become ready." >&2
  tail -n 120 "${SANDBOX_LOG}" >&2 || true
  exit 1
fi

info "running internal notebook workspace real integration"
info "internal screenshots and review artifacts will be written to:"
info "  ${INTERNAL_VISUAL_ARTIFACT_DIR}"
(
  cd "${ROOT_DIR}" && \
    GLM_API_KEY="${GLM_API_KEY_VALUE}" \
    SANDBOX_MANAGER_URL="http://127.0.0.1:${SANDBOX_PORT}" \
    SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY_VALUE}" \
    INTERNAL_AGENT_K8S_NAMESPACE="${K8S_NAMESPACE}" \
    INTERNAL_AGENT_JUICEFS_CSI_DRIVER="${CSI_DRIVER}" \
    INTERNAL_AGENT_WORKSPACE_CAPACITY="${WORKSPACE_CAPACITY}" \
    INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE="${INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE}" \
    INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="${INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE}" \
    INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
    AGENT_EXECUTION_WS_BASE_URL="${AGENT_EXECUTION_WS_BASE_URL_VALUE}" \
    INTERNAL_REAL_VISUAL_ARTIFACT_DIR="${INTERNAL_VISUAL_ARTIFACT_DIR}" \
    INTEGRATION_API_PORT="${API_PORT}" \
    INTEGRATION_WEB_PORT="${WEB_PORT}" \
    bash scripts/run-integration-e2e-full.sh e2e/integration-internal-notebook-workspace.spec.ts
)

info "internal notebook workspace real gate passed"
