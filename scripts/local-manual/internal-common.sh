#!/usr/bin/env bash
set -euo pipefail

export LOCAL_MANUAL_ENABLE_INTERNAL=1

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
source "${ROOT_DIR}/scripts/lib/k8s-external-services.sh"

init_local_manual_env

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
CSI_DRIVER="${INTERNAL_AGENT_JUICEFS_CSI_DRIVER:-csi.juicefs.com}"
WORKSPACE_CAPACITY="${INTERNAL_AGENT_WORKSPACE_CAPACITY:-1Pi}"
STORAGE_CLASS_NAME="${INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME:-juicefs-sc}"
MOUNT_OPTIONS="${INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS:-}"
SUBDIR="${INTERNAL_AGENT_JUICEFS_SUBDIR:-}"
MOUNT_SERVICE_ACCOUNT="${INTERNAL_AGENT_JUICEFS_MOUNT_SERVICE_ACCOUNT:-}"
MOUNT_IMAGE_OVERRIDE="${INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE:-}"
RUNNER_IMAGE="${LOCAL_MANUAL_INTERNAL_AGENT_IMAGE:-agentsmith-codex-runner:local}"
RUNNER_BASE_IMAGE="${LOCAL_MANUAL_INTERNAL_AGENT_BASE_IMAGE:-agentsmith-codex-runner-base:local}"
DOCKER_BUILD_PROXY_VALUE="${LOCAL_MANUAL_INTERNAL_DOCKER_BUILD_PROXY:-${DOCKER_BUILD_PROXY:-${HTTP_PROXY:-}}}"
REBUILD_RUNNER_IMAGE="${LOCAL_MANUAL_INTERNAL_REBUILD_RUNNER_IMAGE:-0}"
JUICEFS_MOUNT_IMAGE="${INTERNAL_AGENT_JUICEFS_MOUNT_IMAGE:-juicedata/mount:ce-v1.3.1}"
JUICEFS_CSI_VERSION="${JUICEFS_CSI_VERSION:-v0.31.3}"
JUICEFS_CSI_MANIFEST_PATH="${JUICEFS_CSI_MANIFEST_PATH:-${ROOT_DIR}/infra/deploy/cluster/addons/juicefs-csi/upstream-manifest.yaml}"
JUICEFS_CSI_NAMESPACE="${JUICEFS_CSI_NAMESPACE:-kube-system}"
KIND_CONFIG_PATH="${LOCAL_KIND_CONFIG_PATH:-${ROOT_DIR}/infra/deploy/demo/kind/config.yaml}"
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
  if [[ ! -f "${API_READY_FILE}" || ! -f "${WEB_READY_FILE}" || ! -f "${PROXY_READY_FILE}" ]]; then
    internal_info "starting default local-manual flow"
    LOCAL_MANUAL_ENABLE_INTERNAL=0 bash "${ROOT_DIR}/scripts/local-manual/up.sh"
  fi
}

ensure_notebook_demo_seeded() {
  if [[ ! -f "${RUNNER_READY_FILE}" || -z "$(state_get project.id)" || -z "$(state_get agent.id)" ]]; then
    internal_info "seeding notebook demo resources"
    LOCAL_MANUAL_ENABLE_INTERNAL=0 bash "${ROOT_DIR}/scripts/local-manual/seed-notebook-demo.sh"
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
  if ! docker image inspect "${RUNNER_BASE_IMAGE}" >/dev/null 2>&1; then
    internal_info "building internal runner base image ${RUNNER_BASE_IMAGE}"
    local build_args=(build -t "${RUNNER_BASE_IMAGE}" -f "${ROOT_DIR}/infra/runner/Dockerfile.agent-codex-runner-base" "${ROOT_DIR}")
    if [[ -n "${DOCKER_BUILD_PROXY_VALUE}" ]]; then
      build_args=(build --build-arg "HTTP_PROXY=${DOCKER_BUILD_PROXY_VALUE}" --build-arg "HTTPS_PROXY=${DOCKER_BUILD_PROXY_VALUE}" --build-arg "NO_PROXY=127.0.0.1,localhost,host.docker.internal" -t "${RUNNER_BASE_IMAGE}" -f "${ROOT_DIR}/infra/runner/Dockerfile.agent-codex-runner-base" "${ROOT_DIR}")
    fi
    docker "${build_args[@]}" >/dev/null
  fi
  if [[ "${REBUILD_RUNNER_IMAGE}" == "1" ]] || ! docker image inspect "${RUNNER_IMAGE}" >/dev/null 2>&1; then
    internal_info "building internal runner image ${RUNNER_IMAGE}"
    local build_args=(build --build-arg "RUNNER_BASE_IMAGE=${RUNNER_BASE_IMAGE}" -t "${RUNNER_IMAGE}" -f "${ROOT_DIR}/infra/runner/Dockerfile.agent-codex-runner" "${ROOT_DIR}")
    if [[ -n "${DOCKER_BUILD_PROXY_VALUE}" ]]; then
      build_args=(build --build-arg "HTTP_PROXY=${DOCKER_BUILD_PROXY_VALUE}" --build-arg "HTTPS_PROXY=${DOCKER_BUILD_PROXY_VALUE}" --build-arg "NO_PROXY=127.0.0.1,localhost,host.docker.internal" --build-arg "RUNNER_BASE_IMAGE=${RUNNER_BASE_IMAGE}" -t "${RUNNER_IMAGE}" -f "${ROOT_DIR}/infra/runner/Dockerfile.agent-codex-runner" "${ROOT_DIR}")
    fi
    docker "${build_args[@]}" >/dev/null
  fi
  internal_info "loading ${RUNNER_IMAGE} into kind"
  ensure_kind_image "${RUNNER_IMAGE}"
}

wait_for_juicefs_ready() {
  local namespace="$1"
  kubectl wait --for=condition=Ready pod -l app=juicefs-csi-controller -n "${namespace}" --timeout=600s >/dev/null
  kubectl wait --for=condition=Ready pod -l app=juicefs-csi-node -n "${namespace}" --timeout=600s >/dev/null
}

ensure_juicefs_csi() {
  local csi_namespace
  internal_info "reconciling JuiceFS CSI driver ${CSI_DRIVER}"
  local csi_manifest="${JUICEFS_CSI_MANIFEST_PATH}"
  if [[ ! -f "${csi_manifest}" ]]; then
    csi_manifest="https://raw.githubusercontent.com/juicedata/juicefs-csi-driver/master/deploy/k8s.yaml"
  fi
  kubectl apply --validate=false -f "${csi_manifest}" >/dev/null

  csi_namespace="${JUICEFS_CSI_NAMESPACE}"

  internal_info "loading CSI images into kind"
  ensure_local_image "${JUICEFS_MOUNT_IMAGE}"
  ensure_kind_image "juicedata/juicefs-csi-driver:${JUICEFS_CSI_VERSION}"
  ensure_kind_image "juicedata/csi-dashboard:${JUICEFS_CSI_VERSION}"
  ensure_kind_image "${JUICEFS_MOUNT_IMAGE}"
  ensure_kind_image "registry.k8s.io/sig-storage/csi-provisioner:v3.6.0"
  ensure_kind_image "registry.k8s.io/sig-storage/csi-resizer:v1.9.0"
  ensure_kind_image "registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0"
  ensure_kind_image "registry.k8s.io/sig-storage/livenessprobe:v2.11.0"

  kubectl scale statefulset/juicefs-csi-controller -n "${csi_namespace}" --replicas=1 >/dev/null || true
  kubectl delete pod -n "${csi_namespace}" -l app=juicefs-csi-controller >/dev/null 2>&1 || true
  kubectl delete pod -n "${csi_namespace}" -l app=juicefs-csi-node >/dev/null 2>&1 || true
  wait_for_juicefs_ready "${csi_namespace}"
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
  local kind_gateway
  kind_gateway="$(resolve_kind_gateway_ip)"
  kubectl create namespace "${K8S_NAMESPACE}" --dry-run=client -o yaml | kubectl apply --validate=false -f - >/dev/null
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

storage:
  endpoint: localhost:${SUBSTRATE_MINIO_API_PORT}
  accessKey: ${MINIO_ACCESS_KEY:-mbos}
  secretKey: ${MINIO_SECRET_KEY:-mbos_dev_password}
  bucket: ${MINIO_BUCKET:-mbos-dev}
  useSSL: false

buffer:
  capacity: 10000
EOF
}

write_internal_state_env() {
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
JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT_VALUE="${JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT:-}"
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

start_internal_runtime() {
  write_internal_sandbox_config
  write_internal_state_env
  stop_internal_runtime
  kubectl delete pod -n "${K8S_NAMESPACE}" -l app=managed-workload --ignore-not-found --wait=true >/dev/null 2>&1 || true
  kubectl delete pod -n "${K8S_NAMESPACE}" -l app=sandbox --ignore-not-found --wait=true >/dev/null 2>&1 || true
  INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" start-manager
  INTERNAL_SANDBOX_REAL_STATE_FILE="${INTERNAL_SANDBOX_STATE_FILE}" bash "${CONTROL_SCRIPT}" start-cleaner
}

restart_api_with_mode() {
  local internal_flag="$1"
  stop_pid_file_if_running "${API_PID_FILE}" "api"
  rm -f "${API_READY_FILE}" "${API_PORT_FILE}" "${API_PID_FILE}"
  if [[ "${internal_flag}" == "1" ]]; then
    local kind_gateway
    kind_gateway="$(resolve_kind_gateway_ip)"
    AGENT_EXECUTION_WS_BASE_URL="ws://${kind_gateway}:${PORT_API}" \
      LOCAL_MANUAL_ENABLE_INTERNAL="${internal_flag}" \
      bash "${ROOT_DIR}/scripts/local-manual/start-api.sh"
    return
  fi
  LOCAL_MANUAL_ENABLE_INTERNAL="${internal_flag}" bash "${ROOT_DIR}/scripts/local-manual/start-api.sh"
}

ensure_internal_agent_state() {
  local token project_id endpoint_id existing_agent
  token="$(cat "$(backend_real_token_file)" 2>/dev/null || true)"
  project_id="$(state_get project.id)"
  endpoint_id="$(state_get endpoint.id)"
  existing_agent="$(state_get internal_agent.id)"
  [[ -n "${token}" && -n "${project_id}" && -n "${endpoint_id}" ]] || {
    internal_err "missing notebook demo state; run make local-manual-seed-notebook first"
    exit 1
  }

  if [[ -n "${existing_agent}" ]]; then
    local status
    status="$(curl -sS -o /dev/null -w '%{http_code}' \
      "http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}/agents/${existing_agent}" \
      -H "Authorization: Bearer ${token}" || true)"
    if [[ "${status}" == "200" ]]; then
      return 0
    fi
  fi

  internal_info "creating internal notebook agent"
  local payload response
  payload="$(
    node - <<'NODE' "${endpoint_id}" "${RUNNER_IMAGE}" "${PRESET_ENDPOINT_MODEL:-placeholder-model}"
const [endpointId, image, model] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  name: `demo-internal-agent-${Date.now()}`,
  mode: 'internal',
  interaction_mode: 'notebook',
  execution_preferences: {
    notebook: {
      endpoint_id: endpointId,
      wire_api: 'responses',
      model,
    },
  },
  config: {
    image,
    endpoint_id: endpointId,
    cpu_request: '500m',
    cpu_limit: '2',
    memory_request: '512Mi',
    memory_limit: '4Gi',
    idle_timeout_sec: 300,
    max_lifetime_sec: 3600,
  },
  capabilities: {
    streaming_completion: true,
  },
}));
NODE
  )"
  response="$(curl -sS \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    -X POST \
    --data "${payload}" \
    "http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}/agents")"
  local agent_json
  agent_json="$(node - <<'NODE' "${response}"
const payload = JSON.parse(process.argv[2]);
if (!payload.id) {
  process.stderr.write(JSON.stringify(payload));
  process.exit(1);
}
process.stdout.write(JSON.stringify({ id: payload.id, name: payload.name || '' }));
NODE
  )"
  state_set_json internal_agent "${agent_json}"
}
