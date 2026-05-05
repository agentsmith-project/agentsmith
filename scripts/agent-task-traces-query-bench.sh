#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
ensure_backend_real_state

API_BASE="${API_BASE:-http://localhost:20000}"
WORKSPACE_ID="${WORKSPACE_ID:-$(state_get workspace.id ws_default)}"
TOKEN_FILE="${TOKEN_FILE:-$(backend_real_token_file)}"
PROJECT_ID="${PROJECT_ID:-$(state_get project.id)}"
TASK_ID="${TASK_ID:-$(state_get task.last_id)}"
ACTIVITY_ID="${ACTIVITY_ID:-}"
RUN_ID="${RUN_ID:-}"
PAGE_SIZE="${PAGE_SIZE:-200}"
REQUESTS="${REQUESTS:-50}"
CONCURRENCY="${CONCURRENCY:-5}"
WARMUP="${WARMUP:-5}"
RESULT_JSON_PATH="${RESULT_JSON_PATH:-}"

if [[ -z "${PROJECT_ID}" || -z "${TASK_ID}" ]]; then
  echo "[traces-bench] missing PROJECT_ID/TASK_ID in $(backend_real_state_file)" >&2
  exit 1
fi
if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[traces-bench] token file not found: ${TOKEN_FILE}" >&2
  exit 1
fi
TOKEN="$(cat "${TOKEN_FILE}")"
BASE="${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}"

json_get() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);let v=j;for(const p of process.argv[1].split(".")){if(!p) continue; v=v?.[p]} if(v==null) process.exit(2); process.stdout.write(String(v));}catch{process.exit(3)}})' "$1"
}

if [[ -z "${ACTIVITY_ID}" ]]; then
  activity_json="$(curl -sS "${BASE}/tasks/${TASK_ID}/activity" -H "Authorization: Bearer ${TOKEN}")"
  ACTIVITY_ID="$(printf '%s' "${activity_json}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const parsed=JSON.parse(s); if(!Array.isArray(parsed)) process.exit(3); const item=[...parsed].reverse().find(x=>x&&x.actor==="runner"&&x.kind==="runner_output"); if(!item?.id) process.exit(2); process.stdout.write(item.id);})' || true)"
fi

if [[ -z "${ACTIVITY_ID}" ]]; then
  echo "[traces-bench] unable to resolve ACTIVITY_ID (set ACTIVITY_ID explicitly or ensure task has runner output)" >&2
  exit 1
fi

query_url="${BASE}/tasks/${TASK_ID}/traces?message_id=${ACTIVITY_ID}&page_size=${PAGE_SIZE}"
if [[ -n "${RUN_ID}" ]]; then
  query_url="${query_url}&run_id=${RUN_ID}"
fi

TMP_DIR="$(mktemp -d /tmp/agentsmith-traces-bench.XXXXXX)"
trap 'rm -rf "${TMP_DIR}"' EXIT INT TERM

run_one() {
  local idx="$1"
  local out_file="${TMP_DIR}/${idx}.body"
  local code_file="${TMP_DIR}/${idx}.code"
  local time_file="${TMP_DIR}/${idx}.time"
  local metrics
  metrics="$(
    curl -sS -o "${out_file}" -w '%{http_code} %{time_total}' \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Accept: application/json' \
      "${query_url}" \
      --max-time 30 || true
  )"
  printf '%s\n' "${metrics}" | awk '{print $1}' > "${code_file}"
  printf '%s\n' "${metrics}" | awk '{print $2}' > "${time_file}"
}

echo "[traces-bench] task_id=${TASK_ID} activity_id=${ACTIVITY_ID} requests=${REQUESTS} concurrency=${CONCURRENCY} page_size=${PAGE_SIZE}"
echo "[traces-bench] url=${query_url}"

for i in $(seq 1 "${WARMUP}"); do
  curl -sS -o /dev/null -H "Authorization: Bearer ${TOKEN}" "${query_url}" || true
done

active=0
for idx in $(seq 1 "${REQUESTS}"); do
  run_one "${idx}" &
  active=$((active + 1))
  if [[ "${active}" -ge "${CONCURRENCY}" ]]; then
    wait -n || true
    active=$((active - 1))
  fi
done
wait || true

summary_json="$(node - <<'NODE' "${TMP_DIR}" "${REQUESTS}" "${CONCURRENCY}" "${TASK_ID}" "${ACTIVITY_ID}"
const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv[2];
const expected = Number(process.argv[3]);
const concurrency = Number(process.argv[4]);
const taskId = process.argv[5];
const activityId = process.argv[6];
const files = fs.readdirSync(dir);
const rows = [];
for (const f of files) {
  if (!f.endsWith('.code')) continue;
  const id = f.replace(/\.code$/, '');
  const code = String(fs.readFileSync(path.join(dir, `${id}.code`), 'utf8')).trim();
  const timeRaw = fs.existsSync(path.join(dir, `${id}.time`))
    ? String(fs.readFileSync(path.join(dir, `${id}.time`), 'utf8')).trim()
    : '';
  const latencyMs = Math.round(Number(timeRaw || '0') * 1000);
  rows.push({ id: Number(id), code, latencyMs });
}
rows.sort((a,b)=>a.id-b.id);
const ok = rows.filter((r) => r.code === '200');
const failed = rows.filter((r) => r.code !== '200');
const lats = ok.map((r)=>r.latencyMs).sort((a,b)=>a-b);
const pct = (p) => {
  if (lats.length === 0) return null;
  const idx = Math.min(lats.length - 1, Math.max(0, Math.ceil((p/100)*lats.length) - 1));
  return lats[idx];
};
const avg = lats.length ? Math.round(lats.reduce((a,b)=>a+b,0)/lats.length) : null;
process.stdout.write(JSON.stringify({
  ts: new Date().toISOString(),
  kind: 'traces_query_bench',
  task_id: taskId,
  activity_id: activityId,
  expected,
  concurrency,
  completed: rows.length,
  success: ok.length,
  failed: failed.length,
  success_rate: expected > 0 ? Number((ok.length / expected).toFixed(4)) : null,
  latency_ms: { avg, p50: pct(50), p95: pct(95), p99: pct(99), max: lats.length ? lats[lats.length - 1] : null },
  failure_codes: [...new Set(failed.map((r)=>r.code))],
}, null, 2));
NODE
)"

echo "[traces-bench] results:"
printf '%s\n' "${summary_json}"

METRICS_URL="${API_BASE%/}/api/v1/internal/agent-task-metrics"
metrics_code="$(
  curl -sS -o "${TMP_DIR}/metrics.json" -w '%{http_code}' \
    "${METRICS_URL}" -H "Authorization: Bearer ${TOKEN}" || true
)"
if [[ "${metrics_code}" == "200" ]]; then
  echo "[traces-bench] agent-task-metrics snapshot:"
  cat "${TMP_DIR}/metrics.json"
  echo
fi

PROM_URL="${API_BASE%/}/api/v1/internal/agent-task-metrics/prometheus"
prom_code="$(
  curl -sS -o "${TMP_DIR}/metrics.prom" -w '%{http_code}' \
    "${PROM_URL}" -H "Authorization: Bearer ${TOKEN}" || true
)"
if [[ "${prom_code}" == "200" ]]; then
  echo "[traces-bench] prometheus trace query histogram (scope=message):"
  rg 'notebook_task_traces_query_duration_ms_(bucket|sum|count).*scope="message"' "${TMP_DIR}/metrics.prom" || true
fi

if [[ -n "${RESULT_JSON_PATH}" ]]; then
  printf '%s\n' "${summary_json}" > "${RESULT_JSON_PATH}"
fi
