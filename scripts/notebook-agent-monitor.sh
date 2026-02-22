#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

API_BASE="${API_BASE:-http://localhost:20000}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
INTERVAL_SEC="${INTERVAL_SEC:-2}"
COUNT="${COUNT:-0}" # 0 means run forever

if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[monitor] token file not found: ${TOKEN_FILE}" >&2
  exit 1
fi
TOKEN="$(cat "${TOKEN_FILE}")"
URL="${API_BASE%/}/api/v1/internal/notebook-runtime-metrics"

json_line() {
  node -e '
    let s="";
    process.stdin.on("data",(d)=>s+=d);
    process.stdin.on("end",()=>{
      try {
        const j = JSON.parse(s);
        const inMem = j.in_memory ?? {};
        const limits = j.limits ?? {};
        const traceQueryByScope = j.trace_query_latency_by_scope ?? {};
        const messageScope = traceQueryByScope.message ?? {};
        const fields = [
          `started=${j.task_runs_started ?? 0}`,
          `completed=${j.task_runs_completed ?? 0}`,
          `failed=${j.task_runs_failed ?? 0}`,
          `terminal_wo_done=${j.task_runs_terminal_without_done ?? 0}`,
          `active_runs=${j.active_runs ?? 0}`,
          `sse_clients=${j.task_sse_clients ?? 0}`,
          `trace_recorded=${j.trace_events_recorded ?? 0}`,
          `trace_trunc_records=${j.trace_events_truncated_records ?? 0}`,
          `trace_details_trunc=${j.trace_details_truncated ?? 0}`,
          `traces_q=${j.task_traces_queries_total ?? 0}`,
          `traces_q_msg=${j.task_traces_queries_message_scoped_total ?? 0}`,
          `traces_q_run=${j.task_traces_queries_run_scoped_total ?? 0}`,
          `traces_q_msg_max_ms=${messageScope.max_ms ?? 0}`,
          `mem_tasks=${inMem.tasks ?? 0}`,
          `mem_msgs=${inMem.messages ?? 0}`,
          `mem_traces=${inMem.traces ?? 0}`,
          `trace_limit=${limits.max_trace_events_per_task ?? "-"}`,
        ];
        process.stdout.write(fields.join(" "));
      } catch (err) {
        process.stderr.write(String(err) + "\n");
        process.exit(2);
      }
    });
  '
}

i=0
while :; do
  i=$((i + 1))
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  rm -f /tmp/agentsmith_notebook_metrics.json
  http_code="$(
    curl -sS -o /tmp/agentsmith_notebook_metrics.json -w '%{http_code}' \
      "${URL}" -H "Authorization: Bearer ${TOKEN}" || true
  )"
  if [[ "${http_code}" != "200" ]]; then
    echo "[monitor][${ts}] http=${http_code} endpoint=${URL}" >&2
    [[ -f /tmp/agentsmith_notebook_metrics.json ]] && cat /tmp/agentsmith_notebook_metrics.json >&2 || true
    echo >&2
  else
    line="$(cat /tmp/agentsmith_notebook_metrics.json | json_line)"
    echo "[monitor][${ts}] ${line}"
  fi

  if [[ "${COUNT}" != "0" && "${i}" -ge "${COUNT}" ]]; then
    break
  fi
  sleep "${INTERVAL_SEC}"
done
