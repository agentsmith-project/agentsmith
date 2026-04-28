#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
source "${ROOT_DIR}/scripts/lib/docker-buildx-common.sh"
source "${ROOT_DIR}/scripts/lib/runner-image-common.sh"

ensure_operator_registry_env
load_registry_env

require_cmd docker

K8S_REGISTRY_HOST="${K8S_REGISTRY_HOST:-${REGISTRY_HOST}}"

APP_SOURCE_DIR="${RELEASE_ROOT}/sources/agentsmith"
SANDBOX_SOURCE_DIR="${RELEASE_ROOT}/sources/mbos-sandbox-v1/manager-service"
UNIVERSAL_PROXY_SOURCE_DIR="${RELEASE_ROOT}/sources/llm-universal-proxy"
APP_SOURCE_DIR="${APP_SOURCE_DIR_OVERRIDE:-${APP_SOURCE_DIR}}"
SANDBOX_SOURCE_DIR="${SANDBOX_SOURCE_DIR_OVERRIDE:-${SANDBOX_SOURCE_DIR}}"
UNIVERSAL_PROXY_SOURCE_DIR="${UNIVERSAL_PROXY_SOURCE_DIR_OVERRIDE:-${UNIVERSAL_PROXY_SOURCE_DIR}}"

[[ -d "${APP_SOURCE_DIR}" ]] || die "missing bundled agentsmith source at ${APP_SOURCE_DIR}"
[[ -d "${SANDBOX_SOURCE_DIR}" ]] || die "missing bundled sandbox manager source at ${SANDBOX_SOURCE_DIR}"
[[ -d "${UNIVERSAL_PROXY_SOURCE_DIR}" ]] || die "missing bundled universal proxy source at ${UNIVERSAL_PROXY_SOURCE_DIR}"

IMAGE_PREFIX="${REGISTRY_HOST}/${REGISTRY_PROJECT}"
JUICEFS_CSI_VERSION="${JUICEFS_CSI_VERSION:-v0.31.3}"
INGRESS_NGINX_VERSION="${INGRESS_NGINX_VERSION:-v1.15.1}"

APP_BASE_IMAGE="agentsmith-app-base:${RELEASE_ID}"
RUNNER_BASE_IMAGE="${RUNNER_BASE_IMAGE:-$(runner_release_base_image notebook "${RELEASE_ID}")}"
CHAT_RUNNER_BASE_IMAGE="${CHAT_RUNNER_BASE_IMAGE:-$(runner_release_base_image chat "${RELEASE_ID}")}"
VERIFY_RUNNER_BASE_IMAGE="agentsmith-verify-runner-base:${RELEASE_ID}"
APP_IMAGE="${IMAGE_PREFIX}/agentsmith-app:${RELEASE_ID}"
RUNNER_IMAGE="${RUNNER_IMAGE:-$(runner_release_image notebook "${RELEASE_ID}" "${IMAGE_PREFIX}")}"
CHAT_RUNNER_IMAGE="${CHAT_RUNNER_IMAGE:-$(runner_release_image chat "${RELEASE_ID}" "${IMAGE_PREFIX}")}"
VERIFY_RUNNER_IMAGE="${IMAGE_PREFIX}/agentsmith-verify-runner:${RELEASE_ID}"
SANDBOX_MANAGER_IMAGE="${IMAGE_PREFIX}/sandbox-manager:${RELEASE_ID}"
UNIVERSAL_PROXY_IMAGE="${IMAGE_PREFIX}/llm-universal-proxy:${RELEASE_ID}"

APP_NODE_BASE_IMAGE="${APP_NODE_BASE_IMAGE:-node:24.14.1-bookworm}"
APP_MC_IMAGE="${APP_MC_IMAGE:-minio/mc:latest}"
RUNNER_NODE_BASE_IMAGE="${RUNNER_NODE_BASE_IMAGE:-node:24.14.1-bookworm}"
VERIFY_PLAYWRIGHT_BASE_IMAGE="${VERIFY_PLAYWRIGHT_BASE_IMAGE:-mcr.microsoft.com/playwright:v1.58.1-noble}"
VERIFY_DOCKER_CLI_IMAGE="${VERIFY_DOCKER_CLI_IMAGE:-docker:28.5.1-cli}"
SANDBOX_GO_BASE_IMAGE="${SANDBOX_GO_BASE_IMAGE:-golang:1.25-alpine}"
SANDBOX_RUNTIME_BASE_IMAGE="${SANDBOX_RUNTIME_BASE_IMAGE:-ubuntu:22.04}"
UNIVERSAL_PROXY_RUST_BASE_IMAGE="${UNIVERSAL_PROXY_RUST_BASE_IMAGE:-rust:1.88-bookworm}"
UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE="${UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE:-debian:bookworm-slim}"

docker_build_local \
  --build-arg NODE_BASE_IMAGE="${APP_NODE_BASE_IMAGE}" \
  -t "${APP_BASE_IMAGE}" \
  -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-app-base" \
  "${APP_SOURCE_DIR}"
docker_build_local \
  --build-arg APP_BASE_IMAGE="${APP_BASE_IMAGE}" \
  --build-arg NODE_RUNTIME_IMAGE="${APP_NODE_BASE_IMAGE}" \
  --build-arg MC_IMAGE="${APP_MC_IMAGE}" \
  -t "${APP_IMAGE}" \
  -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-app" \
  "${APP_SOURCE_DIR}"
build_runner_image notebook "${RUNNER_BASE_IMAGE}" "${RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY:-}" "1" "1" "${APP_SOURCE_DIR}"
build_runner_image chat "${CHAT_RUNNER_BASE_IMAGE}" "${CHAT_RUNNER_IMAGE}" "${DOCKER_BUILD_PROXY:-}" "1" "1" "${APP_SOURCE_DIR}"
docker_build_local \
  --build-arg PLAYWRIGHT_IMAGE="${VERIFY_PLAYWRIGHT_BASE_IMAGE}" \
  --build-arg DOCKER_CLI_IMAGE="${VERIFY_DOCKER_CLI_IMAGE}" \
  -t "${VERIFY_RUNNER_BASE_IMAGE}" \
  -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-verify-runner-base" \
  "${APP_SOURCE_DIR}"
docker_build_local --build-arg VERIFY_RUNNER_BASE_IMAGE="${VERIFY_RUNNER_BASE_IMAGE}" -t "${VERIFY_RUNNER_IMAGE}" -f "${APP_SOURCE_DIR}/infra/deploy/Dockerfile.agentsmith-verify-runner" "${APP_SOURCE_DIR}"
docker_build_local \
  --build-arg GO_BASE_IMAGE="${SANDBOX_GO_BASE_IMAGE}" \
  --build-arg RUNTIME_BASE_IMAGE="${SANDBOX_RUNTIME_BASE_IMAGE}" \
  -t "${SANDBOX_MANAGER_IMAGE}" \
  -f "${SANDBOX_SOURCE_DIR}/Dockerfile" \
  "${SANDBOX_SOURCE_DIR}"
docker_build_local \
  --build-arg RUST_BASE_IMAGE="${UNIVERSAL_PROXY_RUST_BASE_IMAGE}" \
  --build-arg RUNTIME_BASE_IMAGE="${UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE}" \
  -t "${UNIVERSAL_PROXY_IMAGE}" \
  -f "${UNIVERSAL_PROXY_SOURCE_DIR}/Dockerfile" \
  "${UNIVERSAL_PROXY_SOURCE_DIR}"

cat > "${RELEASE_ROOT}/VERSION" <<EOF
release_id=${RELEASE_ID}
agentsmith_app_image=${APP_IMAGE}
agentsmith_runner_image=${RUNNER_IMAGE}
agentsmith_runner_k8s_image=${K8S_REGISTRY_HOST}/${REGISTRY_PROJECT}/agentsmith-notebook-codex-runner:${RELEASE_ID}
agentsmith_chat_runner_image=${CHAT_RUNNER_IMAGE}
agentsmith_chat_runner_k8s_image=${K8S_REGISTRY_HOST}/${REGISTRY_PROJECT}/agentsmith-chat-llm-runner:${RELEASE_ID}
agentsmith_verify_runner_image=${VERIFY_RUNNER_IMAGE}
sandbox_manager_image=${SANDBOX_MANAGER_IMAGE}
sandbox_manager_k8s_image=${K8S_REGISTRY_HOST}/${REGISTRY_PROJECT}/sandbox-manager:${RELEASE_ID}
llm_universal_proxy_image=${UNIVERSAL_PROXY_IMAGE}
juicefs_csi_version=${JUICEFS_CSI_VERSION}
ingress_nginx_version=${INGRESS_NGINX_VERSION}
registry_host=${REGISTRY_HOST}
k8s_registry_host=${K8S_REGISTRY_HOST}
registry_project=${REGISTRY_PROJECT}
EOF

run_build_artifact_broker_diagnostic() {
  local broker_cli="${ROOT_DIR}/scripts/governance/build-artifact-broker-cli.ts"
  local broker_runner=()
  local broker_exit=0

  if [[ ! -f "${broker_cli}" ]]; then
    log "build artifact broker diagnostic skipped: missing internal adapter at ${broker_cli}"
    return 0
  fi

  if [[ -n "${BUILD_ARTIFACT_BROKER_TSX_COMMAND:-}" ]]; then
    broker_runner=("${BUILD_ARTIFACT_BROKER_TSX_COMMAND}")
  elif [[ -x "${ROOT_DIR}/node_modules/.bin/tsx" ]]; then
    broker_runner=("${ROOT_DIR}/node_modules/.bin/tsx")
  elif command -v tsx >/dev/null 2>&1; then
    broker_runner=("$(command -v tsx)")
  else
    log "build artifact broker diagnostic skipped: missing tsx runtime"
    return 0
  fi

  "${broker_runner[@]}" "${broker_cli}" \
    --release-root "${RELEASE_ROOT}" \
    --release-id "${RELEASE_ID}" \
    --app-source-dir "${APP_SOURCE_DIR}" \
    --llmup-source-dir "${UNIVERSAL_PROXY_SOURCE_DIR}" \
    --app-image "${APP_IMAGE}" \
    --llmup-image "${UNIVERSAL_PROXY_IMAGE}" \
    --app-base-image "${APP_NODE_BASE_IMAGE}" \
    --app-base-image "${APP_MC_IMAGE}" \
    --llmup-base-image "${UNIVERSAL_PROXY_RUST_BASE_IMAGE}" \
    --llmup-base-image "${UNIVERSAL_PROXY_RUNTIME_BASE_IMAGE}" || broker_exit=$?

  if [[ "${broker_exit}" -eq 42 ]]; then
    return "${broker_exit}"
  fi
  if [[ "${broker_exit}" -ne 0 ]]; then
    log "build artifact broker diagnostic warning: adapter failed with exit ${broker_exit}"
    return 0
  fi

  if [[ -f "${RELEASE_ROOT}/build-manifest.json" ]]; then
    log "build artifact broker manifest: ${RELEASE_ROOT}/build-manifest.json"
  elif [[ -f "${RELEASE_ROOT}/build-artifact-broker-report.json" ]]; then
    log "build artifact broker diagnostic report: ${RELEASE_ROOT}/build-artifact-broker-report.json"
  fi
}

run_build_artifact_broker_diagnostic

log "build-images ok"
