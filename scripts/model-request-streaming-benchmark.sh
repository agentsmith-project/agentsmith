#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
ensure_backend_real_state

BASE_URL="${BASE_URL:-http://localhost:20000}"
WS_ID="${WS_ID:-$(state_get workspace.id ws_default)}"
PROJECT_ID="${PROJECT_ID:-$(state_get project.id proj_001)}"
MODEL="${MODEL:-openai/gpt-4o-mini}"
PROMPT="${PROMPT:-benchmark streaming request}"
REQUESTS="${REQUESTS:-30}"
CONCURRENCY="${CONCURRENCY:-5}"
MAX_TIME_SECONDS="${MAX_TIME_SECONDS:-90}"
TOKEN_FILE="${TOKEN_FILE:-$(backend_real_token_file)}"
STRICT_GATE="${STRICT_GATE:-0}"
THRESHOLD_P95_MS="${THRESHOLD_P95_MS:-12000}"
THRESHOLD_ERROR_RATE="${THRESHOLD_ERROR_RATE:-0.05}"

if ! command -v curl >/dev/null 2>&1; then
  echo "[model-request-stream-bench] curl is required" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[model-request-stream-bench] node is required" >&2
  exit 1
fi

if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[model-request-stream-bench] token file not found: ${TOKEN_FILE}" >&2
  exit 1
fi

TOKEN="$(tr -d '\r\n' < "${TOKEN_FILE}")"
if [[ -z "${TOKEN}" ]]; then
  echo "[model-request-stream-bench] token is empty: ${TOKEN_FILE}" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/agentsmith-model-request-stream-bench.XXXXXX)"
RESULTS_CSV="${TMP_DIR}/results.csv"
SUMMARY_JSON="${TMP_DIR}/summary.json"
URL="${BASE_URL}/api/v1/workspaces/${WS_ID}/projects/${PROJECT_ID}/llm/chat/completions"

echo "idx,http_code,duration_ms,ok" > "${RESULTS_CSV}"

run_one() {
  local idx="$1"
  local payload_file="${TMP_DIR}/payload-${idx}.json"
  local body_file="${TMP_DIR}/body-${idx}.txt"

  cat > "${payload_file}" <<EOF
{"model":"${MODEL}","stream":true,"messages":[{"role":"user","content":"${PROMPT} #${idx}"}]}
EOF

  local curl_meta
  curl_meta="$(curl -sS \
    --max-time "${MAX_TIME_SECONDS}" \
    -o "${body_file}" \
    -w "%{http_code},%{time_total}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -X POST \
    --data-binary "@${payload_file}" \
    "${URL}" || echo "000,${MAX_TIME_SECONDS}")"

  local http_code
  local time_total
  http_code="$(echo "${curl_meta}" | cut -d',' -f1)"
  time_total="$(echo "${curl_meta}" | cut -d',' -f2)"
  local duration_ms
  duration_ms="$(awk "BEGIN { printf \"%.2f\", (${time_total} * 1000) }")"

  local ok=0
  if [[ "${http_code}" =~ ^2[0-9][0-9]$ ]]; then
    ok=1
  fi
  echo "${idx},${http_code},${duration_ms},${ok}" >> "${RESULTS_CSV}"
}

export -f run_one
export TMP_DIR RESULTS_CSV URL TOKEN MODEL PROMPT MAX_TIME_SECONDS

echo "[model-request-stream-bench] start requests=${REQUESTS} concurrency=${CONCURRENCY} model=${MODEL}"
seq 1 "${REQUESTS}" | xargs -I{} -P "${CONCURRENCY}" bash -lc 'run_one "$@"' _ {}

node -e '
const fs = require("fs");
const path = process.argv[1];
const csv = fs.readFileSync(path, "utf8").trim().split("\n").slice(1);
const rows = csv.map((line) => {
  const [idx, code, duration, ok] = line.split(",");
  return { idx: Number(idx), code, duration: Number(duration), ok: ok === "1" };
});
const total = rows.length;
const success = rows.filter((r) => r.ok);
const failed = total - success.length;
const errorRate = total > 0 ? failed / total : 1;
const durations = success.map((r) => r.duration).sort((a, b) => a - b);
const percentile = (p) => {
  if (durations.length === 0) return 0;
  const rank = Math.max(0, Math.ceil((p / 100) * durations.length) - 1);
  return durations[Math.min(rank, durations.length - 1)];
};
const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
const summary = {
  kind: "model_request_streaming_benchmark",
  total_requests: total,
  success_requests: success.length,
  failed_requests: failed,
  error_rate: Number(errorRate.toFixed(4)),
  latency_ms: {
    avg: Number(avg.toFixed(2)),
    p50: Number(percentile(50).toFixed(2)),
    p95: Number(percentile(95).toFixed(2)),
    p99: Number(percentile(99).toFixed(2)),
  },
  started_at: new Date().toISOString(),
};
process.stdout.write(JSON.stringify(summary, null, 2));
' "${RESULTS_CSV}" > "${SUMMARY_JSON}"

cat "${SUMMARY_JSON}"
echo
echo "[model-request-stream-bench] artifacts_dir=${TMP_DIR}"

if [[ "${STRICT_GATE}" == "1" ]]; then
  P95="$(node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.latency_ms.p95));' "${SUMMARY_JSON}")"
  ERROR_RATE="$(node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(s.error_rate));' "${SUMMARY_JSON}")"
  if awk "BEGIN { exit !(${P95} <= ${THRESHOLD_P95_MS}) }"; then
    :
  else
    echo "[model-request-stream-bench] gate failed: p95=${P95} > ${THRESHOLD_P95_MS}" >&2
    exit 1
  fi
  if awk "BEGIN { exit !(${ERROR_RATE} <= ${THRESHOLD_ERROR_RATE}) }"; then
    :
  else
    echo "[model-request-stream-bench] gate failed: error_rate=${ERROR_RATE} > ${THRESHOLD_ERROR_RATE}" >&2
    exit 1
  fi
fi
