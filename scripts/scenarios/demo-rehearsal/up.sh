#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_demo_rehearsal_env
acquire_scenario_lock "${DEMO_REHEARSAL_NAME}"
arm_scenario_lock_cleanup "${DEMO_REHEARSAL_NAME}"
ensure_demo_rehearsal_site_env
ensure_demo_rehearsal_release_bundle
if [[ "$(demo_env_value DEMO_DEPLOY_MODE)" == "full" ]]; then
  mark_scenario_world_changed
  ensure_local_kind_cluster
fi
if [[ "${SCENARIO_LOCK_WORLD_CHANGED:-0}" != "1" ]]; then
  mark_scenario_world_changed
fi
clear_local_dev_substrate

bash "${ROOT_DIR}/scripts/demo-deploy/prepare.sh"
bash "${ROOT_DIR}/scripts/demo-deploy/deploy.sh"

WEB_PORT="$(demo_env_value WEB_PORT)"
API_PORT="$(demo_env_value API_PORT)"
SANDBOX_HOST_PORT="$(demo_env_value SANDBOX_HOST_PORT)"
WEB_PORT="${WEB_PORT:-3001}"
API_PORT="${API_PORT:-20000}"
SANDBOX_HOST_PORT="${SANDBOX_HOST_PORT:-29080}"
DEMO_DEPLOY_MODE="${DEMO_DEPLOY_MODE:-$(demo_env_value DEMO_DEPLOY_MODE)}"

printf '[demo-rehearsal] ready\n'
printf '[demo-rehearsal] Mode: %s\n' "${DEMO_DEPLOY_MODE:-full}"
printf '[demo-rehearsal] Web: http://localhost:%s\n' "${WEB_PORT}"
printf '[demo-rehearsal] API: http://localhost:%s\n' "${API_PORT}"
if [[ "${DEMO_DEPLOY_MODE:-full}" == "full" ]]; then
  printf '[demo-rehearsal] Sandbox: http://localhost:%s\n' "${SANDBOX_HOST_PORT}"
fi
printf '[demo-rehearsal] Stage: environment ready\n'
printf '[demo-rehearsal] Next steps: make demo-rehearsal-bootstrap && make demo-rehearsal-verify && make demo-rehearsal-report\n'
disarm_scenario_lock_cleanup
