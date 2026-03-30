#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
load_app_mode

case "${APP_MODE}" in
  local-manual)
    if [[ ! -f "${SUBSTRATE_CONNECTION_ENV}" ]]; then
      app_err "missing substrate connection env: ${SUBSTRATE_CONNECTION_ENV}"
      exit 1
    fi
    stop_local_manual_processes
    remove_local_manual_runtime_files
    bash "${ROOT_DIR}/scripts/local-manual/start-api.sh"
    bash "${ROOT_DIR}/scripts/local-manual/start-web.sh"
    bash "${ROOT_DIR}/scripts/local-manual/verify.sh"
    app_info "ready"
    ;;
  *)
    app_err "unsupported APP_MODE=${APP_MODE}"
    exit 1
    ;;
esac
