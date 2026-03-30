#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_demo_rehearsal_env
current="$(current_active_scenario || true)"
[[ "${current}" == "${DEMO_REHEARSAL_NAME}" ]] || { echo "[scenario] ERROR: demo-rehearsal is not the active scenario." >&2; exit 1; }
run_stage verify

