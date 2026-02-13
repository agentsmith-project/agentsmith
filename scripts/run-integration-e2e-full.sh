#!/usr/bin/env bash
set -euo pipefail

SPEC_FILE="${1:-e2e/integration-chat.spec.ts}"
shift || true

# Always clear proxy-related env vars for deterministic local integration/e2e testing.
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

API_PORT="${INTEGRATION_API_PORT:-20000}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3001}"
BASE_URL="${BASE_URL:-http://localhost:${WEB_PORT}}"
INTEGRATION_API_BASE="${INTEGRATION_API_BASE:-http://localhost:${API_PORT}}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:18080/realms}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-mbos-frontend}"

BOOTSTRAP_DEPS="${INTEGRATION_BOOTSTRAP_DEPS:-true}"
INIT_DEPS="${INTEGRATION_INIT_DEPS:-true}"

API_LOG="${INTEGRATION_API_LOG:-/tmp/mbos-api-node-integration.log}"
WEB_LOG="${INTEGRATION_WEB_LOG:-/tmp/mbos-web-integration.log}"

run_clean() {
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY "$@"
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${port}" -sTCP:LISTEN -Pn >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :${port} )" | grep -q ":${port}"
    return $?
  fi
  return 1
}

if [[ "${BOOTSTRAP_DEPS}" == "true" ]]; then
  run_clean npm run integration:deps:up
fi

if [[ "${INIT_DEPS}" == "true" ]]; then
  run_clean npm run integration:deps:init:postgres
  run_clean npm run integration:deps:init:keycloak
fi

if port_in_use "${API_PORT}"; then
  echo "[integration-e2e-full] API port ${API_PORT} is already in use. Stop the process or set INTEGRATION_API_PORT." >&2
  exit 1
fi

if port_in_use "${WEB_PORT}"; then
  echo "[integration-e2e-full] Web port ${WEB_PORT} is already in use. Stop the process or set INTEGRATION_WEB_PORT." >&2
  exit 1
fi

PORT="${API_PORT}" \
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
run_clean npm run api:node:dev >"${API_LOG}" 2>&1 &
API_PID=$!

NEXT_PUBLIC_USE_MSW=false \
NEXT_PUBLIC_API_BASE="${INTEGRATION_API_BASE}/api/v1" \
NEXT_PUBLIC_KEYCLOAK_URL="${KEYCLOAK_URL}" \
NEXT_PUBLIC_KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
run_clean npm run dev:test -- --port "${WEB_PORT}" >"${WEB_LOG}" 2>&1 &
WEB_PID=$!

cleanup() {
  kill "${API_PID}" >/dev/null 2>&1 || true
  kill "${WEB_PID}" >/dev/null 2>&1 || true
  wait "${API_PID}" >/dev/null 2>&1 || true
  wait "${WEB_PID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

api_ready=0
for _ in $(seq 1 120); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "${INTEGRATION_API_BASE}/api/v1/workspaces" || true)"
  if [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" ]]; then
    api_ready=1
    break
  fi
  sleep 1
done

if [[ "${api_ready}" -ne 1 ]]; then
  echo "[integration-e2e-full] API did not become ready in time (last status: ${code})" >&2
  echo "--- API log tail ---" >&2
  tail -n 120 "${API_LOG}" >&2 || true
  exit 1
fi

web_ready=0
for _ in $(seq 1 120); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/en-US/login" || true)"
  if [[ "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ]]; then
    web_ready=1
    break
  fi
  sleep 1
done

if [[ "${web_ready}" -ne 1 ]]; then
  echo "[integration-e2e-full] Web did not become ready in time (last status: ${code})" >&2
  echo "--- Web log tail ---" >&2
  tail -n 120 "${WEB_LOG}" >&2 || true
  exit 1
fi

BASE_URL="${BASE_URL}" \
INTEGRATION_API_BASE="${INTEGRATION_API_BASE}" \
run_clean npx playwright test --config playwright.config.integration.ts "${SPEC_FILE}" --project=chromium --workers=1 "$@"
