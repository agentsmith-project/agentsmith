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

printf '[runtime-scenario-lock-smoke] ok\n'
