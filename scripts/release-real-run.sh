#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"
ensure_real_lane_state

REAL_LANE_API_KEY_VALUE="${REAL_LANE_API_KEY:-}"
REAL_LANE_MODEL_VALUE="${REAL_LANE_MODEL:-MiniMax-M2.7-highspeed}"
REAL_LANE_OPENAI_BASE_URL_VALUE="${REAL_LANE_OPENAI_BASE_URL:-https://api.minimaxi.com/v1}"
REAL_LANE_ANTHROPIC_BASE_URL_VALUE="${REAL_LANE_ANTHROPIC_BASE_URL:-https://api.minimaxi.com/anthropic/v1}"
if [[ -z "${REAL_LANE_API_KEY_VALUE}" ]]; then
  echo "[release-real-run] Missing REAL_LANE_API_KEY." >&2
  exit 1
fi

info() { echo "[release-real-run] $*"; }
run_real_cmd() {
  (cd "${ROOT_DIR}" && env \
    REAL_LANE_API_KEY="${REAL_LANE_API_KEY_VALUE}" \
    REAL_LANE_MODEL="${REAL_LANE_MODEL_VALUE}" \
    REAL_LANE_OPENAI_BASE_URL="${REAL_LANE_OPENAI_BASE_URL_VALUE}" \
    REAL_LANE_ANTHROPIC_BASE_URL="${REAL_LANE_ANTHROPIC_BASE_URL_VALUE}" \
    "$@")
}

info "running external default real lane"
run_real_cmd \
  INTEGRATION_API_PORT=20040 \
  INTEGRATION_WEB_PORT=3041 \
  npm run test:real-core

info "running notebook real smoke"
run_real_cmd \
  INTEGRATION_API_PORT=20060 \
  INTEGRATION_WEB_PORT=3061 \
  npm run test:notebook:real-smoke

info "running external codex real lane"
run_real_cmd \
  INTEGRATION_API_PORT=20064 \
  INTEGRATION_WEB_PORT=3065 \
  npm run test:agents:real:codex

info "running file library real gate"
run_real_cmd \
  FILE_LIBRARY_GATE_API_PORT=21010 \
  bash scripts/run-file-library-real-gate.sh

info "running internal notebook real gate"
run_real_cmd \
  INTEGRATION_API_PORT=20072 \
  INTEGRATION_WEB_PORT=3072 \
  npm run test:internal:real:notebook-workspace

state_set_string release.phase "run_completed"
state_set_string release.last_run_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[release-real-run] done"
