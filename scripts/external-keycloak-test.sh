#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CONTAINER_NAME="${EXTERNAL_KEYCLOAK_CONTAINER_NAME:-agentsmith-external-keycloak}"
PORT="${EXTERNAL_KEYCLOAK_PORT:-18180}"
BASE_URL="${EXTERNAL_KEYCLOAK_BASE_URL:-http://localhost:${PORT}}"
REALM="${KEYCLOAK_REALM:-mbos}"
LOGIN_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
DIRECTORY_CLIENT_ID="${KEYCLOAK_DIRECTORY_CLIENT_ID:-agentsmith-directory}"
DIRECTORY_CLIENT_SECRET="${KEYCLOAK_DIRECTORY_CLIENT_SECRET:-agentsmith-directory-secret}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
IMAGE="${EXTERNAL_KEYCLOAK_IMAGE:-quay.io/keycloak/keycloak:26.0}"
REALM_FILE="${ROOT_DIR}/infra/integration/keycloak/realm-mbos-dev.json"

info() { echo "[external-keycloak-test] $*"; }
err() { echo "[external-keycloak-test] ERROR: $*" >&2; }

wait_ready() {
  local timeout="${1:-120}"
  local start now
  start="$(date +%s)"
  while true; do
    if curl -fsS "${BASE_URL}/realms/${REALM}/.well-known/openid-configuration" >/dev/null 2>&1; then
      return 0
    fi
    now="$(date +%s)"
    if (( now - start > timeout )); then
      err "keycloak not ready at ${BASE_URL}"
      docker logs "${CONTAINER_NAME}" --tail 200 >&2 || true
      return 1
    fi
    sleep 2
  done
}

command_up() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  info "starting external keycloak on ${BASE_URL}"
  docker run -d \
    --name "${CONTAINER_NAME}" \
    -p "${PORT}:8080" \
    -e KC_BOOTSTRAP_ADMIN_USERNAME="${ADMIN_USER}" \
    -e KC_BOOTSTRAP_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
    -e KC_HEALTH_ENABLED=true \
    -e KC_PROXY_HEADERS=xforwarded \
    -v "${REALM_FILE}:/opt/keycloak/data/import/realm-mbos-dev.json:ro" \
    "${IMAGE}" \
    start-dev --import-realm >/dev/null

  wait_ready 180

  info "seeding users, redirects, and directory client"
  PUBLIC_KEYCLOAK_BASE_URL="${BASE_URL}" \
  INTERNAL_KEYCLOAK_BASE_URL="${BASE_URL}" \
  KEYCLOAK_REALM="${REALM}" \
  KEYCLOAK_CLIENT_ID="${LOGIN_CLIENT_ID}" \
  KEYCLOAK_DIRECTORY_CLIENT_ID="${DIRECTORY_CLIENT_ID}" \
  KEYCLOAK_DIRECTORY_CLIENT_SECRET="${DIRECTORY_CLIENT_SECRET}" \
  KEYCLOAK_ADMIN="${ADMIN_USER}" \
  KEYCLOAK_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  node_modules/.bin/tsx "${ROOT_DIR}/scripts/integration-keycloak-init.ts"

  info "ready"
}

command_down() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  info "stopped"
}

command_status() {
  if docker ps --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
    info "running at ${BASE_URL}"
    return 0
  fi
  info "not running"
  return 1
}

case "${1:-}" in
  up) command_up ;;
  down) command_down ;;
  status) command_status ;;
  *)
    err "usage: $0 {up|down|status}"
    exit 1
    ;;
esac
