#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
ORIGINAL_INTEGRATION_API_PORT="${INTEGRATION_API_PORT:-}"
ORIGINAL_INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT:-}"
load_backend_real_env "${ROOT_DIR}/.env.backend-real"
if [[ -n "${ORIGINAL_INTEGRATION_API_PORT}" ]]; then
  export INTEGRATION_API_PORT="${ORIGINAL_INTEGRATION_API_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_WEB_PORT}" ]]; then
  export INTEGRATION_WEB_PORT="${ORIGINAL_INTEGRATION_WEB_PORT}"
fi
export_backend_real_endpoint_env
RUN_ID="${RELEASE_REAL_VISUAL_RUN_ID:-$(date +%Y%m%d-%H%M%S)}"
ARTIFACT_DIR="${RELEASE_REAL_VISUAL_ARTIFACT_DIR:-${ROOT_DIR}/artifacts/backend-real-visual/${RUN_ID}}"
API_PORT="${INTEGRATION_API_PORT:-20070}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3071}"
API_LOG="${INTEGRATION_API_LOG:-/tmp/agentsmith-api-real-visual.log}"
WEB_LOG="${INTEGRATION_WEB_LOG:-/tmp/agentsmith-web-real-visual.log}"
export NEXT_DEV_MEMORY_PROFILE="${NEXT_DEV_MEMORY_PROFILE:-validation}"

if [[ -z "${BACKEND_REAL_API_KEY_VALUE}" ]]; then
  echo "[real-visual-review] Missing PRESET_ENDPOINT_API_KEY." >&2
  echo "[real-visual-review] Export PRESET_ENDPOINT_API_KEY before running this review." >&2
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
info "backend-real logs:"
info "  API: ${API_LOG}"
info "  Web: ${WEB_LOG}"

info "BACKEND_REAL_API_KEY=<redacted> RELEASE_REAL_VISUAL_ARTIFACT_DIR='${ARTIFACT_DIR}' INTEGRATION_API_PORT='${API_PORT}' INTEGRATION_WEB_PORT='${WEB_PORT}' NEXT_DEV_MEMORY_PROFILE='${NEXT_DEV_MEMORY_PROFILE}' bash scripts/run-internal-agent-task-real-gate.sh --visual-review"
(
  cd "${ROOT_DIR}" && \
    BACKEND_REAL_API_KEY="${BACKEND_REAL_API_KEY_VALUE}" \
    RELEASE_REAL_VISUAL_ARTIFACT_DIR="${ARTIFACT_DIR}" \
    UX_TRACE_OUTPUT_ROOT="${ARTIFACT_DIR}/ux-traces" \
    INTERNAL_REAL_VISUAL_ARTIFACT_DIR="${ARTIFACT_DIR}" \
    NEXT_DEV_MEMORY_PROFILE="${NEXT_DEV_MEMORY_PROFILE}" \
    INTEGRATION_API_PORT="${API_PORT}" \
    INTEGRATION_WEB_PORT="${WEB_PORT}" \
    INTEGRATION_API_LOG="${API_LOG}" \
    INTEGRATION_WEB_LOG="${WEB_LOG}" \
    bash scripts/run-internal-agent-task-real-gate.sh --visual-review
)

info "real visual review capture completed"
