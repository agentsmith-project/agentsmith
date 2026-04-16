#!/usr/bin/env bash

if ! declare -F local_runtime_root_dir >/dev/null 2>&1; then
  LOCAL_RUNTIME_LIB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  # shellcheck disable=SC1091
  source "${LOCAL_RUNTIME_LIB_ROOT}/scripts/lib/local-runtime-processes.sh"
fi

port_listener_pids() {
  local port="$1"
  local_runtime_port_listener_pids "${port}"
}

wait_port_free() {
  local port="$1"
  local label="$2"
  local_runtime_wait_port_free "${port}" "${label}" 30
}

backend_real_gate_ports_allow_unowned_rescue() {
  [[ "${BACKEND_REAL_GATE_PORTS_ALLOW_UNOWNED_RESCUE:-0}" == "1" || "${LOCAL_RUNTIME_ALLOW_UNOWNED_RESCUE:-0}" == "1" ]]
}

backend_real_gate_ports_allow_legacy_supervisor_cleanup() {
  [[ "${BACKEND_REAL_GATE_PORTS_ALLOW_LEGACY_SUPERVISOR_CLEANUP:-0}" == "1" ]]
}

backend_real_gate_stop_legacy_supervisor_or_fail_closed() {
  local pid="$1"
  local label="$2"
  local detail="$3"

  if backend_real_gate_ports_allow_legacy_supervisor_cleanup; then
    echo "[backend-real-gate-ports] legacy supervisor cleanup stopping ${label} pid ${pid} (${detail})" >&2
    local_runtime_stop_process_tree_unverified "${pid}"
    return 0
  fi

  echo "[backend-real-gate-ports] legacy supervisor cleanup disabled; refusing unverified cleanup for ${label} pid ${pid} (${detail}). Set BACKEND_REAL_GATE_PORTS_ALLOW_LEGACY_SUPERVISOR_CLEANUP=1 to use explicit legacy rescue." >&2
  return 1
}

backend_real_gate_stop_matching_supervisors() {
  local api_port="$1"
  local web_port="$2"
  local spec_pattern="$3"
  local pid cmd failed=0

  for pid in $(pgrep -f 'scripts/run-integration-e2e-full.sh' 2>/dev/null || true); do
    cmd="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
    if [[ -n "${spec_pattern}" && "${cmd}" == *"${spec_pattern}"* ]]; then
      backend_real_gate_stop_legacy_supervisor_or_fail_closed "${pid}" integration-supervisor "${spec_pattern}" || failed=1
    fi
  done

  for pid in $(pgrep -f 'tsx src/index.ts' 2>/dev/null || true); do
    if local_runtime_process_env_contains "${pid}" "INTEGRATION_API_PORT=${api_port}" \
      || local_runtime_process_env_contains "${pid}" "PORT=${api_port}"; then
      backend_real_gate_stop_legacy_supervisor_or_fail_closed "${pid}" api-env-port "api port ${api_port}" || failed=1
    fi
  done

  for pid in $(pgrep -f "next dev --port ${web_port}" 2>/dev/null || true); do
    backend_real_gate_stop_legacy_supervisor_or_fail_closed "${pid}" web-next-dev "web port ${web_port}" || failed=1
  done

  [[ "${failed}" -eq 0 ]]
}

backend_real_gate_cleanup_listener() {
  local port="$1"
  local service_kind="$2"
  local pid owner_pid failed=0

  for pid in $(port_listener_pids "${port}"); do
    [[ -n "${pid}" ]] || continue
    # Port preflight may need to clean a verified sidecar from a previous run,
    # so identity proof is required here while same-token ownership is not.
    owner_pid="$((unset LOCAL_RUNTIME_OWNER_TOKEN; local_runtime_verified_owner_pid_for_tree_member "${pid}" "${service_kind}" "${port}") 2>/dev/null || true)"
    if [[ -n "${owner_pid}" ]] && (unset LOCAL_RUNTIME_OWNER_TOKEN; local_runtime_stop_owned_process_tree "${owner_pid}" "${service_kind}" "${port}") >/dev/null 2>&1; then
      echo "[backend-real-gate-ports] stopped owned ${service_kind} listener pid ${pid} via owner root pid ${owner_pid} on port ${port}" >&2
      continue
    fi

    if backend_real_gate_ports_allow_unowned_rescue; then
      echo "[backend-real-gate-ports] rescue cleanup for unowned listener pid ${pid} on ${service_kind} port ${port}" >&2
      local_runtime_stop_process_tree_unverified "${pid}"
      continue
    fi

    echo "[backend-real-gate-ports] unowned listener pid ${pid} is using ${service_kind} port ${port}; refusing to kill without BACKEND_REAL_GATE_PORTS_ALLOW_UNOWNED_RESCUE=1" >&2
    failed=1
  done

  [[ "${failed}" -eq 0 ]]
}

cleanup_gate_ports() {
  local api_port="$1"
  local web_port="$2"
  local spec_pattern="$3"
  local failed=0

  backend_real_gate_stop_matching_supervisors "${api_port}" "${web_port}" "${spec_pattern}" || failed=1
  backend_real_gate_cleanup_listener "${api_port}" api || failed=1
  backend_real_gate_cleanup_listener "${web_port}" web || failed=1
  [[ "${failed}" -eq 0 ]] || return 1

  wait_port_free "${api_port}" "api" || return 1
  wait_port_free "${web_port}" "web" || return 1
}
