#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
export DEPLOY_ROOT_DEFAULT="${CLUSTER_DEPLOY_ROOT:-${HOME}/agentsmith/cluster-deploy}"
export DEPLOY_LOG_PREFIX="${DEPLOY_LOG_PREFIX:-cluster-deploy}"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/deploy-common.sh"

CLUSTER_DEPLOY_ROOT="${DEPLOY_ROOT}"
SHARED_REGISTRY_ENV="${CLUSTER_DEPLOY_SHARED_REGISTRY_ENV:-${CONFIG_DIR}/registry.env}"
SHARED_KUBECONFIG="${CLUSTER_DEPLOY_SHARED_KUBECONFIG:-${CONFIG_DIR}/kubeconfig}"
SHARED_ADMIN_KUBECONFIG="${CLUSTER_DEPLOY_SHARED_ADMIN_KUBECONFIG:-${CONFIG_DIR}/admin-kubeconfig}"
SHARED_MANAGER_KUBECONFIG="${CLUSTER_DEPLOY_SHARED_MANAGER_KUBECONFIG:-${CONFIG_DIR}/manager-kubeconfig}"
SHARED_ADMIN_READY_ENV="${CLUSTER_DEPLOY_SHARED_ADMIN_READY_ENV:-${CONFIG_DIR}/admin-ready.env}"
ADMIN_HANDOFF_DIR="${CLUSTER_DEPLOY_ADMIN_HANDOFF_DIR:-${DEPLOY_ROOT}/admin-handoff}"
OPERATOR_CLUSTER_DIR="${ROOT_DIR}/.infra/cluster-deploy"
OPERATOR_SITE_ENV="${OPERATOR_CLUSTER_DIR}/site.env"
OPERATOR_REGISTRY_ENV="${OPERATOR_CLUSTER_DIR}/registry.env"
OPERATOR_KUBECONFIG="${OPERATOR_CLUSTER_DIR}/kubeconfig"
OPERATOR_ADMIN_KUBECONFIG="${OPERATOR_CLUSTER_DIR}/admin-kubeconfig"
OPERATOR_MANAGER_KUBECONFIG="${OPERATOR_CLUSTER_DIR}/manager-kubeconfig"
export CLUSTER_DEPLOY_ROOT SHARED_REGISTRY_ENV SHARED_KUBECONFIG SHARED_ADMIN_KUBECONFIG SHARED_MANAGER_KUBECONFIG SHARED_ADMIN_READY_ENV ADMIN_HANDOFF_DIR OPERATOR_CLUSTER_DIR OPERATOR_SITE_ENV OPERATOR_REGISTRY_ENV OPERATOR_KUBECONFIG OPERATOR_ADMIN_KUBECONFIG OPERATOR_MANAGER_KUBECONFIG

LOCAL_KIND_CLUSTER_NAME="${LOCAL_KIND_CLUSTER_NAME:-agentsmith}"
LOCAL_KIND_CONTEXT_NAME="kind-${LOCAL_KIND_CLUSTER_NAME}"
LOCAL_KIND_KUBECONFIG="${LOCAL_KIND_KUBECONFIG:-${CLUSTER_DEPLOY_ROOT}/state/local-kind/${LOCAL_KIND_CONTEXT_NAME}.kubeconfig}"

ensure_cluster_deploy_shared_dirs() {
  ensure_dirs
  mkdir -p \
    "$(dirname "${SHARED_REGISTRY_ENV}")" \
    "$(dirname "${SHARED_KUBECONFIG}")" \
    "$(dirname "${SHARED_ADMIN_KUBECONFIG}")" \
    "$(dirname "${SHARED_MANAGER_KUBECONFIG}")" \
    "$(dirname "${SHARED_ADMIN_READY_ENV}")" \
    "$(dirname "${ADMIN_HANDOFF_DIR}")"
}

local_kind_kubeconfig_ready() {
  [[ -f "${LOCAL_KIND_KUBECONFIG}" ]] || return 1
  kubectl --kubeconfig "${LOCAL_KIND_KUBECONFIG}" config get-contexts "${LOCAL_KIND_CONTEXT_NAME}" >/dev/null 2>&1
}

kubeconfig_ready() {
  local kubeconfig_path="$1"
  [[ -f "${kubeconfig_path}" ]] || return 1
  kubectl --kubeconfig "${kubeconfig_path}" version --request-timeout=5s >/dev/null 2>&1
}

cluster_deploy_mode() {
  printf '%s\n' "${CLUSTER_DEPLOY_MODE:-semi-auto}"
}

require_supported_cluster_deploy_mode() {
  case "$(cluster_deploy_mode)" in
    semi-auto|full-auto) ;;
    *) die "unsupported CLUSTER_DEPLOY_MODE=$(cluster_deploy_mode); expected semi-auto or full-auto" ;;
  esac
}

ensure_operator_site_env() {
  ensure_dirs
  mkdir -p "${RELEASE_ROOT}/env"

  if [[ ! -f "${SHARED_SITE_ENV}" ]]; then
    if [[ -f "${OPERATOR_SITE_ENV}" ]]; then
      cp "${OPERATOR_SITE_ENV}" "${SHARED_SITE_ENV}"
    elif [[ -f "${CURRENT_LINK}/env/site.env" ]]; then
      cp "${CURRENT_LINK}/env/site.env" "${SHARED_SITE_ENV}"
    elif [[ -f "${RELEASE_ROOT}/env/site.env" ]]; then
      cp "${RELEASE_ROOT}/env/site.env" "${SHARED_SITE_ENV}"
    elif [[ -f "${RELEASE_ROOT}/env/site.env.example" ]]; then
      cp "${RELEASE_ROOT}/env/site.env.example" "${SHARED_SITE_ENV}"
      die "missing site.env; template copied to ${SHARED_SITE_ENV}"
    else
      die "missing site.env in operator files, shared config, and release examples"
    fi
  fi

  cp "${SHARED_SITE_ENV}" "${RELEASE_ROOT}/env/site.env"
}

ensure_operator_registry_env() {
  ensure_cluster_deploy_shared_dirs
  mkdir -p "${RELEASE_ROOT}/env"
  if [[ ! -f "${SHARED_REGISTRY_ENV}" ]]; then
    if [[ -f "${OPERATOR_REGISTRY_ENV}" ]]; then
      cp "${OPERATOR_REGISTRY_ENV}" "${SHARED_REGISTRY_ENV}"
    elif [[ -f "${RELEASE_ROOT}/env/registry.env" ]]; then
      cp "${RELEASE_ROOT}/env/registry.env" "${SHARED_REGISTRY_ENV}"
    elif [[ -f "${RELEASE_ROOT}/env/registry.env.example" ]]; then
      cp "${RELEASE_ROOT}/env/registry.env.example" "${SHARED_REGISTRY_ENV}"
      die "missing registry.env; template copied to ${SHARED_REGISTRY_ENV}"
    else
      die "missing registry.env in operator files, shared config, and release examples"
    fi
  fi
  cp "${SHARED_REGISTRY_ENV}" "${RELEASE_ROOT}/env/registry.env"
}

ensure_operator_kubeconfig() {
  ensure_cluster_deploy_shared_dirs
  mkdir -p "${RELEASE_ROOT}/env"
  if [[ ! -f "${SHARED_KUBECONFIG}" ]]; then
    if [[ -f "${OPERATOR_KUBECONFIG}" ]]; then
      cp "${OPERATOR_KUBECONFIG}" "${SHARED_KUBECONFIG}"
    elif local_kind_kubeconfig_ready; then
      cp "${LOCAL_KIND_KUBECONFIG}" "${SHARED_KUBECONFIG}"
    elif [[ -f "${RELEASE_ROOT}/env/kubeconfig" ]]; then
      cp "${RELEASE_ROOT}/env/kubeconfig" "${SHARED_KUBECONFIG}"
    elif [[ -f "${RELEASE_ROOT}/env/kubeconfig.example.yaml" ]]; then
      cp "${RELEASE_ROOT}/env/kubeconfig.example.yaml" "${SHARED_KUBECONFIG}"
      die "missing kubeconfig; template copied to ${SHARED_KUBECONFIG}"
    else
      die "missing kubeconfig in operator files, shared config, and release examples"
    fi
  fi
  cp "${SHARED_KUBECONFIG}" "${RELEASE_ROOT}/env/kubeconfig"
  export KUBECONFIG="${SHARED_KUBECONFIG}"
}

ensure_operator_admin_kubeconfig() {
  ensure_cluster_deploy_shared_dirs
  mkdir -p "${RELEASE_ROOT}/env"
  if [[ ! -f "${SHARED_ADMIN_KUBECONFIG}" ]]; then
    if [[ -f "${OPERATOR_ADMIN_KUBECONFIG}" ]]; then
      cp "${OPERATOR_ADMIN_KUBECONFIG}" "${SHARED_ADMIN_KUBECONFIG}"
    elif local_kind_kubeconfig_ready; then
      cp "${LOCAL_KIND_KUBECONFIG}" "${SHARED_ADMIN_KUBECONFIG}"
    elif [[ -f "${RELEASE_ROOT}/env/admin-kubeconfig" ]]; then
      cp "${RELEASE_ROOT}/env/admin-kubeconfig" "${SHARED_ADMIN_KUBECONFIG}"
    elif [[ -f "${RELEASE_ROOT}/env/admin-kubeconfig.example.yaml" ]]; then
      cp "${RELEASE_ROOT}/env/admin-kubeconfig.example.yaml" "${SHARED_ADMIN_KUBECONFIG}"
      die "missing admin-kubeconfig; template copied to ${SHARED_ADMIN_KUBECONFIG}"
    else
      die "missing admin-kubeconfig in operator files, shared config, and release examples"
    fi
  fi
  cp "${SHARED_ADMIN_KUBECONFIG}" "${RELEASE_ROOT}/env/admin-kubeconfig"
}

ensure_operator_manager_kubeconfig() {
  ensure_cluster_deploy_shared_dirs
  mkdir -p "${RELEASE_ROOT}/env"
  if [[ ! -f "${SHARED_MANAGER_KUBECONFIG}" ]]; then
    if [[ -f "${OPERATOR_MANAGER_KUBECONFIG}" ]]; then
      cp "${OPERATOR_MANAGER_KUBECONFIG}" "${SHARED_MANAGER_KUBECONFIG}"
    elif [[ -f "${RELEASE_ROOT}/env/manager-kubeconfig" ]]; then
      cp "${RELEASE_ROOT}/env/manager-kubeconfig" "${SHARED_MANAGER_KUBECONFIG}"
    elif [[ -f "${RELEASE_ROOT}/env/manager-kubeconfig.example.yaml" ]]; then
      cp "${RELEASE_ROOT}/env/manager-kubeconfig.example.yaml" "${SHARED_MANAGER_KUBECONFIG}"
      die "missing manager-kubeconfig; template copied to ${SHARED_MANAGER_KUBECONFIG}"
    else
      die "missing manager-kubeconfig in operator files, shared config, and release examples"
    fi
  fi
  cp "${SHARED_MANAGER_KUBECONFIG}" "${RELEASE_ROOT}/env/manager-kubeconfig"
}

load_registry_env() {
  ensure_operator_registry_env
  while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
    local line="${raw_line#"${raw_line%%[![:space:]]*}"}"
    [[ -z "${line}" || "${line}" == \#* || "${line}" != *=* ]] && continue
    local key="${line%%=*}"
    local value="${line#*=}"
        export "${key}=${value}"
      done < "${RELEASE_ROOT}/env/registry.env"
  export K8S_REGISTRY_HOST="${K8S_REGISTRY_HOST:-${REGISTRY_HOST:-}}"
  if [[ -z "${K8S_REGISTRY_HOST:-}" || "${K8S_REGISTRY_HOST}" == "${REGISTRY_HOST:-}" ]]; then
    local local_kind_registry_name="${LOCAL_KIND_REGISTRY_NAME:-kind-registry}"
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "${local_kind_registry_name}"; then
      K8S_REGISTRY_HOST="${local_kind_registry_name}:5000"
      export K8S_REGISTRY_HOST
    fi
  fi
}

load_kubeconfig() {
  ensure_operator_kubeconfig
  export KUBECONFIG="${SHARED_KUBECONFIG}"
}

load_admin_kubeconfig() {
  ensure_operator_admin_kubeconfig
  export KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}"
}

read_version_value() {
  local key="$1"
  awk -F= -v target="${key}" '$1==target{print $2}' "${RELEASE_ROOT}/VERSION"
}

release_bundle_includes_bundled_image_archives() {
  local bundled_archives_included=""
  if [[ -n "${RELEASE_ROOT:-}" && -f "${RELEASE_ROOT}/VERSION" ]]; then
    bundled_archives_included="$(read_version_value bundled_image_archives_included)"
  fi
  if [[ -n "${bundled_archives_included}" ]]; then
    [[ "${bundled_archives_included}" != "0" ]]
    return
  fi
  [[ "${SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION:-0}" != "1" ]]
}

require_version_images() {
  if [[ -z "${REGISTRY_HOST:-}" || -z "${K8S_REGISTRY_HOST:-}" ]]; then
    load_registry_env
  fi
  APP_IMAGE="$(read_version_value agentsmith_app_image)"
  RUNNER_IMAGE="$(read_version_value agentsmith_runner_image)"
  CHAT_RUNNER_IMAGE="$(read_version_value agentsmith_chat_runner_image)"
  K8S_RUNNER_IMAGE="$(read_version_value agentsmith_runner_k8s_image)"
  K8S_CHAT_RUNNER_IMAGE="$(read_version_value agentsmith_chat_runner_k8s_image)"
  SANDBOX_MANAGER_IMAGE="$(read_version_value sandbox_manager_image)"
  K8S_SANDBOX_MANAGER_IMAGE="$(read_version_value sandbox_manager_k8s_image)"
  UNIVERSAL_PROXY_IMAGE="$(read_version_value llm_universal_proxy_image)"
  VERIFY_RUNNER_IMAGE="$(read_version_value agentsmith_verify_runner_image)"
  JUICEFS_MOUNT_IMAGE="$(read_version_value juicefs_mount_image)"
  JUICEFS_CSI_DRIVER_IMAGE="$(read_version_value juicefs_csi_driver_image)"
  JUICEFS_CSI_DASHBOARD_IMAGE="$(read_version_value juicefs_csi_dashboard_image)"
  JUICEFS_CSI_PROVISIONER_IMAGE="$(read_version_value juicefs_csi_provisioner_image)"
  JUICEFS_CSI_RESIZER_IMAGE="$(read_version_value juicefs_csi_resizer_image)"
  JUICEFS_CSI_LIVENESSPROBE_IMAGE="$(read_version_value juicefs_csi_livenessprobe_image)"
  JUICEFS_CSI_NODE_REGISTRAR_IMAGE="$(read_version_value juicefs_csi_node_registrar_image)"
  INGRESS_NGINX_CONTROLLER_IMAGE="$(read_version_value ingress_nginx_controller_image)"
  INGRESS_NGINX_CERTGEN_IMAGE="$(read_version_value ingress_nginx_certgen_image)"
  local image_var image_value k8s_var_name k8s_value
  if [[ -z "${K8S_RUNNER_IMAGE}" ]]; then
    K8S_RUNNER_IMAGE="${RUNNER_IMAGE}"
  fi
  if [[ -n "${K8S_REGISTRY_HOST:-}" && -n "${REGISTRY_HOST:-}" && "${K8S_RUNNER_IMAGE}" == "${REGISTRY_HOST}/"* ]]; then
    K8S_RUNNER_IMAGE="${K8S_REGISTRY_HOST}/${K8S_RUNNER_IMAGE#${REGISTRY_HOST}/}"
  fi
  if [[ -z "${K8S_CHAT_RUNNER_IMAGE}" ]]; then
    K8S_CHAT_RUNNER_IMAGE="${CHAT_RUNNER_IMAGE}"
  fi
  if [[ -n "${K8S_REGISTRY_HOST:-}" && -n "${REGISTRY_HOST:-}" && "${K8S_CHAT_RUNNER_IMAGE}" == "${REGISTRY_HOST}/"* ]]; then
    K8S_CHAT_RUNNER_IMAGE="${K8S_REGISTRY_HOST}/${K8S_CHAT_RUNNER_IMAGE#${REGISTRY_HOST}/}"
  fi
  if [[ -z "${K8S_SANDBOX_MANAGER_IMAGE}" ]]; then
    K8S_SANDBOX_MANAGER_IMAGE="${SANDBOX_MANAGER_IMAGE}"
  fi
  if [[ -n "${K8S_REGISTRY_HOST:-}" && -n "${REGISTRY_HOST:-}" && "${K8S_SANDBOX_MANAGER_IMAGE}" == "${REGISTRY_HOST}/"* ]]; then
    K8S_SANDBOX_MANAGER_IMAGE="${K8S_REGISTRY_HOST}/${K8S_SANDBOX_MANAGER_IMAGE#${REGISTRY_HOST}/}"
  fi
  for image_var in \
    JUICEFS_MOUNT_IMAGE \
    JUICEFS_CSI_DRIVER_IMAGE \
    JUICEFS_CSI_DASHBOARD_IMAGE \
    JUICEFS_CSI_PROVISIONER_IMAGE \
    JUICEFS_CSI_RESIZER_IMAGE \
    JUICEFS_CSI_LIVENESSPROBE_IMAGE \
    JUICEFS_CSI_NODE_REGISTRAR_IMAGE \
    INGRESS_NGINX_CONTROLLER_IMAGE \
    INGRESS_NGINX_CERTGEN_IMAGE; do
    image_value="${!image_var}"
    k8s_value="${image_value}"
    if [[ -n "${K8S_REGISTRY_HOST:-}" && -n "${REGISTRY_HOST:-}" && "${image_value}" == "${REGISTRY_HOST}/"* ]]; then
      k8s_value="${K8S_REGISTRY_HOST}/${image_value#${REGISTRY_HOST}/}"
    fi
    k8s_var_name="K8S_${image_var}"
    printf -v "${k8s_var_name}" '%s' "${k8s_value}"
    export "${k8s_var_name}"
  done
  export APP_IMAGE RUNNER_IMAGE CHAT_RUNNER_IMAGE K8S_RUNNER_IMAGE K8S_CHAT_RUNNER_IMAGE SANDBOX_MANAGER_IMAGE K8S_SANDBOX_MANAGER_IMAGE UNIVERSAL_PROXY_IMAGE VERIFY_RUNNER_IMAGE JUICEFS_MOUNT_IMAGE JUICEFS_CSI_DRIVER_IMAGE JUICEFS_CSI_DASHBOARD_IMAGE JUICEFS_CSI_PROVISIONER_IMAGE JUICEFS_CSI_RESIZER_IMAGE JUICEFS_CSI_LIVENESSPROBE_IMAGE JUICEFS_CSI_NODE_REGISTRAR_IMAGE INGRESS_NGINX_CONTROLLER_IMAGE INGRESS_NGINX_CERTGEN_IMAGE K8S_JUICEFS_MOUNT_IMAGE K8S_JUICEFS_CSI_DRIVER_IMAGE K8S_JUICEFS_CSI_DASHBOARD_IMAGE K8S_JUICEFS_CSI_PROVISIONER_IMAGE K8S_JUICEFS_CSI_RESIZER_IMAGE K8S_JUICEFS_CSI_LIVENESSPROBE_IMAGE K8S_JUICEFS_CSI_NODE_REGISTRAR_IMAGE K8S_INGRESS_NGINX_CONTROLLER_IMAGE K8S_INGRESS_NGINX_CERTGEN_IMAGE
  [[ -n "${APP_IMAGE}" && -n "${RUNNER_IMAGE}" && -n "${CHAT_RUNNER_IMAGE}" && -n "${SANDBOX_MANAGER_IMAGE}" && -n "${UNIVERSAL_PROXY_IMAGE}" && -n "${VERIFY_RUNNER_IMAGE}" ]] \
    || die "VERSION is missing prebuilt image refs; rebuild bundle on the development machine with cluster:bundle"
  [[ -n "${JUICEFS_MOUNT_IMAGE}" ]] \
    || die "VERSION is missing bundled JuiceFS mount image ref; rebuild bundle on the development machine with cluster:bundle"
}

bundled_image_archives() {
  shopt -s nullglob
  local archives=("${RELEASE_ROOT}"/images/*.tar)
  shopt -u nullglob
  if (( ${#archives[@]} == 0 )); then
    die "no bundled image archives found under ${RELEASE_ROOT}/images"
  fi
  printf '%s\n' "${archives[@]}"
}

load_bundled_images() {
  local tar_file
  if [[ "${SKIP_BUNDLED_IMAGE_LOAD:-0}" == "1" ]]; then
    log "skipping bundled image reload because SKIP_BUNDLED_IMAGE_LOAD=1"
    return 0
  fi
  if ! release_bundle_includes_bundled_image_archives; then
    die "release bundle omits bundled image archives; rerun with SKIP_BUNDLED_IMAGE_LOAD=1 and local images available"
  fi
  while IFS= read -r tar_file; do
    docker load -i "${tar_file}" >/dev/null
  done < <(bundled_image_archives)
}

push_release_images() {
  if [[ -n "${REGISTRY_USERNAME:-}" || -n "${REGISTRY_PASSWORD:-}" ]]; then
    [[ -n "${REGISTRY_USERNAME:-}" && -n "${REGISTRY_PASSWORD:-}" ]] \
      || die "registry auth requires both REGISTRY_USERNAME and REGISTRY_PASSWORD"
    docker login "${REGISTRY_HOST}" -u "${REGISTRY_USERNAME}" -p "${REGISTRY_PASSWORD}" >/dev/null
  fi
  local image
  for image in \
    "${APP_IMAGE}" \
    "${RUNNER_IMAGE}" \
    "${CHAT_RUNNER_IMAGE}" \
    "${VERIFY_RUNNER_IMAGE}" \
    "${SANDBOX_MANAGER_IMAGE}" \
    "${UNIVERSAL_PROXY_IMAGE}" \
    "${JUICEFS_MOUNT_IMAGE}" \
    "${JUICEFS_CSI_DRIVER_IMAGE}" \
    "${JUICEFS_CSI_DASHBOARD_IMAGE}" \
    "${JUICEFS_CSI_PROVISIONER_IMAGE}" \
    "${JUICEFS_CSI_RESIZER_IMAGE}" \
    "${JUICEFS_CSI_LIVENESSPROBE_IMAGE}" \
    "${JUICEFS_CSI_NODE_REGISTRAR_IMAGE}" \
    "${INGRESS_NGINX_CONTROLLER_IMAGE}" \
    "${INGRESS_NGINX_CERTGEN_IMAGE}"; do
    docker push "${image}" >/dev/null
  done
}

build_cluster_kubeconfig_from_admin() {
  local service_account="$1"
  local namespace="$2"
  local output_path="$3"
  local server_override="${4:-}"
  local cluster_name server ca_data token
  local secret_name="${service_account}-token"

  cluster_name="$(KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl config view --raw --minify -o jsonpath='{.contexts[0].context.cluster}')"
  server="$(KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.server}')"
  ca_data="$(KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')"
  KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: ${secret_name}
  namespace: ${namespace}
  annotations:
    kubernetes.io/service-account.name: ${service_account}
type: kubernetes.io/service-account-token
EOF
  for _ in $(seq 1 60); do
    token="$(
      KUBECONFIG="${SHARED_ADMIN_KUBECONFIG}" kubectl get secret "${secret_name}" -n "${namespace}" -o jsonpath='{.data.token}' 2>/dev/null \
        | base64 -d 2>/dev/null || true
    )"
    [[ -n "${token}" ]] && break
    sleep 1
  done
  if [[ -n "${server_override}" ]]; then
    server="${server_override}"
  fi

  [[ -n "${cluster_name}" && -n "${server}" && -n "${ca_data}" && -n "${token}" ]] \
    || die "failed to generate kubeconfig for service account ${service_account} in namespace ${namespace}"

  cat > "${output_path}" <<EOF
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: ${ca_data}
    server: ${server}
  name: ${cluster_name}
contexts:
- context:
    cluster: ${cluster_name}
    namespace: ${namespace}
    user: ${service_account}
  name: ${service_account}@${cluster_name}
current-context: ${service_account}@${cluster_name}
preferences: {}
users:
- name: ${service_account}
  user:
    token: ${token}
EOF
}

wait_cluster_substrate() {
  HOST_LOCAL_KEYCLOAK_BASE_URL="${HOST_LOCAL_KEYCLOAK_BASE_URL:-http://127.0.0.1:${KEYCLOAK_PORT:-18080}}"
  wait_http "${HOST_LOCAL_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" 240
}

wait_cluster_app() {
  HOST_LOCAL_WEB_BASE_URL="${HOST_LOCAL_WEB_BASE_URL:-http://127.0.0.1:${WEB_PORT:-3001}}"
  wait_tcp "127.0.0.1" "${API_PORT}" 240
  wait_http "${HOST_LOCAL_WEB_BASE_URL}/api/public/workspaces" 240
}

current_release_root() {
  [[ -f "${CURRENT_LINK}/VERSION" ]] || return 1
  readlink -f "${CURRENT_LINK}"
}

copy_runner_runtime_env_from_current_release() {
  local current_root current_runtime target_runtime ws_url agent_key
  current_root="$(current_release_root 2>/dev/null || true)"
  [[ -n "${current_root}" ]] || die "upgrade requires an existing current release under ${CURRENT_LINK}"
  current_runtime="${current_root}/env/runner-runtime.env"
  target_runtime="${RELEASE_ROOT}/env/runner-runtime.env"
  [[ -f "${current_runtime}" ]] || die "upgrade requires ${current_runtime}"
  ws_url="$(awk -F= '$1=="MBOS_AGENT_WS_URL"{print $2}' "${current_runtime}" | tail -n1)"
  agent_key="$(awk -F= '$1=="MBOS_AGENT_KEY"{print $2}' "${current_runtime}" | tail -n1)"
  [[ -n "${ws_url}" && -n "${agent_key}" ]] \
    || die "upgrade requires a non-empty runner-runtime.env in the current release"
  if [[ "$(readlink -f "${current_runtime}")" == "$(readlink -f "${target_runtime}")" ]]; then
    return 0
  fi
  cp "${current_runtime}" "${target_runtime}"
}

write_admin_ready_template() {
  cat > "${SHARED_ADMIN_READY_ENV}" <<'EOF'
# Set ADMIN_READY=1 after the cluster administrator completes the handoff package.
# Optional:
# ADMIN_CHECKED_AT=2026-03-26T00:00:00Z
ADMIN_READY=0
EOF
}

ensure_admin_ready() {
  [[ -f "${SHARED_ADMIN_READY_ENV}" ]] || die "missing ${SHARED_ADMIN_READY_ENV}; run cluster:prepare-admin-handoff and wait for the administrator handoff"
  local admin_ready checked_at
  admin_ready="$(awk -F= '$1=="ADMIN_READY"{print $2}' "${SHARED_ADMIN_READY_ENV}" | tail -n1)"
  checked_at="$(awk -F= '$1=="ADMIN_CHECKED_AT"{print $2}' "${SHARED_ADMIN_READY_ENV}" | tail -n1)"
  [[ "${admin_ready}" == "1" ]] || die "cluster administrator handoff not complete; set ADMIN_READY=1 in ${SHARED_ADMIN_READY_ENV} after final checks"
  state_set admin.ready 1
  if [[ -n "${checked_at}" ]]; then
    state_set admin.checked_at "${checked_at}"
  fi
}

render_admin_handoff() {
  ensure_cluster_deploy_shared_dirs
  mkdir -p "${ADMIN_HANDOFF_DIR}/examples" "${ADMIN_HANDOFF_DIR}/scripts"
  cp "${SHARED_SITE_ENV}" "${ADMIN_HANDOFF_DIR}/site.env.todo"
  cp "${ROOT_DIR}/infra/deploy/cluster/admin-examples/"*.yaml "${ADMIN_HANDOFF_DIR}/examples/"
  cp "${ROOT_DIR}/docs/user-guides/cluster-admin-runbook.md" "${ADMIN_HANDOFF_DIR}/RUNBOOK.md"
  write_admin_ready_template

  cat > "${ADMIN_HANDOFF_DIR}/scripts/apply-juicefs-prereqs.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
kubectl apply -f examples/juicefs-csi-secret.example.yaml
kubectl apply -f examples/juicefs-storageclass.example.yaml
EOF

  cat > "${ADMIN_HANDOFF_DIR}/scripts/apply-deploy-rbac.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
kubectl apply -f examples/deploy-role.example.yaml
EOF

  cat > "${ADMIN_HANDOFF_DIR}/scripts/apply-manager-rbac.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
kubectl apply -f examples/manager-role.example.yaml
kubectl apply -f examples/manager-pv-clusterrole.example.yaml
EOF

  cat > "${ADMIN_HANDOFF_DIR}/scripts/final-verification.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
SITE_ENV_PATH="${SHARED_SITE_ENV}"
DEPLOY_KUBECONFIG_PATH="${SHARED_KUBECONFIG}"
MANAGER_KUBECONFIG_PATH="${SHARED_MANAGER_KUBECONFIG}"

[[ -f "\${SITE_ENV_PATH}" ]] || { echo "missing \${SITE_ENV_PATH}" >&2; exit 1; }
[[ -f "\${DEPLOY_KUBECONFIG_PATH}" ]] || { echo "missing \${DEPLOY_KUBECONFIG_PATH}" >&2; exit 1; }
[[ -f "\${MANAGER_KUBECONFIG_PATH}" ]] || { echo "missing \${MANAGER_KUBECONFIG_PATH}" >&2; exit 1; }

set -a
source "\${SITE_ENV_PATH}"
set +a

[[ -n "\${INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME:-}" ]] || {
  echo "missing INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME in \${SITE_ENV_PATH}" >&2
  exit 1
}

kubectl get namespace ${INTERNAL_AGENT_K8S_NAMESPACE}
kubectl get csidriver csi.juicefs.com
kubectl get secret -n ${INTERNAL_AGENT_K8S_NAMESPACE} juicefs-csi-secret
kubectl get storageclass "\${INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME}"
[[ "\$(KUBECONFIG="\${DEPLOY_KUBECONFIG_PATH}" kubectl auth can-i create deployments -n ${INTERNAL_AGENT_K8S_NAMESPACE} 2>/dev/null || true)" == "yes" ]] || { echo "deploy kubeconfig missing: create deployments -n ${INTERNAL_AGENT_K8S_NAMESPACE}" >&2; exit 1; }
[[ "\$(KUBECONFIG="\${DEPLOY_KUBECONFIG_PATH}" kubectl auth can-i create services -n ${INTERNAL_AGENT_K8S_NAMESPACE} 2>/dev/null || true)" == "yes" ]] || { echo "deploy kubeconfig missing: create services -n ${INTERNAL_AGENT_K8S_NAMESPACE}" >&2; exit 1; }
[[ "\$(KUBECONFIG="\${DEPLOY_KUBECONFIG_PATH}" kubectl auth can-i create endpoints -n ${INTERNAL_AGENT_K8S_NAMESPACE} 2>/dev/null || true)" == "yes" ]] || { echo "deploy kubeconfig missing: create endpoints -n ${INTERNAL_AGENT_K8S_NAMESPACE}" >&2; exit 1; }
[[ "\$(KUBECONFIG="\${DEPLOY_KUBECONFIG_PATH}" kubectl auth can-i create configmaps -n ${INTERNAL_AGENT_K8S_NAMESPACE} 2>/dev/null || true)" == "yes" ]] || { echo "deploy kubeconfig missing: create configmaps -n ${INTERNAL_AGENT_K8S_NAMESPACE}" >&2; exit 1; }
[[ "\$(KUBECONFIG="\${DEPLOY_KUBECONFIG_PATH}" kubectl auth can-i create secrets -n ${INTERNAL_AGENT_K8S_NAMESPACE} 2>/dev/null || true)" == "yes" ]] || { echo "deploy kubeconfig missing: create secrets -n ${INTERNAL_AGENT_K8S_NAMESPACE}" >&2; exit 1; }
[[ "\$(KUBECONFIG="\${DEPLOY_KUBECONFIG_PATH}" kubectl auth can-i create ingresses.networking.k8s.io -n ${INTERNAL_AGENT_K8S_NAMESPACE} 2>/dev/null || true)" == "yes" ]] || { echo "deploy kubeconfig missing: create ingresses.networking.k8s.io -n ${INTERNAL_AGENT_K8S_NAMESPACE}" >&2; exit 1; }

[[ "\$(KUBECONFIG="\${MANAGER_KUBECONFIG_PATH}" kubectl auth can-i create secrets -n ${INTERNAL_AGENT_K8S_NAMESPACE} 2>/dev/null || true)" == "yes" ]] || { echo "manager kubeconfig missing: create secrets -n ${INTERNAL_AGENT_K8S_NAMESPACE}" >&2; exit 1; }
[[ "\$(KUBECONFIG="\${MANAGER_KUBECONFIG_PATH}" kubectl auth can-i create persistentvolumeclaims -n ${INTERNAL_AGENT_K8S_NAMESPACE} 2>/dev/null || true)" == "yes" ]] || { echo "manager kubeconfig missing: create persistentvolumeclaims -n ${INTERNAL_AGENT_K8S_NAMESPACE}" >&2; exit 1; }
[[ "\$(KUBECONFIG="\${MANAGER_KUBECONFIG_PATH}" kubectl auth can-i create pods -n ${INTERNAL_AGENT_K8S_NAMESPACE} 2>/dev/null || true)" == "yes" ]] || { echo "manager kubeconfig missing: create pods -n ${INTERNAL_AGENT_K8S_NAMESPACE}" >&2; exit 1; }
[[ "\$(KUBECONFIG="\${MANAGER_KUBECONFIG_PATH}" kubectl auth can-i get persistentvolumes 2>/dev/null || true)" == "yes" ]] || { echo "manager kubeconfig missing: get persistentvolumes" >&2; exit 1; }
[[ "\$(KUBECONFIG="\${MANAGER_KUBECONFIG_PATH}" kubectl auth can-i create persistentvolumes 2>/dev/null || true)" == "yes" ]] || { echo "manager kubeconfig missing: create persistentvolumes" >&2; exit 1; }
[[ "\$(KUBECONFIG="\${MANAGER_KUBECONFIG_PATH}" kubectl auth can-i update persistentvolumes 2>/dev/null || true)" == "yes" ]] || { echo "manager kubeconfig missing: update persistentvolumes" >&2; exit 1; }
[[ "\$(KUBECONFIG="\${MANAGER_KUBECONFIG_PATH}" kubectl auth can-i delete persistentvolumes 2>/dev/null || true)" == "yes" ]] || { echo "manager kubeconfig missing: delete persistentvolumes" >&2; exit 1; }
EOF

  chmod +x "${ADMIN_HANDOFF_DIR}/scripts/"*.sh

  cat > "${ADMIN_HANDOFF_DIR}/CHECKLIST.md" <<EOF
# Cluster Admin Handoff Checklist

1. Confirm namespace \`${INTERNAL_AGENT_K8S_NAMESPACE}\` exists.
2. Confirm JuiceFS CSI is installed and healthy.
3. Apply and verify:
   - \`examples/juicefs-csi-secret.example.yaml\`
   - \`examples/juicefs-storageclass.example.yaml\`
   - or run: \`bash scripts/apply-juicefs-prereqs.sh\`
4. Apply and verify:
   - \`examples/deploy-role.example.yaml\`
   - \`examples/manager-role.example.yaml\`
   - \`examples/manager-pv-clusterrole.example.yaml\`
   - or run:
     - \`bash scripts/apply-deploy-rbac.sh\`
     - \`bash scripts/apply-manager-rbac.sh\`
5. Review and finalize \`site.env.todo\`.
6. Deliver these files into their shared paths:
   - \`${SHARED_SITE_ENV}\`
   - \`${SHARED_KUBECONFIG}\`
   - \`${SHARED_MANAGER_KUBECONFIG}\`
7. Run:
   - \`bash scripts/final-verification.sh\`
   - or the equivalent final verification commands from \`RUNBOOK.md\`
8. Edit \`${SHARED_ADMIN_READY_ENV}\` and set:
   - \`ADMIN_READY=1\`
   - optional \`ADMIN_CHECKED_AT=<timestamp>\`

Primary handbook:
- \`RUNBOOK.md\`
EOF

  cat > "${ADMIN_HANDOFF_DIR}/SUMMARY.md" <<EOF
# Cluster Admin Handoff Summary

- release: ${RELEASE_ID}
- target namespace: ${INTERNAL_AGENT_K8S_NAMESPACE}
- shared site env: ${SHARED_SITE_ENV}
- shared deploy kubeconfig: ${SHARED_KUBECONFIG}
- shared manager kubeconfig: ${SHARED_MANAGER_KUBECONFIG}
- admin handoff dir: ${ADMIN_HANDOFF_DIR}
- admin ready marker: ${SHARED_ADMIN_READY_ENV}
- public web: ${PUBLIC_WEB_BASE_URL}
- public api: ${PUBLIC_API_BASE_URL}
- public keycloak: ${PUBLIC_KEYCLOAK_BASE_URL}
- manager ingress host: ${SANDBOX_MANAGER_INGRESS_HOST}
- manager public base: ${SANDBOX_MANAGER_PUBLIC_BASE_URL}
- client postgres: ${CLIENT_PUBLIC_POSTGRES_HOST}:${CLIENT_PUBLIC_POSTGRES_PORT}
- client minio: ${CLIENT_PUBLIC_MINIO_ENDPOINT}
- k8s external postgres: ${K8S_EXTERNAL_POSTGRES_HOST}:${K8S_EXTERNAL_POSTGRES_PORT}
- k8s external minio: ${K8S_EXTERNAL_MINIO_HOST}:${K8S_EXTERNAL_MINIO_PORT}
- storage class: ${INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME}
- manager selector: ${SANDBOX_MANAGER_NODE_SELECTOR_JSON}
- manager tolerations: ${SANDBOX_MANAGER_TOLERATIONS_JSON}
- workload selector: ${INTERNAL_AGENT_WORKLOAD_NODE_SELECTOR_JSON}
- workload tolerations: ${INTERNAL_AGENT_WORKLOAD_TOLERATIONS_JSON}
EOF
}
