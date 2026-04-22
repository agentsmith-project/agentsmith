#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "demo-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
source "${ROOT_DIR}/scripts/lib/common.sh"
source "${ROOT_DIR}/scripts/lib/k8s-external-services.sh"
source "${ROOT_DIR}/scripts/substrate/deploy-common.sh"
source "${ROOT_DIR}/scripts/app/deploy-common.sh"

APP_IMAGE="$(awk -F= '$1=="agentsmith_app_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
CHAT_RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_chat_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
SANDBOX_MANAGER_IMAGE="$(awk -F= '$1=="sandbox_manager_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
UNIVERSAL_PROXY_IMAGE="$(awk -F= '$1=="llm_universal_proxy_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
KIND_CLUSTER_NAME="${KIND_CLUSTER_NAME:-${LOCAL_KIND_CLUSTER_NAME:-agentsmith}}"
KIND_CONTEXT="kind-${KIND_CLUSTER_NAME}"
KIND_CONFIG_PATH="${RELEASE_ROOT}/kind/config.yaml"
DEMO_KIND_KUBECONFIG_PATH="${DEMO_KIND_KUBECONFIG_PATH:-${DEMO_DEPLOY_ROOT}/config/${KIND_CONTEXT}.kubeconfig}"

ensure_demo_kind_cluster() {
  LOCAL_KIND_BIN="${KIND_BIN}" \
  LOCAL_KIND_KUBECTL_BIN="${KUBECTL_BIN}" \
  LOCAL_KIND_RELEASE_ROOT="${RELEASE_ROOT}" \
  LOCAL_KIND_STATE_ROOT="${DEMO_DEPLOY_ROOT}/state/local-kind" \
  LOCAL_KIND_FINAL_KUBECONFIG_PATH="${DEMO_KIND_KUBECONFIG_PATH}" \
  bash "${ROOT_DIR}/scripts/ensure-local-kind-cluster.sh" \
    "${KIND_CLUSTER_NAME}" \
    "${KIND_CONFIG_PATH}" \
    "${KIND_CLUSTER_NAME}-control-plane"
}

image_tar_name() {
  printf '%s' "$1" | tr '/:@' '---'
}

demo_kind_preload_platform() {
  printf '%s\n' "${DEMO_KIND_PRELOAD_PLATFORM:-${BUNDLE_PLATFORM:-linux/amd64}}"
}

release_bundle_includes_bundled_image_archives() {
  local bundled_archives_included=""
  if [[ -f "${RELEASE_ROOT}/VERSION" ]]; then
    bundled_archives_included="$(awk -F= '$1=="bundled_image_archives_included"{print $2}' "${RELEASE_ROOT}/VERSION")"
  fi
  if [[ -n "${bundled_archives_included}" ]]; then
    [[ "${bundled_archives_included}" != "0" ]]
    return
  fi
  [[ "${SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION:-0}" != "1" ]]
}

load_demo_bundled_images() {
  if [[ "${SKIP_BUNDLED_IMAGE_LOAD:-0}" == "1" ]]; then
    log "skipping bundled image reload because SKIP_BUNDLED_IMAGE_LOAD=1"
    return 0
  fi
  if ! release_bundle_includes_bundled_image_archives; then
    die "release bundle omits bundled image archives; rerun with SKIP_BUNDLED_IMAGE_LOAD=1 and local images available"
  fi
  local tar_file
  local -a image_archives=()
  shopt -s nullglob
  image_archives=("${RELEASE_ROOT}"/images/*.tar)
  shopt -u nullglob
  (( ${#image_archives[@]} > 0 )) || die "no image archives found under ${RELEASE_ROOT}/images"
  for tar_file in "${image_archives[@]}"; do
    log "loading $(basename "${tar_file}")"
    docker load -i "${tar_file}" >/dev/null
  done
}

load_demo_kind_image_from_local_archive() {
  local image="$1"
  local archive_path=""
  local archive_platform
  archive_platform="$(demo_kind_preload_platform)"

  archive_path="$(mktemp "${TMPDIR:-/tmp}/demo-kind-image.XXXXXX.tar")"
  if ! docker save --platform "${archive_platform}" "${image}" -o "${archive_path}"; then
    rm -f "${archive_path}"
    return 1
  fi
  if ! kind load image-archive "${archive_path}" --name "${KIND_CLUSTER_NAME}" >/dev/null; then
    local status=$?
    rm -f "${archive_path}"
    return "${status}"
  fi
  rm -f "${archive_path}"
}

load_demo_kind_image_from_local_image() {
  local image="$1"
  local direct_load_error_file=""
  local direct_load_error=""
  local archive_platform
  archive_platform="$(demo_kind_preload_platform)"

  docker image inspect "${image}" >/dev/null 2>&1 || die "missing local image for demo kind preload: ${image}"

  direct_load_error_file="$(mktemp "${TMPDIR:-/tmp}/demo-kind-direct-load.XXXXXX.log")"
  if kind load docker-image "${image}" --name "${KIND_CLUSTER_NAME}" >/dev/null 2>"${direct_load_error_file}"; then
    rm -f "${direct_load_error_file}"
    return 0
  fi

  direct_load_error="$(tr '\n' ' ' < "${direct_load_error_file}" | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
  rm -f "${direct_load_error_file}"
  if [[ -n "${direct_load_error}" ]]; then
    log "kind load docker-image failed for ${image}; retrying with temporary ${archive_platform} archive (${direct_load_error})"
  else
    log "kind load docker-image failed for ${image}; retrying with temporary ${archive_platform} archive"
  fi
  load_demo_kind_image_from_local_archive "${image}"
}

load_demo_kind_images() {
  local image archive_path
  local juicefs_csi_version="${JUICEFS_CSI_VERSION:-v0.31.3}"
  local -a kind_images=(
    "${RUNNER_IMAGE}"
    "${CHAT_RUNNER_IMAGE}"
    "${SANDBOX_MANAGER_IMAGE}"
    "juicedata/juicefs-csi-driver:${juicefs_csi_version}"
    "juicedata/csi-dashboard:${juicefs_csi_version}"
    "juicedata/mount:ce-v1.3.1"
    "registry.k8s.io/sig-storage/csi-provisioner:v3.6.0"
    "registry.k8s.io/sig-storage/csi-resizer:v1.9.0"
    "registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0"
    "registry.k8s.io/sig-storage/livenessprobe:v2.11.0"
  )

  if release_bundle_includes_bundled_image_archives; then
    for image in "${kind_images[@]}"; do
      archive_path="${RELEASE_ROOT}/images/$(image_tar_name "${image}").tar"
      [[ -f "${archive_path}" ]] || die "missing kind image archive: ${archive_path}"
      kind load image-archive "${archive_path}" --name "${KIND_CLUSTER_NAME}" >/dev/null
    done
    return 0
  fi

  for image in "${kind_images[@]}"; do
    load_demo_kind_image_from_local_image "${image}"
  done
}

kind_cluster_incompatible_with_demo_full() {
  kind get clusters 2>/dev/null | grep -qx "${KIND_CLUSTER_NAME}" || return 1
  local sandbox_node_port="30080"
  local conflicting_services
  conflicting_services="$(
    kubectl --context "${KIND_CONTEXT}" get svc -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"\t"}{.metadata.name}{"\t"}{range .spec.ports[*]}{.nodePort}{" "}{end}{"\n"}{end}' 2>/dev/null \
      | awk -v port="${sandbox_node_port}" 'NF >= 3 && $3 ~ ("(^| )" port "( |$)") && !($1 == "agentsmith-sandbox" && $2 == "sandbox-manager-nodeport") { print $1 "/" $2 }'
  )"
  [[ -n "${conflicting_services}" ]] || return 1
  log "demo full mode found conflicting kind services on nodePort ${sandbox_node_port}: ${conflicting_services//$'\n'/, }"
  return 0
}

recreate_kind_cluster_for_demo() {
  local reason="$1"
  log "recreating kind cluster for demo full mode: ${reason}"
  kind delete cluster --name "${KIND_CLUSTER_NAME}" >/dev/null || true
  sleep 2
  ensure_demo_kind_cluster
}

ensure_demo_external_runner_slot_available() {
  if ! docker ps -a --format '{{.Names}}' | grep -qx "${DEMO_EXTERNAL_RUNNER_CONTAINER_NAME}"; then
    return 0
  fi

  log "removing pre-existing external-runner container ${DEMO_EXTERNAL_RUNNER_CONTAINER_NAME} so demo deploy can recreate it deterministically"
  docker rm -f "${DEMO_EXTERNAL_RUNNER_CONTAINER_NAME}" >/dev/null 2>&1 || true
}

main() {
  ensure_dirs
  ensure_operator_site_env
  set -a
  # shellcheck disable=SC1090
  source "${RELEASE_ROOT}/env/site.env"
  set +a
  DEMO_DEPLOY_MODE="$(demo_deploy_mode)"
  HOST_LOCAL_WEB_BASE_URL="${HOST_LOCAL_WEB_BASE_URL:-http://127.0.0.1:${WEB_PORT:-3001}}"
  HOST_LOCAL_KEYCLOAK_BASE_URL="${HOST_LOCAL_KEYCLOAK_BASE_URL:-http://127.0.0.1:${KEYCLOAK_PORT:-18080}}"
  DEMO_COMPOSE_PROJECT_NAME="${DEMO_COMPOSE_PROJECT_NAME:-agentsmith-demo}"
  DEMO_EXTERNAL_RUNNER_CONTAINER_NAME="${EXTERNAL_RUNNER_CONTAINER_NAME:-${DEMO_COMPOSE_PROJECT_NAME}-external-runner-1}"

  write_compose_env "${APP_IMAGE}" "${RUNNER_IMAGE}" "${UNIVERSAL_PROXY_IMAGE}"

  mkdir -p "${DEMO_DEPLOY_ROOT}/releases"
  ln -sfn "${RELEASE_ROOT}" "${CURRENT_LINK}"

  load_demo_bundled_images

  if demo_mode_is_full; then
  ensure_demo_kind_cluster
  export KUBECONFIG="${DEMO_KIND_KUBECONFIG_PATH}"
  if kind_cluster_incompatible_with_demo_full; then
    recreate_kind_cluster_for_demo "found ingress-nginx full-auto prereqs that reserve the demo sandbox node port"
    export KUBECONFIG="${DEMO_KIND_KUBECONFIG_PATH}"
  fi
  bash "${ROOT_DIR}/scripts/cluster-deploy/apply-kind-dns.sh"

  load_demo_kind_images

  kubectl apply -f "${RELEASE_ROOT}/k8s/juicefs-csi.yaml" >/dev/null
  kubectl rollout restart statefulset/juicefs-csi-controller -n kube-system >/dev/null
  kubectl rollout restart daemonset/juicefs-csi-node -n kube-system >/dev/null
  kubectl rollout restart deployment/juicefs-csi-dashboard -n kube-system >/dev/null
  kubectl delete pod -n kube-system juicefs-csi-controller-0 --ignore-not-found --wait=false >/dev/null
  kubectl rollout status statefulset/juicefs-csi-controller -n kube-system --timeout=240s >/dev/null
  kubectl rollout status daemonset/juicefs-csi-node -n kube-system --timeout=240s >/dev/null
  kubectl rollout status deployment/juicefs-csi-dashboard -n kube-system --timeout=240s >/dev/null
fi

rm -f "${RELEASE_ROOT}/env/runtime-addresses.env"
bash "${RELEASE_SCRIPT_DIR}/resolve-runtime-addresses.sh"
bash "${RELEASE_SCRIPT_DIR}/render-env.sh"
load_release_env

release_substrate_up
ensure_demo_external_runner_slot_available
release_app_up
wait_http "${HOST_LOCAL_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" 240
wait_tcp "127.0.0.1" "${API_PORT}" 240
wait_http "${HOST_LOCAL_WEB_BASE_URL}/api/public/workspaces" 240

set -a
source "${RELEASE_ROOT}/env/runtime-addresses.env"
set +a

if demo_mode_is_full; then
  kubectl create namespace "${INTERNAL_AGENT_K8S_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null

  ensure_kind_nodes_on_network "${EXTERNAL_DEPS_NETWORK_NAME:-agentsmith-demo-deps}" "${KIND_CLUSTER_NAME}"
  JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT="${JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT:-http://$(k8s_external_minio_fqdn "${INTERNAL_AGENT_K8S_NAMESPACE}"):9000}"

  KIND_POSTGRES_TARGET_IP="${EXTERNAL_DEPS_POSTGRES_IP:-172.29.0.10}"
  KIND_MINIO_TARGET_IP="${EXTERNAL_DEPS_MINIO_IP:-172.29.0.11}"

  EXTERNAL_DEPS_MANIFEST="${DEMO_DEPLOY_ROOT}/state/internal-external-services.yaml"
  render_k8s_external_dependency_services \
    "${EXTERNAL_DEPS_MANIFEST}" \
    "${INTERNAL_AGENT_K8S_NAMESPACE}" \
    "${KIND_POSTGRES_TARGET_IP}" \
    5432 \
    "${KIND_MINIO_TARGET_IP}" \
    9000
  kubectl apply -f "${EXTERNAL_DEPS_MANIFEST}" >/dev/null

  cat > "${DEMO_DEPLOY_ROOT}/state/sandbox-manager.yaml" <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: agentsmith-sandbox
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sandbox-manager
  namespace: agentsmith-sandbox
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: sandbox-manager
  namespace: agentsmith-sandbox
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/status", "pods/exec", "persistentvolumeclaims", "secrets", "events"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: sandbox-manager
  namespace: agentsmith-sandbox
subjects:
  - kind: ServiceAccount
    name: sandbox-manager
    namespace: agentsmith-sandbox
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: sandbox-manager
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: sandbox-manager-pv
rules:
  - apiGroups: [""]
    resources: ["persistentvolumes"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: sandbox-manager-pv
subjects:
  - kind: ServiceAccount
    name: sandbox-manager
    namespace: agentsmith-sandbox
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: sandbox-manager-pv
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: sandbox-manager-config
  namespace: agentsmith-sandbox
data:
  manager-config.yaml: |
    version: 1
    server:
      httpPort: 8080
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
      debug:
        configPath: /debug/config
        enablePprof: false
    auth:
      headerName: X-Service-Key
    kubernetes:
      qps: 50
      burst: 100
      requestTimeout: 15s
    sandbox:
      defaults:
        namespace: agentsmith-sandbox
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sandbox-manager
  namespace: agentsmith-sandbox
spec:
  replicas: 1
  selector:
    matchLabels:
      app: sandbox-manager
  template:
    metadata:
      labels:
        app: sandbox-manager
    spec:
      serviceAccountName: sandbox-manager
      containers:
        - name: manager
          image: ${SANDBOX_MANAGER_IMAGE}
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8080
          env:
            - name: CONFIG_PATH
              value: /etc/sandbox-manager/manager-config.yaml
            - name: SERVICE_KEYS
              value: agentsmith-sandbox-key
            - name: K8S_NAMESPACE
              value: agentsmith-sandbox
            - name: JUICEFS_CSI_DRIVER
              value: csi.juicefs.com
            - name: JUICEFS_STORAGE_CAPACITY
              value: 1Pi
            - name: JUICEFS_STORAGE_CLASS_NAME
              value: ""
            - name: JUICEFS_MOUNT_OPTIONS
              value: ${INTERNAL_AGENT_JUICEFS_MOUNT_OPTIONS}
            - name: JUICEFS_MOUNT_IMAGE
              value: juicedata/mount:ce-v1.3.1
            - name: JUICEFS_STORAGE_ENDPOINT
              value: ${JUICEFS_BUCKET_ENDPOINT_FOR_INTERNAL_MOUNT}
            - name: JUICEFS_STORAGE_ACCESS_KEY
              value: mbos
            - name: JUICEFS_STORAGE_SECRET_KEY
              value: mbos_dev_password
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8080
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
          volumeMounts:
            - name: config
              mountPath: /etc/sandbox-manager/manager-config.yaml
              subPath: manager-config.yaml
      volumes:
        - name: config
          configMap:
            name: sandbox-manager-config
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sandbox-manager-cleaner
  namespace: agentsmith-sandbox
spec:
  schedule: "*/1 * * * *"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 1
  failedJobsHistoryLimit: 1
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: sandbox-manager
          restartPolicy: Never
          containers:
            - name: cleaner
              image: ${SANDBOX_MANAGER_IMAGE}
              imagePullPolicy: IfNotPresent
              command:
                - /cleaner
                - --namespace=agentsmith-sandbox
                - --dry-run=false
                - --log-level=info
              resources:
                requests:
                  cpu: 100m
                  memory: 128Mi
                limits:
                  cpu: 500m
                  memory: 512Mi
---
apiVersion: v1
kind: Service
metadata:
  name: sandbox-manager
  namespace: agentsmith-sandbox
spec:
  selector:
    app: sandbox-manager
  ports:
    - name: http
      port: 80
      targetPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: sandbox-manager-nodeport
  namespace: agentsmith-sandbox
spec:
  type: NodePort
  selector:
    app: sandbox-manager
  ports:
    - name: http
      port: 80
      targetPort: 8080
      nodePort: 30080
EOF

  kubectl apply -f "${DEMO_DEPLOY_ROOT}/state/sandbox-manager.yaml" >/dev/null
  kubectl rollout status deployment/sandbox-manager -n agentsmith-sandbox --timeout=240s >/dev/null
  wait_tcp "127.0.0.1" "${SANDBOX_HOST_PORT:-29180}" 240
  wait_http "http://localhost:${SANDBOX_HOST_PORT:-29180}/readyz" 240

  ensure_demo_external_runner_slot_available
  release_app_up
  wait_tcp "127.0.0.1" "${API_PORT}" 240
  wait_http "${HOST_LOCAL_WEB_BASE_URL}/api/public/workspaces" 240
  fi

  state_set release.phase deploy_completed
  state_set release.id "${RELEASE_ID}"
  state_set deploy.mode "${DEMO_DEPLOY_MODE}"
  if demo_mode_is_full; then
  state_set kind.cluster agentsmith
  state_set sandbox.url "http://localhost:${SANDBOX_HOST_PORT:-29180}"
  else
  state_set kind.cluster skipped
  state_set sandbox.url skipped
  fi
  log "deploy ok"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
