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
INGRESS_NGINX_VERSION="${INGRESS_NGINX_VERSION:-v1.15.1}"

APP_BASE_IMAGE="agentsmith-app-base:${RELEASE_ID}"
RUNNER_BASE_IMAGE="agentsmith-codex-runner-base:${RELEASE_ID}"
VERIFY_RUNNER_BASE_IMAGE="agentsmith-verify-runner-base:${RELEASE_ID}"
APP_IMAGE="${IMAGE_PREFIX}/agentsmith-app:${RELEASE_ID}"
RUNNER_IMAGE="${IMAGE_PREFIX}/agentsmith-codex-runner:${RELEASE_ID}"
VERIFY_RUNNER_IMAGE="${IMAGE_PREFIX}/agentsmith-verify-runner:${RELEASE_ID}"
SANDBOX_MANAGER_IMAGE="${IMAGE_PREFIX}/sandbox-manager:${RELEASE_ID}"
UNIVERSAL_PROXY_IMAGE="${IMAGE_PREFIX}/llm-universal-proxy:${RELEASE_ID}"

APP_NODE_BASE_IMAGE="${APP_NODE_BASE_IMAGE:-node:22-bookworm}"
RUNNER_NODE_BASE_IMAGE="${RUNNER_NODE_BASE_IMAGE:-node:22-bookworm}"
VERIFY_PLAYWRIGHT_BASE_IMAGE="${VERIFY_PLAYWRIGHT_BASE_IMAGE:-mcr.microsoft.com/playwright:v1.58.1-noble}"
VERIFY_DOCKER_CLI_IMAGE="${VERIFY_DOCKER_CLI_IMAGE:-docker:28.5.1-cli}"
SANDBOX_GO_BASE_IMAGE="${SANDBOX_GO_BASE_IMAGE:-golang:1.25-alpine}"
SANDBOX_RUNTIME_BASE_IMAGE="${SANDBOX_RUNTIME_BASE_IMAGE:-ubuntu:22.04}"
UNIVERSAL_PROXY_RUST_BASE_IMAGE="${UNIVERSAL_PROXY_RUST_BASE_IMAGE:-rust:1.88-bookworm}"
UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE="${UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE:-debian:bookworm-slim}"

docker build \
  --build-arg NODE_BASE_IMAGE="${APP_NODE_BASE_IMAGE}" \
  -t "${APP_BASE_IMAGE}" \
  -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-app-base" \
  "${APP_SOURCE_DIR}"
docker build \
  --build-arg APP_BASE_IMAGE="${APP_BASE_IMAGE}" \
  --build-arg NODE_RUNTIME_IMAGE="${APP_NODE_BASE_IMAGE}" \
  -t "${APP_IMAGE}" \
  -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-app" \
  "${APP_SOURCE_DIR}"
docker build \
  --build-arg NODE_BASE_IMAGE="${RUNNER_NODE_BASE_IMAGE}" \
  -t "${RUNNER_BASE_IMAGE}" \
  -f "${APP_SOURCE_DIR}/infra/runner/Dockerfile.agent-codex-runner-base" \
  "${APP_SOURCE_DIR}"
docker build --build-arg RUNNER_BASE_IMAGE="${RUNNER_BASE_IMAGE}" -t "${RUNNER_IMAGE}" -f "${APP_SOURCE_DIR}/infra/runner/Dockerfile.agent-codex-runner" "${APP_SOURCE_DIR}"
docker build \
  --build-arg PLAYWRIGHT_IMAGE="${VERIFY_PLAYWRIGHT_BASE_IMAGE}" \
  --build-arg DOCKER_CLI_IMAGE="${VERIFY_DOCKER_CLI_IMAGE}" \
  -t "${VERIFY_RUNNER_BASE_IMAGE}" \
  -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-verify-runner-base" \
  "${APP_SOURCE_DIR}"
docker build --build-arg VERIFY_RUNNER_BASE_IMAGE="${VERIFY_RUNNER_BASE_IMAGE}" -t "${VERIFY_RUNNER_IMAGE}" -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-verify-runner" "${APP_SOURCE_DIR}"
docker build \
  --build-arg GO_BASE_IMAGE="${SANDBOX_GO_BASE_IMAGE}" \
  --build-arg RUNTIME_BASE_IMAGE="${SANDBOX_RUNTIME_BASE_IMAGE}" \
  -t "${SANDBOX_MANAGER_IMAGE}" \
  -f "${SANDBOX_SOURCE_DIR}/Dockerfile" \
  "${SANDBOX_SOURCE_DIR}"
docker build \
  --build-arg RUST_BASE_IMAGE="${UNIVERSAL_PROXY_RUST_BASE_IMAGE}" \
  --build-arg RUNTIME_BASE_IMAGE="${UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE}" \
  -t "${UNIVERSAL_PROXY_IMAGE}" \
  -f "${UNIVERSAL_PROXY_SOURCE_DIR}/Dockerfile" \
  "${UNIVERSAL_PROXY_SOURCE_DIR}"

cat > "${RELEASE_ROOT}/VERSION" <<EOF
release_id=${RELEASE_ID}
agentsmith_app_image=${APP_IMAGE}
agentsmith_runner_image=${RUNNER_IMAGE}
agentsmith_verify_runner_image=${VERIFY_RUNNER_IMAGE}
sandbox_manager_image=${SANDBOX_MANAGER_IMAGE}
llm_universal_proxy_image=${UNIVERSAL_PROXY_IMAGE}
juicefs_csi_version=${JUICEFS_CSI_VERSION}
ingress_nginx_version=${INGRESS_NGINX_VERSION}
registry_host=${REGISTRY_HOST}
registry_project=${REGISTRY_PROJECT}
EOF

log "build-images ok"
