#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/runtime-line-state.sh"
ensure_backend_real_state

API_BASE="${API_BASE:-http://localhost:${PORT_API:-21000}}"
BASE_URL="${BASE_URL:-http://localhost:${PORT_WEB:-3101}}"
WORKSPACE_ID="${WORKSPACE_ID:-$(state_get workspace.id ws_default)}"
TOKEN_FILE="${TOKEN_FILE:-$(backend_real_token_file)}"
PROJECT_ID="${PROJECT_ID:-$(state_get project.id)}"
PROMPT="${PROMPT:-check credential sync}"
RUNNER_LOG="${RUNNER_LOG:-$(local_manual_runtime_path runner.log)}"
TASK_LOG="${TASK_LOG:-$(backend_real_state_root)/credential-sync-smoke-task.log}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "[credential-sync-smoke] missing PROJECT_ID in $(backend_real_state_file)" >&2
  exit 1
fi
if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[credential-sync-smoke] token file not found: ${TOKEN_FILE}" >&2
  exit 1
fi

TOKEN="$(cat "${TOKEN_FILE}")"
UNIQ_NAME="credsync_$(date +%s)"
CONNECTION_ID=""

cleanup() {
  if [[ -n "${CONNECTION_ID}" ]]; then
    curl -sS -X DELETE \
      "${API_BASE}/api/v1/me/external-connections/${CONNECTION_ID}" \
      -H "Authorization: Bearer ${TOKEN}" \
      -o /dev/null || true
  fi
}
trap cleanup EXIT

echo "[credential-sync-smoke] creating user external connection: ${UNIQ_NAME}"
CREATE_PAYLOAD="$(
  jq -nc --arg name "${UNIQ_NAME}" '{
    provider:"jira",
    kind:"secret_bundle",
    display_name:$name,
    note:"credential-sync-smoke",
    fields:[
      {key:"base_url", value:"https://jira.example.com", description:"Jira base URL", secret:false},
      {key:"api_token", value:($name + "_token"), description:"Jira API token", secret:true}
    ]
  }'
)"
CREATE_RESP="$(
  curl -sS -X POST \
    "${API_BASE}/api/v1/me/external-connections" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "${CREATE_PAYLOAD}"
)"
CONNECTION_ID="$(printf '%s' "${CREATE_RESP}" | jq -r '.id')"
if [[ -z "${CONNECTION_ID}" || "${CONNECTION_ID}" == "null" ]]; then
  echo "[credential-sync-smoke] failed to create connection: ${CREATE_RESP}" >&2
  exit 1
fi

echo "[credential-sync-smoke] running agent-task smoke task"
(
  cd "${ROOT_DIR}" && \
  BASE_URL="${BASE_URL}" \
  API_BASE="${API_BASE}" \
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

TASK_ID="$(state_get task.last_id)"
if [[ -z "${TASK_ID}" ]]; then
  echo "[credential-sync-smoke] missing task.last_id in $(backend_real_state_file) after task run" >&2
  exit 1
fi
REQUEST_ID="$(
  rg -n "\"task_id\":\"${TASK_ID}\"" "${RUNNER_LOG}" | tail -n1 | \
  sed -nE 's/.*"request_id":"([^"]+)".*/\1/p'
)"
if [[ -z "${REQUEST_ID}" ]]; then
  echo "[credential-sync-smoke] failed to infer request_id from ${RUNNER_LOG} for task ${TASK_ID}" >&2
  exit 1
fi
RUN_CONTEXT_LINE="$(
  rg -n "\"request_id\":\"${REQUEST_ID}\"" "${RUNNER_LOG}" | \
  rg 'prepared task workspace' | tail -n1
)"
if [[ -z "${RUN_CONTEXT_LINE}" ]]; then
  echo "[credential-sync-smoke] failed to infer run context from ${RUNNER_LOG} for task ${TASK_ID}" >&2
  exit 1
fi
CWD="$(printf '%s' "${RUN_CONTEXT_LINE}" | sed -nE 's/.*"cwd":"([^"]+)".*/\1/p')"
CREDENTIAL_DIR="$(printf '%s' "${RUN_CONTEXT_LINE}" | sed -nE 's/.*"credential_dir":"([^"]+)".*/\1/p')"
if [[ -z "${CWD}" || -z "${CREDENTIAL_DIR}" ]]; then
  echo "[credential-sync-smoke] failed to infer cwd/credential_dir from ${RUNNER_LOG} for task ${TASK_ID}" >&2
  echo "${RUN_CONTEXT_LINE}" >&2
  exit 1
fi
INDEX_PATH="${CREDENTIAL_DIR}/index.json"
PROVIDER_PATH="${CREDENTIAL_DIR}/jira/connections.json"

echo "[credential-sync-smoke] checking generated files in ${CREDENTIAL_DIR} (cwd=${CWD})"
[[ -f "${INDEX_PATH}" ]] || { echo "[credential-sync-smoke] missing ${INDEX_PATH}" >&2; exit 1; }
[[ -f "${PROVIDER_PATH}" ]] || { echo "[credential-sync-smoke] missing ${PROVIDER_PATH}" >&2; exit 1; }

HAS_NAME="$(jq -r --arg n "${UNIQ_NAME}" '.connections | map(.display_name) | index($n) != null' "${PROVIDER_PATH}")"
if [[ "${HAS_NAME}" != "true" ]]; then
  echo "[credential-sync-smoke] provider file does not contain ${UNIQ_NAME}" >&2
  jq . "${PROVIDER_PATH}" >&2 || true
  exit 1
fi

echo "[credential-sync-smoke] PASS"
echo "[credential-sync-smoke] task_id=${TASK_ID}"
echo "[credential-sync-smoke] connection_id=${CONNECTION_ID}"
