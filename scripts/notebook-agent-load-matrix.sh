#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"
ensure_real_lane_state

MATRIX="${MATRIX:-10x2,10x3,20x3}"
OUT_DIR="${OUT_DIR:-$(real_lane_tmp_file benchmarks/load-matrix-$(date +%Y%m%d-%H%M%S))}"
POLL_MAX="${POLL_MAX:-90}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-2}"
WAIT_AGENT_ONLINE="${WAIT_AGENT_ONLINE:-1}"
PROMPT="${PROMPT:-reply exactly: chain ok}"

mkdir -p "${OUT_DIR}"
CSV_PATH="${OUT_DIR}/summary.csv"
JSONL_PATH="${OUT_DIR}/summary.jsonl"

echo "[matrix] output dir: ${OUT_DIR}"
echo "[matrix] matrix: ${MATRIX}"

IFS=',' read -r -a CASES <<< "${MATRIX}"

case_idx=0
for item in "${CASES[@]}"; do
  case_idx=$((case_idx + 1))
  req="${item%x*}"
  conc="${item#*x}"
  if [[ -z "${req}" || -z "${conc}" || "${req}" == "${item}" ]]; then
    echo "[matrix] invalid case format: ${item} (expected requestsxconcurrency, e.g. 10x3)" >&2
    exit 1
  fi
  CASE_DIR="${OUT_DIR}/case-${case_idx}-r${req}-c${conc}"
  mkdir -p "${CASE_DIR}"
  CASE_JSON="${CASE_DIR}/result.json"
  CASE_LOG="${CASE_DIR}/stdout.log"
  echo "[matrix] case ${case_idx}/${#CASES[@]} requests=${req} concurrency=${conc}"
  (
    cd "${ROOT_DIR}"
    REQUESTS="${req}" \
    CONCURRENCY="${conc}" \
    POLL_MAX="${POLL_MAX}" \
    POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC}" \
    WAIT_AGENT_ONLINE="${WAIT_AGENT_ONLINE}" \
    PROMPT="${PROMPT}" \
    RESULT_JSON_PATH="${CASE_JSON}" \
    RESULT_CSV_PATH="${CSV_PATH}" \
    ./scripts/notebook-agent-load-test.sh
  ) | tee "${CASE_LOG}"
  node - <<'NODE' "${CASE_JSON}" "${JSONL_PATH}"
const fs = require('node:fs');
const resultPath = process.argv[2];
const jsonlPath = process.argv[3];
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
fs.appendFileSync(jsonlPath, JSON.stringify(result) + '\n');
NODE
done

echo "[matrix] done"
echo "[matrix] csv:   ${CSV_PATH}"
echo "[matrix] jsonl: ${JSONL_PATH}"
