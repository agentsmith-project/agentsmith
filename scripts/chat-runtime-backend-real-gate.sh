#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"

info() { echo "[chat-runtime-backend-real-gate] $*"; }
die() { echo "[chat-runtime-backend-real-gate] $*" >&2; exit 1; }

load_backend_real_env
export_backend_real_endpoint_env
export INTEGRATION_API_PORT="20061"
export INTEGRATION_WEB_PORT="3062"

if [[ -z "${BACKEND_REAL_API_KEY_VALUE:-}" ]]; then
  die "missing PRESET_ENDPOINT_API_KEY in .env.backend-real"
fi

run_grep() {
  local spec="$1"
  local label="$2"
  if [[ -n "${label}" ]]; then
    info "running ${spec} --grep ${label}"
    (cd "${ROOT_DIR}" && \
      INTEGRATION_API_PORT="${INTEGRATION_API_PORT}" \
      INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT}" \
      bash scripts/run-integration-e2e-full.sh "${spec}" --grep "${label}")
    return
  fi
  info "running ${spec}"
  (cd "${ROOT_DIR}" && \
    INTEGRATION_API_PORT="${INTEGRATION_API_PORT}" \
    INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT}" \
    bash scripts/run-integration-e2e-full.sh "${spec}")
}

run_grep e2e/integration-chat-llm-runner.spec.ts ""
run_grep e2e/integration-membership-chat-isolation.spec.ts ""

info "chat runtime backend-real gate passed"
