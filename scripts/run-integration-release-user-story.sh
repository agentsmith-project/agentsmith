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
SANDBOX_PORT="${INTERNAL_SANDBOX_MANAGER_PORT:-28080}"
SANDBOX_MANAGER_URL_VALUE="${SANDBOX_MANAGER_URL:-http://127.0.0.1:${SANDBOX_PORT}}"
SANDBOX_SERVICE_KEY_VALUE="${SANDBOX_SERVICE_KEY:-agentsmith-internal-test-key}"
K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-agentsmith-sandbox}"
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

run_release_user_story_clean_env() {
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY "$@"
}

release_user_story_runner_image_id() {
  docker image inspect --format '{{.Id}}' "${RUNNER_IMAGE}" 2>/dev/null | head -n1 || true
}

release_user_story_cluster_uid() {
  kubectl --context "${KIND_CONTEXT_NAME}" get namespace kube-system -o jsonpath='{.metadata.uid}' 2>/dev/null || true
}

release_user_story_runner_image_reuse_ready() {
  local runner_image_id
  runner_image_id="$(release_user_story_runner_image_id)"
  [[ -n "${runner_image_id}" ]] || return 1

  readiness_state_field_ready_with_identity runner_image_digest_prepared \
    "runner_image_ref=${RUNNER_IMAGE}" \
    "runner_image_id=${runner_image_id}"
}

release_user_story_local_kind_image_import_reuse_ready() {
  local cluster_uid
  local runner_image_id
  cluster_uid="$(release_user_story_cluster_uid)"
  runner_image_id="$(release_user_story_runner_image_id)"
  [[ -n "${cluster_uid}" && -n "${runner_image_id}" ]] || return 1

  readiness_state_field_ready_with_identity local_kind_image_import_completed \
    "local_kind_context=${KIND_CONTEXT_NAME}" \
    "local_kind_cluster_uid=${cluster_uid}" \
    "runner_image_ref=${RUNNER_IMAGE}" \
    "runner_image_id=${runner_image_id}"
}

ensure_release_user_story_integration_deps_for_afscp() {
  info "ensuring local integration dependencies for AFSCP"
  if readiness_state_field_ready integration_deps_ready; then
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
INTEGRATION_AFSCP_DIR="${INTEGRATION_AFSCP_DIR:-${INTEGRATION_DIR}/afscp}"
SANDBOX_LOG="$(backend_real_resolve_runtime_path "${INTEGRATION_SANDBOX_LOG:-${INTEGRATION_DIR}/sandbox-manager.log}")"
CONFIG_PATH="$(backend_real_resolve_runtime_path "${INTEGRATION_SANDBOX_CONFIG:-${INTEGRATION_DIR}/sandbox-manager.yaml}")"
mkdir -p "${INTEGRATION_DIR}" "${INTEGRATION_AFSCP_DIR}" "$(dirname "${SANDBOX_LOG}")" "$(dirname "${CONFIG_PATH}")"

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

CONTEXT_NAME="$(kubectl config current-context 2>/dev/null || true)"
KIND_CLUSTER_NAME="$(
  kind_cluster_name_from_context_or_override \
    "${INTERNAL_AGENT_KIND_CLUSTER_NAME:-}" \
    "${CONTEXT_NAME}"
)"
KIND_CONTEXT_NAME="kind-${KIND_CLUSTER_NAME}"
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
  info "reconciling AFSCP storage CSI driver ${CSI_DRIVER}"
  local csi_manifest="${AFSCP_STORAGE_CSI_MANIFEST_PATH}"
  if [[ ! -f "${csi_manifest}" ]]; then
    csi_manifest="https://raw.githubusercontent.com/juicedata/juicefs-csi-driver/master/deploy/k8s.yaml"
  fi
  kubectl apply --validate=false -f "${csi_manifest}" >/dev/null

  if [[ "${CONTEXT_NAME}" == kind-* ]]; then
    if release_user_story_local_kind_image_import_reuse_ready; then
      info "reusing parent-verified kind image imports for ${KIND_CONTEXT_NAME}"
      if wait_for_afscp_storage_csi_ready "${AFSCP_STORAGE_CSI_NAMESPACE}"; then
        return 0
      fi
      info "parent-verified CSI readiness no longer matches live cluster; reloading kind images"
    fi

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
  fi

  wait_for_afscp_storage_csi_ready "${AFSCP_STORAGE_CSI_NAMESPACE}"
}

ensure_agentsmith_owned_namespace "${K8S_NAMESPACE}"

ensure_afscp_storage_csi

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
  endpoint: localhost:${INTEGRATION_MINIO_API_PORT}
  accessKey: ${MINIO_ACCESS_KEY:-mbos}
  secretKey: ${MINIO_SECRET_KEY:-mbos_dev_password}
  bucket: ${MINIO_BUCKET:-mbos-dev}
  useSSL: false

buffer:
  capacity: 10000
EOF

SANDBOX_PID=""
RELEASE_USER_STORY_AFSCP_LOCAL_RUNTIME_OWNED=0
cleanup() {
  local cleanup_status=0
  if [[ -n "${SANDBOX_PID}" ]] && kill -0 "${SANDBOX_PID}" >/dev/null 2>&1; then
    kill "${SANDBOX_PID}" >/dev/null 2>&1 || true
    wait "${SANDBOX_PID}" >/dev/null 2>&1 || true
  fi
  if [[ "${RELEASE_USER_STORY_AFSCP_LOCAL_RUNTIME_OWNED}" == "1" ]]; then
    if ! stop_release_user_story_afscp_local_runtime; then
      cleanup_status=1
      echo "[integration-release-user-story] cleanup warning: AFSCP local runtime stop failed" >&2
    fi
  fi
  return "${cleanup_status}"
}
trap cleanup EXIT

ensure_release_user_story_integration_deps_for_afscp
ensure_release_user_story_afscp_local_runtime

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
    AFSCP_INTERNAL_BASE_URL="${AFSCP_INTERNAL_BASE_URL_VALUE}" \
    AFSCP_ORCHESTRATOR_TOKEN="${AFSCP_ORCHESTRATOR_TOKEN_VALUE}" \
    AFSCP_CALLER_SERVICE="${AFSCP_CALLER_SERVICE_VALUE}" \
    AFSCP_ACTOR_TYPE="${AFSCP_ACTOR_TYPE_VALUE}" \
    AFSCP_ACTOR_ID="${AFSCP_ACTOR_ID_VALUE}" \
    JUICEFS_CSI_DRIVER="${CSI_DRIVER}" \
    JUICEFS_STORAGE_CAPACITY="${STORAGE_CAPACITY}" \
    JUICEFS_STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME}" \
    JUICEFS_MOUNT_OPTIONS="${MOUNT_OPTIONS}" \
    JUICEFS_SUBDIR="${SUBDIR}" \
    JUICEFS_MOUNT_SERVICE_ACCOUNT="${MOUNT_SERVICE_ACCOUNT}" \
    JUICEFS_MOUNT_IMAGE="${MOUNT_IMAGE_OVERRIDE}" \
    JUICEFS_STORAGE_ENDPOINT="${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE}" \
    JUICEFS_STORAGE_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}" \
    JUICEFS_STORAGE_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}" \
    STORAGE_ENDPOINT="localhost:${INTEGRATION_MINIO_API_PORT}" \
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
    SANDBOX_MANAGER_URL="${SANDBOX_MANAGER_URL_VALUE}" \
    SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY_VALUE}" \
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
