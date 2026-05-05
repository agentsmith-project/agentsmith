#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
source "${ROOT_DIR}/scripts/app/deploy-common.sh"

ensure_dirs
load_site_env
bash "${ROOT_DIR}/scripts/cluster-deploy/render-env.sh"
load_release_env
require_version_images

write_compose_env "${APP_IMAGE}" "${AGENT_TASK_RUNNER_IMAGE}" "${UNIVERSAL_PROXY_IMAGE}"
mkdir -p "${CLUSTER_DEPLOY_ROOT}/releases"
ln -sfn "${RELEASE_ROOT}" "${CURRENT_LINK}"

release_app_up
wait_cluster_app

state_set release.phase deploy_app_completed
log "deploy-app ok"
