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
SANDBOX_HOST_PORT="${SANDBOX_HOST_PORT:-29180}"
DEMO_DEPLOY_MODE="${DEMO_DEPLOY_MODE:-$(demo_env_value DEMO_DEPLOY_MODE)}"

printf 'Scenario: %s\n' "demo-rehearsal"
printf 'Active scenario: %s\n' "$(current_active_scenario || true)"
printf 'Deploy root: %s\n' "${DEMO_REHEARSAL_ROOT}"
printf 'Mode: %s\n' "${DEMO_DEPLOY_MODE:-full}"
printf 'Phase: %s\n' "$(demo_state_value release.phase)"
printf 'Stage summary: %s\n' "$(demo_stage_summary)"
if demo_phase_at_least_deployed; then
  printf 'App readiness: ready for bootstrap\n'
else
  printf 'App readiness: pending\n'
fi
if demo_phase_at_least_bootstrapped; then
  printf 'Bootstrap: completed\n'
else
  printf 'Bootstrap: pending\n'
fi
if demo_phase_verified; then
  printf 'Verify: completed\n'
else
  printf 'Verify: pending\n'
fi
printf 'Release ID: %s\n' "$(demo_release_id)"
printf 'Web: %s\n' "$(scenario_service_status "demo-rehearsal" "http://127.0.0.1:${WEB_PORT}/api/public/workspaces")"
printf 'API: %s\n' "$(scenario_service_status "demo-rehearsal" "http://127.0.0.1:${API_PORT}/api/public/workspaces")"
printf 'Keycloak: %s\n' "$(scenario_service_status "demo-rehearsal" "http://127.0.0.1:${KEYCLOAK_PORT}/realms/mbos/.well-known/openid-configuration")"
if [[ "${DEMO_DEPLOY_MODE:-full}" == "full" ]]; then
  printf 'Sandbox: %s\n' "$(scenario_service_status "demo-rehearsal" "http://127.0.0.1:${SANDBOX_HOST_PORT}/readyz")"
else
  printf 'Sandbox: skipped\n'
fi
printf 'Reports: %s\n' "${DEMO_REHEARSAL_ROOT}/reports"
