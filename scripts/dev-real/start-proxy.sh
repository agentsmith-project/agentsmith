#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_dev_real_env

write_proxy_config() {
  cat > "${PROXY_CONFIG}" <<EOF
listen: 127.0.0.1:${PROXY_PORT}
upstream_timeout_secs: 120
upstreams: {}
model_aliases: {}
EOF
}

wait_port_free "${PROXY_PORT}" "universal-proxy" 30
if [[ ! -x "${PROXY_ROOT}/target/debug/llm-universal-proxy" ]]; then
  info "building llm-universal-proxy debug binary"
  (cd "${PROXY_ROOT}" && cargo build --quiet)
fi
write_proxy_config
launch_detached "${PROXY_PID_FILE}" "${PROXY_LOG}" "
  cd '${PROXY_ROOT}' && \
  exec ./target/debug/llm-universal-proxy --config '${PROXY_CONFIG}'
"
wait_http "http://127.0.0.1:${PROXY_PORT}/admin/state" "universal-proxy" 60
capture_listener_pid "${PROXY_PORT}" "${PROXY_PID_FILE}" "universal-proxy"
printf '%s\n' "${PROXY_PORT}" > "${PROXY_PORT_FILE}"
write_ready_file "${PROXY_READY_FILE}"
