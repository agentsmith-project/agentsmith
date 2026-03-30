#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

echo "[runtime-mainline-smoke] checking workflow contract sync"
npm run contracts:check-current-workflows

echo "[runtime-mainline-smoke] checking bundle inputs"
npm run test:demo-bundle:inputs
npm run test:cluster-bundle:inputs

echo "[runtime-mainline-smoke] checking scenario status commands"
make demo-rehearsal-status >/dev/null
make cluster-rehearsal-status >/dev/null

echo "[runtime-mainline-smoke] checking scenario lock and stage command smoke"
bash "${ROOT_DIR}/scripts/runtime-scenario-lock-smoke.sh"
bash "${ROOT_DIR}/scripts/runtime-stage-command-smoke.sh"

echo "[runtime-mainline-smoke] ok"
