#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_demo_rehearsal_env
current="$(current_active_scenario || true)"
[[ -z "${current}" || "${current}" == "${DEMO_REHEARSAL_NAME}" ]] || { echo "[scenario] ERROR: active scenario is ${current}; stop it before continuing demo-rehearsal." >&2; exit 1; }
demo_require_phase bootstrap
acquire_scenario_lock "${DEMO_REHEARSAL_NAME}"
arm_scenario_lock_cleanup "${DEMO_REHEARSAL_NAME}"
acquire_scenario_command_lock "${DEMO_REHEARSAL_NAME}" bootstrap
arm_scenario_command_lock_cleanup "${DEMO_REHEARSAL_NAME}" bootstrap
mark_scenario_world_changed
run_stage bootstrap
disarm_scenario_command_lock_cleanup
disarm_scenario_lock_cleanup
