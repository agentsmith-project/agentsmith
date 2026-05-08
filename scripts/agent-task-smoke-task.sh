#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/runtime-line-state.sh"
ensure_backend_real_state

read_summary_value() {
  local key="$1"
  local summary_file
  summary_file="$(backend_real_summary_file)"
  [[ -f "${summary_file}" ]] || return 1
  awk -F '=' -v key="${key}" '$1 == key { print substr($0, index($0, "=") + 1); found=1; exit } END { if (!found) exit 1 }' "${summary_file}"
}

derive_api_base_from_ws_url() {
  local ws_url
  ws_url="$(state_get agent_runner.ws_url)"
  [[ -n "${ws_url}" ]] || return 1
  node -e '
const raw = process.argv[1];
try {
  const url = new URL(raw);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "";
  url.search = "";
  url.hash = "";
  process.stdout.write(url.toString().replace(/\/+$/, ""));
} catch {
  process.exit(1);
}
' "${ws_url}"
}

read_local_manual_port() {
  local name="$1"
  local port_file
  port_file="$(local_manual_runtime_path "${name}.port")"
  [[ -f "${port_file}" ]] || return 1
  tr -d '[:space:]' < "${port_file}"
}

API_BASE="${API_BASE:-$(read_summary_value API_BASE || derive_api_base_from_ws_url || echo http://localhost:20000)}"
WORKSPACE_ID="${WORKSPACE_ID:-$(state_get workspace.id ws_default)}"
TOKEN_FILE="${TOKEN_FILE:-$(backend_real_token_file)}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
PROJECT_ID="${PROJECT_ID:-$(state_get project.id)}"
AGENT_RUNNER_ID="${AGENT_RUNNER_ID:-$(state_get agent_runner.id)}"
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

if [[ -z "${PROJECT_ID}" ]]; then
  echo "[smoke] Missing PROJECT_ID in backend-real state." >&2
  exit 1
fi
if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[smoke] Token file not found: ${TOKEN_FILE}" >&2
  exit 1
fi
TOKEN="$(cat "${TOKEN_FILE}")"
DEFAULT_WEB_BASE_URL="${BASE_URL:-http://localhost:$(read_local_manual_port web || echo 3001)}"

userinfo_status="$(
  curl -sS -o "$(backend_real_tmp_file userinfo-check.json)" -w '%{http_code}' \
    "${KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/userinfo" \
    -H "Authorization: Bearer ${TOKEN}" || true
)"
if [[ "${userinfo_status}" != "200" ]]; then
  echo "[smoke] token invalid or expired (userinfo status=${userinfo_status})." >&2
  echo "[smoke] run: make agent-runner-refresh-token" >&2
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
    BASE_URL="${DEFAULT_WEB_BASE_URL}" make agent-runner-refresh-token >/dev/null
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
  if [[ -z "${AGENT_RUNNER_ID}" ]]; then
    echo "[smoke] Missing AGENT_RUNNER_ID in backend-real state." >&2
    return 1
  fi
  local diagnostics_url="${BASE}/agent-runners/${AGENT_RUNNER_ID}/diagnostics"
  for i in $(seq 1 "${WAIT_AGENT_ONLINE_MAX}"); do
    local diag_json diag_presence
    diag_json="$(api_json_request GET "${diagnostics_url}" || true)"
    diag_presence="$(printf '%s' "${diag_json}" | json_get presence || true)"
    if [[ "${diag_presence}" == "managed" || "${diag_presence}" == "online" ]]; then
      echo "[smoke] agent runner ready (presence=${diag_presence})"
      return 0
    fi
    echo "[smoke] waiting agent runner ready... [${i}/${WAIT_AGENT_ONLINE_MAX}] presence=${diag_presence:-unknown}" >&2
    sleep "${WAIT_AGENT_ONLINE_INTERVAL_SEC}"
  done
  echo "[smoke] ERROR: agent runner did not become ready before timeout" >&2
  return 1
}

json_get() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);let v=j;for(const p of process.argv[1].split(".")){if(!p) continue; v=v?.[p]} if(v==null) process.exit(2); process.stdout.write(String(v));})' "$1"
}

run_attempt() {
  local attempt="$1"
  local create_task_resp TASK_ID task_json status activity_json traces_json
  local runner_tail trace_info trace_count trace_rest trace_terminal_status trace_terminal_summary
  local final_activity_json final_runner_tail settle_attempt settle_deadline

  local task_title payload
  task_title="smoke-$(date +%s)"
  payload="$(
    node -e '
      const title = process.argv[1];
      const workspaceMode = process.argv[2];
      const workspaceLibraryId = process.argv[3];
      const workspaceName = process.argv[4];
      const body = { title };
      if (workspaceMode === "create_new") {
        body.workspace_mode = "create_new";
        body.workspace_name = workspaceName || `${title} Workspace`;
      } else {
        body.workspace_file_library_id = workspaceLibraryId;
      }
      console.log(JSON.stringify(body));
    ' \
      "${task_title}" "${WORKSPACE_MODE}" "${WORKSPACE_FILE_LIBRARY_ID}" "${WORKSPACE_NAME}"
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

  api_json_request POST "${BASE}/tasks/${TASK_ID}/runs" \
    "$(node -e 'console.log(JSON.stringify({intent:process.argv[1]}))' "${PROMPT}")" >/dev/null

  for i in $(seq 1 "${POLL_MAX}"); do
    task_json="$(api_json_request GET "${BASE}/tasks/${TASK_ID}")"
    status="$(printf '%s' "${task_json}" | json_get status || true)"
    activity_json="$(api_json_request GET "${BASE}/tasks/${TASK_ID}/activity")"
    traces_json="$(api_json_request GET "${BASE}/tasks/${TASK_ID}/traces?page_size=200" || true)"
    runner_tail="$(printf '%s' "${activity_json}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const a=JSON.parse(s);const m=[...a].reverse().find(x=>x&&x.actor==="runner"&&x.kind==="runner_output");process.stdout.write((m?.content||"").slice(-320));}catch{}})')"
    trace_info="$(printf '%s' "${traces_json}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);const items=Array.isArray(j.items)?j.items:[];const t=[...items].reverse().find(x=>x&&(x.status==="success"||x.status==="error"||x.status==="cancelled"));process.stdout.write(String(items.length)+"|"+(t?.status||"")+"|"+(t?.summary||""))}catch{process.stdout.write("0||")}})')"
    trace_count="${trace_info%%|*}"
    trace_rest="${trace_info#*|}"
    trace_terminal_status="${trace_rest%%|*}"
    trace_terminal_summary="${trace_rest#*|}"
    echo "[smoke][${i}] status=${status} traces=${trace_count} terminal=${trace_terminal_status:-none} tail=${runner_tail//$'\n'/ }"
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
    final_activity_json="$(api_json_request GET "${BASE}/tasks/${TASK_ID}/activity")"
    final_runner_tail="$(printf '%s' "${final_activity_json}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const a=JSON.parse(s);const m=[...a].reverse().find(x=>x&&x.actor==="runner"&&x.kind==="runner_output");process.stdout.write((m?.content||"").trim());}catch{process.exit(2)}})')"
    if [[ -z "${trace_terminal_status:-}" ]]; then
      break
    fi
    if [[ "${trace_terminal_status}" != "success" ]]; then
      break
    fi
    if [[ "${final_runner_tail}" == *'"turn.completed"'* ]]; then
      break
    fi
    if (( SECONDS >= settle_deadline )); then
      break
    fi
    echo "[smoke] waiting for final runner output settle... [${settle_attempt}] " \
      "elapsed=$((FINAL_MESSAGE_SETTLE_MAX_SEC - (settle_deadline - SECONDS)))s/${FINAL_MESSAGE_SETTLE_MAX_SEC}s" >&2
    sleep "${FINAL_MESSAGE_SETTLE_INTERVAL_SEC}"
  done

  echo "[smoke] final activity:"
  printf '%s' "${final_activity_json}"
  echo

  if [[ -z "${trace_terminal_status:-}" || "${trace_count:-0}" == "0" ]]; then
    echo "[smoke] WARN: no terminal trace found for task ${TASK_ID}" >&2
    return 75
  fi
  if [[ "${trace_terminal_status}" != "success" ]]; then
    if [[ "${final_runner_tail}" == *"429 Too Many Requests"* || "${final_runner_tail}" == *"retry limit"* ]]; then
      echo "[smoke] WARN: upstream throttled task ${TASK_ID}" >&2
      return 75
    fi
    echo "[smoke] ERROR: terminal trace status=${trace_terminal_status} summary=${trace_terminal_summary}" >&2
    return 2
  fi
  if [[ -z "${final_runner_tail}" ]]; then
    echo "[smoke] WARN: final runner output empty for task ${TASK_ID}" >&2
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
