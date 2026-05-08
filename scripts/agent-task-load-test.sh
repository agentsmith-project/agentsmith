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
AGENT_RUNNER_ID="${AGENT_RUNNER_ID:-$(state_get agent_runner.id)}"
PROMPT="${PROMPT:-reply exactly: chain ok}"
REQUESTS="${REQUESTS:-10}"
CONCURRENCY="${CONCURRENCY:-3}"
POLL_MAX="${POLL_MAX:-60}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-2}"
WAIT_AGENT_ONLINE="${WAIT_AGENT_ONLINE:-1}"
WAIT_AGENT_ONLINE_MAX="${WAIT_AGENT_ONLINE_MAX:-30}"
WAIT_AGENT_ONLINE_INTERVAL_SEC="${WAIT_AGENT_ONLINE_INTERVAL_SEC:-1}"
RESULT_JSON_PATH="${RESULT_JSON_PATH:-}"
RESULT_CSV_PATH="${RESULT_CSV_PATH:-}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "[load] missing PROJECT_ID in $(backend_real_state_file)" >&2
  exit 1
fi
if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[load] token file not found: ${TOKEN_FILE}" >&2
  exit 1
fi
TOKEN="$(cat "${TOKEN_FILE}")"
BASE="${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}"

json_get() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);let v=j;for(const p of process.argv[1].split(".")){if(!p) continue; v=v?.[p]} if(v==null){process.exit(2)} process.stdout.write(String(v));}catch{process.exit(3)}})' "$1"
}

wait_for_agent_online() {
  if [[ -z "${AGENT_RUNNER_ID}" ]]; then
    echo "[load] missing AGENT_RUNNER_ID in $(backend_real_state_file)" >&2
    return 1
  fi
  local diagnostics_url="${BASE}/agent-runners/${AGENT_RUNNER_ID}/diagnostics"
  for i in $(seq 1 "${WAIT_AGENT_ONLINE_MAX}"); do
    local diag_json diag_presence
    diag_json="$(curl -sS "${diagnostics_url}" -H "Authorization: Bearer ${TOKEN}" || true)"
    diag_presence="$(printf '%s' "${diag_json}" | json_get presence || true)"
    if [[ "${diag_presence}" == "managed" || "${diag_presence}" == "online" ]]; then
      echo "[load] agent runner ready (presence=${diag_presence})"
      return 0
    fi
    sleep "${WAIT_AGENT_ONLINE_INTERVAL_SEC}"
  done
  echo "[load] ERROR: agent runner not ready before timeout" >&2
  return 1
}

TMP_DIR="$(mktemp -d /tmp/agentsmith-loadtest.XXXXXX)"
trap 'rm -rf "${TMP_DIR}"' EXIT INT TERM

run_one() {
  local idx="$1"
  local start_epoch_ms end_epoch_ms elapsed_ms
  start_epoch_ms="$(date +%s%3N)"

  local create_task_resp task_id
  create_task_resp="$(curl -sS -X POST "${BASE}/tasks" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "{\"title\":\"load-${idx}-$(date +%s)\"}")" || {
      printf '{"idx":%s,"ok":false,"phase":"create_task","error":"curl_failed"}\n' "${idx}" > "${TMP_DIR}/${idx}.json"
      return 0
    }
  task_id="$(printf '%s' "${create_task_resp}" | json_get id || true)"
  if [[ -z "${task_id}" ]]; then
    printf '{"idx":%s,"ok":false,"phase":"create_task","error":"invalid_response"}\n' "${idx}" > "${TMP_DIR}/${idx}.json"
    return 0
  fi

  local post_code
  post_code="$(
    curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE}/tasks/${task_id}/runs" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "$(node -e 'console.log(JSON.stringify({intent:process.argv[1]}))' "${PROMPT}")" || true
  )"
  if [[ "${post_code}" != "200" ]]; then
    printf '{"idx":%s,"task_id":"%s","ok":false,"phase":"start_run","http_code":"%s"}\n' "${idx}" "${task_id}" "${post_code}" > "${TMP_DIR}/${idx}.json"
    return 0
  fi

  local poll
  for poll in $(seq 1 "${POLL_MAX}"); do
    local traces_json trace_info trace_count trace_rest trace_terminal_status trace_terminal_summary
    traces_json="$(curl -sS "${BASE}/tasks/${task_id}/traces?page_size=200" -H "Authorization: Bearer ${TOKEN}" || true)"
    trace_info="$(printf '%s' "${traces_json}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);const items=Array.isArray(j.items)?j.items:[];const t=[...items].reverse().find(x=>x&&(x.status==="success"||x.status==="error"||x.status==="cancelled"));process.stdout.write(String(items.length)+"|"+(t?.status||"")+"|"+(t?.summary||""))}catch{process.stdout.write("0||")}})')"
    trace_count="${trace_info%%|*}"
    trace_rest="${trace_info#*|}"
    trace_terminal_status="${trace_rest%%|*}"
    trace_terminal_summary="${trace_rest#*|}"
    if [[ -n "${trace_terminal_status}" ]]; then
      end_epoch_ms="$(date +%s%3N)"
      elapsed_ms="$((end_epoch_ms - start_epoch_ms))"
      if [[ "${trace_terminal_status}" == "success" ]]; then
        printf '{"idx":%s,"task_id":"%s","ok":true,"terminal_status":"%s","latency_ms":%s,"trace_count":%s,"summary":%s}\n' \
          "${idx}" "${task_id}" "${trace_terminal_status}" "${elapsed_ms}" "${trace_count}" \
          "$(node -e 'console.log(JSON.stringify(process.argv[1]))' "${trace_terminal_summary}")" > "${TMP_DIR}/${idx}.json"
      else
        printf '{"idx":%s,"task_id":"%s","ok":false,"phase":"terminal","terminal_status":"%s","latency_ms":%s,"trace_count":%s,"summary":%s}\n' \
          "${idx}" "${task_id}" "${trace_terminal_status}" "${elapsed_ms}" "${trace_count}" \
          "$(node -e 'console.log(JSON.stringify(process.argv[1]))' "${trace_terminal_summary}")" > "${TMP_DIR}/${idx}.json"
      fi
      return 0
    fi
    sleep "${POLL_INTERVAL_SEC}"
  done

  end_epoch_ms="$(date +%s%3N)"
  elapsed_ms="$((end_epoch_ms - start_epoch_ms))"
  printf '{"idx":%s,"task_id":"%s","ok":false,"phase":"timeout","latency_ms":%s}\n' "${idx}" "${task_id}" "${elapsed_ms}" > "${TMP_DIR}/${idx}.json"
}

if [[ "${WAIT_AGENT_ONLINE}" != "0" ]]; then
  wait_for_agent_online
fi

echo "[load] starting notebook load test requests=${REQUESTS} concurrency=${CONCURRENCY}"

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

echo "[load] results:"
summary_json="$(node - <<'NODE' "${TMP_DIR}" "${REQUESTS}" "${CONCURRENCY}"
const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv[2];
const expected = Number(process.argv[3] || '0');
const concurrency = Number(process.argv[4] || '0');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort((a,b)=>Number(a)-Number(b));
const rows = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const success = rows.filter((r) => r.ok);
const failed = rows.filter((r) => !r.ok);
const latencies = success.map((r) => Number(r.latency_ms || 0)).sort((a,b)=>a-b);
const pct = (p) => {
  if (latencies.length === 0) return null;
  const idx = Math.min(latencies.length - 1, Math.max(0, Math.ceil((p/100) * latencies.length) - 1));
  return latencies[idx];
};
const avg = latencies.length ? Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length) : null;
const summary = {
  ts: new Date().toISOString(),
  expected,
  concurrency,
  completed: rows.length,
  success: success.length,
  failed: failed.length,
  success_rate: expected > 0 ? Number((success.length / expected).toFixed(4)) : null,
  latency_ms: {
    avg,
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    max: latencies.length ? latencies[latencies.length - 1] : null,
  },
  failures: failed.slice(0, 10),
};
process.stdout.write(JSON.stringify(summary));
NODE
)"
printf '%s\n' "${summary_json}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.stringify(JSON.parse(s),null,2)))'

METRICS_URL="${API_BASE%/}/api/v1/internal/agent-task-metrics"
metrics_code="$(
  curl -sS -o "${TMP_DIR}/metrics.json" -w '%{http_code}' "${METRICS_URL}" \
    -H "Authorization: Bearer ${TOKEN}" || true
)"
if [[ "${metrics_code}" == "200" ]]; then
  echo "[load] agent-task-metrics snapshot:"
  cat "${TMP_DIR}/metrics.json"
  echo
else
  echo "[load] warning: metrics endpoint returned http=${metrics_code}" >&2
fi

if [[ -n "${RESULT_JSON_PATH}" ]]; then
  node - <<'NODE' "${RESULT_JSON_PATH}" "${summary_json}" "${TMP_DIR}/metrics.json" "${metrics_code}"
const fs = require('node:fs');
const outPath = process.argv[2];
const summary = JSON.parse(process.argv[3]);
const metricsPath = process.argv[4];
const metricsCode = process.argv[5];
let metrics = null;
if (metricsCode === '200' && fs.existsSync(metricsPath)) {
  try { metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8')); } catch {}
}
fs.writeFileSync(outPath, JSON.stringify({ summary, metrics }, null, 2) + '\n');
NODE
fi

if [[ -n "${RESULT_CSV_PATH}" ]]; then
  node - <<'NODE' "${RESULT_CSV_PATH}" "${summary_json}"
const fs = require('node:fs');
const outPath = process.argv[2];
const summary = JSON.parse(process.argv[3]);
const row = {
  ts: summary.ts,
  requests: summary.expected,
  concurrency: summary.concurrency,
  completed: summary.completed,
  success: summary.success,
  failed: summary.failed,
  success_rate: summary.success_rate,
  latency_avg_ms: summary.latency_ms?.avg ?? '',
  latency_p50_ms: summary.latency_ms?.p50 ?? '',
  latency_p95_ms: summary.latency_ms?.p95 ?? '',
  latency_p99_ms: summary.latency_ms?.p99 ?? '',
  latency_max_ms: summary.latency_ms?.max ?? '',
};
const headers = Object.keys(row);
const values = headers.map((h) => JSON.stringify(String(row[h] ?? '')));
if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
  fs.appendFileSync(outPath, headers.join(',') + '\n');
}
fs.appendFileSync(outPath, values.join(',') + '\n');
NODE
fi
