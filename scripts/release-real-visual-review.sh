#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GLM_API_KEY_VALUE="${GLM_API_KEY:-}"
RUN_ID="${RELEASE_REAL_VISUAL_RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
ARTIFACT_DIR="${RELEASE_REAL_VISUAL_ARTIFACT_DIR:-${ROOT_DIR}/artifacts/release-real-visual/${RUN_ID}}"
API_PORT="${INTEGRATION_API_PORT:-20070}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3071}"
API_LOG="${INTEGRATION_API_LOG:-/tmp/agentsmith-api-real-visual.log}"
WEB_LOG="${INTEGRATION_WEB_LOG:-/tmp/agentsmith-web-real-visual.log}"

if [[ -z "${GLM_API_KEY_VALUE}" ]]; then
  echo "[real-visual-review] Missing GLM_API_KEY." >&2
  echo "[real-visual-review] Export GLM_API_KEY before running this review." >&2
  exit 1
fi

mkdir -p "${ARTIFACT_DIR}"

info() { echo "[real-visual-review] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

info "screenshots and review artifacts will be written to:"
info "  ${ARTIFACT_DIR}"
info "real lane logs:"
info "  API: ${API_LOG}"
info "  Web: ${WEB_LOG}"

run_cmd "GLM_API_KEY='${GLM_API_KEY_VALUE}' \
RELEASE_REAL_VISUAL_ARTIFACT_DIR='${ARTIFACT_DIR}' \
INTEGRATION_API_PORT='${API_PORT}' \
INTEGRATION_WEB_PORT='${WEB_PORT}' \
INTEGRATION_API_LOG='${API_LOG}' \
INTEGRATION_WEB_LOG='${WEB_LOG}' \
bash scripts/run-integration-e2e-full.sh e2e/integration-visual-review.spec.ts"

info "real visual review capture completed"
