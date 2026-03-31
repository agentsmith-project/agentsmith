#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
source "${ROOT_DIR}/scripts/app/deploy-common.sh"

ensure_dirs
ensure_operator_site_env
set -a
source "${RELEASE_ROOT}/env/site.env"
set +a
bash "${ROOT_DIR}/scripts/cluster-deploy/render-env.sh"
load_release_env
require_version_images
copy_runner_runtime_env_from_current_release

write_compose_env "${APP_IMAGE}" "${RUNNER_IMAGE}" "${UNIVERSAL_PROXY_IMAGE}"
mkdir -p "${CLUSTER_DEPLOY_ROOT}/releases"

release_app_upgrade_up
wait_cluster_app

docker_compose ps --status running universal-proxy | grep -q universal-proxy \
  || die "upgrade-app failed: universal-proxy is not running"
docker_compose ps --status running external-runner | grep -q external-runner \
  || die "upgrade-app failed: external-runner is not running"

ln -sfn "${RELEASE_ROOT}" "${CURRENT_LINK}"

state_set release.phase upgrade_app_completed
log "upgrade-app ok"
