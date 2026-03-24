#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_dev_real_env
require_demo_endpoint_env

if [[ ! -f "${API_READY_FILE}" || ! -f "${WEB_READY_FILE}" || ! -f "${PROXY_READY_FILE}" ]]; then
  err "dev-real platform is not ready; run make dev-real-up first"
  exit 1
fi

info "refreshing dev-admin token"
(
  cd "${ROOT_DIR}" && \
  BASE_URL="http://localhost:${PORT_WEB}" \
  KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
  KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
  KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
  make notebook-agent-refresh-token
)

TOKEN="$(cat "$(real_lane_token_file)")"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' "http://localhost:${PORT_API}/api/v1/me/profile" -H "Authorization: Bearer ${TOKEN}" || true)"
if [[ "${CODE}" != "200" ]]; then
  err "dev token validation failed against API (status=${CODE})"
  exit 1
fi

info "initializing external notebook agent resources"
(
  cd "${ROOT_DIR}" && \
  API_BASE="http://localhost:${PORT_API}" \
  WORKSPACE_ID="${WORKSPACE_ID}" \
  DEMO_ENDPOINT_API_KEY="${DEMO_ENDPOINT_API_KEY}" \
  DEMO_ENDPOINT_BASE_URL="${DEMO_ENDPOINT_BASE_URL}" \
  DEMO_ENDPOINT_MODEL="${DEMO_ENDPOINT_MODEL}" \
  DEMO_ENDPOINT_PROTOCOL="${DEMO_ENDPOINT_PROTOCOL}" \
  DEMO_ENDPOINT_MAX_CONTEXT_TOKENS="${DEMO_ENDPOINT_MAX_CONTEXT_TOKENS}" \
  DEMO_ENDPOINT_MAX_OUTPUT_TOKENS="${DEMO_ENDPOINT_MAX_OUTPUT_TOKENS}" \
  make notebook-agent-init-resources
)

bash "${ROOT_DIR}/scripts/dev-real/start-runner.sh"

PROJECT_ID="$(state_get project.id)"
info "notebook demo ready"
if [[ -n "${PROJECT_ID}" ]]; then
  info "Notebook: http://localhost:${PORT_WEB}/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/notebook"
fi
