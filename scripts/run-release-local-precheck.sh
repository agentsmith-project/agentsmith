#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"
ensure_real_lane_state

if [[ -f "${ROOT_DIR}/.env.real.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env.real.local"
  set +a
fi

REAL_LANE_API_KEY_VALUE="${REAL_LANE_API_KEY:-}"
if [[ -z "${REAL_LANE_API_KEY_VALUE}" ]]; then
  echo "[release-local-precheck] Missing REAL_LANE_API_KEY." >&2
  exit 1
fi

API_PORT="${INTEGRATION_API_PORT:-20090}"
WEB_PORT="${INTEGRATION_WEB_PORT:-3091}"
PLAYWRIGHT_BASE_URL="${INTEGRATION_BASE_URL:-http://localhost:${WEB_PORT}}"
INTEGRATION_API_BASE="${INTEGRATION_API_BASE:-http://localhost:${API_PORT}}"
EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL="${EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL:-${INTEGRATION_API_BASE}}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_URL="${KEYCLOAK_URL:-${KEYCLOAK_BASE_URL}/realms}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL:-${PUBLIC_KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}}"
INTEGRATION_LOCALE="${INTEGRATION_LOCALE:-en-US}"
INTEGRATION_DEV_ADMIN_USERNAME="${INTEGRATION_DEV_ADMIN_USERNAME:-dev-admin}"
INTEGRATION_DEV_ADMIN_PASSWORD="${INTEGRATION_DEV_ADMIN_PASSWORD:-dev-admin-123}"
BOOTSTRAP_DEPS="${INTEGRATION_BOOTSTRAP_DEPS:-true}"
INIT_DEPS="${INTEGRATION_INIT_DEPS:-true}"

INTEGRATION_LOG_DIR="${INTEGRATION_LOG_DIR:-$(real_lane_tmp_file release-local-precheck)}"
mkdir -p "${INTEGRATION_LOG_DIR}"
API_LOG="${INTEGRATION_API_LOG:-${INTEGRATION_LOG_DIR}/api.log}"
WEB_LOG="${INTEGRATION_WEB_LOG:-${INTEGRATION_LOG_DIR}/web.log}"
API_PID=""
WEB_PID=""
PLAYWRIGHT_PID=""

info() {
  echo "[release-local-precheck] $*"
}

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

tcp_ready() {
  local host="$1"
  local port="$2"
  python3 - "$host" "$port" <<'PY'
import socket, sys
host = sys.argv[1]
port = int(sys.argv[2])
sock = socket.socket()
sock.settimeout(1.0)
try:
    sock.connect((host, port))
except OSError:
    sys.exit(1)
finally:
    sock.close()
PY
}

deps_ready() {
  tcp_ready "127.0.0.1" "15432" || return 1
  tcp_ready "127.0.0.1" "17017" || return 1
  tcp_ready "127.0.0.1" "16379" || return 1
  [[ "$(curl_status "${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration")" == "200" ]] || return 1
  [[ "$(curl_status "http://localhost:19000/minio/health/live")" == "200" ]] || return 1
  return 0
}

integration_compose_postgres_running() {
  docker compose -f "${ROOT_DIR}/infra/integration/docker-compose.yml" ps --status running postgres | grep -q postgres
}

warm_route() {
  local path="$1"
  local attempts="${2:-20}"
  local url="${PLAYWRIGHT_BASE_URL}${path}"
  local last_code=""
  for _ in $(seq 1 "${attempts}"); do
    last_code="$(curl_status "${url}")"
    if [[ "${last_code}" == "200" || "${last_code}" == "307" || "${last_code}" == "308" ]]; then
      sleep 1
      last_code="$(curl_status "${url}")"
      if [[ "${last_code}" == "200" || "${last_code}" == "307" || "${last_code}" == "308" ]]; then
        return 0
      fi
    fi
    sleep 1
  done
  echo "[release-local-precheck] failed to warm route ${path} (last status: ${last_code})" >&2
  return 1
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

json_extract_access_token() {
  python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("access_token",""))'
}

cleanup() {
  stop_background_job "${PLAYWRIGHT_PID}"
  stop_background_job "${WEB_PID}"
  stop_background_job "${API_PID}"
  wait "${PLAYWRIGHT_PID}" >/dev/null 2>&1 || true
  wait "${WEB_PID}" >/dev/null 2>&1 || true
  wait "${API_PID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [[ "${BOOTSTRAP_DEPS}" == "true" ]]; then
  if deps_ready; then
    info "reusing existing local integration dependencies"
  else
    run_clean npm run integration:deps:up
    run_clean make deps-ready
  fi
fi

if [[ "${INIT_DEPS}" == "true" ]]; then
  if integration_compose_postgres_running; then
    run_clean npm run integration:deps:init:postgres
  else
    info "skipping compose-specific postgres init while reusing existing local dependencies"
  fi
  INTEGRATION_WEB_PORT="${WEB_PORT}" \
  INTEGRATION_PUBLIC_WEB_BASES="${PLAYWRIGHT_BASE_URL}" \
  PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
  INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
  KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
  KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
  run_clean npm run integration:deps:init:keycloak
fi

if port_in_use "${API_PORT}"; then
  echo "[release-local-precheck] API port ${API_PORT} is already in use. Stop the process or set INTEGRATION_API_PORT." >&2
  exit 1
fi

if port_in_use "${WEB_PORT}"; then
  echo "[release-local-precheck] Web port ${WEB_PORT} is already in use. Stop the process or set INTEGRATION_WEB_PORT." >&2
  exit 1
fi

API_PID="$(
  PORT="${API_PORT}" \
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
  EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL="${EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL}" \
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
  echo "[release-local-precheck] API did not become ready in time (last status: ${code})" >&2
  tail -n 120 "${API_LOG}" >&2 || true
  exit 1
fi

web_ready=0
for _ in $(seq 1 120); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "${PLAYWRIGHT_BASE_URL}/en-US/login/workspace" || true)"
  if [[ "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ]]; then
    web_ready=1
    break
  fi
  sleep 1
done

if [[ "${web_ready}" -ne 1 ]]; then
  echo "[release-local-precheck] Web did not become ready in time (last status: ${code})" >&2
  tail -n 120 "${WEB_LOG}" >&2 || true
  exit 1
fi

warm_route "/${INTEGRATION_LOCALE}/login/workspace"
warm_route "/${INTEGRATION_LOCALE}/system/login"
warm_route "/${INTEGRATION_LOCALE}/workspaces/ws_default/login"
warm_route "/${INTEGRATION_LOCALE}/workspaces/ws_default/projects"

token_json="$(
  curl -fsS "${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
    -H 'content-type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=password' \
    --data-urlencode "client_id=${KEYCLOAK_CLIENT_ID}" \
    --data-urlencode "username=${INTEGRATION_DEV_ADMIN_USERNAME}" \
    --data-urlencode "password=${INTEGRATION_DEV_ADMIN_PASSWORD}" \
    --data-urlencode 'scope=openid profile email'
)"
ACCESS_TOKEN="$(printf '%s' "${token_json}" | json_extract_access_token)"
[[ -n "${ACCESS_TOKEN}" ]] || {
  echo "[release-local-precheck] failed to obtain dev-admin token during public-auth gate" >&2
  exit 1
}

curl -fsS "${INTEGRATION_API_BASE}/api/v1/me/profile" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" >/dev/null \
  || {
    echo "[release-local-precheck] public-auth gate failed: authenticated /api/v1/me/profile unavailable" >&2
    exit 1
  }

info "public-auth gate passed"
info "running system admin entry, workspace public/login truth, workspace entry, publish usable, directory search, and system-to-notebook precheck"

BASE_URL="${PLAYWRIGHT_BASE_URL}" \
INTEGRATION_API_BASE="${INTEGRATION_API_BASE}" \
REAL_LANE_API_KEY="${REAL_LANE_API_KEY_VALUE}" \
REAL_LANE_ANTHROPIC_BASE_URL="${REAL_LANE_ANTHROPIC_BASE_URL:-https://api.minimaxi.com/anthropic/v1}" \
REAL_LANE_OPENAI_BASE_URL="${REAL_LANE_OPENAI_BASE_URL:-https://api.minimaxi.com/v1}" \
REAL_LANE_MODEL="${REAL_LANE_MODEL:-MiniMax-M2.7-highspeed}" \
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
run_clean npx playwright test \
  --config playwright.config.integration.ts \
  e2e/integration-system-admin-entry.spec.ts \
  e2e/integration-workspace-public-login.spec.ts \
  e2e/integration-workspace-entry.spec.ts \
  e2e/integration-workspace-publish-usable.spec.ts \
  e2e/integration-workspace-settings-directory.spec.ts \
  e2e/integration-system-notebook-mainline.spec.ts \
  --project=chromium \
  --workers=1 &
PLAYWRIGHT_PID=$!
wait "${PLAYWRIGHT_PID}"

info "release local precheck passed"
