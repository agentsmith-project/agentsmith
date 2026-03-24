#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"

SPEC_FILE="${1:-e2e/integration-chat.spec.ts}"
shift || true

if [[ -f ".env.real.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.real.local"
  set +a
fi

# Always clear proxy-related env vars for deterministic local integration/e2e testing.
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

API_PORT="${INTEGRATION_API_PORT:-20000}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3001}"
PLAYWRIGHT_BASE_URL="${INTEGRATION_BASE_URL:-http://localhost:${WEB_PORT}}"
INTEGRATION_API_BASE="${INTEGRATION_API_BASE:-http://localhost:${API_PORT}}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:18080/realms}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL:-${PUBLIC_KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}}"
INTEGRATION_LOCALE="${INTEGRATION_LOCALE:-en-US}"

BOOTSTRAP_DEPS="${INTEGRATION_BOOTSTRAP_DEPS:-true}"
INIT_DEPS="${INTEGRATION_INIT_DEPS:-true}"

ensure_real_lane_state
INTEGRATION_LOG_DIR="${INTEGRATION_LOG_DIR:-$(real_lane_tmp_file integration)}"
mkdir -p "${INTEGRATION_LOG_DIR}"
API_LOG="${INTEGRATION_API_LOG:-${INTEGRATION_LOG_DIR}/api.log}"
WEB_LOG="${INTEGRATION_WEB_LOG:-${INTEGRATION_LOG_DIR}/web.log}"
API_PID=""
WEB_PID=""
PLAYWRIGHT_PID=""

run_clean() {
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY "$@"
}

start_background_job() {
  local log_file="$1"
  shift
  "$@" >"${log_file}" 2>&1 &
  echo $!
}

kill_process_tree() {
  local pid="$1"
  [[ -n "${pid}" ]] || return 0
  local child
  while read -r child; do
    [[ -n "${child}" ]] || continue
    kill_process_tree "${child}"
  done < <(pgrep -P "${pid}" 2>/dev/null || true)
  kill -TERM "${pid}" >/dev/null 2>&1 || true
}

stop_background_job() {
  local pid="$1"
  [[ -n "${pid}" ]] || return 0
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi

  kill_process_tree "${pid}"

  for _ in $(seq 1 10); do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done

  while read -r child; do
    [[ -n "${child}" ]] || continue
    kill -KILL "${child}" >/dev/null 2>&1 || true
  done < <(pgrep -P "${pid}" 2>/dev/null || true)
  kill -KILL "${pid}" >/dev/null 2>&1 || true
}

curl_status() {
  local url="$1"
  curl -s -o /dev/null -w "%{http_code}" "${url}" || true
}

warm_route() {
  local path="$1"
  local attempts="${2:-20}"
  local url="${PLAYWRIGHT_BASE_URL}${path}"
  local last_code=""
  for _ in $(seq 1 "${attempts}"); do
    last_code="$(curl_status "${url}")"
    if [[ "${last_code}" == "200" || "${last_code}" == "307" || "${last_code}" == "308" ]]; then
      # Hit the route a second time after a short pause so Next dev can finish
      # compiling and the page is less likely to open as a blank first render.
      sleep 1
      last_code="$(curl_status "${url}")"
      if [[ "${last_code}" == "200" || "${last_code}" == "307" || "${last_code}" == "308" ]]; then
        return 0
      fi
    fi
    sleep 1
  done
  echo "[integration-e2e-full] failed to warm route ${path} (last status: ${last_code})" >&2
  return 1
}

try_warm_route() {
  local path="$1"
  if ! warm_route "${path}"; then
    echo "[integration-e2e-full] continuing after non-fatal warm-up miss for ${path}" >&2
  fi
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
  run_clean make deps-ready
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

API_PID="$(
  PORT="${API_PORT}" \
  DEBUG_NOTEBOOK_EXECUTION="${DEBUG_NOTEBOOK_EXECUTION:-}" \
  KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
  PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
  INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
  KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL}" \
  KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
  DATABASE_URL="${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:15432/mbos}" \
  MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}" \
  MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}" \
  REDIS_URL="${REDIS_URL:-redis://localhost:16379}" \
  MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}" \
  MINIO_PORT="${MINIO_PORT:-19000}" \
  MINIO_USE_SSL="${MINIO_USE_SSL:-false}" \
  MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}" \
  MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}" \
  MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}" \
  SANDBOX_MANAGER_URL="${SANDBOX_MANAGER_URL:-}" \
  SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY:-}" \
  INTERNAL_AGENT_K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-}" \
  INTERNAL_AGENT_JUICEFS_CSI_DRIVER="${INTERNAL_AGENT_JUICEFS_CSI_DRIVER:-}" \
  INTERNAL_AGENT_WORKSPACE_CAPACITY="${INTERNAL_AGENT_WORKSPACE_CAPACITY:-}" \
  INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE="${INTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE:-}" \
  INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="${INTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE:-}" \
  AGENT_EXECUTION_WS_BASE_URL="${AGENT_EXECUTION_WS_BASE_URL:-}" \
  start_background_job "${API_LOG}" run_clean npm run api:node:dev
)"

WEB_PID="$(
  MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}" \
  MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}" \
  NEXT_PUBLIC_USE_MSW=false \
  AGENTSMITH_ENABLE_TEST_ROUTES=true \
  NEXT_PUBLIC_API_BASE="${INTEGRATION_API_BASE}/api/v1" \
  NEXT_PUBLIC_KEYCLOAK_URL="${KEYCLOAK_URL}" \
  NEXT_PUBLIC_KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
  NEXT_PUBLIC_KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
  start_background_job "${WEB_LOG}" run_clean npm run dev:test -- --port "${WEB_PORT}"
)"

cleanup() {
  stop_background_job "${PLAYWRIGHT_PID}"
  stop_background_job "${WEB_PID}"
  stop_background_job "${API_PID}"
  wait "${PLAYWRIGHT_PID}" >/dev/null 2>&1 || true
  wait "${WEB_PID}" >/dev/null 2>&1 || true
  wait "${API_PID}" >/dev/null 2>&1 || true
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
  code="$(curl -s -o /dev/null -w "%{http_code}" "${PLAYWRIGHT_BASE_URL}/en-US/login" || true)"
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

echo "[integration-e2e-full] warming key routes before Playwright..." >&2
try_warm_route "/${INTEGRATION_LOCALE}/login"
try_warm_route "/${INTEGRATION_LOCALE}/login/workspace"
try_warm_route "/${INTEGRATION_LOCALE}/system/login"
try_warm_route "/${INTEGRATION_LOCALE}/workspaces/ws_default/login"
try_warm_route "/${INTEGRATION_LOCALE}/workspaces/ws_default"
try_warm_route "/${INTEGRATION_LOCALE}/workspaces/ws_default/projects"

BASE_URL="${PLAYWRIGHT_BASE_URL}" \
INTEGRATION_API_BASE="${INTEGRATION_API_BASE}" \
run_clean npx playwright test --config playwright.config.integration.ts "${SPEC_FILE}" --project=chromium --workers=1 "$@" &
PLAYWRIGHT_PID=$!
wait "${PLAYWRIGHT_PID}"
