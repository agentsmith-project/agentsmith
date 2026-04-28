#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SANDBOX_ROOT="$(cd "${ROOT_DIR}/../mbos-sandbox-v1" && pwd)"
OUT_DIR="${OUT_DIR:-${HOME}/agentsmith/cluster-deploy/uploads}"
RELEASE_ID="${RELEASE_ID:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%SZ)}"
export DEPLOY_COMMON_IGNORE_CURRENT_RELEASE=1
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
source "${ROOT_DIR}/scripts/lib/ensure-juicefs-vendor.sh"
source "${ROOT_DIR}/scripts/lib/image-archive-manifest.sh"
source "${ROOT_DIR}/scripts/lib/release-story-verify-source-set.sh"
RELEASE_STORY_SOURCE_SET_NAME="$(release_story_verify_source_set_name)"
RELEASE_STORY_SOURCE_SET_HELPER="$(release_story_verify_source_set_helper_path)"

BUNDLE_DIR="${OUT_DIR}/agentsmith-${RELEASE_ID}"
IMAGES_DIR="${BUNDLE_DIR}/images"
TOOLS_DIR="${BUNDLE_DIR}/tools"
BUNDLED_IMAGE_ARCHIVES_INCLUDED=1
if [[ "${SKIP_BUNDLED_IMAGE_ARCHIVE_GENERATION:-0}" == "1" ]]; then
  BUNDLED_IMAGE_ARCHIVES_INCLUDED=0
fi

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
mkdir -p "${BUNDLE_DIR}" "${TOOLS_DIR}"
if [[ "${BUNDLED_IMAGE_ARCHIVES_INCLUDED}" == "1" ]]; then
  mkdir -p "${IMAGES_DIR}"
fi

copy_bundle_file() {
  local source_file="$1"
  local target_file="$2"
  rm -rf "${target_file}"
  mkdir -p "$(dirname "${target_file}")"
  cp "${source_file}" "${target_file}"
}

mkdir -p "${BUNDLE_DIR}/compose" "${BUNDLE_DIR}/env" "${BUNDLE_DIR}/scripts/cluster-deploy" "${BUNDLE_DIR}/scripts/lib" "${BUNDLE_DIR}/docs/contracts" "${BUNDLE_DIR}/docs/user-guides" "${BUNDLE_DIR}/infra/deploy/cluster/admin-examples" "${BUNDLE_DIR}/infra/runtime" "${BUNDLE_DIR}/addons/ingress-nginx" "${BUNDLE_DIR}/addons/juicefs-csi" "${BUNDLE_DIR}/postgres-init" "${BUNDLE_DIR}/minio" "${BUNDLE_DIR}/keycloak" "${BUNDLE_DIR}/universal-proxy" "${BUNDLE_DIR}/e2e"
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
cp "${ROOT_DIR}/scripts/file-library-real-smoke.sh" "${BUNDLE_DIR}/scripts/file-library-real-smoke.sh"
cp "${ROOT_DIR}/scripts/notebook-agent-refresh-token.js" "${BUNDLE_DIR}/scripts/notebook-agent-refresh-token.js"
cp "${ROOT_DIR}/scripts/cluster-deploy/"*.sh "${BUNDLE_DIR}/scripts/cluster-deploy/"
rm -f \
  "${BUNDLE_DIR}/scripts/cluster-deploy/build-bundle.sh" \
  "${BUNDLE_DIR}/scripts/cluster-deploy/build-images.sh"
cp "${ROOT_DIR}/scripts/cluster-upgrade-smoke.sh" "${BUNDLE_DIR}/scripts/cluster-upgrade-smoke.sh"
cp "${ROOT_DIR}/scripts/cluster-deploy/lib.sh" "${BUNDLE_DIR}/scripts/cluster-deploy/lib.sh"
cp "${ROOT_DIR}/scripts/lib/deploy-common.sh" "${BUNDLE_DIR}/scripts/lib/deploy-common.sh"
cp "${ROOT_DIR}/scripts/lib/release-stage-common.sh" "${BUNDLE_DIR}/scripts/lib/release-stage-common.sh"
cp "${ROOT_DIR}/scripts/lib/bootstrap-common.sh" "${BUNDLE_DIR}/scripts/lib/bootstrap-common.sh"
cp "${ROOT_DIR}/scripts/lib/k8s-external-services.sh" "${BUNDLE_DIR}/scripts/lib/k8s-external-services.sh"
cp "${ROOT_DIR}/scripts/lib/preset-common.sh" "${BUNDLE_DIR}/scripts/lib/preset-common.sh"
cp "${ROOT_DIR}/scripts/lib/release-story-verify-source-set.sh" "${BUNDLE_DIR}/scripts/lib/release-story-verify-source-set.sh"
cp "${ROOT_DIR}/scripts/lib/runtime-verification.sh" "${BUNDLE_DIR}/scripts/lib/runtime-verification.sh"
mkdir -p "${BUNDLE_DIR}/scripts/substrate"
cp "${ROOT_DIR}/scripts/substrate/deploy-common.sh" "${BUNDLE_DIR}/scripts/substrate/deploy-common.sh"
mkdir -p "${BUNDLE_DIR}/scripts/app"
cp "${ROOT_DIR}/scripts/app/deploy-common.sh" "${BUNDLE_DIR}/scripts/app/deploy-common.sh"
cp "${ROOT_DIR}/infra/runtime/presets.env" "${BUNDLE_DIR}/infra/runtime/presets.env"
cp -R "${ROOT_DIR}/infra/deploy/cluster/addons/ingress-nginx/." "${BUNDLE_DIR}/addons/ingress-nginx/"
cp -R "${ROOT_DIR}/infra/deploy/cluster/addons/juicefs-csi/." "${BUNDLE_DIR}/addons/juicefs-csi/"
copy_bundle_file "${ROOT_DIR}/e2e/integration-real-helpers.ts" "${BUNDLE_DIR}/e2e/integration-real-helpers.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-files.spec.ts" "${BUNDLE_DIR}/e2e/integration-files.spec.ts"
copy_bundle_file "${ROOT_DIR}/e2e/notebook-execution-outcome.ts" "${BUNDLE_DIR}/e2e/notebook-execution-outcome.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-workspace-access.ts" "${BUNDLE_DIR}/e2e/integration-workspace-access.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-workspace-entry.spec.ts" "${BUNDLE_DIR}/e2e/integration-workspace-entry.spec.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-workspace-publish-usable.spec.ts" "${BUNDLE_DIR}/e2e/integration-workspace-publish-usable.spec.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-preset-external-file-library.spec.ts" "${BUNDLE_DIR}/e2e/integration-preset-external-file-library.spec.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-internal-chat-runner.spec.ts" "${BUNDLE_DIR}/e2e/integration-internal-chat-runner.spec.ts"
copy_bundle_file "${ROOT_DIR}/e2e/integration-chat-local-upstream.ts" "${BUNDLE_DIR}/e2e/integration-chat-local-upstream.ts"
copy_bundle_file "${ROOT_DIR}/e2e/internal-chat-isolation-probe.ts" "${BUNDLE_DIR}/e2e/internal-chat-isolation-probe.ts"
while IFS= read -r relative_path; do
  [[ -n "${relative_path}" ]] || continue
  copy_bundle_file "${ROOT_DIR}/${relative_path}" "${BUNDLE_DIR}/${relative_path}"
done < <(release_story_verify_source_set "${ROOT_DIR}")
cp "${ROOT_DIR}/docs/user-guides/cluster-admin-runbook.md" "${BUNDLE_DIR}/docs/user-guides/cluster-admin-runbook.md"
cp "${ROOT_DIR}/docs/contracts/cluster-deployment-spec-v1.md" "${BUNDLE_DIR}/docs/contracts/cluster-deployment-spec-v1.md"
cp "${ROOT_DIR}/docs/user-guides/cluster-deploy-operations.md" "${BUNDLE_DIR}/docs/user-guides/cluster-deploy-operations.md"
cp "${ROOT_DIR}/docs/user-guides/cluster-upgrade-operations.md" "${BUNDLE_DIR}/docs/user-guides/cluster-upgrade-operations.md"
cp "$(PATH="${ORIGINAL_PATH}" type -P kubectl)" "${TOOLS_DIR}/kubectl"
chmod +x "${BUNDLE_DIR}/scripts/check-preset-external-file-library.sh" "${BUNDLE_DIR}/scripts/cluster-upgrade-smoke.sh" "${BUNDLE_DIR}"/scripts/cluster-deploy/*.sh "${BUNDLE_DIR}/scripts/cluster-deploy/lib.sh" "${BUNDLE_DIR}/scripts/lib/"*.sh "${TOOLS_DIR}/kubectl"

DEPLOY_ROOT="${OUT_DIR}/.cluster-build-${RELEASE_ID}" \
RELEASE_ROOT="${BUNDLE_DIR}" \
APP_SOURCE_DIR_OVERRIDE="${ROOT_DIR}" \
SANDBOX_SOURCE_DIR_OVERRIDE="${SANDBOX_ROOT}/manager-service" \
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
CHAT_RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_chat_runner_image"{print $2}' "${BUNDLE_DIR}/VERSION")"
VERIFY_RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_verify_runner_image"{print $2}' "${BUNDLE_DIR}/VERSION")"
SANDBOX_MANAGER_IMAGE="$(awk -F= '$1=="sandbox_manager_image"{print $2}' "${BUNDLE_DIR}/VERSION")"
UNIVERSAL_PROXY_IMAGE="$(awk -F= '$1=="llm_universal_proxy_image"{print $2}' "${BUNDLE_DIR}/VERSION")"

FIRST_PARTY_IMAGES=(
  "${APP_IMAGE}"
  "${RUNNER_IMAGE}"
  "${CHAT_RUNNER_IMAGE}"
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
  "registry:2"
  "kindest/node:v1.32.2"
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

ensure_local_image() {
  local image="$1"
  if [[ "${FORCE_REFRESH_DEPENDENCY_IMAGES:-0}" == "1" ]]; then
    docker pull --platform linux/amd64 "${image}" >/dev/null
    return
  fi

  if docker image inspect "${image}" >/dev/null 2>&1; then
    log "reuse local image: ${image}"
    return
  fi

  docker pull --platform linux/amd64 "${image}" >/dev/null
}

for image in "${COMPOSE_DEPENDENCY_IMAGES[@]}" "${CLUSTER_DEPENDENCY_SOURCE_IMAGES[@]}"; do
  ensure_local_image "${image}"
done

for idx in "${!CLUSTER_DEPENDENCY_SOURCE_IMAGES[@]}"; do
  docker tag "${CLUSTER_DEPENDENCY_SOURCE_IMAGES[$idx]}" "${CLUSTER_DEPENDENCY_TARGET_IMAGES[$idx]}"
done

save_image_archive() {
  local image="$1"
  local archive_name
  archive_name="$(printf '%s' "${image}" | tr '/:@' '---').tar"
  save_image_archive_with_cache \
    "${image}" \
    "${IMAGES_DIR}/${archive_name}" \
    "${OUT_DIR}" \
    "${BUNDLE_DIR}" \
    "default" \
    "linux/amd64"
}

if [[ "${BUNDLED_IMAGE_ARCHIVES_INCLUDED}" == "1" ]]; then
  for image in "${FIRST_PARTY_IMAGES[@]}" "${COMPOSE_DEPENDENCY_IMAGES[@]}" "${CLUSTER_DEPENDENCY_TARGET_IMAGES[@]}"; do
    save_image_archive "${image}"
  done
else
  log "skipped bundled image archive generation for ${BUNDLE_DIR}"
fi

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
bundled_image_archives_included=${BUNDLED_IMAGE_ARCHIVES_INCLUDED}
EOF

if [[ "${BUNDLED_IMAGE_ARCHIVES_INCLUDED}" == "1" ]]; then
  write_image_archive_manifest "${BUNDLE_DIR}" "${RELEASE_ID}" "scripts/cluster-deploy/build-bundle.sh" "linux/amd64"
fi

(cd "${BUNDLE_DIR}" && find . -type f -print0 | sort -z | xargs -0 sha256sum > checksums.txt)

mapfile -t release_story_runtime_files < <(release_story_verify_source_set "${ROOT_DIR}")
python3 - <<'PY' "${BUNDLE_DIR}/deployment.manifest.json" "${BUNDLE_DIR}" "${RELEASE_STORY_SOURCE_SET_NAME}" "${RELEASE_STORY_SOURCE_SET_HELPER}" "${release_story_runtime_files[@]}"
import json
import pathlib
import sys

manifest_path = pathlib.Path(sys.argv[1])
bundle_root = pathlib.Path(sys.argv[2])
expected_source_set_name = sys.argv[3]
expected_source_set_helper = sys.argv[4]
required_source_files = sys.argv[5:]
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))

for relative in manifest.get("bundle_files", []):
    path = bundle_root / relative
    if not path.exists():
        raise SystemExit(f"missing_bundle_file:{relative}")

bundle_source_sets = manifest.get("bundle_source_sets", [])
if not any(
    isinstance(entry, dict)
    and entry.get("name") == expected_source_set_name
    and entry.get("helper") == expected_source_set_helper
    for entry in bundle_source_sets
):
    raise SystemExit(f"missing_bundle_source_set:{expected_source_set_name}")

for relative in required_source_files:
    path = bundle_root / relative
    if not path.exists():
        raise SystemExit(f"missing_bundle_source_set_file:{relative}")
PY

TMP_TAR_PATH="${OUT_DIR}/agentsmith-${RELEASE_ID}.tar.gz.tmp"
FINAL_TAR_PATH="${OUT_DIR}/agentsmith-${RELEASE_ID}.tar.gz"
if [[ "${SKIP_RELEASE_ARCHIVE:-0}" == "1" ]]; then
  log "skipped release archive packaging for ${BUNDLE_DIR}"
else
  rm -f "${TMP_TAR_PATH}" "${FINAL_TAR_PATH}"
  (cd "${OUT_DIR}" && tar -czf "${TMP_TAR_PATH##*/}" "agentsmith-${RELEASE_ID}")
  mv "${TMP_TAR_PATH}" "${FINAL_TAR_PATH}"
  log "bundle ready: ${FINAL_TAR_PATH}"
fi
