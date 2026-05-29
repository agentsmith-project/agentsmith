#!/usr/bin/env bash

internal_real_gate_info() { echo "[internal-real-gate] $*"; }

internal_real_gate_lib_root="${ROOT_DIR:-$(pwd)}"
# shellcheck disable=SC1090
source "${internal_real_gate_lib_root}/scripts/lib/managed-runner-image-handoff.sh"

internal_real_gate_secret_fingerprint() {
  local value="${1:-}"
  local digest
  if [[ -z "${value}" ]]; then
    printf '\n'
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    digest="$(printf '%s' "${value}" | sha256sum | awk '{print $1}')"
  else
    digest="$(printf '%s' "${value}" | shasum -a 256 | awk '{print $1}')"
  fi
  printf 'sha256:%s\n' "${digest}"
}

internal_real_gate_asbcp_kubeconfig_path() {
  local configured="${KUBECONFIG:-}"
  if [[ -n "${configured}" ]]; then
    realpath -m "${configured}"
    return 0
  fi
  if [[ -n "${LOCAL_KIND_FINAL_KUBECONFIG_PATH:-}" ]]; then
    realpath -m "${LOCAL_KIND_FINAL_KUBECONFIG_PATH}"
    return 0
  fi
  if declare -F scenario_kind_kubeconfig_path >/dev/null 2>&1; then
    scenario_kind_kubeconfig_path "${LOCAL_KIND_CLUSTER_NAME:-${KIND_CLUSTER_NAME:-agentsmith}}"
    return 0
  fi
  printf '%s/agentsmith/local-kind/kind-%s.kubeconfig\n' "${HOME}" "${LOCAL_KIND_CLUSTER_NAME:-${KIND_CLUSTER_NAME:-agentsmith}}"
}

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

  internal_real_gate_ensure_local_image "${image}"
  tarball="$(mktemp /tmp/kind-image.XXXXXX.tar)"
  (
    set -e
    trap 'rm -f "${tarball}"' EXIT
    docker save "${image}" -o "${tarball}"
    docker exec -i "${KIND_NODE_NAME}" sh -lc 'cat > /tmp/image.tar && ctr -n k8s.io images import /tmp/image.tar && rm -f /tmp/image.tar' < "${tarball}"
  )
}

internal_real_gate_ensure_local_image() {
  local image="$1"

  if docker image inspect "${image}" >/dev/null 2>&1; then
    return 0
  fi

  internal_real_gate_info "pulling required image ${image}"
  docker pull "${image}" >/dev/null
}

internal_real_gate_runner_image_id() {
  local image="$1"
  docker image inspect --format '{{.Id}}' "${image}" 2>/dev/null | head -n1 || true
}

internal_real_gate_runner_image_reuse_ready() {
  local runner_image_id
  runner_image_id="$(internal_real_gate_runner_image_id "${RUNNER_IMAGE}")"
  [[ -n "${runner_image_id}" ]] || return 1

  readiness_state_field_ready_with_identity runner_image_digest_prepared \
    "runner_image_ref=${RUNNER_IMAGE}" \
    "runner_image_id=${runner_image_id}"
}

internal_real_gate_image_tag_text() {
  local raw="${1:-local}"
  local tag
  tag="$(printf '%s' "${raw}" | tr -c 'A-Za-z0-9_.-' '-' | sed -E 's/^-+//; s/-+$//; s/-+/-/g' | cut -c1-80)"
  printf '%s\n' "${tag:-local}"
}

internal_real_gate_source_kind_bootstrap() {
  if declare -F kind_configure_registry_no_proxy_for_containerd >/dev/null 2>&1; then
    return 0
  fi

  local root_dir="${ROOT_DIR:-$(pwd)}"
  local bootstrap_path="${root_dir}/scripts/lib/kind-cluster-bootstrap.sh"
  if [[ ! -f "${bootstrap_path}" ]]; then
    echo "[internal-real-gate] missing kind bootstrap helper: ${bootstrap_path}" >&2
    return 1
  fi

  # shellcheck disable=SC1090
  source "${bootstrap_path}"
}

internal_real_gate_configure_skills_runtime_runner_image() {
  if [[ "${GATE_MODE:-}" != "skills-runtime" ]]; then
    return 0
  fi

  local explicit_image_env=()
  [[ -n "${INTEGRATION_INTERNAL_AGENT_IMAGE:-}" ]] && explicit_image_env+=("INTEGRATION_INTERNAL_AGENT_IMAGE")
  [[ -n "${INTERNAL_AGENT_IMAGE:-}" ]] && explicit_image_env+=("INTERNAL_AGENT_IMAGE")
  [[ -n "${MANAGED_RUNNER_IMAGE:-}" ]] && explicit_image_env+=("MANAGED_RUNNER_IMAGE")
  if [[ "${#explicit_image_env[@]}" -gt 0 ]]; then
    gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "skills_runtime_runner_image" "--skills-runtime managed runner image env must be unset"
    echo "[internal-real-gate] --skills-runtime builds and pushes the current workspace runner image; found ${explicit_image_env[*]}. unset them, or use --runner-projection-smoke for release-locked image coverage." >&2
    return 1
  fi

  if [[ "${BUILD_RUNNER_IMAGE:-1}" != "1" ]]; then
    gate_record_failure "${INTERNAL_REAL_DIR}" "infra_dependency_unready" "skills_runtime_runner_image" "INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=1 is required"
    echo "[internal-real-gate] --skills-runtime requires INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=1 so it can test the current workspace builtin skills." >&2
    return 1
  fi

  local image_tag
  image_tag="backend-real-$(internal_real_gate_image_tag_text "${RUNTIME_LINE_ID:-local}")"
  RUNNER_IMAGE="${INTEGRATION_INTERNAL_AGENT_LOCAL_IMAGE_TAG:-agentsmith-managed-runner:${image_tag}}"
  RUNNER_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_BASE_IMAGE:-agentsmith-managed-runner-base:${image_tag}}"
}

internal_real_gate_publish_local_runner_image_ref() {
  local source_image="$1"
  local image_repository image_tag
  image_repository="${INTEGRATION_INTERNAL_AGENT_LOCAL_REPOSITORY:-mbos/agentsmith-managed-runner}"
  image_tag="${INTEGRATION_INTERNAL_AGENT_LOCAL_TAG:-backend-real-$(internal_real_gate_image_tag_text "${RUNTIME_LINE_ID:-local}")}"
  managed_runner_image_handoff_publish_local_runner_image_ref \
    "${source_image}" \
    "${image_repository}" \
    "${image_tag}" \
    "[internal-real-gate]"
}

internal_real_gate_runner_image_from_kind_registry() {
  local image="$1"
  managed_runner_image_handoff_from_kind_registry "${image}"
}

internal_real_gate_preflight_kind_registry_runner_image() {
  local runner_image="$1"
  managed_runner_image_handoff_preflight_kind_registry_runner_image \
    "${runner_image}" \
    "${KIND_NODE_NAME}" \
    "[internal-real-gate]" \
    "${ROOT_DIR:-$(pwd)}"
}

internal_real_gate_prepare_managed_runner_image_handoff() {
  if [[ "${GATE_MODE:-}" == "runner-projection-smoke" ]]; then
    return 0
  fi

  managed_runner_image_handoff_reject_legacy_runner_image_ref "${RUNNER_IMAGE}" "[internal-real-gate]" || return 1

  if managed_runner_image_handoff_is_digest_ref "${RUNNER_IMAGE}"; then
    internal_real_gate_preflight_kind_registry_runner_image "${RUNNER_IMAGE}" || return 1
    return 0
  fi

  RUNNER_IMAGE="$(internal_real_gate_publish_local_runner_image_ref "${RUNNER_IMAGE}")" || return 1
  internal_real_gate_preflight_kind_registry_runner_image "${RUNNER_IMAGE}" || return 1
  internal_real_gate_info "using local managed runner digest image ${RUNNER_IMAGE}"
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
  httpPort: ${ASBCP_PORT}
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
    containerName: main
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

internal_real_gate_write_sandbox_state_file() {
  local state_file="$1"
  local config_path="$2"
  local sandbox_log="$3"
  local asbcp_kubeconfig_path afscp_internal_base_url afscp_orchestrator_token afscp_caller_service afscp_actor_type afscp_actor_id

  asbcp_kubeconfig_path="$(internal_real_gate_asbcp_kubeconfig_path)"
  afscp_internal_base_url="${AFSCP_INTERNAL_BASE_URL:-${AFSCP_BASE_URL:-http://127.0.0.1:28090}}"
  afscp_orchestrator_token="${AFSCP_ORCHESTRATOR_TOKEN:-${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-agentsmith-local-afscp-orchestrator-token}}"
  afscp_caller_service="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-${AFSCP_CALLER_SERVICE:-agentsmith-sandbox-control-plane}}"
  afscp_actor_type="${AFSCP_ACTOR_TYPE:-${AFSCP_ORCHESTRATOR_ACTOR_TYPE:-system}}"
  afscp_actor_id="${AFSCP_ACTOR_ID:-${AFSCP_ORCHESTRATOR_ACTOR_ID:-${afscp_caller_service}}}"

  cat > "${state_file}" <<EOF
ROOT_DIR="${ROOT_DIR}"
INTERNAL_REAL_DIR="${INTERNAL_REAL_DIR}"
ASBCP_IMAGE="${ASBCP_IMAGE:-}"
ASBCP_IMAGE_LOCK_PATH="${ASBCP_IMAGE_LOCK_PATH:-${ROOT_DIR}/infra/deploy/shared/asbcp-image.lock}"
ASBCP_CONFIG_PATH="${config_path}"
ASBCP_PORT="${ASBCP_PORT}"
ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL_VALUE}"
ASBCP_SERVICE_KEY_FINGERPRINT="$(internal_real_gate_secret_fingerprint "${ASBCP_SERVICE_KEY_VALUE}")"
K8S_NAMESPACE="${K8S_NAMESPACE}"
ASBCP_LOG="${sandbox_log}"
AFSCP_INTERNAL_BASE_URL="${afscp_internal_base_url}"
AFSCP_ORCHESTRATOR_TOKEN_FINGERPRINT="$(internal_real_gate_secret_fingerprint "${afscp_orchestrator_token}")"
AFSCP_CALLER_SERVICE="${afscp_caller_service}"
AFSCP_ACTOR_TYPE="${afscp_actor_type}"
AFSCP_ACTOR_ID="${afscp_actor_id}"
AFSCP_BASE_URL="${AFSCP_BASE_URL:-${afscp_internal_base_url}}"
AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-${afscp_caller_service}}"
AFSCP_ORCHESTRATOR_SERVICE_TOKEN_FINGERPRINT="$(internal_real_gate_secret_fingerprint "${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-${afscp_orchestrator_token}}")"
AFSCP_ORCHESTRATOR_ACTOR_TYPE="${AFSCP_ORCHESTRATOR_ACTOR_TYPE:-${afscp_actor_type}}"
AFSCP_ORCHESTRATOR_ACTOR_ID="${AFSCP_ORCHESTRATOR_ACTOR_ID:-${afscp_actor_id}}"
KUBECONFIG="${asbcp_kubeconfig_path}"
EOF
}

internal_real_gate_start_runtime() {
  local state_file="$1"
  local afscp_orchestrator_token
  afscp_orchestrator_token="${AFSCP_ORCHESTRATOR_TOKEN:-${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-agentsmith-local-afscp-orchestrator-token}}"

  INTERNAL_SANDBOX_REAL_STATE_FILE="${state_file}" \
    ASBCP_SERVICE_KEY_VALUE="${ASBCP_SERVICE_KEY_VALUE}" \
    AFSCP_ORCHESTRATOR_TOKEN="${afscp_orchestrator_token}" \
    bash "${CONTROL_SCRIPT}" start-asbcp 1>&2
}

internal_real_gate_stop_runtime() {
  local state_file="$1"

  INTERNAL_SANDBOX_REAL_STATE_FILE="${state_file}" bash "${CONTROL_SCRIPT}" stop-asbcp >/dev/null 2>&1 || true
}

internal_real_gate_reset_runtime() {
  local state_file="$1"
  local existing_sandbox_pid

  internal_real_gate_stop_runtime "${state_file}"
  kubectl delete pod -n "${K8S_NAMESPACE}" -l app=managed-workload --ignore-not-found --wait=true >/dev/null 2>&1 || true
  kubectl delete pod -n "${K8S_NAMESPACE}" -l app=sandbox --ignore-not-found --wait=true >/dev/null 2>&1 || true

  existing_sandbox_pid="$(lsof -tiTCP:${ASBCP_PORT} -sTCP:LISTEN -n -P 2>/dev/null | head -n1 || true)"
  if [[ -n "${existing_sandbox_pid}" ]]; then
    internal_real_gate_info "terminating stale ASBCP on :${ASBCP_PORT} (pid=${existing_sandbox_pid})"
    kill "${existing_sandbox_pid}" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      if ! kill -0 "${existing_sandbox_pid}" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    if kill -0 "${existing_sandbox_pid}" >/dev/null 2>&1; then
      echo "[internal-real-gate] failed to stop stale ASBCP on :${ASBCP_PORT}" >&2
      return 1
    fi
  fi
}

prepare_internal_backend_real_gate_runtime() {
  local rebuild_runner_base_image
  managed_runner_image_handoff_reject_legacy_runner_image_ref "${RUNNER_IMAGE:-}" "[internal-real-gate]" || return 1
  internal_real_gate_require_host_tools
  BUILD_RUNNER_IMAGE="${BUILD_RUNNER_IMAGE:-1}"
  rebuild_runner_base_image="${INTEGRATION_INTERNAL_AGENT_REBUILD_BASE_IMAGE:-1}"
  CONTEXT_NAME="${CONTEXT_NAME:-$(kubectl config current-context 2>/dev/null || true)}"
  KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME:-$(internal_real_gate_default_kind_cluster_name)}"
  KIND_CONTEXT_NAME="${KIND_CONTEXT_NAME:-kind-${KIND_CLUSTER_NAME}}"
  internal_real_gate_ensure_kind_cluster
  KIND_NODE_NAME="${KIND_CLUSTER_NAME}-control-plane"

  if [[ "${BUILD_RUNNER_IMAGE}" == "1" ]]; then
    if [[ "${GATE_MODE:-}" != "skills-runtime" ]] && internal_real_gate_runner_image_reuse_ready; then
      internal_real_gate_info "reusing parent-verified runner image digest for ${RUNNER_IMAGE}"
    else
      internal_real_gate_info "building internal runner image ${RUNNER_IMAGE} from current workspace"
      build_runner_image "${RUNNER_KIND}" "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY_VALUE}" "${rebuild_runner_base_image}" "1"
    fi
  elif ! docker image inspect "${RUNNER_IMAGE}" >/dev/null 2>&1; then
    echo "[internal-real-gate] runner image not found: ${RUNNER_IMAGE}" >&2
    echo "[internal-real-gate] build it first or leave INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE=1." >&2
    return 1
  fi

  internal_real_gate_prepare_managed_runner_image_handoff || return 1

  ensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"

  if [[ "${CONTEXT_NAME}" == kind-* ]]; then
    if ! internal_real_gate_runner_image_from_kind_registry "${RUNNER_IMAGE}"; then
      internal_real_gate_info "loading ${RUNNER_IMAGE} into kind node ${KIND_NODE_NAME}"
      internal_real_gate_ensure_kind_image "${RUNNER_IMAGE}"
    fi
  fi

  internal_real_gate_ensure_afscp_storage_csi

  KIND_GATEWAY="$(internal_real_gate_resolve_kind_gateway)"
  ASBCP_INTERNAL_BASE_URL_VALUE="${ASBCP_INTERNAL_BASE_URL:-http://127.0.0.1:${ASBCP_PORT}}"
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

  ensure_internal_afscp_local_runtime
  internal_real_gate_write_sandbox_config
}

prepare_internal_backend_real_spec_runtime() {
  local spec_slug="$1"
  local spec_runtime_dir
  local spec_state_file
  local spec_config_path
  local spec_sandbox_log

  spec_runtime_dir="${INTERNAL_REAL_DIR}/${spec_slug}"
  mkdir -p "${spec_runtime_dir}"
  spec_state_file="${spec_runtime_dir}/sandbox-control.env"
  spec_config_path="${spec_runtime_dir}/asbcp-config.yaml"
  spec_sandbox_log="${spec_runtime_dir}/asbcp.log"

  cp "${CONFIG_PATH}" "${spec_config_path}"
  internal_real_gate_write_sandbox_state_file "${spec_state_file}" "${spec_config_path}" "${spec_sandbox_log}"
  internal_real_gate_reset_runtime "${spec_state_file}"

  echo "[internal-real-gate] starting isolated ASBCP for ${spec_slug} on :${ASBCP_PORT}" >&2
  internal_real_gate_start_runtime "${spec_state_file}"
  CURRENT_SANDBOX_STATE_FILE="${spec_state_file}"
  printf '%s\n' "${spec_state_file}"
}
