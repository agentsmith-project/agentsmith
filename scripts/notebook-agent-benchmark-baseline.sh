#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"
ensure_real_lane_state

# Default baseline profile is intentionally moderate for repeatability on local/CI-like environments.
MATRIX="${MATRIX:-6x2,6x3,10x3}"
POLL_MAX="${POLL_MAX:-120}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-2}"
WAIT_AGENT_ONLINE="${WAIT_AGENT_ONLINE:-1}"
PROMPT="${PROMPT:-reply exactly: chain ok}"
OUT_DIR="${OUT_DIR:-$(real_lane_tmp_file benchmarks/baseline-$(date +%Y%m%d-%H%M%S))}"

mkdir -p "${OUT_DIR}"

echo "[baseline] matrix=${MATRIX}"
echo "[baseline] out_dir=${OUT_DIR}"

(
  cd "${ROOT_DIR}"
  MATRIX="${MATRIX}" \
  OUT_DIR="${OUT_DIR}" \
  POLL_MAX="${POLL_MAX}" \
  POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC}" \
  WAIT_AGENT_ONLINE="${WAIT_AGENT_ONLINE}" \
  PROMPT="${PROMPT}" \
  ./scripts/notebook-agent-load-matrix.sh
)

echo "[baseline] summary.csv preview:"
head -20 "${OUT_DIR}/summary.csv" || true

echo "[baseline] top-level outputs:"
echo "  ${OUT_DIR}/summary.csv"
echo "  ${OUT_DIR}/summary.jsonl"
