#!/usr/bin/env bash
set -euo pipefail

NO_API_RESTART=0
if [[ "${1:-}" == "--no-api-restart" ]]; then
  NO_API_RESTART=1
fi

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/internal-common.sh"

stop_internal_runtime
rm -f "${INTERNAL_SANDBOX_STATE_FILE}"
if [[ "${NO_API_RESTART}" != "1" && -f "${API_READY_FILE}" ]]; then
  restart_api_with_mode 0
fi

internal_info "down"
