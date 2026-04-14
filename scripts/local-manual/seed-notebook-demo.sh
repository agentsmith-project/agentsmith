#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_local_manual_env
require_preset_endpoint_env

if ! local_manual_platform_is_ready; then
  err "local-manual platform is not ready; run make local-manual-up first"
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

info "initializing external notebook agent resources"
(
  cd "${ROOT_DIR}" && \
  API_BASE="http://localhost:${PORT_API}" \
  WORKSPACE_ID="${WORKSPACE_ID}" \
  PRESET_ENDPOINT_API_KEY="${PRESET_ENDPOINT_API_KEY}" \
  PRESET_ANTHROPIC_ENDPOINT_BASE_URL="${PRESET_ANTHROPIC_ENDPOINT_BASE_URL}" \
  PRESET_ENDPOINT_MODEL="${PRESET_ENDPOINT_MODEL}" \
  PRESET_ANTHROPIC_ENDPOINT_PROTOCOL="${PRESET_ANTHROPIC_ENDPOINT_PROTOCOL}" \
  PRESET_ENDPOINT_MAX_CONTEXT_TOKENS="${PRESET_ENDPOINT_MAX_CONTEXT_TOKENS}" \
  PRESET_ENDPOINT_MAX_OUTPUT_TOKENS="${PRESET_ENDPOINT_MAX_OUTPUT_TOKENS}" \
  make notebook-agent-init-resources
)

bash "${ROOT_DIR}/scripts/local-manual/start-runner.sh"
bash "${ROOT_DIR}/scripts/local-manual/verify-notebook-demo.sh"

PROJECT_ID="$(state_get project.id)"
info "notebook demo ready"
if [[ -n "${PROJECT_ID}" ]]; then
  info "Notebook: http://localhost:${PORT_WEB}/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/notebook"
fi
