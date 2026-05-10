#!/usr/bin/env bash

internal_real_gate_info() { echo "[internal-real-gate] $*"; }

internal_real_gate_require_host_tools() {
  if ! command -v kubectl >/dev/null 2>&1; then
    echo "[internal-real-gate] kubectl is required." >&2
    return 1
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "[internal-real-gate] docker is required." >&2
    return 1
  fi

  if ! command -v kind >/dev/null 2>&1; then
    echo "[internal-real-gate] kind is required." >&2
    return 1
  fi
}

internal_real_gate_default_kind_cluster_name() {
  if kind get clusters 2>/dev/null | grep -qx 'mbos'; then
    printf 'mbos\n'
    return 0
  fi

  printf 'agentsmith\n'
}

internal_real_gate_ensure_kind_cluster() {
  LOCAL_KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME}" \
  LOCAL_KIND_CONFIG_PATH="${KIND_CONFIG_PATH}" \
  LOCAL_KIND_CONTROL_PLANE_NODE_NAME="${KIND_CLUSTER_NAME}-control-plane" \
    ensure_local_kind_cluster
  kubectl config use-context "${KIND_CONTEXT_NAME}" >/dev/null
  CONTEXT_NAME="${KIND_CONTEXT_NAME}"
}

internal_real_gate_ensure_kind_image() {
  local image="$1"
  local tarball

  tarball="$(mktemp /tmp/kind-image.XXXXXX.tar)"
  docker save "${image}" -o "${tarball}"
  cat "${tarball}" | docker exec -i "${KIND_NODE_NAME}" sh -lc 'cat > /tmp/image.tar && ctr -n k8s.io images import /tmp/image.tar && rm -f /tmp/image.tar'
  rm -f "${tarball}"
}

internal_real_gate_ensure_local_image() {
  local image="$1"

  if docker image inspect "${image}" >/dev/null 2>&1; then
    return 0
  fi

  internal_real_gate_info "pulling required image ${image}"
  docker pull "${image}" >/dev/null
}

internal_real_gate_wait_for_afscp_storage_csi_pods() {
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

internal_real_gate_wait_for_afscp_storage_csi_ready() {
  local namespace="$1"

  internal_real_gate_wait_for_afscp_storage_csi_pods "${namespace}" 'app=juicefs-csi-controller'
  kubectl wait --for=condition=Ready pod -l app=juicefs-csi-controller -n "${namespace}" --timeout=600s >/dev/null
  internal_real_gate_wait_for_afscp_storage_csi_pods "${namespace}" 'app=juicefs-csi-node'
  kubectl wait --for=condition=Ready pod -l app=juicefs-csi-node -n "${namespace}" --timeout=600s >/dev/null
}

internal_real_gate_ensure_afscp_storage_csi() {
  local csi_manifest

  internal_real_gate_info "reconciling AFSCP storage CSI driver ${CSI_DRIVER}"
  csi_manifest="${AFSCP_STORAGE_CSI_MANIFEST_PATH}"
  if [[ ! -f "${csi_manifest}" ]]; then
    csi_manifest="$(mktemp "${INTERNAL_REAL_DIR}/afscp-storage-csi.XXXXXX.yaml")"
    curl -fsSL --max-time 30 "https://raw.githubusercontent.com/juicedata/juicefs-csi-driver/master/deploy/k8s.yaml" -o "${csi_manifest}"
  fi
  kubectl apply --validate=false --request-timeout=30s -f "${csi_manifest}" >/dev/null

  if [[ "${CONTEXT_NAME}" == kind-* ]]; then
    internal_real_gate_info "loading CSI images into kind node ${KIND_NODE_NAME}"
    internal_real_gate_ensure_local_image "${AFSCP_STORAGE_CSI_MOUNT_IMAGE}"
    internal_real_gate_ensure_kind_image "juicedata/juicefs-csi-driver:${AFSCP_STORAGE_CSI_VERSION}"
    internal_real_gate_ensure_kind_image "juicedata/csi-dashboard:${AFSCP_STORAGE_CSI_VERSION}"
    internal_real_gate_ensure_kind_image "${AFSCP_STORAGE_CSI_MOUNT_IMAGE}"
    internal_real_gate_ensure_kind_image "registry.k8s.io/sig-storage/csi-provisioner:v3.6.0"
    internal_real_gate_ensure_kind_image "registry.k8s.io/sig-storage/csi-resizer:v1.9.0"
    internal_real_gate_ensure_kind_image "registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0"
    internal_real_gate_ensure_kind_image "registry.k8s.io/sig-storage/livenessprobe:v2.11.0"

    kubectl scale statefulset/juicefs-csi-controller -n "${AFSCP_STORAGE_CSI_NAMESPACE}" --replicas=1 >/dev/null
    kubectl delete pod -n "${AFSCP_STORAGE_CSI_NAMESPACE}" -l app=juicefs-csi-controller >/dev/null 2>&1 || true
    kubectl delete pod -n "${AFSCP_STORAGE_CSI_NAMESPACE}" -l app=juicefs-csi-node >/dev/null 2>&1 || true
  fi

  internal_real_gate_info "waiting for AFSCP storage CSI readiness"
  internal_real_gate_wait_for_afscp_storage_csi_ready "${AFSCP_STORAGE_CSI_NAMESPACE}"
}

internal_real_gate_resolve_kind_gateway() {
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

  if ! is_ipv4_address "${gateway}"; then
    echo "[internal-real-gate] unable to resolve a routable kind gateway IP for external dependency services." >&2
    return 1
  fi

  printf '%s\n' "${gateway}"
}

internal_real_gate_write_sandbox_config() {
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
}

internal_real_gate_write_sandbox_state_file() {
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
AFSCP_STORAGE_CSI_DRIVER="${CSI_DRIVER}"
AFSCP_STORAGE_CAPACITY="${STORAGE_CAPACITY}"
AFSCP_STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME}"
AFSCP_STORAGE_CSI_MOUNT_OPTIONS="${MOUNT_OPTIONS}"
AFSCP_STORAGE_CSI_SUBDIR="${SUBDIR}"
AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT="${MOUNT_SERVICE_ACCOUNT}"
AFSCP_STORAGE_CSI_MOUNT_IMAGE="${MOUNT_IMAGE_OVERRIDE}"
AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"
KUBECONFIG="${KUBECONFIG:-}"
EOF
}

internal_real_gate_stop_runtime() {
  local state_file="$1"

  INTERNAL_SANDBOX_REAL_STATE_FILE="${state_file}" bash "${CONTROL_SCRIPT}" stop-cleaner >/dev/null 2>&1 || true
  INTERNAL_SANDBOX_REAL_STATE_FILE="${state_file}" bash "${CONTROL_SCRIPT}" stop-manager >/dev/null 2>&1 || true
}

internal_real_gate_reset_runtime() {
  local state_file="$1"
  local existing_sandbox_pid

  internal_real_gate_stop_runtime "${state_file}"
  kubectl delete pod -n "${K8S_NAMESPACE}" -l app=managed-workload --ignore-not-found --wait=true >/dev/null 2>&1 || true
  kubectl delete pod -n "${K8S_NAMESPACE}" -l app=sandbox --ignore-not-found --wait=true >/dev/null 2>&1 || true

  existing_sandbox_pid="$(lsof -tiTCP:${SANDBOX_PORT} -sTCP:LISTEN -n -P 2>/dev/null | head -n1 || true)"
  if [[ -n "${existing_sandbox_pid}" ]]; then
    internal_real_gate_info "terminating stale sandbox manager on :${SANDBOX_PORT} (pid=${existing_sandbox_pid})"
    kill "${existing_sandbox_pid}" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      if ! kill -0 "${existing_sandbox_pid}" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    if kill -0 "${existing_sandbox_pid}" >/dev/null 2>&1; then
      echo "[internal-real-gate] failed to stop stale sandbox manager on :${SANDBOX_PORT}" >&2
      return 1
    fi
  fi
}

prepare_internal_backend_real_gate_runtime() {
  local rebuild_runner_base_image
  internal_real_gate_require_host_tools
  BUILD_RUNNER_IMAGE="${BUILD_RUNNER_IMAGE:-1}"
  rebuild_runner_base_image="${INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE:-1}"
  CONTEXT_NAME="${CONTEXT_NAME:-$(kubectl config current-context 2>/dev/null || true)}"
  KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME:-$(internal_real_gate_default_kind_cluster_name)}"
  KIND_CONTEXT_NAME="${KIND_CONTEXT_NAME:-kind-${KIND_CLUSTER_NAME}}"
  internal_real_gate_ensure_kind_cluster

  if [[ "${BUILD_RUNNER_IMAGE}" == "1" ]]; then
    internal_real_gate_info "building internal runner image ${RUNNER_IMAGE} from current workspace"
    build_runner_image "${RUNNER_KIND}" "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY_VALUE}" "${rebuild_runner_base_image}" "1"
  elif ! docker image inspect "${RUNNER_IMAGE}" >/dev/null 2>&1; then
    echo "[internal-real-gate] runner image not found: ${RUNNER_IMAGE}" >&2
    echo "[internal-real-gate] build it first or leave INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=1." >&2
    return 1
  fi

  kubectl create namespace "${K8S_NAMESPACE}" --dry-run=client -o yaml | kubectl apply --validate=false -f - >/dev/null

  KIND_NODE_NAME="${KIND_CLUSTER_NAME}-control-plane"
  if [[ "${CONTEXT_NAME}" == kind-* ]]; then
    internal_real_gate_info "loading ${RUNNER_IMAGE} into kind node ${KIND_NODE_NAME}"
    internal_real_gate_ensure_kind_image "${RUNNER_IMAGE}"
  fi

  internal_real_gate_ensure_afscp_storage_csi

  KIND_GATEWAY="$(internal_real_gate_resolve_kind_gateway)"
  SANDBOX_MANAGER_URL_VALUE="${SANDBOX_MANAGER_URL:-http://127.0.0.1:${SANDBOX_PORT}}"
  AGENT_EXECUTION_WS_BASE_URL_VALUE="ws://${KIND_GATEWAY}:${API_PORT}"
  AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT:-http://$(k8s_external_minio_fqdn "${K8S_NAMESPACE}"):9000}"

  EXTERNAL_DEPS_MANIFEST="${EXTERNAL_DEPS_MANIFEST:-${INTERNAL_REAL_DIR}/external-dependencies.yaml}"
  render_k8s_external_dependency_services \
    "${EXTERNAL_DEPS_MANIFEST}" \
    "${K8S_NAMESPACE}" \
    "${KIND_GATEWAY}" \
    "${INTEGRATION_POSTGRES_PORT}" \
    "${KIND_GATEWAY}" \
    "${INTEGRATION_MINIO_API_PORT}"
  kubectl apply -f "${EXTERNAL_DEPS_MANIFEST}" >/dev/null

  internal_real_gate_write_sandbox_config
}

prepare_internal_backend_real_spec_runtime() {
  local spec_slug="$1"
  local cleaner_mode="$2"
  local spec_runtime_dir
  local spec_state_file
  local spec_config_path
  local spec_sandbox_log
  local spec_cleaner_log

  spec_runtime_dir="${INTERNAL_REAL_DIR}/${spec_slug}"
  mkdir -p "${spec_runtime_dir}"
  spec_state_file="${spec_runtime_dir}/sandbox-control.env"
  spec_config_path="${spec_runtime_dir}/sandbox-manager.yaml"
  spec_sandbox_log="${spec_runtime_dir}/sandbox-manager.log"
  spec_cleaner_log="${spec_runtime_dir}/sandbox-cleaner.log"

  cp "${CONFIG_PATH}" "${spec_config_path}"
  internal_real_gate_write_sandbox_state_file "${spec_state_file}" "${spec_config_path}" "${spec_sandbox_log}" "${spec_cleaner_log}"
  internal_real_gate_reset_runtime "${spec_state_file}"

  echo "[internal-real-gate] starting isolated sandbox manager for ${spec_slug} on :${SANDBOX_PORT}" >&2
  INTERNAL_SANDBOX_REAL_STATE_FILE="${spec_state_file}" bash "${CONTROL_SCRIPT}" start-manager 1>&2
  if [[ "${cleaner_mode}" == "with-cleaner" ]]; then
    echo "[internal-real-gate] starting isolated sandbox cleaner for ${spec_slug}" >&2
    INTERNAL_SANDBOX_REAL_STATE_FILE="${spec_state_file}" bash "${CONTROL_SCRIPT}" start-cleaner 1>&2
  fi
  CURRENT_SANDBOX_STATE_FILE="${spec_state_file}"
  printf '%s\n' "${spec_state_file}"
}
