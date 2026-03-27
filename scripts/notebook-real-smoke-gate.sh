#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REAL_LANE_API_KEY_VALUE="${PRESET_ENDPOINT_API_KEY:-${REAL_LANE_API_KEY:-}}"
API_PORT="${INTEGRATION_API_PORT:-20060}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3061}"
API_LOG="${INTEGRATION_API_LOG:-/tmp/agentsmith-api-real-default.log}"
WEB_LOG="${INTEGRATION_WEB_LOG:-/tmp/agentsmith-web-real-default.log}"

if [[ -z "${REAL_LANE_API_KEY_VALUE}" ]]; then
  echo "[real-default-gate] Missing PRESET_ENDPOINT_API_KEY (or REAL_LANE_API_KEY alias)." >&2
  echo "[real-default-gate] Export PRESET_ENDPOINT_API_KEY (or REAL_LANE_API_KEY alias) before running this gate." >&2
  exit 1
fi

info() { echo "[real-default-gate] $*"; }

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

info "real lane logs will be written to:"
info "  API: ${API_LOG}"
info "  Web: ${WEB_LOG}"

run_cmd "REAL_LANE_API_KEY='${REAL_LANE_API_KEY_VALUE}' \
INTEGRATION_API_PORT='${API_PORT}' \
INTEGRATION_WEB_PORT='${WEB_PORT}' \
INTEGRATION_API_LOG='${API_LOG}' \
INTEGRATION_WEB_LOG='${WEB_LOG}' \
bash scripts/run-integration-e2e-full.sh e2e/integration-system-notebook-default.spec.ts"

info "system 管理侧 -> notebook 真实主链 gate passed"
