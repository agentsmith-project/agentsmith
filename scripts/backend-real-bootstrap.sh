#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
source "${ROOT_DIR}/scripts/lib/run-readiness-state.sh"
source "${ROOT_DIR}/scripts/lib/local-redis-auth.sh"
ensure_backend_real_state

API_PORT="${API_PORT:-${INTEGRATION_API_PORT:-20000}}"
WEB_PORT="${WEB_PORT:-${INTEGRATION_WEB_PORT:-3001}}"
POSTGRES_PORT="${POSTGRES_PORT:-${INTEGRATION_POSTGRES_PORT:-15432}}"
MONGO_PORT="${MONGO_PORT:-${INTEGRATION_MONGO_PORT:-17017}}"
REDIS_PORT="${REDIS_PORT:-${INTEGRATION_REDIS_PORT:-16379}}"
REDIS_PASSWORD="${REDIS_PASSWORD:-mbos_dev_password}"
local_redis_require_simple_password REDIS_PASSWORD "${REDIS_PASSWORD}" "[backend-real-bootstrap]"
MINIO_API_PORT="${MINIO_API_PORT:-${INTEGRATION_MINIO_API_PORT:-19000}}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-${INTEGRATION_MINIO_CONSOLE_PORT:-19001}}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-${INTEGRATION_KEYCLOAK_PORT:-18080}}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
resolve_loopback_runtime_stack "${API_PORT}" "${WEB_PORT}" "${KEYCLOAK_PORT}" "${KEYCLOAK_REALM}" "${KEYCLOAK_CLIENT_ID}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-${KEYCLOAK_URL:-${RUNTIME_HOST_KEYCLOAK_BASE_URL}}}"
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:${MONGO_PORT}/admin}"
MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"
PORT_WEB="${PORT_WEB:-${WEB_PORT}}"

info() { echo "[backend-real-bootstrap] $*"; }

integration_deps_readiness_ready() {
  readiness_state_field_ready_with_identity integration_deps_ready \
    "postgres_port=${POSTGRES_PORT}" \
    "mongo_port=${MONGO_PORT}" \
    "redis_port=${REDIS_PORT}" \
    "minio_api_port=${MINIO_API_PORT}" \
    "minio_console_port=${MINIO_CONSOLE_PORT}" \
    "keycloak_port=${KEYCLOAK_PORT}" \
    "keycloak_base_url=${KEYCLOAK_BASE_URL}" \
    "keycloak_realm=${KEYCLOAK_REALM}" \
    "keycloak_client_id=${KEYCLOAK_CLIENT_ID}" \
    && local_redis_auth_ping "127.0.0.1" "${REDIS_PORT}" "${REDIS_PASSWORD}" "[backend-real-bootstrap]"
}

wait_for_keycloak() {
  local timeout="${1:-180}"
  local started
  started="$(date +%s)"
  until curl -fsS "${KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" >/dev/null 2>&1; do
    if (( "$(date +%s)" - started > timeout )); then
      echo "[backend-real-bootstrap] timed out waiting for Keycloak discovery" >&2
      return 1
    fi
    sleep 2
  done
}

run_keycloak_init_with_retry() {
  local attempts="${1:-5}"
  local delay="${2:-3}"
  local attempt
  for attempt in $(seq 1 "${attempts}"); do
    if (cd "${ROOT_DIR}" && npm run integration:deps:init:keycloak >/dev/null); then
      return 0
    fi
    if (( attempt == attempts )); then
      return 1
    fi
    info "keycloak init attempt ${attempt}/${attempts} failed; retrying in ${delay}s"
    sleep "${delay}"
    wait_for_keycloak 60 || true
  done
}

if integration_deps_readiness_ready; then
  info "reusing parent-verified integration dependencies"
else
  info "starting integration dependencies"
  (
    cd "${ROOT_DIR}" && \
      POSTGRES_PORT="${POSTGRES_PORT}" \
      MONGO_PORT="${MONGO_PORT}" \
      REDIS_PORT="${REDIS_PORT}" \
      REDIS_PASSWORD="${REDIS_PASSWORD}" \
      MINIO_API_PORT="${MINIO_API_PORT}" \
      MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT}" \
      KEYCLOAK_PORT="${KEYCLOAK_PORT}" \
      npm run integration:deps:up >/dev/null
  )
fi
wait_for_keycloak

info "initializing integration services"
(cd "${ROOT_DIR}" && npm run integration:deps:init:postgres >/dev/null)
run_keycloak_init_with_retry

info "ensuring default workspace"
(cd "${ROOT_DIR}" && MONGO_URL="${MONGO_URL}" MONGO_DB_NAME="${MONGO_DB_NAME}" KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" KEYCLOAK_REALM="${KEYCLOAK_REALM}" KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" npx tsx scripts/ensure-default-workspace.ts >/dev/null)

info "refreshing agent runner token"
(cd "${ROOT_DIR}" && REFRESH_TOKEN_FORCE_PASSWORD_GRANT=1 BASE_URL="${RUNTIME_BROWSER_WEB_BASE_URL}" make agent-runner-refresh-token >/dev/null)

state_set_string release.phase "bootstrap_completed"
state_set_string workspace.id "ws_default"
state_set_string release.last_bootstrap_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
state_write_summary
echo "[backend-real-bootstrap] done"
