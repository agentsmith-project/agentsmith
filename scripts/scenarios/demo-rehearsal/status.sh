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
KIND_CLUSTER_NAME="$(scenario_kind_cluster_name)"
REGISTRY_NAME="$(scenario_kind_registry_name)"
KIND_CLUSTER_PRESENT="$(scenario_presence_label_for_probe local_kind_cluster_exists "${KIND_CLUSTER_NAME}")"
REGISTRY_PRESENT="$(scenario_presence_label_for_probe local_kind_registry_exists "${REGISTRY_NAME}")"
WEB_STATUS="$(scenario_service_status "demo-rehearsal" "http://127.0.0.1:${WEB_PORT}/api/public/workspaces")"
API_STATUS="$(scenario_service_status "demo-rehearsal" "http://127.0.0.1:${API_PORT}/api/public/workspaces")"
KEYCLOAK_STATUS="$(scenario_service_status "demo-rehearsal" "http://127.0.0.1:${KEYCLOAK_PORT}/realms/mbos/.well-known/openid-configuration")"
if [[ "${DEMO_DEPLOY_MODE:-full}" == "full" ]]; then
  SANDBOX_STATUS="$(scenario_service_status "demo-rehearsal" "http://127.0.0.1:${SANDBOX_HOST_PORT}/readyz")"
else
  SANDBOX_STATUS="skipped"
fi

render_rehearsal_world_health_snapshot \
  "demo-rehearsal" \
  "${DEMO_REHEARSAL_ROOT}" \
  AGENTSMITH_REHEARSAL_KIND_CLUSTER_PRESENT="${KIND_CLUSTER_PRESENT}" \
  AGENTSMITH_REHEARSAL_REGISTRY_PRESENT="${REGISTRY_PRESENT}" \
  AGENTSMITH_REHEARSAL_WEB_STATUS="${WEB_STATUS}" \
  AGENTSMITH_REHEARSAL_API_STATUS="${API_STATUS}" \
  AGENTSMITH_REHEARSAL_KEYCLOAK_STATUS="${KEYCLOAK_STATUS}" \
  AGENTSMITH_REHEARSAL_SANDBOX_STATUS="${SANDBOX_STATUS}"

printf 'Scenario detail:\n'
printf 'Scenario: %s\n' "demo-rehearsal"
printf 'Active scenario: %s\n' "$(current_active_scenario || true)"
printf 'Deploy root: %s\n' "${DEMO_REHEARSAL_ROOT}"
printf 'Local kind cluster: %s (%s)\n' "${KIND_CLUSTER_NAME}" "${KIND_CLUSTER_PRESENT}"
printf 'Local registry: %s @ %s:%s (%s)\n' \
  "${REGISTRY_NAME}" \
  "$(scenario_kind_registry_host)" \
  "$(scenario_kind_registry_host_port)" \
  "${REGISTRY_PRESENT}"
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
printf 'Web: %s\n' "${WEB_STATUS}"
printf 'API: %s\n' "${API_STATUS}"
printf 'Keycloak: %s\n' "${KEYCLOAK_STATUS}"
printf 'Sandbox: %s\n' "${SANDBOX_STATUS}"
printf 'Reports: %s\n' "${DEMO_REHEARSAL_ROOT}/reports"
