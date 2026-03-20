#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"
ensure_real_lane_state

API_BASE="${API_BASE:-http://localhost:20000}"
WORKSPACE_ID="${WORKSPACE_ID:-$(state_get workspace.id ws_default)}"
TOKEN_FILE="${TOKEN_FILE:-$(real_lane_token_file)}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
PROJECT_ID="${PROJECT_ID:-$(state_get project.id)}"
AGENT_ID="${AGENT_ID:-$(state_get agent.id)}"
WORKSPACE_FILE_LIBRARY_ID="${WORKSPACE_FILE_LIBRARY_ID:-$(state_get workspace.current_library_id)}"
WORKSPACE_MODE="${WORKSPACE_MODE:-}"
WORKSPACE_NAME="${WORKSPACE_NAME:-}"
PROMPT="${PROMPT:-reply exactly: chain ok}"
POLL_MAX="${POLL_MAX:-40}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-2}"
SCENARIO_ATTEMPTS="${SCENARIO_ATTEMPTS:-4}"
SCENARIO_BACKOFF_SEC="${SCENARIO_BACKOFF_SEC:-45}"
FINAL_MESSAGE_SETTLE_MAX_SEC="${FINAL_MESSAGE_SETTLE_MAX_SEC:-15}"
FINAL_MESSAGE_SETTLE_INTERVAL_SEC="${FINAL_MESSAGE_SETTLE_INTERVAL_SEC:-1}"
WAIT_AGENT_ONLINE_MAX="${WAIT_AGENT_ONLINE_MAX:-20}"
WAIT_AGENT_ONLINE_INTERVAL_SEC="${WAIT_AGENT_ONLINE_INTERVAL_SEC:-1}"
WAIT_AGENT_ONLINE="${WAIT_AGENT_ONLINE:-1}"

if [[ -z "${PROJECT_ID}" || -z "${AGENT_ID}" ]]; then
  echo "[smoke] Missing PROJECT_ID or AGENT_ID in real-lane state." >&2
  exit 1
fi
if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[smoke] Token file not found: ${TOKEN_FILE}" >&2
  exit 1
fi
TOKEN="$(cat "${TOKEN_FILE}")"
DEFAULT_WEB_BASE_URL="${BASE_URL:-http://localhost:3001}"

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

discover_workspace_file_library_id() {
  if [[ "${WORKSPACE_MODE}" == "create_new" ]]; then
    return 0
  fi
  if [[ -n "${WORKSPACE_FILE_LIBRARY_ID}" ]]; then
    if api_json_request GET "${BASE}/file-libraries/${WORKSPACE_FILE_LIBRARY_ID}" >/dev/null 2>&1; then
      return 0
    fi
    WORKSPACE_FILE_LIBRARY_ID=""
  fi
  local libraries_json discovered
  libraries_json="$(api_json_request GET "${BASE}/file-libraries" || true)"
  discovered="$(
    printf '%s' "${libraries_json}" | \
      node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);const items=Array.isArray(j.items)?j.items:[];const ready=items.find(item=>item&&item.status==="ready"&&typeof item.id==="string");if(ready?.id){process.stdout.write(ready.id);return;}process.exit(2);}catch{process.exit(2)}})' \
      || true
  )"
  if [[ -z "${discovered}" ]]; then
    echo "[smoke] ERROR: missing WORKSPACE_FILE_LIBRARY_ID and failed to discover a ready file library for project ${PROJECT_ID}" >&2
    return 1
  fi
  WORKSPACE_FILE_LIBRARY_ID="${discovered}"
  state_set_string workspace.current_library_id "${WORKSPACE_FILE_LIBRARY_ID}"
}

refresh_auth_token() {
  echo "[smoke] token expired during API request; refreshing..." >&2
  (
    cd "${ROOT_DIR}" && \
    BASE_URL="${DEFAULT_WEB_BASE_URL}" make notebook-agent-refresh-token >/dev/null
  )
  TOKEN="$(cat "${TOKEN_FILE}")"
}

api_json_request() {
  local method="$1"
  local url="$2"
  local payload="${3-}"
  local response_file status body

  response_file="$(mktemp)"
  if [[ -n "${payload}" ]]; then
    status="$(curl -sS -o "${response_file}" -w '%{http_code}' -X "${method}" "${url}" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "${payload}" || true)"
  else
    status="$(curl -sS -o "${response_file}" -w '%{http_code}' -X "${method}" "${url}" \
      -H "Authorization: Bearer ${TOKEN}" || true)"
  fi

  if [[ "${status}" == "401" ]]; then
    refresh_auth_token
    if [[ -n "${payload}" ]]; then
      status="$(curl -sS -o "${response_file}" -w '%{http_code}' -X "${method}" "${url}" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H 'Content-Type: application/json' \
        -d "${payload}" || true)"
    else
      status="$(curl -sS -o "${response_file}" -w '%{http_code}' -X "${method}" "${url}" \
        -H "Authorization: Bearer ${TOKEN}" || true)"
    fi
  fi

  body="$(cat "${response_file}" 2>/dev/null || true)"
  rm -f "${response_file}"

  if [[ ! "${status}" =~ ^[0-9]{3}$ ]]; then
    echo "[smoke] ERROR: ${method} ${url} returned invalid HTTP status (${status})" >&2
    return 1
  fi
  if [[ "${status}" -lt 200 || "${status}" -ge 300 ]]; then
    echo "[smoke] ERROR: ${method} ${url} -> ${status}: ${body}" >&2
    return 1
  fi
  printf '%s' "${body}"
}

wait_for_agent_online() {
  local diagnostics_url="${BASE}/agents/${AGENT_ID}/diagnostics"
  for i in $(seq 1 "${WAIT_AGENT_ONLINE_MAX}"); do
    local diag_json diag_presence diag_connected_at
    diag_json="$(api_json_request GET "${diagnostics_url}" || true)"
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

run_attempt() {
  local attempt="$1"
  local create_task_resp TASK_ID task_json status messages_json traces_json
  local agent_tail trace_info trace_count trace_rest trace_terminal_status trace_terminal_summary
  local final_messages_json final_agent_tail settle_attempt settle_deadline

  local task_title payload
  task_title="smoke-$(date +%s)"
  payload="$(
    node -e '
      const title = process.argv[1];
      const agentId = process.argv[2];
      const workspaceMode = process.argv[3];
      const workspaceLibraryId = process.argv[4];
      const workspaceName = process.argv[5];
      const body = { title, agent_id: agentId };
      if (workspaceMode === "create_new") {
        body.workspace_mode = "create_new";
        body.workspace_name = workspaceName || `${title} Workspace`;
      } else {
        body.workspace_file_library_id = workspaceLibraryId;
      }
      console.log(JSON.stringify(body));
    ' \
      "${task_title}" "${AGENT_ID}" "${WORKSPACE_MODE}" "${WORKSPACE_FILE_LIBRARY_ID}" "${WORKSPACE_NAME}"
  )"

  create_task_resp="$(api_json_request POST "${BASE}/tasks" "${payload}")"

  TASK_ID="$(printf '%s' "${create_task_resp}" | json_get id)"
  if [[ -z "${TASK_ID}" ]]; then
    echo "[smoke] ERROR: task creation returned no task id" >&2
    return 1
  fi
  state_set_string task.last_id "${TASK_ID}"
  state_set_string task.last_title "${task_title}"
  echo "[smoke] task_id=${TASK_ID} (attempt ${attempt}/${SCENARIO_ATTEMPTS})"

  api_json_request POST "${BASE}/tasks/${TASK_ID}/messages" \
    "$(node -e 'console.log(JSON.stringify({role:"user",content:process.argv[1]}))' "${PROMPT}")" >/dev/null

  for i in $(seq 1 "${POLL_MAX}"); do
    task_json="$(api_json_request GET "${BASE}/tasks/${TASK_ID}")"
    status="$(printf '%s' "${task_json}" | json_get status || true)"
    messages_json="$(api_json_request GET "${BASE}/tasks/${TASK_ID}/messages")"
    traces_json="$(api_json_request GET "${BASE}/tasks/${TASK_ID}/traces?page_size=200" || true)"
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
  api_json_request GET "${BASE}/tasks/${TASK_ID}"
  echo
  settle_attempt=0
  settle_deadline=$((SECONDS + FINAL_MESSAGE_SETTLE_MAX_SEC))
  while true; do
    settle_attempt=$((settle_attempt + 1))
    final_messages_json="$(api_json_request GET "${BASE}/tasks/${TASK_ID}/messages")"
    final_agent_tail="$(printf '%s' "${final_messages_json}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const a=JSON.parse(s);const m=[...a].reverse().find(x=>x.role==="agent");process.stdout.write((m?.content||"").trim());}catch{process.exit(2)}})')"
    if [[ -z "${trace_terminal_status:-}" ]]; then
      break
    fi
    if [[ "${trace_terminal_status}" != "success" ]]; then
      break
    fi
    if [[ "${final_agent_tail}" == *'"turn.completed"'* ]]; then
      break
    fi
    if (( SECONDS >= settle_deadline )); then
      break
    fi
    echo "[smoke] waiting for final agent message settle... [${settle_attempt}] " \
      "elapsed=$((FINAL_MESSAGE_SETTLE_MAX_SEC - (settle_deadline - SECONDS)))s/${FINAL_MESSAGE_SETTLE_MAX_SEC}s" >&2
    sleep "${FINAL_MESSAGE_SETTLE_INTERVAL_SEC}"
  done

  echo "[smoke] final messages:"
  printf '%s' "${final_messages_json}"
  echo

  if [[ -z "${trace_terminal_status:-}" || "${trace_count:-0}" == "0" ]]; then
    echo "[smoke] WARN: no terminal trace found for task ${TASK_ID}" >&2
    return 75
  fi
  if [[ "${trace_terminal_status}" != "success" ]]; then
    if [[ "${final_agent_tail}" == *"429 Too Many Requests"* || "${final_agent_tail}" == *"retry limit"* ]]; then
      echo "[smoke] WARN: upstream throttled task ${TASK_ID}" >&2
      return 75
    fi
    echo "[smoke] ERROR: terminal trace status=${trace_terminal_status} summary=${trace_terminal_summary}" >&2
    return 2
  fi
  if [[ -z "${final_agent_tail}" ]]; then
    echo "[smoke] WARN: final agent message empty for task ${TASK_ID}" >&2
    return 75
  fi
  return 0
}

if [[ "${WAIT_AGENT_ONLINE}" != "0" ]]; then
  wait_for_agent_online
else
  echo "[smoke] skipping agent-online wait (WAIT_AGENT_ONLINE=0)"
fi

if [[ -z "${WORKSPACE_MODE}" ]]; then
  if [[ -n "${WORKSPACE_FILE_LIBRARY_ID}" ]]; then
    WORKSPACE_MODE="use_existing"
  else
    WORKSPACE_MODE="create_new"
  fi
fi

discover_workspace_file_library_id

for attempt in $(seq 1 "${SCENARIO_ATTEMPTS}"); do
  if run_attempt "${attempt}"; then
    exit 0
  fi
  rc=$?
  if [[ "${rc}" != "75" || "${attempt}" == "${SCENARIO_ATTEMPTS}" ]]; then
    exit "${rc}"
  fi
  echo "[smoke] retrying smoke scenario after ${SCENARIO_BACKOFF_SEC}s (${attempt}/${SCENARIO_ATTEMPTS})" >&2
  sleep "${SCENARIO_BACKOFF_SEC}"
done
