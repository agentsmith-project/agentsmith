#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"
DEFAULT_MAX_OLD_SPACE_SIZE="${NEXT_MAX_OLD_SPACE_SIZE:-4096}"

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

NEXT_GENERATED_ROOT_STATE_DIR="$(next_generated_root_state_dir "${NEXT_GENERATED_ROOT_STATE_DIR:-}")"
next_generated_root_snapshot "${NEXT_GENERATED_ROOT_STATE_DIR}"

NEXT_DEV_CHILD_PID=""

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  if [[ -n "${NEXT_DEV_CHILD_PID}" ]] && kill -0 "${NEXT_DEV_CHILD_PID}" >/dev/null 2>&1; then
    kill -TERM "${NEXT_DEV_CHILD_PID}" >/dev/null 2>&1 || true
    wait "${NEXT_DEV_CHILD_PID}" >/dev/null 2>&1 || true
  fi

  next_generated_root_restore "${NEXT_GENERATED_ROOT_STATE_DIR}"

  if [[ -d "${NEXT_GENERATED_ROOT_STATE_DIR}" ]]; then
    rm -rf "${NEXT_GENERATED_ROOT_STATE_DIR}"
  fi

  exit "${status}"
}
trap cleanup EXIT INT TERM

next dev "$@" &
NEXT_DEV_CHILD_PID=$!

if [[ -n "${NEXT_DEV_PID_FILE:-}" ]]; then
  mkdir -p "$(dirname "${NEXT_DEV_PID_FILE}")"
  printf '%s\n' "${NEXT_DEV_CHILD_PID}" > "${NEXT_DEV_PID_FILE}"
fi

wait "${NEXT_DEV_CHILD_PID}"
