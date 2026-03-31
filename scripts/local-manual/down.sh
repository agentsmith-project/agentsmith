#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_local_manual_env

if [[ -f "$(backend_real_tmp_file internal)/sandbox-control.env" ]]; then
  bash "${ROOT_DIR}/scripts/local-manual/internal-down.sh" --no-api-restart || true
fi

APP_MODE=local-manual SUBSTRATE="${SUBSTRATE}" ENV_FILE="${ENV_FILE}" bash "${ROOT_DIR}/scripts/app/down.sh"
reset_local_manual_state
SUBSTRATE_ENV_FILE="${ENV_FILE}" SUBSTRATE="${SUBSTRATE}" bash "${ROOT_DIR}/scripts/substrate/down.sh" || true
release_scenario_lock local-manual

info "done"
