#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="${NEXT_GENERATED_ROOT_BUILD_ROOT:-${SCRIPT_ROOT}}"
export ROOT_DIR
source "${SCRIPT_ROOT}/scripts/lib/next-generated-root-state.sh"

BUILD_COMMAND="${NEXT_GENERATED_ROOT_BUILD_COMMAND:-next build}"
BUILD_FINALIZED=0

info() { echo "[build-next-with-root-finalize] $*"; }

finalize_on_exit() {
  local status=$?
  if [[ "${BUILD_FINALIZED}" != "1" ]]; then
    next_generated_root_with_source_contract_lock build_finalize_trap \
      next_generated_root_prepare_source_safe_for_tsc >/dev/null 2>&1 || true
  fi
  exit "${status}"
}

run_build_with_final_reconcile() {
  local build_status finalize_status
  next_generated_root_prepare_source_safe_for_tsc

  info "${BUILD_COMMAND}"
  set +e
  (cd "${ROOT_DIR}" && eval "${BUILD_COMMAND}")
  build_status=$?
  set -e

  finalize_status=0
  next_generated_root_prepare_source_safe_for_tsc || finalize_status=$?
  BUILD_FINALIZED=1

  if (( build_status != 0 )); then
    return "${build_status}"
  fi
  return "${finalize_status}"
}

trap finalize_on_exit EXIT

next_generated_root_with_source_contract_lock build_next_with_root_finalize run_build_with_final_reconcile
