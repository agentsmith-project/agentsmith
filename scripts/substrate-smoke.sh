#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

ACTIVE_SCENARIO_LOCK_FILE="${ROOT_DIR}/artifacts/runtime/active-scenario.lock"
if [[ -f "${ACTIVE_SCENARIO_LOCK_FILE}" ]]; then
  active_scenario="$(cat "${ACTIVE_SCENARIO_LOCK_FILE}" 2>/dev/null || true)"
  if [[ -n "${active_scenario}" ]]; then
    echo "[substrate-smoke] ERROR: active flow is ${active_scenario}; stop it before running substrate smoke" >&2
    exit 1
  fi
fi

echo "[substrate-smoke] checking shared substrate lifecycle"
bash "${ROOT_DIR}/scripts/substrate/up.sh"
bash "${ROOT_DIR}/scripts/substrate/reseed.sh"
bash "${ROOT_DIR}/scripts/substrate/status.sh" >/dev/null
bash "${ROOT_DIR}/scripts/substrate/down.sh"
bash "${ROOT_DIR}/scripts/substrate/reset.sh"
echo "[substrate-smoke] ok"
