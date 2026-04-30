#!/usr/bin/env bash
set -euo pipefail

NO_API_RESTART=0
if [[ "${1:-}" == "--no-api-restart" ]]; then
  NO_API_RESTART=1
fi

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/internal-common.sh"

if [[ "${NO_API_RESTART}" == "1" ]]; then
  stop_internal_runtime
  rm -f "${INTERNAL_SANDBOX_STATE_FILE}"
else
  if [[ ! -f "${SUBSTRATE_CONNECTION_ENV}" ]]; then
    internal_info "substrate connection env missing; stopping internal runtime without API restart"
    stop_internal_runtime
    rm -f "${INTERNAL_SANDBOX_STATE_FILE}"
  else
    restore_local_manual_external_mode
  fi
fi

internal_info "down"
