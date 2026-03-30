#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_demo_rehearsal_env
acquire_scenario_lock "${DEMO_REHEARSAL_NAME}"
ensure_demo_rehearsal_site_env
ensure_demo_rehearsal_release_bundle
ensure_local_kind_cluster
clear_local_dev_substrate

bash "${ROOT_DIR}/scripts/demo-deploy/prepare.sh"
bash "${ROOT_DIR}/scripts/demo-deploy/deploy.sh"

WEB_PORT="$(demo_env_value WEB_PORT)"
API_PORT="$(demo_env_value API_PORT)"
SANDBOX_HOST_PORT="$(demo_env_value SANDBOX_HOST_PORT)"
WEB_PORT="${WEB_PORT:-3001}"
API_PORT="${API_PORT:-20000}"
SANDBOX_HOST_PORT="${SANDBOX_HOST_PORT:-29080}"

printf '[demo-rehearsal] ready\n'
printf '[demo-rehearsal] Web: http://localhost:%s\n' "${WEB_PORT}"
printf '[demo-rehearsal] API: http://localhost:%s\n' "${API_PORT}"
printf '[demo-rehearsal] Sandbox: http://localhost:%s\n' "${SANDBOX_HOST_PORT}"
printf '[demo-rehearsal] Next steps: bash %s/scripts/demo-deploy/bootstrap.sh && bash %s/scripts/demo-deploy/verify.sh\n' "${ROOT_DIR}" "${ROOT_DIR}"
