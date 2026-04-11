#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_demo_rehearsal_env
acquire_scenario_command_lock "${DEMO_REHEARSAL_NAME}" down
arm_scenario_command_lock_cleanup "${DEMO_REHEARSAL_NAME}" down

bash "${ROOT_DIR}/scripts/demo-deploy/reset.sh" || true
release_scenario_lock "${DEMO_REHEARSAL_NAME}"
disarm_scenario_command_lock_cleanup

printf '[demo-rehearsal] down\n'
