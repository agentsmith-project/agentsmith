#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_cluster_rehearsal_env
acquire_scenario_lock "${CLUSTER_REHEARSAL_NAME}"
arm_scenario_lock_cleanup "${CLUSTER_REHEARSAL_NAME}"
acquire_scenario_command_lock "${CLUSTER_REHEARSAL_NAME}" reset
arm_scenario_command_lock_cleanup "${CLUSTER_REHEARSAL_NAME}" reset

mark_scenario_world_changed
bash "${ROOT_DIR}/scripts/cluster-deploy/reset.sh"
release_scenario_lock "${CLUSTER_REHEARSAL_NAME}"
disarm_scenario_command_lock_cleanup
disarm_scenario_lock_cleanup

printf '[cluster-rehearsal] reset complete\n'
