#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_demo_rehearsal_env

WEB_PORT="$(demo_env_value WEB_PORT)"
API_PORT="$(demo_env_value API_PORT)"
KEYCLOAK_PORT="$(demo_env_value KEYCLOAK_PORT)"
SANDBOX_HOST_PORT="$(demo_env_value SANDBOX_HOST_PORT)"
WEB_PORT="${WEB_PORT:-3001}"
API_PORT="${API_PORT:-20000}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-18080}"
SANDBOX_HOST_PORT="${SANDBOX_HOST_PORT:-29080}"

printf 'Scenario: %s\n' "demo-rehearsal"
printf 'Active scenario: %s\n' "$(current_active_scenario || true)"
printf 'Deploy root: %s\n' "${DEMO_REHEARSAL_ROOT}"
printf 'Phase: %s\n' "$(demo_state_value release.phase)"
printf 'Release ID: %s\n' "$(demo_state_value release.id)"
printf 'Web: %s\n' "$(http_code "http://127.0.0.1:${WEB_PORT}/api/public/workspaces")"
printf 'API: %s\n' "$(http_code "http://127.0.0.1:${API_PORT}/api/public/workspaces")"
printf 'Keycloak: %s\n' "$(http_code "http://127.0.0.1:${KEYCLOAK_PORT}/realms/mbos/.well-known/openid-configuration")"
printf 'Sandbox: %s\n' "$(http_code "http://127.0.0.1:${SANDBOX_HOST_PORT}/readyz")"
printf 'Reports: %s\n' "${DEMO_REHEARSAL_ROOT}/reports"
