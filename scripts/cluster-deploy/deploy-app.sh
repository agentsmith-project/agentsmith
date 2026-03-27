#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

ensure_dirs
ensure_operator_site_env
set -a
source "${RELEASE_ROOT}/env/site.env"
set +a
bash "${ROOT_DIR}/scripts/cluster-deploy/render-env.sh"
load_release_env
require_version_images

write_compose_env "${APP_IMAGE}" "${RUNNER_IMAGE}" "${UNIVERSAL_PROXY_IMAGE}"
mkdir -p "${CLUSTER_DEPLOY_ROOT}/releases"
ln -sfn "${RELEASE_ROOT}" "${CURRENT_LINK}"

docker_compose up -d api web external-runner
wait_cluster_app

state_set release.phase deploy_app_completed
log "deploy-app ok"
