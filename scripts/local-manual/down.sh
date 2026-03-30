#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_local_manual_env

stop_local_manual_processes
remove_local_manual_runtime_files
reset_local_manual_state
SUBSTRATE_ENV_FILE="${ENV_FILE}" SUBSTRATE="${SUBSTRATE}" bash "${ROOT_DIR}/scripts/substrate/down.sh" || true
release_scenario_lock local-manual

info "done"
