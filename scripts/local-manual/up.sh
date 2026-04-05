#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_local_manual_env
acquire_scenario_lock local-manual
arm_scenario_lock_cleanup local-manual

mark_scenario_world_changed
stop_local_manual_processes
remove_local_manual_runtime_files
reset_local_manual_state

SUBSTRATE_ENV_FILE="${ENV_FILE}" SUBSTRATE="${SUBSTRATE}" bash "${ROOT_DIR}/scripts/substrate/up.sh"
SUBSTRATE_ENV_FILE="${ENV_FILE}" SUBSTRATE="${SUBSTRATE}" bash "${ROOT_DIR}/scripts/substrate/reseed.sh"
load_local_manual_substrate_env

APP_MODE=local-manual SUBSTRATE="${SUBSTRATE}" ENV_FILE="${ENV_FILE}" bash "${ROOT_DIR}/scripts/app/up.sh"

info "ready"
info "Web: http://localhost:${PORT_WEB}/${LOCALE}/login/workspace"
info "API: http://localhost:${PORT_API}"
info "Keycloak: ${KEYCLOAK_BASE_URL}"
info "Proxy: ${MBOS_UNIVERSAL_PROXY_BASE_URL}"
info "Next step for notebook manual testing: make local-manual-seed-notebook"
disarm_scenario_lock_cleanup
