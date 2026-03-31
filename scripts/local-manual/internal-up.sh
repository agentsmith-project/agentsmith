#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/internal-common.sh"

ensure_local_manual_ready
ensure_notebook_demo_seeded
ensure_kind_cluster
ensure_internal_runner_image
ensure_juicefs_csi
ensure_internal_external_dependency_services
start_internal_runtime
restart_api_with_mode 1
ensure_internal_agent_state

internal_info "ready"
internal_info "Sandbox manager: ${INTERNAL_SANDBOX_MANAGER_URL_VALUE}"
internal_info "Namespace: ${K8S_NAMESPACE}"
internal_info "Internal agent: $(state_get internal_agent.name) ($(state_get internal_agent.id))"
