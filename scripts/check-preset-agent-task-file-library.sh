#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/deploy-common.sh"

load_release_env

HOST_LOCAL_API_BASE_URL="${HOST_LOCAL_API_BASE_URL:-http://127.0.0.1:${API_PORT:-20000}}"
HOST_LOCAL_KEYCLOAK_BASE_URL="${HOST_LOCAL_KEYCLOAK_BASE_URL:-http://127.0.0.1:${KEYCLOAK_PORT:-18080}}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
INTEGRATION_DEV_ADMIN_USERNAME="${INTEGRATION_DEV_ADMIN_USERNAME:-dev-admin}"
INTEGRATION_DEV_ADMIN_PASSWORD="${INTEGRATION_DEV_ADMIN_PASSWORD:-dev-admin-123}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
PRESET_PROJECT_NAME_VALUE="${PRESET_PROJECT_NAME:-Demo Project}"
PRESET_AGENT_RUNNER_NAME_VALUE="${PRESET_AGENT_RUNNER_NAME:-demo-agent-task-runner}"
WORKSPACE_ACCESS_EVIDENCE_FILE="${WORKSPACE_ACCESS_EVIDENCE_FILE:-}"

BODY_FILE="$(mktemp)"
cleanup() {
  rm -f "${BODY_FILE}"
}
trap cleanup EXIT

fetch_token() {
  local token_json
  token_json="$(
    curl -fsS "${HOST_LOCAL_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
      -H 'content-type: application/x-www-form-urlencoded' \
      --data-urlencode 'grant_type=password' \
      --data-urlencode "client_id=${KEYCLOAK_CLIENT_ID}" \
      --data-urlencode "username=${INTEGRATION_DEV_ADMIN_USERNAME}" \
      --data-urlencode "password=${INTEGRATION_DEV_ADMIN_PASSWORD}" \
      --data-urlencode 'scope=openid profile email'
  )"
  printf '%s' "${token_json}" | json_extract access_token
}

api_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "${body}" ]]; then
    curl -sS -o "${BODY_FILE}" -w '%{http_code}' \
      -X "${method}" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      -H 'Content-Type: application/json' \
      --data "${body}" \
      "${HOST_LOCAL_API_BASE_URL}${path}"
  else
    curl -sS -o "${BODY_FILE}" -w '%{http_code}' \
      -X "${method}" \
      -H "Authorization: Bearer ${ACCESS_TOKEN}" \
      "${HOST_LOCAL_API_BASE_URL}${path}"
  fi
}


json_body_field() {
  local expression="$1"
  node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const v=eval(process.argv[1]);if(v===undefined||v===null){process.exit(2)}if(typeof v==='string'){process.stdout.write(v)}else{process.stdout.write(JSON.stringify(v))}})" "${expression}" < "${BODY_FILE}"
}

is_relative_library_root_path() {
  local value="$1"
  [[ -n "${value}" ]] || return 1
  [[ "${value}" != /* ]] || return 1
  [[ "${value}" != *".."* ]] || return 1
  return 0
}

is_canonical_task_home_paths() {
  local task_home_path="$1"
  local workspace_path="$2"
  local artifacts_path="$3"
  [[ "${task_home_path}" == /home/* ]] || return 1
  [[ "${workspace_path}" == "${task_home_path}/workspace" ]] || return 1
  [[ "${artifacts_path}" == "${workspace_path}/.artifacts" ]] || return 1
  return 0
}

ACCESS_TOKEN="$(fetch_token)"
[[ -n "${ACCESS_TOKEN}" ]] || die "preset agent-task file-library readiness failed: missing token"

PROJECTS_JSON="$(
  curl -fsS "${HOST_LOCAL_API_BASE_URL}/api/v1/workspaces/${WORKSPACE_ID}/projects?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
PROJECT_ID="$(printf '%s' "${PROJECTS_JSON}" | json_find_named_id "${PRESET_PROJECT_NAME_VALUE}")"
[[ -n "${PROJECT_ID}" ]] || die "preset agent-task file-library readiness failed: preset project missing"

AGENT_RUNNERS_JSON="$(
  curl -fsS "${HOST_LOCAL_API_BASE_URL}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/agent-runners?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
AGENT_RUNNER_ID="$(printf '%s' "${AGENT_RUNNERS_JSON}" | json_find_named_id "${PRESET_AGENT_RUNNER_NAME_VALUE}")"
[[ -n "${AGENT_RUNNER_ID}" ]] || die "preset agent-task file-library readiness failed: preset agent-task runner missing"

READY_DEADLINE=$(( $(date +%s) + 90 ))
TASK_ID=""
LIBRARY_ID=""
LAST_STATUS=""
LAST_BODY=""

while (( $(date +%s) < READY_DEADLINE )); do
  TASK_NAME="preset-agent-task-ready-$(date +%s)"
  WORKSPACE_NAME="preset-agent-task-ready-$(date +%s)"
  CREATE_STATUS="$(
    api_json POST \
      "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/tasks" \
      "{\"title\":\"${TASK_NAME}\",\"workspace_mode\":\"create_new\",\"workspace_name\":\"${WORKSPACE_NAME}\"}"
  )"
  LAST_STATUS="${CREATE_STATUS}"
  LAST_BODY="$(cat "${BODY_FILE}")"
  if [[ "${CREATE_STATUS}" == "201" ]]; then
    TASK_ID="$(cat "${BODY_FILE}" | json_extract id)"
    LIBRARY_ID="$(cat "${BODY_FILE}" | json_extract workspace_file_library_id)"
    ACCESS_STATUS="$(
      api_json POST \
        "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/tasks/${TASK_ID}/workspace-access"
    )"
    LAST_STATUS="${ACCESS_STATUS}"
    LAST_BODY="$(cat "${BODY_FILE}")"
    if [[ "${ACCESS_STATUS}" == "200" ]]; then
      if [[ -n "${WORKSPACE_ACCESS_EVIDENCE_FILE}" ]]; then
        mkdir -p "$(dirname "${WORKSPACE_ACCESS_EVIDENCE_FILE}")"
        cp "${BODY_FILE}" "${WORKSPACE_ACCESS_EVIDENCE_FILE}"
      fi
      RAW_STORAGE_LEAK="0"
      if grep -Eq 'metadata_url|storage_bucket_url|recommended_mount|filesystem_name|juicefs' "${BODY_FILE}"; then
        RAW_STORAGE_LEAK="1"
        LAST_STATUS="workspace-access-raw-storage-leak"
        LAST_BODY="$(cat "${BODY_FILE}")"
      fi
      BINDING_PROVIDER="$(json_body_field 'j.task_home_binding && j.task_home_binding.provider ? j.task_home_binding.provider : ""' || true)"
      BINDING_MODE="$(json_body_field 'j.task_home_binding && j.task_home_binding.mode ? j.task_home_binding.mode : ""' || true)"
      LIBRARY_ROOT_PATH="$(json_body_field 'j.task_home_binding && j.task_home_binding.paths ? j.task_home_binding.paths.library_root_path : ""' || true)"
      TASK_HOME_PATH="$(json_body_field 'j.task_home_binding && j.task_home_binding.paths ? j.task_home_binding.paths.task_home_path : ""' || true)"
      WORKSPACE_PATH="$(json_body_field 'j.task_home_binding && j.task_home_binding.paths ? j.task_home_binding.paths.workspace_path : ""' || true)"
      ARTIFACTS_PATH="$(json_body_field 'j.task_home_binding && j.task_home_binding.paths ? j.task_home_binding.paths.artifacts_path : ""' || true)"
      if [[ "${RAW_STORAGE_LEAK}" == "0" && "${BINDING_PROVIDER}" == "afscp" && "${BINDING_MODE}" == "pre_mounted" ]] \
        && is_relative_library_root_path "${LIBRARY_ROOT_PATH}" \
        && is_canonical_task_home_paths "${TASK_HOME_PATH}" "${WORKSPACE_PATH}" "${ARTIFACTS_PATH}"; then
        api_json DELETE "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/tasks/${TASK_ID}" >/dev/null || true
        if [[ -n "${LIBRARY_ID}" ]]; then
          api_json DELETE "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}" >/dev/null || true
        fi
        log "preset agent-task file-library readiness ok"
        exit 0
      fi
      LAST_STATUS="workspace-access-shape"
      LAST_BODY="$(cat "${BODY_FILE}")"
    fi
    api_json DELETE "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/tasks/${TASK_ID}" >/dev/null || true
    if [[ -n "${LIBRARY_ID}" ]]; then
      api_json DELETE "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}" >/dev/null || true
    fi
  fi
  sleep 3
done

die "preset agent-task file-library readiness failed: status=${LAST_STATUS} body=${LAST_BODY}"
