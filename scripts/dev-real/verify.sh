#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_dev_real_env

check_http() {
  local url="$1"
  local label="$2"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' "${url}" || true)"
  if [[ "${code}" != "200" && "${code}" != "307" && "${code}" != "308" ]]; then
    err "${label} check failed (${url}) status=${code}"
    exit 1
  fi
}

check_http "http://127.0.0.1:${PROXY_PORT}/admin/state" "proxy"
check_http "http://localhost:${PORT_API}/api/v1/openapi.json" "api"
check_http "http://localhost:${PORT_WEB}/${LOCALE}/login/workspace" "web"
check_http "http://localhost:${PORT_WEB}/api/public/workspaces" "public workspaces"
info "platform verify passed"
