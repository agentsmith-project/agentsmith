#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
export DEPLOY_ROOT_DEFAULT="${CLUSTER_DEPLOY_ROOT:-${HOME}/agentsmith/cluster-deploy}"
export DEPLOY_LOG_PREFIX="${DEPLOY_LOG_PREFIX:-cluster-deploy}"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/deploy-common.sh"

CLUSTER_DEPLOY_ROOT="${DEPLOY_ROOT}"
SHARED_REGISTRY_ENV="${CONFIG_DIR}/registry.env"
SHARED_KUBECONFIG="${CONFIG_DIR}/kubeconfig"
SHARED_MANAGER_KUBECONFIG="${CONFIG_DIR}/manager-kubeconfig"
SHARED_ADMIN_READY_ENV="${CONFIG_DIR}/admin-ready.env"
ADMIN_HANDOFF_DIR="${DEPLOY_ROOT}/admin-handoff"
OPERATOR_CLUSTER_DIR="${ROOT_DIR}/.infra/cluster-deploy"
OPERATOR_SITE_ENV="${OPERATOR_CLUSTER_DIR}/site.env"
OPERATOR_REGISTRY_ENV="${OPERATOR_CLUSTER_DIR}/registry.env"
OPERATOR_KUBECONFIG="${OPERATOR_CLUSTER_DIR}/kubeconfig"
OPERATOR_MANAGER_KUBECONFIG="${OPERATOR_CLUSTER_DIR}/manager-kubeconfig"
export CLUSTER_DEPLOY_ROOT SHARED_REGISTRY_ENV SHARED_KUBECONFIG SHARED_MANAGER_KUBECONFIG SHARED_ADMIN_READY_ENV ADMIN_HANDOFF_DIR OPERATOR_CLUSTER_DIR OPERATOR_SITE_ENV OPERATOR_REGISTRY_ENV OPERATOR_KUBECONFIG OPERATOR_MANAGER_KUBECONFIG

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
  ensure_dirs
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
  ensure_dirs
  mkdir -p "${RELEASE_ROOT}/env"
  if [[ ! -f "${SHARED_KUBECONFIG}" ]]; then
    if [[ -f "${OPERATOR_KUBECONFIG}" ]]; then
      cp "${OPERATOR_KUBECONFIG}" "${SHARED_KUBECONFIG}"
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

ensure_operator_manager_kubeconfig() {
  ensure_dirs
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
}

load_kubeconfig() {
  ensure_operator_kubeconfig
  export KUBECONFIG="${SHARED_KUBECONFIG}"
}

read_version_value() {
  local key="$1"
  awk -F= -v target="${key}" '$1==target{print $2}' "${RELEASE_ROOT}/VERSION"
}

require_version_images() {
  APP_IMAGE="$(read_version_value agentsmith_app_image)"
  RUNNER_IMAGE="$(read_version_value agentsmith_runner_image)"
  SANDBOX_MANAGER_IMAGE="$(read_version_value sandbox_manager_image)"
  UNIVERSAL_PROXY_IMAGE="$(read_version_value llm_universal_proxy_image)"
  VERIFY_RUNNER_IMAGE="$(read_version_value agentsmith_verify_runner_image)"
  JUICEFS_MOUNT_IMAGE="$(read_version_value juicefs_mount_image)"
  export APP_IMAGE RUNNER_IMAGE SANDBOX_MANAGER_IMAGE UNIVERSAL_PROXY_IMAGE VERIFY_RUNNER_IMAGE JUICEFS_MOUNT_IMAGE
  [[ -n "${APP_IMAGE}" && -n "${RUNNER_IMAGE}" && -n "${SANDBOX_MANAGER_IMAGE}" && -n "${UNIVERSAL_PROXY_IMAGE}" && -n "${VERIFY_RUNNER_IMAGE}" ]] \
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
  while IFS= read -r tar_file; do
    docker load -i "${tar_file}" >/dev/null
  done < <(bundled_image_archives)
}

push_release_images() {
  docker login "${REGISTRY_HOST}" -u "${REGISTRY_USERNAME}" -p "${REGISTRY_PASSWORD}" >/dev/null
  local image
  for image in \
    "${APP_IMAGE}" \
    "${RUNNER_IMAGE}" \
    "${VERIFY_RUNNER_IMAGE}" \
    "${SANDBOX_MANAGER_IMAGE}" \
    "${UNIVERSAL_PROXY_IMAGE}" \
    "${JUICEFS_MOUNT_IMAGE}"; do
    docker push "${image}" >/dev/null
  done
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
  ensure_dirs
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
CONFIG_DIR="${CONFIG_DIR}"

[[ -f "\${CONFIG_DIR}/site.env" ]] || { echo "missing \${CONFIG_DIR}/site.env" >&2; exit 1; }
[[ -f "\${CONFIG_DIR}/registry.env" ]] || { echo "missing \${CONFIG_DIR}/registry.env" >&2; exit 1; }
[[ -f "\${CONFIG_DIR}/kubeconfig" ]] || { echo "missing \${CONFIG_DIR}/kubeconfig" >&2; exit 1; }
[[ -f "\${CONFIG_DIR}/manager-kubeconfig" ]] || { echo "missing \${CONFIG_DIR}/manager-kubeconfig" >&2; exit 1; }

set -a
source "\${CONFIG_DIR}/site.env"
set +a

[[ -n "\${INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME:-}" ]] || {
  echo "missing INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME in \${CONFIG_DIR}/site.env" >&2
  exit 1
}

kubectl get namespace ${INTERNAL_AGENT_K8S_NAMESPACE}
kubectl get csidriver csi.juicefs.com
kubectl get secret -n ${INTERNAL_AGENT_K8S_NAMESPACE} juicefs-csi-secret
kubectl get storageclass "\${INTERNAL_AGENT_JUICEFS_STORAGE_CLASS_NAME}"
KUBECONFIG="\${CONFIG_DIR}/kubeconfig" kubectl auth can-i create deployments -n ${INTERNAL_AGENT_K8S_NAMESPACE}
KUBECONFIG="\${CONFIG_DIR}/kubeconfig" kubectl auth can-i create services -n ${INTERNAL_AGENT_K8S_NAMESPACE}
KUBECONFIG="\${CONFIG_DIR}/kubeconfig" kubectl auth can-i create ingresses.networking.k8s.io -n ${INTERNAL_AGENT_K8S_NAMESPACE}
KUBECONFIG="\${CONFIG_DIR}/kubeconfig" kubectl auth can-i create secrets -n ${INTERNAL_AGENT_K8S_NAMESPACE}
KUBECONFIG="\${CONFIG_DIR}/manager-kubeconfig" kubectl auth can-i create secrets -n ${INTERNAL_AGENT_K8S_NAMESPACE}
KUBECONFIG="\${CONFIG_DIR}/manager-kubeconfig" kubectl auth can-i create persistentvolumeclaims -n ${INTERNAL_AGENT_K8S_NAMESPACE}
KUBECONFIG="\${CONFIG_DIR}/manager-kubeconfig" kubectl auth can-i create pods -n ${INTERNAL_AGENT_K8S_NAMESPACE}
KUBECONFIG="\${CONFIG_DIR}/manager-kubeconfig" kubectl auth can-i create persistentvolumes
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
6. Deliver these files into \`${CONFIG_DIR}\`:
   - \`site.env\`
   - \`registry.env\`
   - \`kubeconfig\`
   - \`manager-kubeconfig\`
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
- config dir: ${CONFIG_DIR}
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
