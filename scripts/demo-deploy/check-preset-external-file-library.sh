#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "demo-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
source "${ROOT_DIR}/scripts/lib/common.sh"

load_release_env

HOST_LOCAL_API_BASE_URL="${HOST_LOCAL_API_BASE_URL:-http://127.0.0.1:${API_PORT:-20000}}"
HOST_LOCAL_KEYCLOAK_BASE_URL="${HOST_LOCAL_KEYCLOAK_BASE_URL:-http://127.0.0.1:${KEYCLOAK_PORT:-18080}}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
INTEGRATION_DEV_ADMIN_USERNAME="${INTEGRATION_DEV_ADMIN_USERNAME:-dev-admin}"
INTEGRATION_DEV_ADMIN_PASSWORD="${INTEGRATION_DEV_ADMIN_PASSWORD:-dev-admin-123}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
PRESET_PROJECT_NAME_VALUE="${PRESET_PROJECT_NAME:-Demo Project}"
PRESET_EXTERNAL_AGENT_NAME_VALUE="${PRESET_EXTERNAL_AGENT_NAME:-demo-external-agent}"
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

ACCESS_TOKEN="$(fetch_token)"
[[ -n "${ACCESS_TOKEN}" ]] || die "preset external file-library readiness failed: missing token"

PROJECTS_JSON="$(
  curl -fsS "${HOST_LOCAL_API_BASE_URL}/api/v1/workspaces/${WORKSPACE_ID}/projects?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
PROJECT_ID="$(printf '%s' "${PROJECTS_JSON}" | json_find_named_id "${PRESET_PROJECT_NAME_VALUE}")"
[[ -n "${PROJECT_ID}" ]] || die "preset external file-library readiness failed: preset project missing"

AGENTS_JSON="$(
  curl -fsS "${HOST_LOCAL_API_BASE_URL}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/agents?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
AGENT_ID="$(printf '%s' "${AGENTS_JSON}" | json_find_named_id "${PRESET_EXTERNAL_AGENT_NAME_VALUE}")"
[[ -n "${AGENT_ID}" ]] || die "preset external file-library readiness failed: preset external agent missing"

READY_DEADLINE=$(( $(date +%s) + 90 ))
TASK_ID=""
LIBRARY_ID=""
LAST_STATUS=""
LAST_BODY=""

while (( $(date +%s) < READY_DEADLINE )); do
  TASK_NAME="preset-ext-ready-$(date +%s)"
  WORKSPACE_NAME="preset-ext-ready-$(date +%s)"
  CREATE_STATUS="$(
    api_json POST \
      "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/tasks" \
      "{\"title\":\"${TASK_NAME}\",\"agent_id\":\"${AGENT_ID}\",\"workspace_mode\":\"create_new\",\"workspace_name\":\"${WORKSPACE_NAME}\"}"
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
      METADATA_URL="$(cat "${BODY_FILE}" | json_extract metadata_url)"
      STORAGE_BUCKET_URL="$(cat "${BODY_FILE}" | json_extract storage_bucket_url)"
      if [[ "${METADATA_URL}" == *"@postgres:5432/"* && "${STORAGE_BUCKET_URL}" == *"http://minio:9000/"* ]]; then
        api_json DELETE "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/tasks/${TASK_ID}" >/dev/null || true
        if [[ -n "${LIBRARY_ID}" ]]; then
          api_json DELETE "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}" >/dev/null || true
        fi
        log "preset external file-library readiness ok"
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

die "preset external file-library readiness failed: status=${LAST_STATUS} body=${LAST_BODY}"
