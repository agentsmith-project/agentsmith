#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_cluster_rehearsal_env
acquire_scenario_lock "${CLUSTER_REHEARSAL_NAME}"
ensure_cluster_rehearsal_site_env
ensure_cluster_rehearsal_registry_env
ensure_cluster_rehearsal_release_bundle
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
bash "${ROOT_DIR}/scripts/cluster-deploy/prepare-admin-handoff.sh"
mark_cluster_rehearsal_admin_ready
bash "${ROOT_DIR}/scripts/cluster-deploy/apply-cluster-prereqs.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/deploy-sandbox.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/bootstrap.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/verify.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/report.sh"

WEB_PORT="$(cluster_env_value WEB_PORT)"
API_PORT="$(cluster_env_value API_PORT)"
WEB_PORT="${WEB_PORT:-3001}"
API_PORT="${API_PORT:-20000}"

printf '[cluster-rehearsal] ready (mode=%s)\n' "${CLUSTER_DEPLOY_MODE}"
printf '[cluster-rehearsal] Web: http://localhost:%s\n' "${WEB_PORT}"
printf '[cluster-rehearsal] API: http://localhost:%s\n' "${API_PORT}"
