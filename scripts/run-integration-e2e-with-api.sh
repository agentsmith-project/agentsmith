#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"

SPEC_FILE="${1:-}"
if [[ -z "${SPEC_FILE}" ]]; then
  echo "Usage: $0 <spec-file>"
  exit 1
fi
shift

API_PORT="${INTEGRATION_API_PORT:-20010}"
WEB_BASE_URL="${BASE_URL:-http://localhost:3001}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
ensure_real_lane_state
INTEGRATION_LOG_DIR="${INTEGRATION_LOG_DIR:-$(real_lane_tmp_file integration)}"
mkdir -p "${INTEGRATION_LOG_DIR}"
API_LOG="${INTEGRATION_API_LOG:-${INTEGRATION_LOG_DIR}/api.log}"

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
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${API_PORT}/api/v1/workspaces" || true)"
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

INTEGRATION_API_BASE="http://localhost:${API_PORT}" \
BASE_URL="${WEB_BASE_URL}" \
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
npx playwright test --config playwright.config.integration.ts "${SPEC_FILE}" --project=chromium --workers=1 "$@"
