#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/lane-run-state.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"

SPEC_FILE="${1:-}"
if [[ -z "${SPEC_FILE}" ]]; then
  echo "Usage: $0 <spec-file>"
  exit 1
fi
shift

API_PORT="${INTEGRATION_API_PORT:-20010}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3001}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-18080}"
resolve_loopback_runtime_stack "${API_PORT}" "${WEB_PORT}" "${KEYCLOAK_PORT}" "${KEYCLOAK_REALM}" "${KEYCLOAK_CLIENT_ID}"
WEB_BASE_URL="${BASE_URL:-${RUNTIME_BROWSER_WEB_BASE_URL}}"
ensure_backend_real_state
INTEGRATION_RUN_ID="${INTEGRATION_RUN_ID:-$(lane_generate_run_id integration-with-api)}"
INTEGRATION_RUN_ROOT="${INTEGRATION_RUN_ROOT:-$(lane_prepare_run_root backend-real "${INTEGRATION_RUN_ID}" current-with-api)}"
INTEGRATION_LOG_DIR="${INTEGRATION_LOG_DIR:-${INTEGRATION_RUN_ROOT}/integration}"
mkdir -p "${INTEGRATION_LOG_DIR}"
API_LOG="${INTEGRATION_API_LOG:-${INTEGRATION_LOG_DIR}/api.log}"
PLAYWRIGHT_STATUS=1

# Always clear proxy-related env vars for deterministic local integration testing.
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

PORT="${API_PORT}" \
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
npm run api:node:dev >"${API_LOG}" 2>&1 &
API_PID=$!

cleanup() {
  kill "${API_PID}" >/dev/null 2>&1 || true
  wait "${API_PID}" >/dev/null 2>&1 || true
  if [[ "${PLAYWRIGHT_STATUS}" -eq 0 ]]; then
    lane_mark_status "${INTEGRATION_RUN_ROOT}" success
    rm -rf "${INTEGRATION_RUN_ROOT}"
    lane_remove_current_link_if_matches backend-real "${INTEGRATION_RUN_ROOT}" current-with-api
  else
    lane_mark_status "${INTEGRATION_RUN_ROOT}" failed
  fi
  lane_prune_runs backend-real "${BACKEND_REAL_KEEP_RUNS:-5}"
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "${RUNTIME_HOST_API_BASE_URL}/api/v1/workspaces" || true)"
  if [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" ]]; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "${ready}" -ne 1 ]]; then
  echo "API did not become ready in time (last status: ${code})"
  exit 1
fi

web_ready=0
for _ in $(seq 1 30); do
  web_code="$(curl -s -o /dev/null -w "%{http_code}" "${WEB_BASE_URL}/en-US/login" || true)"
  if [[ "${web_code}" == "200" || "${web_code}" == "307" || "${web_code}" == "308" ]]; then
    web_ready=1
    break
  fi
  sleep 1
done

if [[ "${web_ready}" -ne 1 ]]; then
  echo "Web did not become ready at ${WEB_BASE_URL} (last status: ${web_code:-n/a})." >&2
  echo "Hint: start frontend first, or use the *-auto make targets (for example: make e2e-int-chat-auto)." >&2
  exit 1
fi

INTEGRATION_API_BASE="${RUNTIME_HOST_API_BASE_URL}" \
BASE_URL="${WEB_BASE_URL}" \
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
npx playwright test --config playwright.config.integration.ts "${SPEC_FILE}" --project=chromium --workers=1 "$@"
PLAYWRIGHT_STATUS=0
