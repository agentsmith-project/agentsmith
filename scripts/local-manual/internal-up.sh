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
ensure_notebook_demo_seeded
ensure_kind_cluster
ensure_internal_runner_image
ensure_juicefs_csi
ensure_internal_external_dependency_services
INTERNAL_RUNTIME_STARTED=1
start_internal_runtime
restart_api_with_mode 1
ensure_internal_agent_state

internal_info "ready"
internal_info "Sandbox manager: ${INTERNAL_SANDBOX_MANAGER_URL_VALUE}"
internal_info "Namespace: ${K8S_NAMESPACE}"
internal_info "Internal agent: $(state_get internal_agent.name) ($(state_get internal_agent.id))"
trap - EXIT INT TERM
