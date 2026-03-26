#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

ensure_operator_registry_env
load_registry_env

require_cmd docker

APP_SOURCE_DIR="${RELEASE_ROOT}/sources/agentsmith"
SANDBOX_SOURCE_DIR="${RELEASE_ROOT}/sources/mbos-sandbox-v1/manager-service"
UNIVERSAL_PROXY_SOURCE_DIR="${RELEASE_ROOT}/sources/llm-universal-proxy"

[[ -d "${APP_SOURCE_DIR}" ]] || die "missing bundled agentsmith source at ${APP_SOURCE_DIR}"
[[ -d "${SANDBOX_SOURCE_DIR}" ]] || die "missing bundled sandbox manager source at ${SANDBOX_SOURCE_DIR}"
[[ -d "${UNIVERSAL_PROXY_SOURCE_DIR}" ]] || die "missing bundled universal proxy source at ${UNIVERSAL_PROXY_SOURCE_DIR}"

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

docker build -t "${APP_BASE_IMAGE}" -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-app-base" "${APP_SOURCE_DIR}"
docker build --build-arg APP_BASE_IMAGE="${APP_BASE_IMAGE}" -t "${APP_IMAGE}" -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-app" "${APP_SOURCE_DIR}"
docker build -t "${RUNNER_BASE_IMAGE}" -f "${APP_SOURCE_DIR}/infra/runner/Dockerfile.agent-codex-runner-base" "${APP_SOURCE_DIR}"
docker build --build-arg RUNNER_BASE_IMAGE="${RUNNER_BASE_IMAGE}" -t "${RUNNER_IMAGE}" -f "${APP_SOURCE_DIR}/infra/runner/Dockerfile.agent-codex-runner" "${APP_SOURCE_DIR}"
docker build -t "${VERIFY_RUNNER_BASE_IMAGE}" -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-verify-runner-base" "${APP_SOURCE_DIR}"
docker build --build-arg VERIFY_RUNNER_BASE_IMAGE="${VERIFY_RUNNER_BASE_IMAGE}" -t "${VERIFY_RUNNER_IMAGE}" -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-verify-runner" "${APP_SOURCE_DIR}"
docker build -t "${SANDBOX_MANAGER_IMAGE}" -f "${SANDBOX_SOURCE_DIR}/Dockerfile" "${SANDBOX_SOURCE_DIR}"
docker build -t "${UNIVERSAL_PROXY_IMAGE}" -f "${UNIVERSAL_PROXY_SOURCE_DIR}/Dockerfile" "${UNIVERSAL_PROXY_SOURCE_DIR}"

for image in \
  "${APP_IMAGE}" \
  "${RUNNER_IMAGE}" \
  "${VERIFY_RUNNER_IMAGE}" \
  "${SANDBOX_MANAGER_IMAGE}" \
  "${UNIVERSAL_PROXY_IMAGE}"; do
  docker push "${image}"
done

cat > "${RELEASE_ROOT}/VERSION" <<EOF
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

log "build-images ok"
