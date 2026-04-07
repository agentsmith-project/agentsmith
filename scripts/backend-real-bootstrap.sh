#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
ensure_backend_real_state

KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}"
MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"
PORT_WEB="${PORT_WEB:-3001}"

info() { echo "[backend-real-bootstrap] $*"; }

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

info "starting integration dependencies"
(cd "${ROOT_DIR}" && npm run integration:deps:up >/dev/null)
wait_for_keycloak

info "initializing integration services"
(cd "${ROOT_DIR}" && npm run integration:deps:init:postgres >/dev/null)
run_keycloak_init_with_retry

info "ensuring default workspace"
(cd "${ROOT_DIR}" && MONGO_URL="${MONGO_URL}" MONGO_DB_NAME="${MONGO_DB_NAME}" KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" KEYCLOAK_REALM="${KEYCLOAK_REALM}" KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" npx tsx scripts/ensure-default-workspace.ts >/dev/null)

info "refreshing notebook token"
(cd "${ROOT_DIR}" && REFRESH_TOKEN_FORCE_PASSWORD_GRANT=1 BASE_URL="http://localhost:${PORT_WEB}" make notebook-agent-refresh-token >/dev/null)

state_set_string release.phase "bootstrap_completed"
state_set_string workspace.id "ws_default"
state_set_string release.last_bootstrap_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
state_write_summary
echo "[backend-real-bootstrap] done"
