#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_cluster_rehearsal_env
acquire_scenario_lock "${CLUSTER_REHEARSAL_NAME}"

bash "${ROOT_DIR}/scripts/cluster-deploy/reset.sh"
release_scenario_lock "${CLUSTER_REHEARSAL_NAME}"

printf '[cluster-rehearsal] reset complete\n'
