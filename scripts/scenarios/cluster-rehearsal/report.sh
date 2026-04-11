#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_cluster_rehearsal_env
current="$(current_active_scenario || true)"
[[ "${current}" == "${CLUSTER_REHEARSAL_NAME}" ]] || { echo "[scenario] ERROR: cluster-rehearsal is not the active scenario." >&2; exit 1; }
cluster_require_phase report
acquire_scenario_command_lock "${CLUSTER_REHEARSAL_NAME}" report
arm_scenario_command_lock_cleanup "${CLUSTER_REHEARSAL_NAME}" report
run_stage report
disarm_scenario_command_lock_cleanup
