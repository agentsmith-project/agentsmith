#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

API_BASE="${API_BASE:-http://localhost:20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
PROJECT_ID="${PROJECT_ID:-$(cat /tmp/agentsmith_project_id.txt 2>/dev/null || true)}"
AGENT_ID="${AGENT_ID:-$(cat /tmp/agentsmith_agent_id.txt 2>/dev/null || true)}"
PROMPT="${PROMPT:-reply exactly: chain ok}"
POLL_MAX="${POLL_MAX:-40}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-2}"
WAIT_AGENT_ONLINE_MAX="${WAIT_AGENT_ONLINE_MAX:-20}"
WAIT_AGENT_ONLINE_INTERVAL_SEC="${WAIT_AGENT_ONLINE_INTERVAL_SEC:-1}"
WAIT_AGENT_ONLINE="${WAIT_AGENT_ONLINE:-1}"

if [[ -z "${PROJECT_ID}" || -z "${AGENT_ID}" ]]; then
  echo "[smoke] Missing PROJECT_ID or AGENT_ID (or /tmp/agentsmith_project_id.txt / /tmp/agentsmith_agent_id.txt)." >&2
  exit 1
fi
if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[smoke] Token file not found: ${TOKEN_FILE}" >&2
  exit 1
fi
TOKEN="$(cat "${TOKEN_FILE}")"

userinfo_status="$(
  curl -sS -o /tmp/agentsmith_userinfo_check.json -w '%{http_code}' \
    "${KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/userinfo" \
    -H "Authorization: Bearer ${TOKEN}" || true
)"
if [[ "${userinfo_status}" != "200" ]]; then
  echo "[smoke] token invalid or expired (userinfo status=${userinfo_status})." >&2
  echo "[smoke] run: make notebook-agent-refresh-token" >&2
  exit 42
fi

BASE="${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}"

wait_for_agent_online() {
  local diagnostics_url="${BASE}/agents/${AGENT_ID}/diagnostics"
  for i in $(seq 1 "${WAIT_AGENT_ONLINE_MAX}"); do
    local diag_json diag_presence diag_connected_at
    diag_json="$(curl -sS "${diagnostics_url}" -H "Authorization: Bearer ${TOKEN}" || true)"
    diag_presence="$(printf '%s' "${diag_json}" | json_get presence || true)"
    diag_connected_at="$(printf '%s' "${diag_json}" | json_get connected_at || true)"
    if [[ "${diag_presence}" == "online" && -n "${diag_connected_at}" ]]; then
      echo "[smoke] agent online (presence=${diag_presence})"
      return 0
    fi
    echo "[smoke] waiting agent online... [${i}/${WAIT_AGENT_ONLINE_MAX}] presence=${diag_presence:-unknown}" >&2
    sleep "${WAIT_AGENT_ONLINE_INTERVAL_SEC}"
  done
  echo "[smoke] ERROR: agent did not become online before timeout" >&2
  return 1
}

json_get() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);let v=j;for(const p of process.argv[1].split(".")){if(!p) continue; v=v?.[p]} if(v==null) process.exit(2); process.stdout.write(String(v));})' "$1"
}

if [[ "${WAIT_AGENT_ONLINE}" != "0" ]]; then
  wait_for_agent_online
else
  echo "[smoke] skipping agent-online wait (WAIT_AGENT_ONLINE=0)"
fi

create_task_resp="$(curl -sS -X POST "${BASE}/tasks" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"smoke-$(date +%s)\",\"agent_id\":\"${AGENT_ID}\"}")"

TASK_ID="$(printf '%s' "${create_task_resp}" | json_get id)"
echo "${TASK_ID}" > /tmp/agentsmith_last_task_id.txt
echo "[smoke] task_id=${TASK_ID}"

curl -sS -X POST "${BASE}/tasks/${TASK_ID}/messages" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({role:"user",content:process.argv[1]}))' "${PROMPT}")" >/dev/null

for i in $(seq 1 "${POLL_MAX}"); do
  task_json="$(curl -sS "${BASE}/tasks/${TASK_ID}" -H "Authorization: Bearer ${TOKEN}")"
  status="$(printf '%s' "${task_json}" | json_get status || true)"
  messages_json="$(curl -sS "${BASE}/tasks/${TASK_ID}/messages" -H "Authorization: Bearer ${TOKEN}")"
  traces_json="$(curl -sS "${BASE}/tasks/${TASK_ID}/traces?page_size=200" -H "Authorization: Bearer ${TOKEN}" || true)"
  agent_tail="$(printf '%s' "${messages_json}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const a=JSON.parse(s);const m=[...a].reverse().find(x=>x.role==="agent");process.stdout.write((m?.content||"").slice(-320));}catch{}})')"
  trace_info="$(printf '%s' "${traces_json}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);const items=Array.isArray(j.items)?j.items:[];const t=[...items].reverse().find(x=>x&&(x.status==="success"||x.status==="error"||x.status==="cancelled"));process.stdout.write(String(items.length)+"|"+(t?.status||"")+"|"+(t?.summary||""))}catch{process.stdout.write("0||")}})')"
  trace_count="${trace_info%%|*}"
  trace_rest="${trace_info#*|}"
  trace_terminal_status="${trace_rest%%|*}"
  trace_terminal_summary="${trace_rest#*|}"
  echo "[smoke][${i}] status=${status} traces=${trace_count} terminal=${trace_terminal_status:-none} tail=${agent_tail//$'\n'/ }"
  if [[ "${status}" == "closed" || -n "${trace_terminal_status}" ]]; then
    break
  fi
  sleep "${POLL_INTERVAL_SEC}"
done

echo "[smoke] final task:"
curl -sS "${BASE}/tasks/${TASK_ID}" -H "Authorization: Bearer ${TOKEN}"
echo
echo "[smoke] final messages:"
final_messages_json="$(curl -sS "${BASE}/tasks/${TASK_ID}/messages" -H "Authorization: Bearer ${TOKEN}")"
printf '%s' "${final_messages_json}"
echo

final_agent_tail="$(printf '%s' "${final_messages_json}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const a=JSON.parse(s);const m=[...a].reverse().find(x=>x.role==="agent");process.stdout.write((m?.content||"").trim());}catch{process.exit(2)}})')"
if [[ -z "${final_agent_tail}" ]]; then
  echo "[smoke] ERROR: final agent message is empty" >&2
  exit 2
fi
