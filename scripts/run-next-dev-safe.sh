#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"
DEFAULT_MAX_OLD_SPACE_SIZE="${NEXT_MAX_OLD_SPACE_SIZE:-4096}"
NEXT_GENERATED_ROOT_MANAGED="${NEXT_GENERATED_ROOT_MANAGED:-0}"
export PATH="${ROOT_DIR}/node_modules/.bin:${PATH}"
NEXT_DEV_EXIT_MARKER_WRITTEN=0
NEXT_DEV_ROOT_GUARD_PID=""

if [[ -n "${NODE_OPTIONS:-}" ]]; then
  export NODE_OPTIONS="${NODE_OPTIONS} --max-old-space-size=${DEFAULT_MAX_OLD_SPACE_SIZE}"
else
  export NODE_OPTIONS="--max-old-space-size=${DEFAULT_MAX_OLD_SPACE_SIZE}"
fi

running_processes="$(pgrep -af "next-server|next dev" || true)"
if [[ -n "${running_processes}" ]]; then
  running_count="$(
    printf '%s\n' "${running_processes}" \
      | { grep -F "${ROOT_DIR}" || true; } \
      | { grep -v "run-next-dev-safe.sh" || true; } \
      | wc -l \
      | tr -d ' '
  )"
else
  running_count="0"
fi

if [[ "${running_count}" -ge 2 ]]; then
  cat >&2 <<EOF
[next-dev-safe] warning: detected ${running_count} Next.js dev processes for this workspace.
[next-dev-safe] This repo has previously hit host OOM when multiple dev servers ran in parallel.
[next-dev-safe] Consider stopping unused dev servers before continuing.
EOF
fi

if [[ -n "${NEXT_DEV_PID_FILE:-}" ]]; then
  mkdir -p "$(dirname "${NEXT_DEV_PID_FILE}")"
  printf '%s\n' "$$" > "${NEXT_DEV_PID_FILE}"
fi

if [[ -n "${NEXT_DEV_PORT_FILE:-}" && -n "${NEXT_DEV_PORT:-}" ]]; then
  mkdir -p "$(dirname "${NEXT_DEV_PORT_FILE}")"
  printf '%s\n' "${NEXT_DEV_PORT}" > "${NEXT_DEV_PORT_FILE}"
fi

NEXT_DEV_CHILD_PID=""

write_next_dev_exit_marker() {
  local event="$1"
  local exit_status="$2"
  local signal_value="${3:-null}"
  local child_pid_value="${4:-null}"
  [[ -n "${NEXT_DEV_EXIT_MARKER_FILE:-}" ]] || return 0
  if [[ "${NEXT_DEV_EXIT_MARKER_WRITTEN}" == "1" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "${NEXT_DEV_EXIT_MARKER_FILE}")"
  cat > "${NEXT_DEV_EXIT_MARKER_FILE}" <<EOF
{
  "event": "${event}",
  "exit_status": ${exit_status},
  "signal": ${signal_value},
  "wrapper_pid": $$,
  "child_pid": ${child_pid_value},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
}
EOF
  NEXT_DEV_EXIT_MARKER_WRITTEN=1
}

finalize_managed_root_contract() {
  [[ "${NEXT_GENERATED_ROOT_MANAGED}" == "1" && -n "${NEXT_DEV_CHILD_PID}" ]] || return 0

  if [[ -n "${NEXT_DEV_ROOT_GUARD_PID}" ]]; then
    next_generated_root_stop_contract_guard "${NEXT_DEV_ROOT_GUARD_PID}"
    wait "${NEXT_DEV_ROOT_GUARD_PID}" >/dev/null 2>&1 || true
    NEXT_DEV_ROOT_GUARD_PID=""
  fi

  next_generated_root_final_reconcile_source_contract
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  if [[ -n "${NEXT_DEV_CHILD_PID}" ]]; then
    if kill -0 "${NEXT_DEV_CHILD_PID}" >/dev/null 2>&1; then
      local cleanup_signal="null"
      if [[ "${status}" -ge 128 ]]; then
        cleanup_signal="$((status - 128))"
      fi
      write_next_dev_exit_marker "wrapper_cleanup" "${status}" "${cleanup_signal}" "${NEXT_DEV_CHILD_PID}"
      next_generated_root_stop_pid_tree_gracefully "${NEXT_DEV_CHILD_PID}" 5
    fi
    wait "${NEXT_DEV_CHILD_PID}" >/dev/null 2>&1 || true
    local finalize_status=0
    set +e
    finalize_managed_root_contract
    finalize_status=$?
    set -e
    if [[ "${finalize_status}" -ne 0 && "${status}" -eq 0 ]]; then
      status="${finalize_status}"
    fi
    NEXT_DEV_CHILD_PID=""
  fi

  if [[ -n "${NEXT_DEV_ROOT_GUARD_PID}" ]]; then
    next_generated_root_stop_contract_guard "${NEXT_DEV_ROOT_GUARD_PID}"
    wait "${NEXT_DEV_ROOT_GUARD_PID}" >/dev/null 2>&1 || true
    NEXT_DEV_ROOT_GUARD_PID=""
  fi

  exit "${status}"
}
trap cleanup EXIT INT TERM

if [[ "${NEXT_GENERATED_ROOT_MANAGED}" == "1" ]]; then
  next_generated_root_prepare_for_validation
fi

next dev "$@" &
NEXT_DEV_CHILD_PID=$!

if [[ "${NEXT_GENERATED_ROOT_MANAGED}" == "1" ]]; then
  next_generated_root_guard_source_contract "${NEXT_DEV_CHILD_PID}" &
  NEXT_DEV_ROOT_GUARD_PID=$!
fi

if [[ -n "${NEXT_DEV_PID_FILE:-}" ]]; then
  mkdir -p "$(dirname "${NEXT_DEV_PID_FILE}")"
  printf '%s\n' "${NEXT_DEV_CHILD_PID}" > "${NEXT_DEV_PID_FILE}"
fi

set +e
wait "${NEXT_DEV_CHILD_PID}"
NEXT_DEV_CHILD_STATUS=$?
set -e

NEXT_DEV_CHILD_SIGNAL="null"
if [[ "${NEXT_DEV_CHILD_STATUS}" -ge 128 ]]; then
  NEXT_DEV_CHILD_SIGNAL="$((NEXT_DEV_CHILD_STATUS - 128))"
fi
write_next_dev_exit_marker "child_exit" "${NEXT_DEV_CHILD_STATUS}" "${NEXT_DEV_CHILD_SIGNAL}" "${NEXT_DEV_CHILD_PID}"
FINALIZE_MANAGED_ROOT_STATUS=0
set +e
finalize_managed_root_contract
FINALIZE_MANAGED_ROOT_STATUS=$?
set -e
if [[ "${FINALIZE_MANAGED_ROOT_STATUS}" -ne 0 && "${NEXT_DEV_CHILD_STATUS}" -eq 0 ]]; then
  NEXT_DEV_CHILD_STATUS="${FINALIZE_MANAGED_ROOT_STATUS}"
fi

if [[ "${NEXT_DEV_CHILD_STATUS}" -ge 128 ]]; then
  echo "[next-dev-safe] next dev child exited due to signal ${NEXT_DEV_CHILD_SIGNAL} (status ${NEXT_DEV_CHILD_STATUS})" >&2
else
  echo "[next-dev-safe] next dev child exited with status ${NEXT_DEV_CHILD_STATUS}" >&2
fi

NEXT_DEV_CHILD_PID=""
exit "${NEXT_DEV_CHILD_STATUS}"
