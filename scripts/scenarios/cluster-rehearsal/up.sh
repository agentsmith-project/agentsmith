#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_cluster_rehearsal_env
acquire_scenario_lock "${CLUSTER_REHEARSAL_NAME}"
arm_scenario_lock_cleanup "${CLUSTER_REHEARSAL_NAME}"
acquire_scenario_command_lock "${CLUSTER_REHEARSAL_NAME}" up
arm_scenario_command_lock_cleanup "${CLUSTER_REHEARSAL_NAME}" up
ensure_cluster_rehearsal_site_env
ensure_cluster_rehearsal_registry_env
ensure_cluster_rehearsal_release_bundle
mark_scenario_world_changed
ensure_local_kind_cluster
cp "${HOME}/.kube/config" "${CLUSTER_REHEARSAL_CONFIG_DIR}/kubeconfig"
cp "${HOME}/.kube/config" "${CLUSTER_REHEARSAL_CONFIG_DIR}/admin-kubeconfig"
rm -f "${CLUSTER_REHEARSAL_CONFIG_DIR}/manager-kubeconfig"
clear_local_dev_substrate

bash "${ROOT_DIR}/scripts/cluster-deploy/prepare.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/publish-images.sh"
preload_cluster_rehearsal_kind_images
bash "${ROOT_DIR}/scripts/cluster-deploy/deploy-substrate.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/deploy-app.sh"

WEB_PORT="$(cluster_env_value WEB_PORT)"
API_PORT="$(cluster_env_value API_PORT)"
WEB_PORT="${WEB_PORT:-3001}"
API_PORT="${API_PORT:-20000}"

printf '[cluster-rehearsal] ready (mode=%s)\n' "${CLUSTER_DEPLOY_MODE}"
printf '[cluster-rehearsal] Web: http://localhost:%s\n' "${WEB_PORT}"
printf '[cluster-rehearsal] API: http://localhost:%s\n' "${API_PORT}"
printf '[cluster-rehearsal] Stage: environment ready\n'
printf '[cluster-rehearsal] Next steps: make cluster-rehearsal-bootstrap && make cluster-rehearsal-verify && make cluster-rehearsal-report\n'
disarm_scenario_command_lock_cleanup
disarm_scenario_lock_cleanup
