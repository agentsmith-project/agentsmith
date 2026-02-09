#!/usr/bin/env bash
set -euo pipefail

SPEC_FILE="${1:-}"
if [[ -z "${SPEC_FILE}" ]]; then
  echo "Usage: $0 <spec-file>"
  exit 1
fi
shift

API_PORT="${INTEGRATION_API_PORT:-20010}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
API_LOG="${INTEGRATION_API_LOG:-/tmp/mbos-api-node-integration.log}"

PORT="${API_PORT}" \
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
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

RUN_INTEGRATION_E2E=true \
INTEGRATION_API_BASE="http://localhost:${API_PORT}" \
npx playwright test "${SPEC_FILE}" --project=chromium --workers=1 "$@"
