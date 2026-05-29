#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
source "${ROOT_DIR}/scripts/lib/k8s-external-services.sh"
source "${ROOT_DIR}/scripts/lib/docker-buildx-common.sh"
source "${ROOT_DIR}/scripts/lib/kind-cluster-bootstrap.sh"
source "${ROOT_DIR}/scripts/lib/runner-image-common.sh"
source "${ROOT_DIR}/scripts/lib/afscp-local-runtime.sh"
source "${ROOT_DIR}/scripts/lib/run-readiness-state.sh"
ensure_backend_real_state

ORIGINAL_INTEGRATION_API_PORT="${INTEGRATION_API_PORT:-}"
ORIGINAL_INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT:-}"
ORIGINAL_INTEGRATION_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT:-}"
ORIGINAL_INTEGRATION_MONGO_PORT="${INTEGRATION_MONGO_PORT:-}"
ORIGINAL_INTEGRATION_REDIS_PORT="${INTEGRATION_REDIS_PORT:-}"
ORIGINAL_INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT:-}"
ORIGINAL_INTEGRATION_MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT:-}"
ORIGINAL_INTEGRATION_KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT:-}"
load_backend_real_env "${ROOT_DIR}/.env.backend-real"
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

API_PORT="${INTEGRATION_API_PORT:-20074}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3074}"
INTEGRATION_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT:-25432}"
INTEGRATION_MONGO_PORT="${INTEGRATION_MONGO_PORT:-27027}"
INTEGRATION_REDIS_PORT="${INTEGRATION_REDIS_PORT:-26379}"
INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT:-29000}"
INTEGRATION_MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT:-29001}"
INTEGRATION_KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT:-28081}"
MONGO_URL="mongodb://mbos:mbos_dev_password@localhost:${INTEGRATION_MONGO_PORT}/admin"
MONGO_DB_NAME="${INTEGRATION_MONGO_DB_NAME:-mbos}"
POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}"
MONGO_PORT="${INTEGRATION_MONGO_PORT}"
REDIS_PORT="${INTEGRATION_REDIS_PORT}"
MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}"
MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT}"
KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:${INTEGRATION_KEYCLOAK_PORT}}"
ASBCP_PORT="${INTERNAL_ASBCP_PORT:-28080}"
ASBCP_INTERNAL_BASE_URL_VALUE="${ASBCP_INTERNAL_BASE_URL:-http://127.0.0.1:${ASBCP_PORT}}"
ASBCP_SERVICE_KEY_VALUE="${ASBCP_SERVICE_KEY:-agentsmith-internal-test-key}"
K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-sandbox}"
KIND_CLUSTER_NAME="${INTERNAL_AGENT_KIND_CLUSTER_NAME:-${KIND_CLUSTER_NAME:-agentsmith}}"
KIND_CONTEXT_NAME="kind-${KIND_CLUSTER_NAME}"
KIND_NODE_NAME="${LOCAL_KIND_CONTROL_PLANE_NODE_NAME:-${KIND_CLUSTER_NAME}-control-plane}"
CSI_DRIVER="${AFSCP_STORAGE_CSI_DRIVER:-csi.juicefs.com}"
RUNNER_KIND="${INTEGRATION_INTERNAL_AGENT_RUNNER_KIND:-agent-task}"
RUNNER_IMAGE="${INTEGRATION_INTERNAL_AGENT_IMAGE:-${INTEGRATION_AGENT_TASK_RUNNER_DOCKER_IMAGE:-$(runner_default_image "${RUNNER_KIND}")}}"
RUNNER_BASE_IMAGE="${INTEGRATION_INTERNAL_AGENT_BASE_IMAGE:-${INTEGRATION_AGENT_TASK_RUNNER_BASE_DOCKER_IMAGE:-$(runner_default_base_image "${RUNNER_KIND}")}}"
BUILD_RUNNER_IMAGE="${INTEGRATION_BUILD_INTERNAL_AGENT_IMAGE:-${INTEGRATION_AGENT_TASK_RUNNER_REBUILD_IMAGE:-1}}"
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
RESET_FIRST="${RESET_FIRST:-1}"
resolve_afscp_local_runtime_defaults "${API_PORT}" "vol_release_user_story"
AFSCP_INTERNAL_BASE_URL_VALUE="${AFSCP_INTERNAL_BASE_URL:-${AFSCP_BASE_URL}}"
AFSCP_ORCHESTRATOR_TOKEN_VALUE="${AFSCP_ORCHESTRATOR_TOKEN:-${AFSCP_ORCHESTRATOR_SERVICE_TOKEN}}"
AFSCP_CALLER_SERVICE_VALUE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE}"
AFSCP_ACTOR_TYPE_VALUE="${AFSCP_ACTOR_TYPE:-${AFSCP_ORCHESTRATOR_ACTOR_TYPE:-system}}"
AFSCP_ACTOR_ID_VALUE="${AFSCP_ACTOR_ID:-${AFSCP_ORCHESTRATOR_ACTOR_ID:-${AFSCP_CALLER_SERVICE_VALUE}}}"

info() { echo "[integration-release-user-story] $*"; }

release_user_story_fail() {
  echo "[integration-release-user-story] ERROR: $*" >&2
  exit 1
}

release_user_story_secret_fingerprint() {
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

release_user_story_kubectl_context_ready() {
  local current_context
  current_context="$(kubectl config current-context 2>/dev/null || true)"
  [[ "${current_context}" == "${KIND_CONTEXT_NAME}" ]] || return 1
  kubectl --context "${KIND_CONTEXT_NAME}" get --raw='/readyz' >/dev/null 2>&1 \
    || kubectl --context "${KIND_CONTEXT_NAME}" get namespace default >/dev/null 2>&1
}

release_user_story_default_kind_kubeconfig_path() {
  local cluster_name="${1:-${KIND_CLUSTER_NAME:-${INTERNAL_AGENT_KIND_CLUSTER_NAME:-agentsmith}}}"
  if [[ -z "${cluster_name}" ]]; then
    cluster_name="agentsmith"
  fi
  if [[ -n "${DEPLOY_ROOT:-}" ]]; then
    printf '%s/state/local-kind/kind-%s.kubeconfig\n' "${DEPLOY_ROOT}" "${cluster_name}"
    return 0
  fi
  printf '%s/agentsmith/local-kind/kind-%s.kubeconfig\n' "${HOME}" "${cluster_name}"
}

release_user_story_asbcp_kubeconfig_path() {
  local cluster_name="${KIND_CLUSTER_NAME:-${INTERNAL_AGENT_KIND_CLUSTER_NAME:-agentsmith}}"
  if [[ -n "${LOCAL_KIND_FINAL_KUBECONFIG_PATH:-}" ]]; then
    realpath -m "${LOCAL_KIND_FINAL_KUBECONFIG_PATH}"
    return 0
  fi
  if [[ -z "${cluster_name}" ]]; then
    cluster_name="agentsmith"
  fi
  release_user_story_default_kind_kubeconfig_path "${cluster_name}"
}

release_user_story_require_target_kind_context() {
  local action="${1:-Kubernetes operation}"
  if ! release_user_story_kubectl_context_ready; then
    local current_context
    current_context="$(kubectl config current-context 2>/dev/null || true)"
    echo "[integration-release-user-story] ERROR: ${action} requires local kind context ${KIND_CONTEXT_NAME}, got ${current_context:-<none>}" >&2
    return 1
  fi
}

ensure_release_user_story_kubernetes_context() {
  [[ -n "${KIND_CLUSTER_NAME}" && "${KIND_CONTEXT_NAME}" == kind-* ]] \
    || release_user_story_fail "target kind context is invalid: cluster=${KIND_CLUSTER_NAME:-<empty>} context=${KIND_CONTEXT_NAME:-<empty>}"

  if ! command -v kind >/dev/null 2>&1; then
    release_user_story_fail "kind is required for the local release user story diagnostic context ${KIND_CONTEXT_NAME}."
  fi

  local kind_config_path
  kind_config_path="${KIND_CONFIG_PATH:-${LOCAL_KIND_CONFIG_PATH:-${ROOT_DIR}/infra/deploy/unified/local-kind/config.yaml}}"
  LOCAL_KIND_FINAL_KUBECONFIG_PATH="${LOCAL_KIND_FINAL_KUBECONFIG_PATH:-$(release_user_story_default_kind_kubeconfig_path "${KIND_CLUSTER_NAME}")}"
  export LOCAL_KIND_FINAL_KUBECONFIG_PATH

  info "ensuring local kind cluster ${KIND_CLUSTER_NAME} for standalone release user story rehearsal"
  LOCAL_KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME}" \
  LOCAL_KIND_CONFIG_PATH="${kind_config_path}" \
  LOCAL_KIND_CONTROL_PLANE_NODE_NAME="${KIND_NODE_NAME}" \
    bash "${ROOT_DIR}/scripts/ensure-local-kind-cluster.sh" "${KIND_CLUSTER_NAME}" "${kind_config_path}" "${KIND_NODE_NAME}"

  export KUBECONFIG="${LOCAL_KIND_FINAL_KUBECONFIG_PATH}"
  kubectl config use-context "${KIND_CONTEXT_NAME}" >/dev/null \
    || release_user_story_fail "failed to select local kind context ${KIND_CONTEXT_NAME}."
  release_user_story_require_target_kind_context "release user story rehearsal" \
    || exit 1
  CONTEXT_NAME="${KIND_CONTEXT_NAME}"
  ASBCP_KUBECONFIG_PATH="$(release_user_story_asbcp_kubeconfig_path)"
  info "using local kind Kubernetes context ${CONTEXT_NAME}"
}

run_release_user_story_clean_env() {
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY "$@"
}

release_user_story_runner_image_id() {
  docker image inspect --format '{{.Id}}' "${RUNNER_IMAGE}" 2>/dev/null | head -n1 || true
}

release_user_story_runner_image_reuse_ready() {
  local runner_image_id
  runner_image_id="$(release_user_story_runner_image_id)"
  [[ -n "${runner_image_id}" ]] || return 1

  readiness_state_field_ready_with_identity runner_image_digest_prepared \
    "runner_image_ref=${RUNNER_IMAGE}" \
    "runner_image_id=${runner_image_id}"
}

release_user_story_integration_deps_ready() {
  readiness_state_field_ready_with_identity integration_deps_ready \
    "postgres_port=${INTEGRATION_POSTGRES_PORT}" \
    "mongo_port=${INTEGRATION_MONGO_PORT}" \
    "redis_port=${INTEGRATION_REDIS_PORT}" \
    "minio_api_port=${INTEGRATION_MINIO_API_PORT}" \
    "minio_console_port=${INTEGRATION_MINIO_CONSOLE_PORT}" \
    "keycloak_port=${INTEGRATION_KEYCLOAK_PORT}" \
    "keycloak_base_url=${KEYCLOAK_BASE_URL}" \
    "keycloak_realm=${KEYCLOAK_REALM}" \
    "keycloak_client_id=${KEYCLOAK_CLIENT_ID}"
}

ensure_release_user_story_integration_deps_for_afscp() {
  info "ensuring local integration dependencies for AFSCP"
  if release_user_story_integration_deps_ready; then
    info "reusing parent-verified integration dependencies for AFSCP"
    (
      cd "${ROOT_DIR}" && \
        run_release_user_story_clean_env env \
          POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}" \
          npm run integration:deps:init:postgres
    )
  else
    (
      cd "${ROOT_DIR}" && \
        run_release_user_story_clean_env env \
          POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}" \
          MONGO_PORT="${INTEGRATION_MONGO_PORT}" \
          REDIS_PORT="${INTEGRATION_REDIS_PORT}" \
          MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}" \
          MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT}" \
          KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT}" \
          KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
          KEYCLOAK_URL="${KEYCLOAK_BASE_URL%/}/realms" \
          KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
          KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
          make deps-bootstrap && \
        run_release_user_story_clean_env env \
          POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}" \
          npm run integration:deps:init:postgres
    )
  fi
}

with_release_user_story_afscp_runtime_env() {
  (
    unset AFSCP_API_PORT AFSCP_API_LISTEN_ADDR AFSCP_EXPORT_GATEWAY_PORT AFSCP_EXPORT_GATEWAY_LISTEN_ADDR
    export POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}"
    export MONGO_PORT="${INTEGRATION_MONGO_PORT}"
    export MONGO_URL="${MONGO_URL}"
    export MONGO_DB_NAME="${MONGO_DB_NAME}"
    export REDIS_PORT="${INTEGRATION_REDIS_PORT}"
    export MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}"
    export MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT}"
    export KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT}"
    export MINIO_PORT="${INTEGRATION_MINIO_API_PORT}"
    export MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
    export MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
    export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
    export MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"
    export DATABASE_URL="postgresql://mbos:mbos_dev_password@localhost:${INTEGRATION_POSTGRES_PORT}/mbos?sslmode=disable"
    export AFSCP_LOCAL_RUNTIME_DATABASE_URL="${DATABASE_URL}"
    export AFSCP_STORAGE_CSI_DRIVER="${CSI_DRIVER}"
    export AFSCP_STORAGE_CAPACITY="${STORAGE_CAPACITY}"
    export AFSCP_STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME}"
    export AFSCP_STORAGE_CSI_MOUNT_OPTIONS="${MOUNT_OPTIONS}"
    export AFSCP_STORAGE_CSI_SUBDIR="${SUBDIR}"
    export AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT="${MOUNT_SERVICE_ACCOUNT}"
    export AFSCP_STORAGE_CSI_MOUNT_IMAGE="${AFSCP_STORAGE_CSI_MOUNT_IMAGE}"
    export AFSCP_STORAGE_CSI_NAMESPACE="${AFSCP_STORAGE_CSI_NAMESPACE}"
    "$@"
  )
}

ensure_release_user_story_afscp_local_runtime() {
  info "ensuring AFSCP local runtime at ${AFSCP_BASE_URL}"
  RELEASE_USER_STORY_AFSCP_LOCAL_RUNTIME_OWNED=1
  with_release_user_story_afscp_runtime_env stop_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}" >/dev/null 2>&1 || true
  with_release_user_story_afscp_runtime_env reset_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}"
  with_release_user_story_afscp_runtime_env ensure_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}"
}

stop_release_user_story_afscp_local_runtime() {
  if [[ "${RELEASE_USER_STORY_AFSCP_LOCAL_RUNTIME_OWNED}" != "1" ]]; then
    return 0
  fi
  with_release_user_story_afscp_runtime_env stop_afscp_local_runtime_for_gate "${INTEGRATION_AFSCP_DIR}"
}

if [[ -z "${PRESET_ENDPOINT_API_KEY_VALUE}" ]]; then
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

ASBCP_KUBECONFIG_PATH=""
ensure_release_user_story_kubernetes_context

if [[ "${RESET_FIRST}" == "1" ]]; then
  info "running clean reset"
  BACKEND_REAL_RESET_KUBE_CONTEXT="${KIND_CONTEXT_NAME}" \
  BACKEND_REAL_RESET_KUBE_NAMESPACE="${K8S_NAMESPACE}" \
    bash "${ROOT_DIR}/scripts/backend-real-reset.sh"
fi

ensure_backend_real_state
INTEGRATION_DIR="$(backend_real_tmp_file integration-release-user-story)"
INTEGRATION_AFSCP_DIR="${INTEGRATION_AFSCP_DIR:-${INTEGRATION_DIR}/afscp}"
ASBCP_LOG="$(backend_real_resolve_runtime_path "${INTEGRATION_ASBCP_LOG:-${INTEGRATION_DIR}/asbcp.log}")"
CONFIG_PATH="$(backend_real_resolve_runtime_path "${INTEGRATION_ASBCP_CONFIG:-${INTEGRATION_DIR}/asbcp-config.yaml}")"
ASBCP_STATE_FILE="$(backend_real_resolve_runtime_path "${INTEGRATION_ASBCP_STATE_FILE:-${INTEGRATION_DIR}/asbcp-control.env}")"
CONTROL_SCRIPT="${ROOT_DIR}/scripts/lib/internal-sandbox-real-control.sh"
mkdir -p "${INTEGRATION_DIR}" "${INTEGRATION_AFSCP_DIR}" "$(dirname "${ASBCP_LOG}")" "$(dirname "${CONFIG_PATH}")" "$(dirname "${ASBCP_STATE_FILE}")"

if [[ "${BUILD_RUNNER_IMAGE}" == "1" ]]; then
  if release_user_story_runner_image_reuse_ready; then
    info "reusing parent-verified runner image digest for ${RUNNER_IMAGE}"
  else
    info "building internal runner image ${RUNNER_IMAGE}"
    build_runner_image "${RUNNER_KIND}" "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY_VALUE}" "1" "1" "${ROOT_DIR}"
  fi
elif ! docker image inspect "${RUNNER_IMAGE}" >/dev/null 2>&1; then
  echo "[integration-release-user-story] runner image not found: ${RUNNER_IMAGE}" >&2
  exit 1
fi

RELEASE_USER_STORY_AFSCP_LOCAL_RUNTIME_OWNED=0
cleanup() {
  local cleanup_status=0
  INTERNAL_SANDBOX_REAL_STATE_FILE="${ASBCP_STATE_FILE}" bash "${CONTROL_SCRIPT}" stop-asbcp >/dev/null 2>&1 || true
  if [[ "${RELEASE_USER_STORY_AFSCP_LOCAL_RUNTIME_OWNED}" == "1" ]]; then
    if ! stop_release_user_story_afscp_local_runtime; then
      cleanup_status=1
      echo "[integration-release-user-story] cleanup warning: AFSCP local runtime stop failed" >&2
    fi
  fi
  return "${cleanup_status}"
}
trap cleanup EXIT

ensure_kind_image() {
  local image="$1"
  local tarball
  ensure_local_image "${image}"
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
  release_user_story_require_target_kind_context "AFSCP storage CSI reconciliation" \
    || exit 1
  info "reconciling AFSCP storage CSI driver ${CSI_DRIVER}"
  local csi_manifest="${AFSCP_STORAGE_CSI_MANIFEST_PATH}"
  if [[ ! -f "${csi_manifest}" ]]; then
    csi_manifest="https://raw.githubusercontent.com/juicedata/juicefs-csi-driver/master/deploy/k8s.yaml"
  fi
  kubectl apply --validate=false -f "${csi_manifest}" >/dev/null

  info "loading images into kind cluster ${KIND_CLUSTER_NAME}"
  ensure_local_image "${AFSCP_STORAGE_CSI_MOUNT_IMAGE}"
  ensure_kind_image "${RUNNER_IMAGE}"
  ensure_kind_image "juicedata/juicefs-csi-driver:${AFSCP_STORAGE_CSI_VERSION}"
  ensure_kind_image "juicedata/csi-dashboard:${AFSCP_STORAGE_CSI_VERSION}"
  ensure_kind_image "${AFSCP_STORAGE_CSI_MOUNT_IMAGE}"
  ensure_kind_image "registry.k8s.io/sig-storage/csi-provisioner:v3.6.0"
  ensure_kind_image "registry.k8s.io/sig-storage/csi-resizer:v1.9.0"
  ensure_kind_image "registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0"
  ensure_kind_image "registry.k8s.io/sig-storage/livenessprobe:v2.11.0"

  kubectl scale statefulset/juicefs-csi-controller -n "${AFSCP_STORAGE_CSI_NAMESPACE}" --replicas=1 >/dev/null || true
  kubectl delete pod -n "${AFSCP_STORAGE_CSI_NAMESPACE}" -l app=juicefs-csi-controller >/dev/null 2>&1 || true
  kubectl delete pod -n "${AFSCP_STORAGE_CSI_NAMESPACE}" -l app=juicefs-csi-node >/dev/null 2>&1 || true

  wait_for_afscp_storage_csi_ready "${AFSCP_STORAGE_CSI_NAMESPACE}"
}

ensure_release_user_story_integration_deps_for_afscp
ensure_release_user_story_kubernetes_context
ensure_afscp_storage_csi
ensure_release_user_story_afscp_local_runtime
release_user_story_require_target_kind_context "sandbox namespace reconciliation" \
  || exit 1
ensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"

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
AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT:-http://$(k8s_external_minio_fqdn "${K8S_NAMESPACE}"):9000}"

EXTERNAL_DEPS_MANIFEST="${INTEGRATION_DIR}/external-dependencies.yaml"
render_k8s_external_dependency_services \
  "${EXTERNAL_DEPS_MANIFEST}" \
  "${K8S_NAMESPACE}" \
  "${KIND_GATEWAY}" \
  "${INTEGRATION_POSTGRES_PORT}" \
  "${KIND_GATEWAY}" \
  "${INTEGRATION_MINIO_API_PORT}"
release_user_story_require_target_kind_context "external dependency service apply" \
  || exit 1
kubectl apply -f "${EXTERNAL_DEPS_MANIFEST}" >/dev/null

cat > "${CONFIG_PATH}" <<EOF
version: 1

server:
  httpPort: ${ASBCP_PORT}

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

buffer:
  capacity: 10000
EOF

cat > "${ASBCP_STATE_FILE}" <<EOF
ROOT_DIR="${ROOT_DIR}"
INTERNAL_REAL_DIR="${INTEGRATION_DIR}"
ASBCP_IMAGE="${ASBCP_IMAGE:-}"
ASBCP_IMAGE_LOCK_PATH="${ASBCP_IMAGE_LOCK_PATH:-${ROOT_DIR}/infra/deploy/shared/asbcp-image.lock}"
ASBCP_CONFIG_PATH="${CONFIG_PATH}"
ASBCP_PORT="${ASBCP_PORT}"
ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL_VALUE}"
ASBCP_SERVICE_KEY_FINGERPRINT="$(release_user_story_secret_fingerprint "${ASBCP_SERVICE_KEY_VALUE}")"
ASBCP_LOG="${ASBCP_LOG}"
K8S_NAMESPACE="${K8S_NAMESPACE}"
AFSCP_INTERNAL_BASE_URL="${AFSCP_INTERNAL_BASE_URL_VALUE}"
AFSCP_ORCHESTRATOR_TOKEN_FINGERPRINT="$(release_user_story_secret_fingerprint "${AFSCP_ORCHESTRATOR_TOKEN_VALUE}")"
AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE_VALUE}"
AFSCP_ACTOR_TYPE="${AFSCP_ACTOR_TYPE_VALUE}"
AFSCP_ACTOR_ID="${AFSCP_ACTOR_ID_VALUE}"
KUBECONFIG="${ASBCP_KUBECONFIG_PATH}"
EOF

info "starting ASBCP from locked image"
INTERNAL_SANDBOX_REAL_STATE_FILE="${ASBCP_STATE_FILE}" ASBCP_SERVICE_KEY_VALUE="${ASBCP_SERVICE_KEY_VALUE}" AFSCP_ORCHESTRATOR_TOKEN="${AFSCP_ORCHESTRATOR_TOKEN_VALUE}" bash "${CONTROL_SCRIPT}" start-asbcp

info "running full integration release user story"
(
  cd "${ROOT_DIR}" && \
    PRESET_ENDPOINT_API_KEY="${PRESET_ENDPOINT_API_KEY_VALUE}" \
    BACKEND_REAL_ANTHROPIC_BASE_URL="${BACKEND_REAL_ANTHROPIC_BASE_URL_VALUE}" \
    BACKEND_REAL_OPENAI_BASE_URL="${BACKEND_REAL_OPENAI_BASE_URL_VALUE}" \
    BACKEND_REAL_MODEL="${BACKEND_REAL_MODEL_VALUE}" \
    ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL_VALUE}" \
    ASBCP_SERVICE_KEY="${ASBCP_SERVICE_KEY_VALUE}" \
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
    AFSCP_EXPORT_GATEWAY_BASE_URL="${AFSCP_EXPORT_GATEWAY_BASE_URL}" \
    AFSCP_DEFAULT_VOLUME_ID="${AFSCP_DEFAULT_VOLUME_ID}" \
    AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE}" \
    AFSCP_SERVICE_TOKEN="${AFSCP_SERVICE_TOKEN}" \
    AFSCP_BOOTSTRAP_CALLER_SERVICE="${AFSCP_BOOTSTRAP_CALLER_SERVICE}" \
    AFSCP_BOOTSTRAP_SERVICE_TOKEN="${AFSCP_BOOTSTRAP_SERVICE_TOKEN}" \
    AFSCP_ORCHESTRATOR_CALLER_SERVICE="${AFSCP_ORCHESTRATOR_CALLER_SERVICE}" \
    AFSCP_ORCHESTRATOR_SERVICE_TOKEN="${AFSCP_ORCHESTRATOR_SERVICE_TOKEN}" \
    AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE}" \
    INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
    AGENT_EXECUTION_WS_BASE_URL="${AGENT_EXECUTION_WS_BASE_URL_VALUE}" \
    UX_TRACE_OUTPUT_ROOT="${ARTIFACT_DIR}/ux-traces" \
    INTEGRATION_AFSCP_LOCAL_RUNTIME=0 \
    POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}" \
    MONGO_PORT="${INTEGRATION_MONGO_PORT}" \
    MONGO_URL="${MONGO_URL}" \
    MONGO_DB_NAME="${MONGO_DB_NAME}" \
    REDIS_PORT="${INTEGRATION_REDIS_PORT}" \
    MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}" \
    MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT}" \
    KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT}" \
    INTEGRATION_API_PORT="${API_PORT}" \
    INTEGRATION_POSTGRES_PORT="${INTEGRATION_POSTGRES_PORT}" \
    INTEGRATION_MONGO_PORT="${INTEGRATION_MONGO_PORT}" \
    INTEGRATION_REDIS_PORT="${INTEGRATION_REDIS_PORT}" \
    INTEGRATION_MINIO_API_PORT="${INTEGRATION_MINIO_API_PORT}" \
    INTEGRATION_MINIO_CONSOLE_PORT="${INTEGRATION_MINIO_CONSOLE_PORT}" \
    INTEGRATION_KEYCLOAK_PORT="${INTEGRATION_KEYCLOAK_PORT}" \
    INTEGRATION_WEB_PORT="${WEB_PORT}" \
    bash scripts/run-integration-e2e-full.sh e2e/integration-release-user-story.spec.ts
)

info "integration release user story passed"
