#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_local_manual_env
LOCAL_MANUAL_RESET_EVIDENCE=1
setup_local_manual_runtime_evidence

check_http() {
  local url="$1"
  local label="$2"
  local stage="$3"
  if ! gate_wait_for_http "${LOCAL_MANUAL_EVIDENCE_DIR}" "${url}" 30 infra_dependency_unready "${stage}" "200,307,308"; then
    err "${label} check failed (${url})"
    exit 1
  fi
  gate_record_service_status "${LOCAL_MANUAL_EVIDENCE_DIR}" "${label}" ready "${url}"
}

check_http "http://127.0.0.1:${PROXY_PORT}/admin/state" "proxy" "infra_preflight_proxy"
check_http "${RUNTIME_HOST_API_BASE_URL}/openapi.json" "api" "infra_preflight_api"
check_http "${RUNTIME_BROWSER_WEB_BASE_URL}/${LOCALE}/login/workspace" "web" "infra_preflight_web_login"
check_http "${RUNTIME_HOST_WEB_BASE_URL}/api/public/workspaces" "public_workspaces" "infra_preflight_web_public"
gate_write_mount_tree "${LOCAL_MANUAL_EVIDENCE_DIR}" "${LOCAL_MANUAL_ROOT}"
gate_record_success "${LOCAL_MANUAL_EVIDENCE_DIR}" "verify"
info "platform verify passed"
