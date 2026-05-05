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
  load_env_file "${RELEASE_ROOT}/env/registry.env"
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
  AGENT_TASK_RUNNER_IMAGE="$(read_version_value agentsmith_agent_task_runner_image)"
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
  export APP_IMAGE AGENT_TASK_RUNNER_IMAGE SANDBOX_MANAGER_IMAGE K8S_SANDBOX_MANAGER_IMAGE UNIVERSAL_PROXY_IMAGE VERIFY_RUNNER_IMAGE JUICEFS_MOUNT_IMAGE JUICEFS_CSI_DRIVER_IMAGE JUICEFS_CSI_DASHBOARD_IMAGE JUICEFS_CSI_PROVISIONER_IMAGE JUICEFS_CSI_RESIZER_IMAGE JUICEFS_CSI_LIVENESSPROBE_IMAGE JUICEFS_CSI_NODE_REGISTRAR_IMAGE INGRESS_NGINX_CONTROLLER_IMAGE INGRESS_NGINX_CERTGEN_IMAGE K8S_JUICEFS_MOUNT_IMAGE K8S_JUICEFS_CSI_DRIVER_IMAGE K8S_JUICEFS_CSI_DASHBOARD_IMAGE K8S_JUICEFS_CSI_PROVISIONER_IMAGE K8S_JUICEFS_CSI_RESIZER_IMAGE K8S_JUICEFS_CSI_LIVENESSPROBE_IMAGE K8S_JUICEFS_CSI_NODE_REGISTRAR_IMAGE K8S_INGRESS_NGINX_CONTROLLER_IMAGE K8S_INGRESS_NGINX_CERTGEN_IMAGE
  [[ -n "${APP_IMAGE}" && -n "${AGENT_TASK_RUNNER_IMAGE}" && -n "${SANDBOX_MANAGER_IMAGE}" && -n "${UNIVERSAL_PROXY_IMAGE}" && -n "${VERIFY_RUNNER_IMAGE}" ]] \
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
    docker_load_archive_with_digest_proven_skip "${tar_file}"
  done < <(bundled_image_archives)
}

image_repository_from_ref() {
  local image="$1"
  local image_without_digest="${image%%@*}"
  local last_component="${image_without_digest##*/}"

  if [[ "${last_component}" == *:* ]]; then
    printf '%s' "${image_without_digest%:*}"
    return 0
  fi

  printf '%s' "${image_without_digest}"
}

local_registry_manifest_digest_for_image() {
  local image="$1"
  local image_repo
  local repo_digests_json

  command -v node >/dev/null 2>&1 || return 1
  image_repo="$(image_repository_from_ref "${image}")"
  if ! repo_digests_json="$(docker image inspect --format '{{json .RepoDigests}}' "${image}" 2>/dev/null)"; then
    return 1
  fi

  node - "${image_repo}" "${repo_digests_json}" <<'NODE'
const repo = process.argv[2];
const input = process.argv[3] ?? '';
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
let repoDigests;

try {
  repoDigests = JSON.parse(input);
} catch {
  process.exit(1);
}

if (!Array.isArray(repoDigests)) {
  process.exit(1);
}

for (const entry of repoDigests) {
  if (typeof entry !== 'string') {
    continue;
  }

  const separatorIndex = entry.lastIndexOf('@');
  if (separatorIndex <= 0) {
    continue;
  }

  const entryRepo = entry.slice(0, separatorIndex);
  const entryDigest = entry.slice(separatorIndex + 1);
  if (entryRepo === repo && digestPattern.test(entryDigest)) {
    process.stdout.write(entryDigest);
    process.exit(0);
  }
}

process.exit(1);
NODE
}

remote_registry_manifest_digest_for_image() {
  local image="$1"
  local manifest_json

  command -v node >/dev/null 2>&1 || return 1
  if ! manifest_json="$(docker buildx imagetools inspect "${image}" --format '{{json .Manifest}}' 2>/dev/null)"; then
    return 1
  fi

  node - "${manifest_json}" <<'NODE'
const input = process.argv[2] ?? '';
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
let manifest;

try {
  manifest = JSON.parse(input);
} catch {
  process.exit(1);
}

if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
  process.exit(1);
}

const digest = manifest.digest;
if (typeof digest !== 'string' || !digestPattern.test(digest)) {
  process.exit(1);
}

process.stdout.write(digest);
NODE
}

registry_push_skip_decision_generated_at() {
  if [[ -n "${BUILD_ARTIFACT_BROKER_GENERATED_AT:-}" ]]; then
    printf '%s' "${BUILD_ARTIFACT_BROKER_GENERATED_AT}"
    return 0
  fi

  node -e 'process.stdout.write(new Date().toISOString())'
}

append_registry_push_skip_decision() {
  local image="$1"
  local input_digest="$2"
  local existing_artifact_digest="$3"
  local generated_at
  local skip_decisions_path="${RELEASE_ROOT}/skip-decisions.ndjson"

  generated_at="$(registry_push_skip_decision_generated_at)"
  node - \
    "${skip_decisions_path}" \
    "${image}" \
    "${input_digest}" \
    "${existing_artifact_digest}" \
    "${generated_at}" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const [skipDecisionsPath, image, inputDigest, existingArtifactDigest, generatedAt] = process.argv.slice(2);
const decision = {
  schema: 'current-build-skip-decision.v1',
  version: 1,
  target: `image:${image}`,
  operation: 'registry_push',
  input_digest: inputDigest,
  existing_artifact_digest: existingArtifactDigest,
  skip_reason: 'remote_manifest_digest_matches',
  validator: 'registry manifest digest probe via docker buildx imagetools inspect',
  generated_at: generatedAt,
};

fs.mkdirSync(path.dirname(skipDecisionsPath), { recursive: true });
fs.appendFileSync(skipDecisionsPath, `${JSON.stringify(decision)}\n`, 'utf8');
NODE
}

push_release_images() {
  if [[ -n "${REGISTRY_USERNAME:-}" || -n "${REGISTRY_PASSWORD:-}" ]]; then
    [[ -n "${REGISTRY_USERNAME:-}" && -n "${REGISTRY_PASSWORD:-}" ]] \
      || die "registry auth requires both REGISTRY_USERNAME and REGISTRY_PASSWORD"
    printf '%s' "${REGISTRY_PASSWORD}" | docker login "${REGISTRY_HOST}" -u "${REGISTRY_USERNAME}" --password-stdin >/dev/null
  fi
  local image local_manifest_digest remote_manifest_digest
  for image in \
    "${APP_IMAGE}" \
    "${AGENT_TASK_RUNNER_IMAGE}" \
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
    if [[ "${FORCE_REGISTRY_PUSH:-0}" != "1" ]] \
      && local_manifest_digest="$(local_registry_manifest_digest_for_image "${image}")" \
      && remote_manifest_digest="$(remote_registry_manifest_digest_for_image "${image}")" \
      && [[ "${local_manifest_digest}" == "${remote_manifest_digest}" ]]; then
      append_registry_push_skip_decision "${image}" "${local_manifest_digest}" "${remote_manifest_digest}"
      log "skipping registry push because local RepoDigest matches remote manifest digest: ${image}"
      continue
    fi

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

carry_managed_runner_release_state() {
  current_release_root >/dev/null 2>&1 || die "upgrade requires an existing current release under ${CURRENT_LINK}"
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
