#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/internal-common.sh"

cleanup_on_exit() {
  local exit_code="${1:-0}"
  if [[ "${exit_code}" != "0" && "${INTERNAL_RUNTIME_STARTED:-0}" == "1" ]]; then
    bash "${ROOT_DIR}/scripts/local-manual/internal-down.sh" --no-api-restart >/dev/null 2>&1 || true
  fi
}
trap 'cleanup_on_exit $?' EXIT INT TERM

ensure_local_manual_ready
ensure_kind_cluster
ensure_internal_runner_image
ensure_internal_runner_state_before_api_restart
ensure_afscp_storage_csi
ensure_internal_external_dependency_services
INTERNAL_RUNTIME_STARTED=1
if afscp_local_runtime_uses_source; then
  resolve_afscp_jvs_binary
fi
ensure_afscp_local_runtime
start_internal_runtime
restart_api_with_mode 1
ensure_internal_runner_state

internal_info "ready"
internal_info "ASBCP: ${ASBCP_INTERNAL_BASE_URL_VALUE}"
internal_info "Namespace: ${K8S_NAMESPACE}"
trap - EXIT INT TERM
