#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

SCENARIO_RUNTIME_ROOT="${TMP_DIR}/runtime"
ACTIVE_SCENARIO_LOCK_FILE="${SCENARIO_RUNTIME_ROOT}/active-scenario.lock"
mkdir -p "${SCENARIO_RUNTIME_ROOT}"

# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/scenarios/common.sh"

printf '[runtime-scenario-lock-smoke] acquiring local-manual lock\n'
acquire_scenario_lock local-manual
[[ "$(current_active_scenario)" == 'local-manual' ]]

printf '[runtime-scenario-lock-smoke] rejecting conflicting rehearsal lock\n'
if SCENARIO_RUNTIME_ROOT="${SCENARIO_RUNTIME_ROOT}" ACTIVE_SCENARIO_LOCK_FILE="${ACTIVE_SCENARIO_LOCK_FILE}" bash -lc '
  source "'$ROOT_DIR'/scripts/scenarios/common.sh"
  acquire_scenario_lock demo-rehearsal
'; then
  echo '[runtime-scenario-lock-smoke] expected conflicting lock acquisition to fail' >&2
  exit 1
fi

printf '[runtime-scenario-lock-smoke] releasing local-manual lock\n'
release_scenario_lock local-manual
[[ -z "$(current_active_scenario)" ]]

printf '[runtime-scenario-lock-smoke] acquiring rehearsal lock after release\n'
acquire_scenario_lock cluster-rehearsal
[[ "$(current_active_scenario)" == 'cluster-rehearsal' ]]
release_scenario_lock cluster-rehearsal

printf '[runtime-scenario-lock-smoke] invalid demo bootstrap must not leave a stale lock\n'
if SCENARIO_RUNTIME_ROOT="${SCENARIO_RUNTIME_ROOT}" ACTIVE_SCENARIO_LOCK_FILE="${ACTIVE_SCENARIO_LOCK_FILE}" ROOT_DIR="${ROOT_DIR}" DEMO_REHEARSAL_ROOT="${TMP_DIR}/demo-rehearsal" bash -lc '
  set -euo pipefail
  bash "${ROOT_DIR}/scripts/scenarios/demo-rehearsal/bootstrap.sh"
'; then
  echo '[runtime-scenario-lock-smoke] expected invalid demo bootstrap to fail' >&2
  exit 1
fi
[[ -z "$(current_active_scenario)" ]]

printf '[runtime-scenario-lock-smoke] guarded lock cleanup releases lock on failure\n'
if SCENARIO_RUNTIME_ROOT="${SCENARIO_RUNTIME_ROOT}" ACTIVE_SCENARIO_LOCK_FILE="${ACTIVE_SCENARIO_LOCK_FILE}" ROOT_DIR="${ROOT_DIR}" bash -lc '
  set -euo pipefail
  source "${ROOT_DIR}/scripts/scenarios/common.sh"
  acquire_scenario_lock demo-rehearsal
  arm_scenario_lock_cleanup demo-rehearsal
  false
'; then
  echo '[runtime-scenario-lock-smoke] expected guarded lock cleanup case to fail' >&2
  exit 1
fi
[[ -z "$(current_active_scenario)" ]]

printf '[runtime-scenario-lock-smoke] guarded lock cleanup keeps lock after world change\n'
if SCENARIO_RUNTIME_ROOT="${SCENARIO_RUNTIME_ROOT}" ACTIVE_SCENARIO_LOCK_FILE="${ACTIVE_SCENARIO_LOCK_FILE}" ROOT_DIR="${ROOT_DIR}" bash -lc '
  set -euo pipefail
  source "${ROOT_DIR}/scripts/scenarios/common.sh"
  acquire_scenario_lock demo-rehearsal
  arm_scenario_lock_cleanup demo-rehearsal
  mark_scenario_world_changed
  false
'; then
  echo '[runtime-scenario-lock-smoke] expected guarded world-change case to fail' >&2
  exit 1
fi
[[ "$(current_active_scenario)" == 'demo-rehearsal' ]]
release_scenario_lock demo-rehearsal
[[ -z "$(current_active_scenario)" ]]

printf '[runtime-scenario-lock-smoke] ok\n'
