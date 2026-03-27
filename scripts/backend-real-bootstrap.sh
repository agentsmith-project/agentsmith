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

info "starting integration dependencies"
(cd "${ROOT_DIR}" && npm run integration:deps:up >/dev/null)

info "initializing integration services"
(cd "${ROOT_DIR}" && npm run integration:deps:init:postgres >/dev/null)
(cd "${ROOT_DIR}" && npm run integration:deps:init:keycloak >/dev/null)

info "ensuring default workspace"
(cd "${ROOT_DIR}" && MONGO_URL="${MONGO_URL}" MONGO_DB_NAME="${MONGO_DB_NAME}" KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" KEYCLOAK_REALM="${KEYCLOAK_REALM}" KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" npx tsx scripts/ensure-default-workspace.ts >/dev/null)

info "refreshing notebook token"
(cd "${ROOT_DIR}" && BASE_URL="http://localhost:${PORT_WEB}" make notebook-agent-refresh-token >/dev/null)

state_set_string release.phase "bootstrap_completed"
state_set_string workspace.id "ws_default"
state_set_string release.last_bootstrap_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
state_write_summary
echo "[backend-real-bootstrap] done"
