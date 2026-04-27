#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
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
API_PORT="${INTEGRATION_API_PORT:-20060}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3061}"
API_LOG="${INTEGRATION_API_LOG:-/tmp/agentsmith-api-real-default.log}"
WEB_LOG="${INTEGRATION_WEB_LOG:-/tmp/agentsmith-web-real-default.log}"

if [[ -z "${BACKEND_REAL_API_KEY_VALUE}" ]]; then
  echo "[backend-real-default-gate] Missing PRESET_ENDPOINT_API_KEY." >&2
  echo "[backend-real-default-gate] Set PRESET_ENDPOINT_API_KEY in .env.backend-real before running this gate." >&2
  exit 1
fi

info() { echo "[backend-real-default-gate] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

run_cmd "npm run contracts:check"
run_cmd "npm run contracts:check-openapi"
run_cmd "npm run openapi:check-generated"
run_cmd "npx next typegen ."
run_cmd "npx tsc --noEmit"

run_cmd "npm run test:run -- \
  'src/lib/hooks/__tests__/use-join-requests.test.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/__tests__/page.test.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/settings/__tests__/page.test.tsx'"

run_cmd "node --max-old-space-size=6144 ./node_modules/vitest/vitest.mjs run \
  'packages/api-entry-node/src/project-join-request-routes.test.ts' \
  'packages/api-entry-node/src/project-member-governance-routes.test.ts' \
  'packages/api-entry-node/src/workspace-registry.test.ts'"

info "backend-real logs will be written to:"
info "  API: ${API_LOG}"
info "  Web: ${WEB_LOG}"

info "BACKEND_REAL_API_KEY=<redacted> INTEGRATION_API_PORT='${API_PORT}' INTEGRATION_WEB_PORT='${WEB_PORT}' bash scripts/run-integration-e2e-full.sh e2e/integration-system-notebook-default.spec.ts"
(
  cd "${ROOT_DIR}" && \
    BACKEND_REAL_API_KEY="${BACKEND_REAL_API_KEY_VALUE}" \
    INTEGRATION_API_PORT="${API_PORT}" \
    INTEGRATION_WEB_PORT="${WEB_PORT}" \
    INTEGRATION_API_LOG="${API_LOG}" \
    INTEGRATION_WEB_LOG="${WEB_LOG}" \
    bash scripts/run-integration-e2e-full.sh e2e/integration-system-notebook-default.spec.ts
)

info "system 管理侧 -> notebook 真实主链 gate passed"
