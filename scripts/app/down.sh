#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
load_app_mode

case "${APP_MODE}" in
  local-manual)
    stop_local_manual_processes
    remove_local_manual_runtime_files
    app_info "down"
    ;;
  *)
    app_err "unsupported APP_MODE=${APP_MODE}"
    exit 1
    ;;
esac
