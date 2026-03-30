#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SANDBOX_ROOT="$(cd "${ROOT_DIR}/../mbos-sandbox-v1" && pwd)"
UNIVERSAL_PROXY_ROOT="$(cd "${ROOT_DIR}/../llm-universal-proxy" && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
source "${ROOT_DIR}/scripts/lib/ensure-juicefs-vendor.sh"

OUT_DIR="${OUT_DIR:-${HOME}/agentsmith/cluster-deploy/uploads}"
RELEASE_ID="${RELEASE_ID:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%SZ)}"
BUNDLE_DIR="${OUT_DIR}/agentsmith-${RELEASE_ID}"
IMAGES_DIR="${BUNDLE_DIR}/images"
TOOLS_DIR="${BUNDLE_DIR}/tools"

require_cmd tar
require_cmd sha256sum
require_cmd kubectl
require_cmd python3
require_cmd docker

ensure_operator_registry_env
load_registry_env

if [[ "${SKIP_BUNDLE_INPUTS_CHECK:-0}" != "1" ]]; then
  (cd "${ROOT_DIR}" && npm run test:cluster-bundle:inputs)
  (cd "${ROOT_DIR}" && npm run test:cluster-rendered-env)
  (cd "${ROOT_DIR}" && npm run test:client-public-runtime)
fi

JUICEFS_VERSION="${JUICEFS_VERSION:-1.3.0}"
JUICEFS_DOWNLOAD_BASE_URL="${JUICEFS_DOWNLOAD_BASE_URL:-https://github.com/juicedata/juicefs/releases/download/v${JUICEFS_VERSION}}"
INGRESS_NGINX_VERSION="${INGRESS_NGINX_VERSION:-v1.15.1}"

mkdir -p "${OUT_DIR}"
rm -rf "${BUNDLE_DIR}"
mkdir -p "${BUNDLE_DIR}" "${IMAGES_DIR}" "${TOOLS_DIR}"

copy_source_tree() {
  local src="$1"
  local dst="$2"
  mkdir -p "${dst}"
  tar -C "${src}" \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='.next' \
    --exclude='artifacts' \
    --exclude='.tmp' \
    --exclude='.infra' \
    --exclude='coverage' \
    --exclude='playwright-report' \
    --exclude='test-results' \
    -cf - . | tar -C "${dst}" -xf -
}

mkdir -p "${BUNDLE_DIR}/compose" "${BUNDLE_DIR}/env" "${BUNDLE_DIR}/scripts/cluster-deploy" "${BUNDLE_DIR}/scripts/lib" "${BUNDLE_DIR}/docs/contracts" "${BUNDLE_DIR}/docs/user-guides" "${BUNDLE_DIR}/infra/deploy/cluster/admin-examples" "${BUNDLE_DIR}/infra/runtime" "${BUNDLE_DIR}/addons/ingress-nginx" "${BUNDLE_DIR}/addons/juicefs-csi" "${BUNDLE_DIR}/postgres-init" "${BUNDLE_DIR}/minio" "${BUNDLE_DIR}/keycloak" "${BUNDLE_DIR}/universal-proxy" "${BUNDLE_DIR}/e2e" "${BUNDLE_DIR}/sources/agentsmith" "${BUNDLE_DIR}/sources/mbos-sandbox-v1/manager-service" "${BUNDLE_DIR}/sources/llm-universal-proxy"
cp "${ROOT_DIR}/infra/deploy/cluster/docker-compose.yml" "${BUNDLE_DIR}/compose/docker-compose.yml"
cp "${ROOT_DIR}/infra/deploy/cluster/deployment.manifest.json" "${BUNDLE_DIR}/deployment.manifest.json"
cp "${ROOT_DIR}/infra/deploy/cluster/env/site.env.example" "${BUNDLE_DIR}/env/site.env.example"
cp "${ROOT_DIR}/infra/deploy/cluster/env/registry.env.example" "${BUNDLE_DIR}/env/registry.env.example"
cp "${ROOT_DIR}/infra/deploy/cluster/env/kubeconfig.example.yaml" "${BUNDLE_DIR}/env/kubeconfig.example.yaml"
cp "${ROOT_DIR}/infra/deploy/cluster/env/admin-kubeconfig.example.yaml" "${BUNDLE_DIR}/env/admin-kubeconfig.example.yaml"
cp "${ROOT_DIR}/infra/deploy/cluster/env/manager-kubeconfig.example.yaml" "${BUNDLE_DIR}/env/manager-kubeconfig.example.yaml"
cp "${ROOT_DIR}/infra/deploy/cluster/admin-examples/"*.yaml "${BUNDLE_DIR}/infra/deploy/cluster/admin-examples/"
cp "${ROOT_DIR}/infra/integration/postgres-init/001-create-databases.sql" "${BUNDLE_DIR}/postgres-init/"
cp "${ROOT_DIR}/packages/adapters-private/sql/projects.sql" "${BUNDLE_DIR}/postgres-init/"
cp "${ROOT_DIR}/infra/integration/minio/init-minio.sh" "${BUNDLE_DIR}/minio/"
cp "${ROOT_DIR}/infra/integration/keycloak/realm-mbos-dev.json" "${BUNDLE_DIR}/keycloak/"
cp "${ROOT_DIR}/infra/deploy/shared/universal-proxy/config.yaml" "${BUNDLE_DIR}/universal-proxy/config.yaml"
cp "${ROOT_DIR}/scripts/check-preset-external-file-library.sh" "${BUNDLE_DIR}/scripts/check-preset-external-file-library.sh"
cp "${ROOT_DIR}/scripts/cluster-deploy/"*.sh "${BUNDLE_DIR}/scripts/cluster-deploy/"
cp "${ROOT_DIR}/scripts/cluster-deploy/lib.sh" "${BUNDLE_DIR}/scripts/cluster-deploy/lib.sh"
cp "${ROOT_DIR}/scripts/lib/docker-buildx-common.sh" "${BUNDLE_DIR}/scripts/lib/docker-buildx-common.sh"
cp "${ROOT_DIR}/scripts/lib/ensure-juicefs-vendor.sh" "${BUNDLE_DIR}/scripts/lib/ensure-juicefs-vendor.sh"
cp "${ROOT_DIR}/scripts/lib/deploy-common.sh" "${BUNDLE_DIR}/scripts/lib/deploy-common.sh"
cp "${ROOT_DIR}/scripts/lib/release-stage-common.sh" "${BUNDLE_DIR}/scripts/lib/release-stage-common.sh"
cp "${ROOT_DIR}/scripts/lib/bootstrap-common.sh" "${BUNDLE_DIR}/scripts/lib/bootstrap-common.sh"
cp "${ROOT_DIR}/scripts/lib/k8s-external-services.sh" "${BUNDLE_DIR}/scripts/lib/k8s-external-services.sh"
cp "${ROOT_DIR}/scripts/lib/preset-common.sh" "${BUNDLE_DIR}/scripts/lib/preset-common.sh"
cp "${ROOT_DIR}/infra/runtime/presets.env" "${BUNDLE_DIR}/infra/runtime/presets.env"
cp -R "${ROOT_DIR}/infra/deploy/cluster/addons/ingress-nginx/." "${BUNDLE_DIR}/addons/ingress-nginx/"
cp -R "${ROOT_DIR}/infra/deploy/cluster/addons/juicefs-csi/." "${BUNDLE_DIR}/addons/juicefs-csi/"
cp "${ROOT_DIR}/e2e/integration-real-helpers.ts" "${BUNDLE_DIR}/e2e/integration-real-helpers.ts"
cp "${ROOT_DIR}/e2e/integration-workspace-entry.spec.ts" "${BUNDLE_DIR}/e2e/integration-workspace-entry.spec.ts"
cp "${ROOT_DIR}/e2e/integration-workspace-publish-usable.spec.ts" "${BUNDLE_DIR}/e2e/integration-workspace-publish-usable.spec.ts"
cp "${ROOT_DIR}/e2e/integration-preset-external-file-library.spec.ts" "${BUNDLE_DIR}/e2e/integration-preset-external-file-library.spec.ts"
cp "${ROOT_DIR}/e2e/integration-release-user-story.spec.ts" "${BUNDLE_DIR}/e2e/integration-release-user-story.spec.ts"
cp "${ROOT_DIR}/docs/user-guides/cluster-admin-runbook.md" "${BUNDLE_DIR}/docs/user-guides/cluster-admin-runbook.md"
cp "${ROOT_DIR}/docs/contracts/cluster-deployment-spec-v1.md" "${BUNDLE_DIR}/docs/contracts/cluster-deployment-spec-v1.md"
cp "${ROOT_DIR}/docs/user-guides/cluster-deploy-operations.md" "${BUNDLE_DIR}/docs/user-guides/cluster-deploy-operations.md"
cp "$(PATH="${ORIGINAL_PATH}" type -P kubectl)" "${TOOLS_DIR}/kubectl"
chmod +x "${BUNDLE_DIR}/scripts/check-preset-external-file-library.sh" "${BUNDLE_DIR}"/scripts/cluster-deploy/*.sh "${BUNDLE_DIR}/scripts/cluster-deploy/lib.sh" "${BUNDLE_DIR}/scripts/lib/"*.sh "${TOOLS_DIR}/kubectl"

copy_source_tree "${ROOT_DIR}" "${BUNDLE_DIR}/sources/agentsmith"
copy_source_tree "${SANDBOX_ROOT}/manager-service" "${BUNDLE_DIR}/sources/mbos-sandbox-v1/manager-service"
copy_source_tree "${UNIVERSAL_PROXY_ROOT}" "${BUNDLE_DIR}/sources/llm-universal-proxy"

JUICEFS_VENDOR_DIR="${BUNDLE_DIR}/sources/agentsmith/infra/vendor/juicefs"
ensure_juicefs_vendor_dir "${BUNDLE_DIR}/sources/agentsmith" "${JUICEFS_VERSION}" "${JUICEFS_DOWNLOAD_BASE_URL}" >/dev/null

DEPLOY_ROOT="${OUT_DIR}/.cluster-build-${RELEASE_ID}" \
RELEASE_ROOT="${BUNDLE_DIR}" \
bash "${ROOT_DIR}/scripts/cluster-deploy/build-images.sh"

dep_registry_ref() {
  local source_image="$1"
  local target_registry_host="$2"
  local target_registry_project="$3"
  local source_repo="${source_image%:*}"
  local source_tag="${source_image##*:}"
  local normalized_repo
  normalized_repo="$(printf '%s' "${source_repo}" | tr '/.' '-' | tr '@' '-')"
  printf '%s/%s/%s:%s\n' "${target_registry_host}" "${target_registry_project}" "thirdparty-${normalized_repo}" "${source_tag}"
}

TARGET_REGISTRY_HOST="$(awk -F= '$1=="registry_host"{print $2}' "${BUNDLE_DIR}/VERSION")"
TARGET_REGISTRY_PROJECT="$(awk -F= '$1=="registry_project"{print $2}' "${BUNDLE_DIR}/VERSION")"
[[ -n "${TARGET_REGISTRY_HOST}" && -n "${TARGET_REGISTRY_PROJECT}" ]] || die "VERSION is missing registry host/project after build-images"

JUICEFS_MOUNT_IMAGE="$(dep_registry_ref "juicedata/mount:ce-v1.3.1" "${TARGET_REGISTRY_HOST}" "${TARGET_REGISTRY_PROJECT}")"
JUICEFS_CSI_DRIVER_IMAGE="$(dep_registry_ref "juicedata/juicefs-csi-driver:v0.31.3" "${TARGET_REGISTRY_HOST}" "${TARGET_REGISTRY_PROJECT}")"
JUICEFS_CSI_DASHBOARD_IMAGE="$(dep_registry_ref "juicedata/csi-dashboard:v0.31.3" "${TARGET_REGISTRY_HOST}" "${TARGET_REGISTRY_PROJECT}")"
JUICEFS_CSI_PROVISIONER_IMAGE="$(dep_registry_ref "registry.k8s.io/sig-storage/csi-provisioner:v3.6.0" "${TARGET_REGISTRY_HOST}" "${TARGET_REGISTRY_PROJECT}")"
JUICEFS_CSI_RESIZER_IMAGE="$(dep_registry_ref "registry.k8s.io/sig-storage/csi-resizer:v1.9.0" "${TARGET_REGISTRY_HOST}" "${TARGET_REGISTRY_PROJECT}")"
JUICEFS_CSI_LIVENESSPROBE_IMAGE="$(dep_registry_ref "registry.k8s.io/sig-storage/livenessprobe:v2.11.0" "${TARGET_REGISTRY_HOST}" "${TARGET_REGISTRY_PROJECT}")"
JUICEFS_CSI_NODE_REGISTRAR_IMAGE="$(dep_registry_ref "registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0" "${TARGET_REGISTRY_HOST}" "${TARGET_REGISTRY_PROJECT}")"
INGRESS_NGINX_CONTROLLER_IMAGE="$(dep_registry_ref "registry.k8s.io/ingress-nginx/controller:v1.15.1" "${TARGET_REGISTRY_HOST}" "${TARGET_REGISTRY_PROJECT}")"
INGRESS_NGINX_CERTGEN_IMAGE="$(dep_registry_ref "registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.9" "${TARGET_REGISTRY_HOST}" "${TARGET_REGISTRY_PROJECT}")"

APP_IMAGE="$(awk -F= '$1=="agentsmith_app_image"{print $2}' "${BUNDLE_DIR}/VERSION")"
RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_runner_image"{print $2}' "${BUNDLE_DIR}/VERSION")"
VERIFY_RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_verify_runner_image"{print $2}' "${BUNDLE_DIR}/VERSION")"
SANDBOX_MANAGER_IMAGE="$(awk -F= '$1=="sandbox_manager_image"{print $2}' "${BUNDLE_DIR}/VERSION")"
UNIVERSAL_PROXY_IMAGE="$(awk -F= '$1=="llm_universal_proxy_image"{print $2}' "${BUNDLE_DIR}/VERSION")"

FIRST_PARTY_IMAGES=(
  "${APP_IMAGE}"
  "${RUNNER_IMAGE}"
  "${VERIFY_RUNNER_IMAGE}"
  "${SANDBOX_MANAGER_IMAGE}"
  "${UNIVERSAL_PROXY_IMAGE}"
)

COMPOSE_DEPENDENCY_IMAGES=(
  "pgvector/pgvector:pg16"
  "mongo:7"
  "redis:7-alpine"
  "minio/minio:latest"
  "minio/mc:latest"
  "quay.io/keycloak/keycloak:26.0"
)

CLUSTER_DEPENDENCY_SOURCE_IMAGES=(
  "juicedata/mount:ce-v1.3.1"
  "juicedata/juicefs-csi-driver:v0.31.3"
  "juicedata/csi-dashboard:v0.31.3"
  "registry.k8s.io/sig-storage/csi-provisioner:v3.6.0"
  "registry.k8s.io/sig-storage/csi-resizer:v1.9.0"
  "registry.k8s.io/sig-storage/livenessprobe:v2.11.0"
  "registry.k8s.io/sig-storage/csi-node-driver-registrar:v2.9.0"
  "registry.k8s.io/ingress-nginx/controller:v1.15.1"
  "registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.9"
)

CLUSTER_DEPENDENCY_TARGET_IMAGES=(
  "${JUICEFS_MOUNT_IMAGE}"
  "${JUICEFS_CSI_DRIVER_IMAGE}"
  "${JUICEFS_CSI_DASHBOARD_IMAGE}"
  "${JUICEFS_CSI_PROVISIONER_IMAGE}"
  "${JUICEFS_CSI_RESIZER_IMAGE}"
  "${JUICEFS_CSI_LIVENESSPROBE_IMAGE}"
  "${JUICEFS_CSI_NODE_REGISTRAR_IMAGE}"
  "${INGRESS_NGINX_CONTROLLER_IMAGE}"
  "${INGRESS_NGINX_CERTGEN_IMAGE}"
)

for image in "${COMPOSE_DEPENDENCY_IMAGES[@]}" "${CLUSTER_DEPENDENCY_SOURCE_IMAGES[@]}"; do
  docker pull --platform linux/amd64 "${image}" >/dev/null
done

for idx in "${!CLUSTER_DEPENDENCY_SOURCE_IMAGES[@]}"; do
  docker tag "${CLUSTER_DEPENDENCY_SOURCE_IMAGES[$idx]}" "${CLUSTER_DEPENDENCY_TARGET_IMAGES[$idx]}"
done

save_image_archive() {
  local image="$1"
  local archive_name
  archive_name="$(printf '%s' "${image}" | tr '/:@' '---').tar"
  docker save "${image}" -o "${IMAGES_DIR}/${archive_name}"
}

for image in "${FIRST_PARTY_IMAGES[@]}" "${COMPOSE_DEPENDENCY_IMAGES[@]}" "${CLUSTER_DEPENDENCY_TARGET_IMAGES[@]}"; do
  save_image_archive "${image}"
done

cat >> "${BUNDLE_DIR}/VERSION" <<EOF
juicefs_version=${JUICEFS_VERSION}
juicefs_mount_image=${JUICEFS_MOUNT_IMAGE}
juicefs_csi_driver_image=${JUICEFS_CSI_DRIVER_IMAGE}
juicefs_csi_dashboard_image=${JUICEFS_CSI_DASHBOARD_IMAGE}
juicefs_csi_provisioner_image=${JUICEFS_CSI_PROVISIONER_IMAGE}
juicefs_csi_resizer_image=${JUICEFS_CSI_RESIZER_IMAGE}
juicefs_csi_livenessprobe_image=${JUICEFS_CSI_LIVENESSPROBE_IMAGE}
juicefs_csi_node_registrar_image=${JUICEFS_CSI_NODE_REGISTRAR_IMAGE}
ingress_nginx_version=${INGRESS_NGINX_VERSION}
ingress_nginx_controller_image=${INGRESS_NGINX_CONTROLLER_IMAGE}
ingress_nginx_certgen_image=${INGRESS_NGINX_CERTGEN_IMAGE}
EOF

(cd "${BUNDLE_DIR}" && find . -type f -print0 | sort -z | xargs -0 sha256sum > checksums.txt)

ARCHIVE_PATH="${OUT_DIR}/agentsmith-${RELEASE_ID}.tar.gz"
tar -C "${OUT_DIR}" -czf "${ARCHIVE_PATH}" "agentsmith-${RELEASE_ID}"
log "bundle ready: ${ARCHIVE_PATH}"
