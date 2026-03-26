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

ensure_operator_registry_env
load_registry_env

require_cmd docker
require_cmd tar
require_cmd sha256sum

if [[ "${SKIP_BUNDLE_INPUTS_CHECK:-0}" != "1" ]]; then
  (cd "${ROOT_DIR}" && npm run test:cluster-bundle:inputs)
  (cd "${ROOT_DIR}" && npm run test:cluster-rendered-env)
  (cd "${ROOT_DIR}" && npm run test:client-public-runtime)
fi

IMAGE_PREFIX="${REGISTRY_HOST}/${REGISTRY_PROJECT}"
JUICEFS_CSI_VERSION="${JUICEFS_CSI_VERSION:-v0.31.3}"

APP_BASE_IMAGE="agentsmith-app-base:${RELEASE_ID}"
RUNNER_BASE_IMAGE="agentsmith-codex-runner-base:${RELEASE_ID}"
VERIFY_RUNNER_BASE_IMAGE="agentsmith-verify-runner-base:${RELEASE_ID}"
APP_IMAGE="${IMAGE_PREFIX}/agentsmith-app:${RELEASE_ID}"
RUNNER_IMAGE="${IMAGE_PREFIX}/agentsmith-codex-runner:${RELEASE_ID}"
VERIFY_RUNNER_IMAGE="${IMAGE_PREFIX}/agentsmith-verify-runner:${RELEASE_ID}"
SANDBOX_MANAGER_IMAGE="${IMAGE_PREFIX}/sandbox-manager:${RELEASE_ID}"
UNIVERSAL_PROXY_IMAGE="${IMAGE_PREFIX}/llm-universal-proxy:${RELEASE_ID}"

docker login "${REGISTRY_HOST}" -u "${REGISTRY_USERNAME}" -p "${REGISTRY_PASSWORD}" >/dev/null

mkdir -p "${OUT_DIR}"
rm -rf "${BUNDLE_DIR}"
mkdir -p "${BUNDLE_DIR}" "${TOOLS_DIR}"

docker build -t "${APP_BASE_IMAGE}" -f "${ROOT_DIR}/infra/deploy/Dockerfile.agentsmith-app-base" "${ROOT_DIR}"
docker build --build-arg APP_BASE_IMAGE="${APP_BASE_IMAGE}" -t "${APP_IMAGE}" -f "${ROOT_DIR}/infra/deploy/Dockerfile.agentsmith-app" "${ROOT_DIR}"
docker build -t "${RUNNER_BASE_IMAGE}" -f "${ROOT_DIR}/infra/runner/Dockerfile.agent-codex-runner-base" "${ROOT_DIR}"
docker build --build-arg RUNNER_BASE_IMAGE="${RUNNER_BASE_IMAGE}" -t "${RUNNER_IMAGE}" -f "${ROOT_DIR}/infra/runner/Dockerfile.agent-codex-runner" "${ROOT_DIR}"
docker build -t "${VERIFY_RUNNER_BASE_IMAGE}" -f "${ROOT_DIR}/infra/deploy/Dockerfile.agentsmith-verify-runner-base" "${ROOT_DIR}"
docker build --build-arg VERIFY_RUNNER_BASE_IMAGE="${VERIFY_RUNNER_BASE_IMAGE}" -t "${VERIFY_RUNNER_IMAGE}" -f "${ROOT_DIR}/infra/deploy/Dockerfile.agentsmith-verify-runner" "${ROOT_DIR}"
docker build -t "${SANDBOX_MANAGER_IMAGE}" -f "${SANDBOX_ROOT}/manager-service/Dockerfile" "${SANDBOX_ROOT}/manager-service"
docker build -t "${UNIVERSAL_PROXY_IMAGE}" -f "${UNIVERSAL_PROXY_ROOT}/Dockerfile" "${UNIVERSAL_PROXY_ROOT}"

for image in \
  "${APP_IMAGE}" \
  "${RUNNER_IMAGE}" \
  "${VERIFY_RUNNER_IMAGE}" \
  "${SANDBOX_MANAGER_IMAGE}" \
  "${UNIVERSAL_PROXY_IMAGE}"; do
  docker push "${image}"
done

mkdir -p "${BUNDLE_DIR}/compose" "${BUNDLE_DIR}/env" "${BUNDLE_DIR}/k8s" "${BUNDLE_DIR}/scripts/cluster-deploy" "${BUNDLE_DIR}/scripts/remote-deploy/lib" "${BUNDLE_DIR}/scripts/lib" "${BUNDLE_DIR}/docs/contracts" "${BUNDLE_DIR}/docs/user-guides" "${BUNDLE_DIR}/postgres-init" "${BUNDLE_DIR}/minio" "${BUNDLE_DIR}/keycloak" "${BUNDLE_DIR}/universal-proxy" "${BUNDLE_DIR}/e2e"
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
cp "$(command -v kind)" "${TOOLS_DIR}/kind"
cp "$(command -v kubectl)" "${TOOLS_DIR}/kubectl"
chmod +x "${BUNDLE_DIR}"/scripts/cluster-deploy/*.sh "${BUNDLE_DIR}/scripts/cluster-deploy/lib.sh" "${BUNDLE_DIR}/scripts/remote-deploy/bootstrap.sh" "${BUNDLE_DIR}/scripts/lib/k8s-external-services.sh" "${TOOLS_DIR}/kind" "${TOOLS_DIR}/kubectl"

cat > "${BUNDLE_DIR}/VERSION" <<EOF
release_id=${RELEASE_ID}
agentsmith_app_image=${APP_IMAGE}
agentsmith_runner_image=${RUNNER_IMAGE}
agentsmith_verify_runner_image=${VERIFY_RUNNER_IMAGE}
sandbox_manager_image=${SANDBOX_MANAGER_IMAGE}
llm_universal_proxy_image=${UNIVERSAL_PROXY_IMAGE}
juicefs_csi_version=${JUICEFS_CSI_VERSION}
registry_host=${REGISTRY_HOST}
registry_project=${REGISTRY_PROJECT}
EOF

(cd "${BUNDLE_DIR}" && find . -type f -print0 | sort -z | xargs -0 sha256sum > checksums.txt)

ARCHIVE_PATH="${OUT_DIR}/agentsmith-${RELEASE_ID}.tar.gz"
tar -C "${OUT_DIR}" -czf "${ARCHIVE_PATH}" "agentsmith-${RELEASE_ID}"
log "bundle ready: ${ARCHIVE_PATH}"
