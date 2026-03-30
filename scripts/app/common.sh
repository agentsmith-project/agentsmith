#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
APP_MODE="${APP_MODE:-local-manual}"
SUBSTRATE="${SUBSTRATE:-local-dev}"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.local-manual}"

app_info() { echo "[app:${APP_MODE}] $*"; }
app_err() { echo "[app:${APP_MODE}] ERROR: $*" >&2; }

load_app_mode() {
  case "${APP_MODE}" in
    local-manual)
      source "${ROOT_DIR}/scripts/local-manual/common.sh"
      init_local_manual_env
      ;;
    *)
      app_err "unsupported APP_MODE=${APP_MODE}"
      exit 1
      ;;
  esac
}
