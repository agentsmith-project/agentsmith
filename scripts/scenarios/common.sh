#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
SCENARIO_RUNTIME_ROOT="${ROOT_DIR}/artifacts/runtime"
ACTIVE_SCENARIO_LOCK_FILE="${SCENARIO_RUNTIME_ROOT}/active-scenario.lock"

ensure_scenario_dirs() {
  mkdir -p "${SCENARIO_RUNTIME_ROOT}"
}

current_active_scenario() {
  [[ -f "${ACTIVE_SCENARIO_LOCK_FILE}" ]] || return 0
  cat "${ACTIVE_SCENARIO_LOCK_FILE}" 2>/dev/null || true
}

acquire_scenario_lock() {
  local scenario="$1"
  ensure_scenario_dirs
  local current="$(current_active_scenario)"
  if [[ -n "${current}" && "${current}" != "${scenario}" ]]; then
    echo "[scenario] ERROR: active scenario is ${current}; stop it before starting ${scenario}." >&2
    exit 1
  fi
  printf '%s\n' "${scenario}" > "${ACTIVE_SCENARIO_LOCK_FILE}"
}

release_scenario_lock() {
  local scenario="$1"
  local current="$(current_active_scenario)"
  if [[ "${current}" == "${scenario}" ]]; then
    rm -f "${ACTIVE_SCENARIO_LOCK_FILE}"
  fi
}
