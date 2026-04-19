#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/backend-real-gate-ports.sh"

info() { echo "[internal-chat-real-gate] $*"; }
die() { echo "[internal-chat-real-gate] $*" >&2; exit 1; }

ORIGINAL_INTEGRATION_API_PORT="${INTEGRATION_API_PORT:-}"
ORIGINAL_INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT:-}"
load_backend_real_env
if [[ -n "${ORIGINAL_INTEGRATION_API_PORT}" ]]; then
  export INTEGRATION_API_PORT="${ORIGINAL_INTEGRATION_API_PORT}"
fi
if [[ -n "${ORIGINAL_INTEGRATION_WEB_PORT}" ]]; then
  export INTEGRATION_WEB_PORT="${ORIGINAL_INTEGRATION_WEB_PORT}"
fi
export_backend_real_endpoint_env

[[ -n "${BACKEND_REAL_API_KEY_VALUE:-}" ]] || die "missing PRESET_ENDPOINT_API_KEY in .env.backend-real"
[[ -n "${SANDBOX_MANAGER_URL:-}" ]] || die "missing SANDBOX_MANAGER_URL for internal chat backend-real coverage"
[[ -n "${SANDBOX_SERVICE_KEY:-}" ]] || die "missing SANDBOX_SERVICE_KEY for internal chat backend-real coverage"
[[ -n "${INTERNAL_AGENT_K8S_NAMESPACE:-}" ]] || die "missing INTERNAL_AGENT_K8S_NAMESPACE for internal chat backend-real coverage"

API_PORT="${INTEGRATION_API_PORT:-20064}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3065}"
SPEC_PATH="e2e/integration-internal-chat-runner.spec.ts"

info "running internal chat backend-real integration"
cleanup_gate_ports "${API_PORT}" "${WEB_PORT}" "${SPEC_PATH}"
(cd "${ROOT_DIR}" && \
  INTEGRATION_API_PORT="${API_PORT}" \
  INTEGRATION_WEB_PORT="${WEB_PORT}" \
  bash scripts/run-integration-e2e-full.sh "${SPEC_PATH}")

info "internal chat backend-real gate passed"
