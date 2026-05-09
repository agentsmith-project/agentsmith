#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_local_manual_env
require_preset_endpoint_env
AGENT_RUNNER_SEED_MODE="${AGENT_RUNNER_SEED_MODE:-developer_runner}"

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
  make agent-runner-refresh-token
)

info "initializing ${AGENT_RUNNER_SEED_MODE} agent-task runner resources"
(
  cd "${ROOT_DIR}" && \
  AGENT_RUNNER_SEED_MODE="${AGENT_RUNNER_SEED_MODE}" \
  API_BASE="http://localhost:${PORT_API}" \
  WORKSPACE_ID="${WORKSPACE_ID}" \
  PRESET_ENDPOINT_API_KEY="${PRESET_ENDPOINT_API_KEY}" \
  PRESET_ANTHROPIC_ENDPOINT_BASE_URL="${PRESET_ANTHROPIC_ENDPOINT_BASE_URL}" \
  PRESET_ENDPOINT_MODEL="${PRESET_ENDPOINT_MODEL}" \
  PRESET_ANTHROPIC_ENDPOINT_PROTOCOL="${PRESET_ANTHROPIC_ENDPOINT_PROTOCOL}" \
  PRESET_ENDPOINT_MAX_CONTEXT_TOKENS="${PRESET_ENDPOINT_MAX_CONTEXT_TOKENS}" \
  PRESET_ENDPOINT_MAX_OUTPUT_TOKENS="${PRESET_ENDPOINT_MAX_OUTPUT_TOKENS}" \
  make agent-runner-init-resources
)

bash "${ROOT_DIR}/scripts/local-manual/start-runner.sh"
bash "${ROOT_DIR}/scripts/local-manual/verify-agent-task-diagnostics.sh"

PROJECT_ID="$(state_get project.id)"
info "agent-task diagnostic resources ready"
if [[ -n "${PROJECT_ID}" ]]; then
  info "Agent tasks: http://localhost:${PORT_WEB}/${LOCALE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/agent-tasks"
fi
