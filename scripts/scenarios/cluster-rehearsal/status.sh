#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_cluster_rehearsal_env

WEB_PORT="$(cluster_env_value WEB_PORT)"
API_PORT="$(cluster_env_value API_PORT)"
KEYCLOAK_PORT="$(cluster_env_value KEYCLOAK_PORT)"
SANDBOX_HOST_PORT="$(cluster_env_value SANDBOX_HOST_PORT)"
WEB_PORT="${WEB_PORT:-3001}"
API_PORT="${API_PORT:-20000}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-18080}"
SANDBOX_HOST_PORT="${SANDBOX_HOST_PORT:-29180}"

printf 'Scenario: %s\n' "cluster-rehearsal"
printf 'Active scenario: %s\n' "$(current_active_scenario || true)"
printf 'Deploy root: %s\n' "${CLUSTER_REHEARSAL_ROOT}"
printf 'Mode: %s\n' "${CLUSTER_DEPLOY_MODE:-full-auto}"
printf 'Phase: %s\n' "$(cluster_state_value release.phase)"
printf 'Stage summary: %s\n' "$(cluster_stage_summary)"
if cluster_phase_at_least_app_deployed; then
  printf 'App readiness: ready for bootstrap\n'
else
  printf 'App readiness: pending\n'
fi
if cluster_phase_at_least_bootstrapped; then
  printf 'Bootstrap: completed\n'
else
  printf 'Bootstrap: pending\n'
fi
if cluster_phase_verified; then
  printf 'Verify: completed\n'
else
  printf 'Verify: pending\n'
fi
printf 'Release ID: %s\n' "$(cluster_release_id)"
printf 'Web: %s\n' "$(scenario_service_status "cluster-rehearsal" "http://127.0.0.1:${WEB_PORT}/api/public/workspaces")"
printf 'API: %s\n' "$(scenario_service_status "cluster-rehearsal" "http://127.0.0.1:${API_PORT}/api/public/workspaces")"
printf 'Keycloak: %s\n' "$(scenario_service_status "cluster-rehearsal" "http://127.0.0.1:${KEYCLOAK_PORT}/realms/mbos/.well-known/openid-configuration")"
printf 'Sandbox: %s\n' "$(scenario_service_status "cluster-rehearsal" "http://127.0.0.1:${SANDBOX_HOST_PORT}/readyz")"
printf 'Reports: %s\n' "${CLUSTER_REHEARSAL_ROOT}/reports"
