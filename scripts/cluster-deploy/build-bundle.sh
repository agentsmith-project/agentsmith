#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SANDBOX_ROOT="$(cd "${ROOT_DIR}/../mbos-sandbox-v1" && pwd)"
UNIVERSAL_PROXY_ROOT="$(cd "${ROOT_DIR}/../llm-universal-proxy" && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

OUT_DIR="${OUT_DIR:-${HOME}/agentsmith/cluster-deploy/uploads}"
RELEASE_ID="${RELEASE_ID:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%SZ)}"
BUNDLE_DIR="${OUT_DIR}/agentsmith-${RELEASE_ID}"
TOOLS_DIR="${BUNDLE_DIR}/tools"

require_cmd tar
require_cmd sha256sum
require_cmd kubectl
require_cmd python3

if [[ "${SKIP_BUNDLE_INPUTS_CHECK:-0}" != "1" ]]; then
  (cd "${ROOT_DIR}" && npm run test:cluster-bundle:inputs)
  (cd "${ROOT_DIR}" && npm run test:cluster-rendered-env)
  (cd "${ROOT_DIR}" && npm run test:client-public-runtime)
fi

JUICEFS_CSI_VERSION="${JUICEFS_CSI_VERSION:-v0.31.3}"

mkdir -p "${OUT_DIR}"
rm -rf "${BUNDLE_DIR}"
mkdir -p "${BUNDLE_DIR}" "${TOOLS_DIR}"

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

mkdir -p "${BUNDLE_DIR}/compose" "${BUNDLE_DIR}/env" "${BUNDLE_DIR}/k8s" "${BUNDLE_DIR}/scripts/cluster-deploy" "${BUNDLE_DIR}/scripts/remote-deploy/lib" "${BUNDLE_DIR}/scripts/lib" "${BUNDLE_DIR}/docs/contracts" "${BUNDLE_DIR}/docs/user-guides" "${BUNDLE_DIR}/postgres-init" "${BUNDLE_DIR}/minio" "${BUNDLE_DIR}/keycloak" "${BUNDLE_DIR}/universal-proxy" "${BUNDLE_DIR}/e2e" "${BUNDLE_DIR}/sources/agentsmith" "${BUNDLE_DIR}/sources/mbos-sandbox-v1/manager-service" "${BUNDLE_DIR}/sources/llm-universal-proxy"
cp "${ROOT_DIR}/infra/deploy/cluster/docker-compose.yml" "${BUNDLE_DIR}/compose/docker-compose.yml"
cp "${ROOT_DIR}/infra/deploy/cluster/deployment.manifest.json" "${BUNDLE_DIR}/deployment.manifest.json"
cp "${ROOT_DIR}/infra/deploy/cluster/env/site.env.example" "${BUNDLE_DIR}/env/site.env.example"
cp "${ROOT_DIR}/infra/deploy/cluster/env/registry.env.example" "${BUNDLE_DIR}/env/registry.env.example"
cp "${ROOT_DIR}/infra/deploy/cluster/env/kubeconfig.example.yaml" "${BUNDLE_DIR}/env/kubeconfig.example.yaml"
cp "${ROOT_DIR}/infra/deploy/remote/k8s/juicefs-csi.yaml" "${BUNDLE_DIR}/k8s/juicefs-csi.yaml"
cp "${ROOT_DIR}/infra/integration/postgres-init/001-create-databases.sql" "${BUNDLE_DIR}/postgres-init/"
cp "${ROOT_DIR}/packages/adapters-private/sql/projects.sql" "${BUNDLE_DIR}/postgres-init/"
cp "${ROOT_DIR}/infra/integration/minio/init-minio.sh" "${BUNDLE_DIR}/minio/"
cp "${ROOT_DIR}/infra/integration/keycloak/realm-mbos-dev.json" "${BUNDLE_DIR}/keycloak/"
cp "${ROOT_DIR}/infra/deploy/remote/universal-proxy/config.yaml" "${BUNDLE_DIR}/universal-proxy/config.yaml"
cp "${ROOT_DIR}/scripts/cluster-deploy/"*.sh "${BUNDLE_DIR}/scripts/cluster-deploy/"
cp "${ROOT_DIR}/scripts/cluster-deploy/lib.sh" "${BUNDLE_DIR}/scripts/cluster-deploy/lib.sh"
cp "${ROOT_DIR}/scripts/remote-deploy/bootstrap.sh" "${BUNDLE_DIR}/scripts/remote-deploy/bootstrap.sh"
cp "${ROOT_DIR}/scripts/remote-deploy/lib/common.sh" "${BUNDLE_DIR}/scripts/remote-deploy/lib/common.sh"
cp "${ROOT_DIR}/scripts/lib/k8s-external-services.sh" "${BUNDLE_DIR}/scripts/lib/k8s-external-services.sh"
cp "${ROOT_DIR}/e2e/integration-real-helpers.ts" "${BUNDLE_DIR}/e2e/integration-real-helpers.ts"
cp "${ROOT_DIR}/e2e/integration-workspace-entry.spec.ts" "${BUNDLE_DIR}/e2e/integration-workspace-entry.spec.ts"
cp "${ROOT_DIR}/e2e/integration-workspace-publish-usable.spec.ts" "${BUNDLE_DIR}/e2e/integration-workspace-publish-usable.spec.ts"
cp "${ROOT_DIR}/e2e/integration-preset-external-file-library.spec.ts" "${BUNDLE_DIR}/e2e/integration-preset-external-file-library.spec.ts"
cp "${ROOT_DIR}/e2e/integration-release-user-story.spec.ts" "${BUNDLE_DIR}/e2e/integration-release-user-story.spec.ts"
cp "${ROOT_DIR}/docs/contracts/cluster-deployment-spec-v1.md" "${BUNDLE_DIR}/docs/contracts/cluster-deployment-spec-v1.md"
cp "${ROOT_DIR}/docs/user-guides/cluster-deploy-operations.md" "${BUNDLE_DIR}/docs/user-guides/cluster-deploy-operations.md"
cp "$(PATH="${ORIGINAL_PATH}" type -P kubectl)" "${TOOLS_DIR}/kubectl"
chmod +x "${BUNDLE_DIR}"/scripts/cluster-deploy/*.sh "${BUNDLE_DIR}/scripts/cluster-deploy/lib.sh" "${BUNDLE_DIR}/scripts/remote-deploy/bootstrap.sh" "${BUNDLE_DIR}/scripts/lib/k8s-external-services.sh" "${TOOLS_DIR}/kubectl"

copy_source_tree "${ROOT_DIR}" "${BUNDLE_DIR}/sources/agentsmith"
copy_source_tree "${SANDBOX_ROOT}/manager-service" "${BUNDLE_DIR}/sources/mbos-sandbox-v1/manager-service"
copy_source_tree "${UNIVERSAL_PROXY_ROOT}" "${BUNDLE_DIR}/sources/llm-universal-proxy"

cat > "${BUNDLE_DIR}/VERSION" <<EOF
release_id=${RELEASE_ID}
juicefs_csi_version=${JUICEFS_CSI_VERSION}
EOF

(cd "${BUNDLE_DIR}" && find . -type f -print0 | sort -z | xargs -0 sha256sum > checksums.txt)

ARCHIVE_PATH="${OUT_DIR}/agentsmith-${RELEASE_ID}.tar.gz"
tar -C "${OUT_DIR}" -czf "${ARCHIVE_PATH}" "agentsmith-${RELEASE_ID}"
log "bundle ready: ${ARCHIVE_PATH}"
