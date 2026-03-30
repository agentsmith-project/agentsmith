#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_cluster_rehearsal_env
acquire_scenario_lock "${CLUSTER_REHEARSAL_NAME}"

bash "${ROOT_DIR}/scripts/cluster-deploy/prepare.sh"
bash "${ROOT_DIR}/scripts/cluster-deploy/deploy.sh"

WEB_PORT="$(cluster_env_value WEB_PORT)"
API_PORT="$(cluster_env_value API_PORT)"
WEB_PORT="${WEB_PORT:-3001}"
API_PORT="${API_PORT:-20000}"

printf '[cluster-rehearsal] ready (mode=%s)\n' "${CLUSTER_DEPLOY_MODE}"
printf '[cluster-rehearsal] Web: http://localhost:%s\n' "${WEB_PORT}"
printf '[cluster-rehearsal] API: http://localhost:%s\n' "${API_PORT}"
