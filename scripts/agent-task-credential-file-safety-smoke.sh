#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/runtime-line-state.sh"
ensure_backend_real_state

API_BASE_INPUT="${API_BASE:-http://localhost:${PORT_API:-21000}}"
API_ORIGIN="${API_BASE_INPUT%/}"
API_ORIGIN="${API_ORIGIN%/api/v1}"
BASE_URL="${BASE_URL:-http://localhost:${PORT_WEB:-3101}}"
WORKSPACE_ID="${WORKSPACE_ID:-$(state_get workspace.id ws_default)}"
TOKEN_FILE="${TOKEN_FILE:-$(backend_real_token_file)}"
PROJECT_ID="${PROJECT_ID:-$(state_get project.id)}"
RUNNER_LOG="${RUNNER_LOG:-$(local_manual_runtime_path runner.log)}"
TASK_LOG="${TASK_LOG:-$(backend_real_state_root)/credential-file-safety-smoke-task.log}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "[credential-file-safety-smoke] missing PROJECT_ID in $(backend_real_state_file)" >&2
  exit 1
fi
if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[credential-file-safety-smoke] token file not found: ${TOKEN_FILE}" >&2
  exit 1
fi

TOKEN="$(cat "${TOKEN_FILE}")"
UNIQ_NAME="credsafety_$(date +%s)"
CONNECTION_ID=""
SAFETY_NONCE="${CREDENTIAL_FILE_SAFETY_NONCE:-}"
if [[ -z "${SAFETY_NONCE}" ]]; then
  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    SAFETY_NONCE="$(tr -d '-' </proc/sys/kernel/random/uuid)"
  else
    SAFETY_NONCE="$(printf '%s_%s_%s' "$(date +%s%N)" "$$" "${RANDOM}")"
  fi
fi
SAFETY_MARKER_PREFIX="CREDENTIAL_FILE_SAFETY::ok::"
SAFETY_MARKER="${SAFETY_MARKER_PREFIX}${SAFETY_NONCE}"

cleanup() {
  if [[ -n "${CONNECTION_ID}" ]]; then
    curl -sS -X DELETE \
      "${API_ORIGIN}/api/v1/me/external-connections/${CONNECTION_ID}" \
      -H "Authorization: Bearer ${TOKEN}" \
      -o /dev/null || true
  fi
}
trap cleanup EXIT

echo "[credential-file-safety-smoke] creating external connection fixture: ${UNIQ_NAME}"
CREATE_PAYLOAD="$(
  jq -nc --arg name "${UNIQ_NAME}" '{
    provider:"custom",
    custom_domain:"custom.local",
    kind:"secret_bundle",
    display_name:$name,
    note:"credential-file-safety-smoke",
    fields:[
      {key:"service_url", value:"https://service.example.com", description:"Service URL", secret:false},
      {key:"access_token", value:($name + "_token"), description:"Access token", secret:true}
    ]
  }'
)"
CREATE_RESP="$(
  curl -sS -X POST \
    "${API_ORIGIN}/api/v1/me/external-connections" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "${CREATE_PAYLOAD}"
)"
CONNECTION_ID="$(printf '%s' "${CREATE_RESP}" | jq -r '.id')"
if [[ -z "${CONNECTION_ID}" || "${CONNECTION_ID}" == "null" ]]; then
  echo "[credential-file-safety-smoke] failed to create connection: ${CREATE_RESP}" >&2
  exit 1
fi

SAFETY_COMMAND="$(
  node - "${UNIQ_NAME}" "${SAFETY_NONCE}" <<'NODE'
const externalConnectionName = process.argv[2] ?? '';
const safetyNonce = process.argv[3] ?? '';
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
const python = [
  'import json,os,sys',
  `external_connection_name=${JSON.stringify(externalConnectionName)}`,
  'marker_nonce=os.environ.get("CREDENTIAL_FILE_SAFETY_NONCE","")',
  'if not marker_nonce:',
  '    sys.exit("missing_safety_nonce")',
  'raw=os.environ.get("MBOS_AGENT_PROJECTED_DEPENDENCIES","")',
  'if raw:',
  '    try:',
  '        data=json.loads(raw)',
  '    except Exception as exc:',
  '        sys.exit("invalid_projected_dependencies:"+str(exc))',
  '    serialized=json.dumps(data,sort_keys=True).lower()',
  '    for forbidden in ("managed_credentials","managed_credential","managed_credential_refresh","credential_files","user_bearer_token"):',
  '        if forbidden in serialized:',
  '            sys.exit("forbidden_projection_field:"+forbidden)',
  '    if external_connection_name and external_connection_name.lower() in serialized:',
  '        sys.exit("external_connection_projected:"+external_connection_name)',
  '    deps=data.get("dependencies") if isinstance(data,dict) else None',
  '    if isinstance(deps,dict) and deps:',
  '        sys.exit("unexpected_projected_dependencies:"+",".join(sorted(str(k) for k in deps.keys())))',
  'for key in ("CREDENTIAL_DIR","MBOS_CREDENTIAL_DIR","MBOS_AGENT_CREDENTIAL_DIR"):',
  '    if os.environ.get(key):',
  '        sys.exit("credential_dir_env:"+key)',
  'task_home=os.environ.get("TASK_HOME") or os.environ.get("HOME","")',
  'workspace_path=os.environ.get("WORKSPACE_PATH") or os.getcwd()',
  'candidate_paths=[]',
  'for base in (task_home,workspace_path):',
  '    if base:',
  '        candidate_paths.extend([os.path.join(base,"credentials"),os.path.join(base,".credentials"),os.path.join(base,".mbos","credentials")])',
  'for candidate in candidate_paths:',
  '    if candidate and os.path.exists(candidate):',
  '        sys.exit("credential_file_projection:"+candidate)',
  'print("CREDENTIAL_FILE_SAFETY::ok::"+marker_nonce)',
].join('\n');
process.stdout.write(`CREDENTIAL_FILE_SAFETY_NONCE=${shellQuote(safetyNonce)} python3 -c 'exec(${JSON.stringify(python)})'`);
NODE
)"
PROMPT="${PROMPT:-Run this exact shell command and use its stdout value in your final reply: \`${SAFETY_COMMAND}\`. Reply with exactly one line and no extra text.}"

echo "[credential-file-safety-smoke] running negative Agent Task safety check"
(
  cd "${ROOT_DIR}" && \
  BASE_URL="${BASE_URL}" \
  API_BASE="${API_ORIGIN}" \
  WORKSPACE_ID="${WORKSPACE_ID}" \
  PROJECT_ID="${PROJECT_ID}" \
  PROMPT="${PROMPT}" \
  SCENARIO_ATTEMPTS=1 \
  POLL_MAX=25 \
  FINAL_MESSAGE_SETTLE_MAX_SEC=8 \
  WAIT_AGENT_ONLINE=1 \
  bash scripts/agent-task-smoke-task.sh
) >"${TASK_LOG}" 2>&1 || {
  tail -n 120 "${TASK_LOG}" >&2 || true
  exit 1
}

if ! rg -q --fixed-strings -- "${SAFETY_MARKER}" "${TASK_LOG}"; then
  echo "[credential-file-safety-smoke] missing ${SAFETY_MARKER} marker" >&2
  tail -n 120 "${TASK_LOG}" >&2 || true
  exit 1
fi

TASK_ID="$(state_get task.last_id)"
if [[ -n "${TASK_ID}" && -f "${RUNNER_LOG}" ]]; then
  if rg -n "\"task_id\":\"${TASK_ID}\".*\"credential_dir\"" "${RUNNER_LOG}" >/dev/null; then
    echo "[credential-file-safety-smoke] runner log exposed retired credential_dir for task ${TASK_ID}" >&2
    rg -n "\"task_id\":\"${TASK_ID}\".*\"credential_dir\"" "${RUNNER_LOG}" >&2 || true
    exit 1
  fi
  REQUEST_ID="$(
    rg -n "\"task_id\":\"${TASK_ID}\"" "${RUNNER_LOG}" | tail -n1 | \
    sed -nE 's/.*"request_id":"([^"]+)".*/\1/p' || true
  )"
  if [[ -n "${REQUEST_ID}" ]] && rg -n "\"request_id\":\"${REQUEST_ID}\".*\"credential_dir\"" "${RUNNER_LOG}" >/dev/null; then
    echo "[credential-file-safety-smoke] runner log exposed retired credential_dir for request ${REQUEST_ID}" >&2
    rg -n "\"request_id\":\"${REQUEST_ID}\".*\"credential_dir\"" "${RUNNER_LOG}" >&2 || true
    exit 1
  fi
fi

echo "[credential-file-safety-smoke] PASS"
echo "[credential-file-safety-smoke] task_id=${TASK_ID:-unknown}"
echo "[credential-file-safety-smoke] connection_id=${CONNECTION_ID}"
