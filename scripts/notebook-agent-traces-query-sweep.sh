#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

PAGE_SIZES="${PAGE_SIZES:-20,50,200,500}"
REQUESTS="${REQUESTS:-100}"
CONCURRENCY="${CONCURRENCY:-10}"
WARMUP="${WARMUP:-10}"
OUT_DIR="${OUT_DIR:-/tmp/agentsmith-traces-query-sweep-$(date +%Y%m%d-%H%M%S)}"

API_BASE="${API_BASE:-http://localhost:20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
PROJECT_ID="${PROJECT_ID:-$(cat /tmp/agentsmith_project_id.txt 2>/dev/null || true)}"
TASK_ID="${TASK_ID:-}"
MESSAGE_ID="${MESSAGE_ID:-}"
PREPARE_TASK="${PREPARE_TASK:-1}"
TURNS="${TURNS:-5}"
TURN_PROMPT_PREFIX="${TURN_PROMPT_PREFIX:-reply exactly: trace turn}"

mkdir -p "${OUT_DIR}"

if [[ -z "${TASK_ID}" && "${PREPARE_TASK}" == "1" ]]; then
  echo "[sweep] preparing fresh task with ${TURNS} turns..."
  for i in $(seq 1 "${TURNS}"); do
    if [[ "${i}" == "1" ]]; then
      (
        cd "${ROOT_DIR}"
        PROMPT="${TURN_PROMPT_PREFIX} ${i}" make notebook-agent-smoke-task >/dev/null
      )
      TASK_ID="$(cat /tmp/agentsmith_last_task_id.txt)"
    else
      TOKEN="$(cat "${TOKEN_FILE}")"
      BASE="${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}"
      curl -sS -X POST "${BASE}/tasks/${TASK_ID}/messages" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "$(node -e 'console.log(JSON.stringify({role:"user",content:process.argv[1]}))' "${TURN_PROMPT_PREFIX} ${i}")" >/dev/null
      # Wait for terminal trace on this task.
      for _ in $(seq 1 90); do
        traces_json="$(curl -sS "${BASE}/tasks/${TASK_ID}/traces?page_size=200" -H "Authorization: Bearer ${TOKEN}" || true)"
        terminal="$(printf '%s' "${traces_json}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);const items=Array.isArray(j.items)?j.items:[];const t=[...items].reverse().find(x=>x&&(x.status==="success"||x.status==="error"||x.status==="cancelled"));process.stdout.write(t?.status||"")}catch{}})')"
        [[ -n "${terminal}" ]] && break
        sleep 2
      done
    fi
  done
  echo "[sweep] prepared task_id=${TASK_ID}"
fi

if [[ -z "${TASK_ID}" ]]; then
  echo "[sweep] TASK_ID is required (or PREPARE_TASK=1 to auto-generate)" >&2
  exit 1
fi

results_jsonl="${OUT_DIR}/summary.jsonl"
results_csv="${OUT_DIR}/summary.csv"
rm -f "${results_jsonl}" "${results_csv}"

IFS=',' read -r -a PAGES <<< "${PAGE_SIZES}"
for page in "${PAGES[@]}"; do
  page="$(echo "${page}" | xargs)"
  [[ -z "${page}" ]] && continue
  case_dir="${OUT_DIR}/page-${page}"
  mkdir -p "${case_dir}"
  echo "[sweep] page_size=${page}"
  if [[ -n "${MESSAGE_ID}" ]]; then
    (
      cd "${ROOT_DIR}"
      TASK_ID="${TASK_ID}" \
      MESSAGE_ID="${MESSAGE_ID}" \
      REQUESTS="${REQUESTS}" \
      CONCURRENCY="${CONCURRENCY}" \
      WARMUP="${WARMUP}" \
      PAGE_SIZE="${page}" \
      RESULT_JSON_PATH="${case_dir}/result.json" \
      ./scripts/notebook-agent-traces-query-bench.sh
    ) | tee "${case_dir}/stdout.log"
  else
    (
      cd "${ROOT_DIR}"
      TASK_ID="${TASK_ID}" \
      REQUESTS="${REQUESTS}" \
      CONCURRENCY="${CONCURRENCY}" \
      WARMUP="${WARMUP}" \
      PAGE_SIZE="${page}" \
      RESULT_JSON_PATH="${case_dir}/result.json" \
      ./scripts/notebook-agent-traces-query-bench.sh
    ) | tee "${case_dir}/stdout.log"
  fi
  node - <<'NODE' "${case_dir}/result.json" "${results_jsonl}" "${results_csv}" "${page}"
const fs = require('node:fs');
const resultPath = process.argv[2];
const jsonlPath = process.argv[3];
const csvPath = process.argv[4];
const pageSize = Number(process.argv[5]);
const summary = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
summary.page_size = pageSize;
fs.appendFileSync(jsonlPath, JSON.stringify(summary) + '\n');
const row = {
  ts: summary.ts,
  page_size: pageSize,
  requests: summary.expected,
  concurrency: summary.concurrency,
  success_rate: summary.success_rate,
  latency_avg_ms: summary.latency_ms?.avg ?? '',
  latency_p50_ms: summary.latency_ms?.p50 ?? '',
  latency_p95_ms: summary.latency_ms?.p95 ?? '',
  latency_p99_ms: summary.latency_ms?.p99 ?? '',
  latency_max_ms: summary.latency_ms?.max ?? '',
};
const headers = Object.keys(row);
if (!fs.existsSync(csvPath) || fs.statSync(csvPath).size === 0) {
  fs.appendFileSync(csvPath, headers.join(',') + '\n');
}
fs.appendFileSync(csvPath, headers.map((h)=>JSON.stringify(String(row[h] ?? ''))).join(',') + '\n');
NODE
done

echo "[sweep] done"
echo "[sweep] jsonl=${results_jsonl}"
echo "[sweep] csv=${results_csv}"
