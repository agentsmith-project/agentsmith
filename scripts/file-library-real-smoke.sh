#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
resolve_backend_real_api_base_for_smoke
resolve_loopback_runtime_stack
API_PORT="${INTEGRATION_API_PORT:-${API_PORT:-20000}}"
API_BASE="$(normalize_api_root_base "${API_BASE:-${RUNTIME_HOST_API_BASE_URL}}")"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-${KEYCLOAK_URL:-${RUNTIME_HOST_KEYCLOAK_BASE_URL}}}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
MBOS_DEV_USERNAME="${MBOS_DEV_USERNAME:-dev-admin}"
MBOS_DEV_PASSWORD="${MBOS_DEV_PASSWORD:-dev-admin-123}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
PROJECT_ID="${PROJECT_ID:-}"
PROJECT_CREATED="0"

TMP_DIR="$(mktemp -d /tmp/agentsmith-filelib-smoke.XXXXXX)"
TOKEN_FILE="${TMP_DIR}/token.txt"
BODY_FILE="${TMP_DIR}/body.json"
HEADERS_FILE="${TMP_DIR}/headers.txt"
UPLOAD_FILE="${TMP_DIR}/guide.txt"
DOWNLOAD_FILE="${TMP_DIR}/download.txt"
LIBRARY_ID=""
TASK_FILE_TEMPLATE_ID=""
TEMPLATE_TASK_ID=""
TEMPLATE_LIBRARY_ID=""

info() { echo "[file-library-real-smoke] $*"; }
err() { echo "[file-library-real-smoke] ERROR: $*" >&2; }

cleanup() {
  if [[ -n "${TEMPLATE_TASK_ID}" && -n "${WORKSPACE_ID}" && -n "${PROJECT_ID}" ]]; then
    curl -sS -o /dev/null -X DELETE \
      -H "Authorization: Bearer $(cat "${TOKEN_FILE}" 2>/dev/null || true)" \
      "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/tasks/${TEMPLATE_TASK_ID}" || true
  fi
  if [[ -n "${TEMPLATE_LIBRARY_ID}" && -n "${WORKSPACE_ID}" && -n "${PROJECT_ID}" ]]; then
    curl -sS -o /dev/null -X POST \
      -H "Authorization: Bearer $(cat "${TOKEN_FILE}" 2>/dev/null || true)" \
      -H 'Content-Type: application/json' \
      --data '{"paths":["docs/guide.txt","docs/"]}' \
      "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${TEMPLATE_LIBRARY_ID}/delete" || true
    curl -sS -o /dev/null -X DELETE \
      -H "Authorization: Bearer $(cat "${TOKEN_FILE}" 2>/dev/null || true)" \
      "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${TEMPLATE_LIBRARY_ID}" || true
  fi
  if [[ -n "${TASK_FILE_TEMPLATE_ID}" && -n "${WORKSPACE_ID}" && -n "${PROJECT_ID}" ]]; then
    curl -sS -o /dev/null -X DELETE \
      -H "Authorization: Bearer $(cat "${TOKEN_FILE}" 2>/dev/null || true)" \
      "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/task-file-templates/${TASK_FILE_TEMPLATE_ID}" || true
  fi
  if [[ -n "${LIBRARY_ID}" && -n "${WORKSPACE_ID}" && -n "${PROJECT_ID}" ]]; then
    curl -sS -o /dev/null -X DELETE \
      -H "Authorization: Bearer $(cat "${TOKEN_FILE}" 2>/dev/null || true)" \
      "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}" || true
  fi
  if [[ "${PROJECT_CREATED}" == "1" && -n "${WORKSPACE_ID}" && -n "${PROJECT_ID}" ]]; then
    curl -sS -o /dev/null -X DELETE \
      -H "Authorization: Bearer $(cat "${TOKEN_FILE}" 2>/dev/null || true)" \
      "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}" || true
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "missing command: $1"; exit 1; }
}

json_field() {
  local expr="$1"
  node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);const v=(${expr});if(v===undefined||v===null){process.exit(2)}if(typeof v==='string'){process.stdout.write(v)}else{process.stdout.write(JSON.stringify(v))}})"
}

content_type_media_type() {
  node -e "process.stdout.write(String(process.argv[1] ?? '').split(';')[0].trim().toLowerCase())" "$1"
}

assert_no_raw_afscp_ids() {
  local label="$1"
  if grep -Eiq '(^|[^A-Za-z0-9_])(repo_|tmpl_|plan_|restore[_]plan|sp_(user|template|[A-Za-z0-9])|[0-9]{13}-[0-9a-f]{8})' "${BODY_FILE}"; then
    err "${label} leaked raw AFSCP resource ids"
    cat "${BODY_FILE}" >&2
    exit 1
  fi
}

assert_no_raw_storage_fields() {
  local label="$1"
  if grep -Eiq 'metadata_url|storage_bucket_url|client_mount_access|recommended_mount|filesystem_name|access_key|secret_key|juicefs' "${BODY_FILE}"; then
    err "${label} leaked raw file-library storage material"
    cat "${BODY_FILE}" >&2
    exit 1
  fi
  assert_no_raw_afscp_ids "${label}"
}

response_error_code() {
  cat "${BODY_FILE}" | json_field "typeof j.error_code === 'string' ? j.error_code : ''" || true
}

is_operation_success_state() {
  local normalized
  normalized="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "${normalized}" == "succeeded" || "${normalized}" == "success" || "${normalized}" == "completed" || "${normalized}" == "ready" ]]
}

is_operation_failed_state() {
  local normalized
  normalized="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "${normalized}" == "failed" || "${normalized}" == "failure" || "${normalized}" == "error" || "${normalized}" == "errored" || "${normalized}" == "cancelled" || "${normalized}" == "canceled" ]]
}

wait_restore_operation_terminal() {
  local operation_id="$1"
  local max_attempts="${FILE_LIBRARY_RESTORE_OPERATION_ATTEMPTS:-90}"
  local attempt=1
  if ! [[ "${max_attempts}" =~ ^[0-9]+$ ]] || [[ "${max_attempts}" -lt 1 ]]; then
    max_attempts=90
  fi

  while (( attempt <= max_attempts )); do
    status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/operations/active")"
    if [[ "${status}" == "200" ]]; then
      assert_no_raw_storage_fields "file library restore operation"
      local operation_status
      operation_status="$(cat "${BODY_FILE}" | json_field "j.operation && j.operation.id === '${operation_id}' ? j.operation.status : ''" || true)"
      if [[ -z "${operation_status}" ]]; then
        info "restore operation ${operation_id} is no longer active"
        return 0
      fi
      if [[ "${operation_status}" == "failed" || "${operation_status}" == "recovery_required" ]]; then
        err "restore operation ${operation_id} failed"
        cat "${BODY_FILE}" >&2
        exit 1
      fi
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  err "timed out waiting for restore operation ${operation_id}"
  cat "${BODY_FILE}" >&2
  exit 1
}

api_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  : > "${BODY_FILE}"
  : > "${HEADERS_FILE}"
  local status
  if [[ -n "${body}" ]]; then
    status="$(curl -sS -D "${HEADERS_FILE}" -o "${BODY_FILE}" -w '%{http_code}' \
      -X "${method}" \
      -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
      -H 'Content-Type: application/json' \
      --data "${body}" \
      "${API_BASE%/}${path}")"
  else
    status="$(curl -sS -D "${HEADERS_FILE}" -o "${BODY_FILE}" -w '%{http_code}' \
      -X "${method}" \
      -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
      "${API_BASE%/}${path}")"
  fi
  printf '%s' "${status}"
}

api_json_with_idempotency() {
  local method="$1"
  local path="$2"
  local idempotency_key="$3"
  local body="${4:-}"
  : > "${BODY_FILE}"
  : > "${HEADERS_FILE}"
  local status
  status="$(curl -sS -D "${HEADERS_FILE}" -o "${BODY_FILE}" -w '%{http_code}' \
    -X "${method}" \
    -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: ${idempotency_key}" \
    --data "${body}" \
    "${API_BASE%/}${path}")"
  printf '%s' "${status}"
}

upload_guide_file() {
  local label="$1"
  local status
  status="$(curl -sS -D "${HEADERS_FILE}" -o "${BODY_FILE}" -w '%{http_code}' \
    -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
    -F "prefix=docs/" \
    -F "file=@${UPLOAD_FILE};type=text/plain" \
    "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/upload")"
  if [[ "${status}" != "200" && "${status}" != "201" ]]; then
    err "failed to upload file ${label}: ${status}"
    cat "${BODY_FILE}" >&2
    exit 1
  fi
  assert_no_raw_storage_fields "file library upload ${label}"
}

create_library_when_project_storage_ready() {
  local payload="$1"
  local max_attempts="${FILE_LIBRARY_PROJECT_STORAGE_READY_ATTEMPTS:-60}"
  local attempt=1
  if ! [[ "${max_attempts}" =~ ^[0-9]+$ ]] || [[ "${max_attempts}" -lt 1 ]]; then
    max_attempts=60
  fi

  while (( attempt <= max_attempts )); do
    status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries" "${payload}")"
    if [[ "${status}" == "201" ]]; then
      return 0
    fi

    local error_code
    error_code="$(response_error_code)"
    if [[ "${status}" == "409" && "${error_code}" == "PROJECT_STORAGE_PENDING" ]]; then
      info "project storage pending before file library create; waiting for backend readiness (${attempt}/${max_attempts})"
      sleep 1
      attempt=$((attempt + 1))
      continue
    fi

    err "failed to create file library: ${status}"
    cat "${BODY_FILE}" >&2
    exit 1
  done

  err "timed out waiting for project storage readiness before file library create"
  cat "${BODY_FILE}" >&2
  exit 1
}

wait_file_library_delete_operation_terminal() {
  local operation_id="$1"
  local max_attempts="${FILE_LIBRARY_REPO_DELETE_OPERATION_ATTEMPTS:-90}"
  local attempt=1
  if ! [[ "${max_attempts}" =~ ^[0-9]+$ ]] || [[ "${max_attempts}" -lt 1 ]]; then
    max_attempts=90
  fi

  while (( attempt <= max_attempts )); do
    local status
    status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-library-operations/${operation_id}")"
    if [[ "${status}" != "200" ]]; then
      err "failed to read file library delete operation ${operation_id}: ${status}"
      cat "${BODY_FILE}" >&2
      exit 1
    fi
    local operation_state
    operation_state="$(cat "${BODY_FILE}" | json_field "j.operation_state" || true)"
    if is_operation_success_state "${operation_state}"; then
      info "file library delete operation ${operation_id} reached ${operation_state}"
      return 0
    fi
    if is_operation_failed_state "${operation_state}"; then
      err "file library delete operation ${operation_id} failed with state ${operation_state}"
      cat "${BODY_FILE}" >&2
      exit 1
    fi
    info "file library delete operation ${operation_id} is ${operation_state:-unknown}; waiting for terminal state (${attempt}/${max_attempts})"
    sleep 1
    attempt=$((attempt + 1))
  done

  err "timed out waiting for file library delete operation ${operation_id}"
  cat "${BODY_FILE}" >&2
  exit 1
}

wait_file_library_deleting_projection() {
  local max_attempts="${FILE_LIBRARY_REPO_DELETE_RESOURCE_ATTEMPTS:-10}"
  local attempt=1
  if ! [[ "${max_attempts}" =~ ^[0-9]+$ ]] || [[ "${max_attempts}" -lt 1 ]]; then
    max_attempts=10
  fi

  while (( attempt <= max_attempts )); do
    local status
    status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}")"
    if [[ "${status}" == "404" ]]; then
      return 0
    fi
    if [[ "${status}" == "200" ]]; then
      local library_status
      library_status="$(cat "${BODY_FILE}" | json_field "j.status" || true)"
      if [[ "${library_status}" == "deleting" ]]; then
        info "file library ${LIBRARY_ID} is deleting; retrying delete reconciliation (${attempt}/${max_attempts})"
        return 0
      fi
      if [[ "${library_status}" == "degraded" || "${library_status}" == "failed" ]]; then
        err "file library delete moved to ${library_status}"
        cat "${BODY_FILE}" >&2
        exit 1
      fi
    fi
    info "waiting for file library delete resource projection (${attempt}/${max_attempts})"
    sleep 1
    attempt=$((attempt + 1))
  done

  err "timed out waiting for file library delete resource projection"
  cat "${BODY_FILE}" >&2
  exit 1
}

delete_empty_library_when_terminal() {
  local max_attempts="${FILE_LIBRARY_REPO_DELETE_RECONCILE_ATTEMPTS:-5}"
  local attempt=1
  if ! [[ "${max_attempts}" =~ ^[0-9]+$ ]] || [[ "${max_attempts}" -lt 1 ]]; then
    max_attempts=5
  fi

  while (( attempt <= max_attempts )); do
    local status
    status="$(curl -sS -D "${HEADERS_FILE}" -o "${BODY_FILE}" -w '%{http_code}' \
      -X DELETE \
      -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
      "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}")"
    if [[ "${status}" == "204" || "${status}" == "404" ]]; then
      return 0
    fi
    if [[ "${status}" == "202" ]]; then
      assert_no_raw_storage_fields "empty file library delete accepted"
      local operation_id
      operation_id="$(cat "${BODY_FILE}" | json_field "typeof j.operation_id === 'string' ? j.operation_id : ''" || true)"
      local operation_status
      operation_status="$(cat "${BODY_FILE}" | json_field "j.operation_status" || true)"
      if [[ "${operation_status}" != "pending" ]]; then
        err "unexpected file library delete accepted status: ${operation_status:-missing}"
        cat "${BODY_FILE}" >&2
        exit 1
      fi
      if [[ -n "${operation_id}" ]]; then
        wait_file_library_delete_operation_terminal "${operation_id}"
      else
        wait_file_library_deleting_projection
      fi
      attempt=$((attempt + 1))
      continue
    fi

    err "failed to delete empty file library: ${status}"
    cat "${BODY_FILE}" >&2
    exit 1
  done

  err "timed out reconciling empty file library delete"
  cat "${BODY_FILE}" >&2
  exit 1
}

discover_workspace() {
  local body
  body="$(curl -sS "${API_BASE%/}/api/public/workspaces")"
  local discovered
  discovered="$(printf '%s' "${body}" | json_field "Array.isArray(j.items) && j.items[0] ? j.items[0].id : ''" || true)"
  if [[ -n "${discovered}" ]]; then
    WORKSPACE_ID="${WORKSPACE_ID:-${discovered}}"
  fi
}

discover_project() {
  local status
  status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects")"
  if [[ "${status}" != "200" ]]; then
    if [[ -n "${PROJECT_ID}" ]]; then
      return
    fi
    err "failed to list projects: ${status}"
    cat "${BODY_FILE}" >&2
    exit 1
  fi
  local projects_body
  projects_body="$(cat "${BODY_FILE}")"
  if [[ -z "${PROJECT_ID}" ]]; then
    local project_ids
    project_ids="$(printf '%s' "${projects_body}" | json_field "Array.isArray(j.items) ? j.items.map((item) => item.id).filter(Boolean).join('\n') : ''" || true)"
    local candidate_project_id
    while IFS= read -r candidate_project_id; do
      if [[ -n "${candidate_project_id}" ]] && project_has_ready_managed_runner "${candidate_project_id}"; then
        PROJECT_ID="${candidate_project_id}"
        return
      fi
    done <<< "${project_ids}"
  fi
  local discovered
  discovered="$(printf '%s' "${projects_body}" | json_field "Array.isArray(j.items) && j.items[0] ? j.items[0].id : ''" || true)"
  PROJECT_ID="${PROJECT_ID:-${discovered}}"
  if [[ -z "${PROJECT_ID}" ]]; then
    info "no existing project found; creating temporary project"
    local create_status
    create_status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects" '{"name":"File Library Smoke Project","visibility":"private","join_policy":"approval_required"}')"
    if [[ "${create_status}" != "201" ]]; then
      err "failed to create temporary project: ${create_status}"
      cat "${BODY_FILE}" >&2
      exit 1
    fi
    PROJECT_ID="$(cat "${BODY_FILE}" | json_field "j.id")"
    PROJECT_CREATED="1"
  fi
}

project_has_ready_managed_runner() {
  local project_id="$1"
  local status
  status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}/agent-runners")"
  if [[ "${status}" != "200" ]]; then
    return 1
  fi
  local has_ready_runner
  has_ready_runner="$(cat "${BODY_FILE}" | json_field "Array.isArray(j.items) && j.items.some((runner) => (runner.kind === 'system_managed' || runner.presence === 'managed' || runner.source === 'system') && (runner.status === 'ready' || runner.runner_status === 'ready')) ? '1' : ''" || true)"
  [[ "${has_ready_runner}" == "1" ]]
}

wait_ready() {
  local tries=0
  while (( tries < 30 )); do
    local status
    status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}")"
    if [[ "${status}" == "200" ]]; then
      assert_no_raw_storage_fields "file library detail"
      local library_status
      library_status="$(cat "${BODY_FILE}" | json_field "j.status" || true)"
      if [[ "${library_status}" == "ready" ]]; then
        return 0
      fi
      if [[ "${library_status}" == "failed" ]]; then
        err "library provisioning failed"
        cat "${BODY_FILE}" >&2
        exit 1
      fi
    fi
    sleep 1
    tries=$((tries + 1))
  done
  err "timed out waiting for library ready"
  exit 1
}

require_cmd curl
require_cmd node

info "fetching dev token"
REFRESH_TOKEN_FORCE_PASSWORD_GRANT=1 PRINT_TOKEN=1 \
MBOS_DEV_USERNAME="${MBOS_DEV_USERNAME}" \
MBOS_DEV_PASSWORD="${MBOS_DEV_PASSWORD}" \
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
node "${ROOT_DIR}/scripts/agent-runner-refresh-token.js" > "${TOKEN_FILE}"

discover_workspace
discover_project
info "using workspace=${WORKSPACE_ID} project=${PROJECT_ID}"

local_name="Smoke Library $(date +%s)"
create_library_when_project_storage_ready "{\"name\":\"${local_name}\",\"description\":\"Release smoke library\"}"
LIBRARY_ID="$(cat "${BODY_FILE}" | json_field "j.id")"
assert_no_raw_storage_fields "file library create"
info "created library ${LIBRARY_ID}"

wait_ready

status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries")"
if [[ "${status}" != "200" ]]; then
  err "failed to list file libraries: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "file library list"
LIST_HAS_LIBRARY="$(cat "${BODY_FILE}" | json_field "Array.isArray(j.items) && j.items.some((item) => item.id === '${LIBRARY_ID}') ? '1' : ''" || true)"
if [[ "${LIST_HAS_LIBRARY}" != "1" ]]; then
  err "created library missing from file library list"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/folders" '{"path":"docs"}')"
if [[ "${status}" != "204" ]]; then
  err "failed to create docs folder: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/entries")"
if [[ "${status}" != "200" ]]; then
  err "failed to list root entries after folder create: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "file library root entries"
ROOT_HAS_DOCS_FOLDER="$(cat "${BODY_FILE}" | json_field "Array.isArray(j.items) && j.items.some((item) => item.kind === 'directory' && item.path === 'docs/' && item.name === 'docs') ? '1' : ''" || true)"
if [[ "${ROOT_HAS_DOCS_FOLDER}" != "1" ]]; then
  err "new docs folder missing from root entries immediately after create"
  cat "${BODY_FILE}" >&2
  exit 1
fi

printf 'hello from file-library smoke\n' > "${UPLOAD_FILE}"
upload_guide_file "initial"

status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/entries?path=docs/")"
if [[ "${status}" != "200" ]]; then
  err "failed to list docs entries: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "file library docs entries"
if ! grep -q 'guide.txt' "${BODY_FILE}"; then
  err "uploaded file missing from entries"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/meta?path=$(node -p "encodeURIComponent('docs/guide.txt')")")"
if [[ "${status}" != "200" ]]; then
  err "failed to fetch file metadata: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "file library object metadata"
META_CONTENT_TYPE="$(cat "${BODY_FILE}" | json_field "j.content_type" || true)"
META_MEDIA_TYPE="$(content_type_media_type "${META_CONTENT_TYPE}")"
if [[ "${META_MEDIA_TYPE}" != "text/plain" ]]; then
  err "file metadata content_type mismatch: ${META_CONTENT_TYPE}"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(curl -sS -D "${HEADERS_FILE}" -o "${DOWNLOAD_FILE}" -w '%{http_code}' \
  -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
  "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/download?path=$(node -p "encodeURIComponent('docs/guide.txt')")")"
if [[ "${status}" != "200" ]]; then
  err "failed to download file: ${status}"
  cat "${DOWNLOAD_FILE}" >&2 || true
  exit 1
fi
if ! grep -q 'hello from file-library smoke' "${DOWNLOAD_FILE}"; then
  err "downloaded file content mismatch"
  exit 1
fi

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/save-points" '{"message":"Smoke save point before template publish"}')"
if [[ "${status}" != "201" ]]; then
  err "failed to create save point: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "file library save point create"
SAVE_POINT_ID="$(cat "${BODY_FILE}" | json_field "j.id")"

status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/save-points")"
if [[ "${status}" != "200" ]]; then
  err "failed to list save points: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "file library save point list"
SAVE_POINT_LIST_HAS_CREATED="$(cat "${BODY_FILE}" | json_field "Array.isArray(j.items) && j.items.some((item) => item.id === '${SAVE_POINT_ID}') ? '1' : ''" || true)"
if [[ "${SAVE_POINT_LIST_HAS_CREATED}" != "1" ]]; then
  err "created save point missing from save point list"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/delete" '{"paths":["docs/guide.txt"]}')"
if [[ "${status}" != "200" ]]; then
  err "failed to delete guide after save point: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "post-save-point mutation delete"

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/save-points" '{"message":"Smoke save point after mutation"}')"
if [[ "${status}" != "201" ]]; then
  err "failed to create mutation save point: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "file library mutation save point create"
MUTATION_SAVE_POINT_ID="$(cat "${BODY_FILE}" | json_field "j.id")"
if [[ "${MUTATION_SAVE_POINT_ID}" == "${SAVE_POINT_ID}" ]]; then
  err "mutation save point reused original save point id"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/save-points")"
if [[ "${status}" != "200" ]]; then
  err "failed to list save points before restore: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "file library save point list before restore"
SAVE_POINT_COUNT_BEFORE_RESTORE="$(cat "${BODY_FILE}" | json_field "Array.isArray(j.items) ? String(j.items.length) : ''")"
RESTORE_TRIGGERED_SAVE_POINT_BEFORE="$(cat "${BODY_FILE}" | json_field "Array.isArray(j.items) && j.items.some((item) => /restore|preview|current state|fence/i.test(String(item.message || ''))) ? '1' : ''" || true)"
if [[ "${RESTORE_TRIGGERED_SAVE_POINT_BEFORE}" == "1" ]]; then
  err "save point list already contains restore-triggered internal-looking save point before direct restore"
  cat "${BODY_FILE}" >&2
  exit 1
fi

RESTORE_IDEMPOTENCY_KEY="file-library-smoke-restore-${LIBRARY_ID}-${SAVE_POINT_ID}"
status="$(api_json_with_idempotency POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/restore" "${RESTORE_IDEMPOTENCY_KEY}" "{\"save_point_id\":\"${SAVE_POINT_ID}\"}")"
if [[ "${status}" != "200" ]]; then
  err "failed to start direct restore: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "file library direct restore"
RESTORE_OPERATION_ID="$(cat "${BODY_FILE}" | json_field "j.id")"
RESTORE_OPERATION_STATUS="$(cat "${BODY_FILE}" | json_field "j.status" || true)"
RESTORE_OPERATION_SOURCE_SAVE_POINT_ID="$(cat "${BODY_FILE}" | json_field "j.source_save_point_id" || true)"
if [[ "${RESTORE_OPERATION_SOURCE_SAVE_POINT_ID}" != "${SAVE_POINT_ID}" ]]; then
  err "direct restore operation did not reference the requested save point"
  cat "${BODY_FILE}" >&2
  exit 1
fi
if [[ "${RESTORE_OPERATION_STATUS}" == "pending" || "${RESTORE_OPERATION_STATUS}" == "restoring" ]]; then
  wait_restore_operation_terminal "${RESTORE_OPERATION_ID}"
elif [[ "${RESTORE_OPERATION_STATUS}" != "succeeded" ]]; then
  err "direct restore returned unexpected status: ${RESTORE_OPERATION_STATUS}"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/save-points")"
if [[ "${status}" != "200" ]]; then
  err "failed to list save points after restore: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "file library save point list after restore"
SAVE_POINT_COUNT_AFTER_RESTORE="$(cat "${BODY_FILE}" | json_field "Array.isArray(j.items) ? String(j.items.length) : ''")"
if [[ "${SAVE_POINT_COUNT_AFTER_RESTORE}" != "${SAVE_POINT_COUNT_BEFORE_RESTORE}" ]]; then
  err "direct restore changed save point count; possible restore-triggered save point"
  cat "${BODY_FILE}" >&2
  exit 1
fi
RESTORE_TRIGGERED_SAVE_POINT_AFTER="$(cat "${BODY_FILE}" | json_field "Array.isArray(j.items) && j.items.some((item) => /restore|preview|current state|fence/i.test(String(item.message || ''))) ? '1' : ''" || true)"
if [[ "${RESTORE_TRIGGERED_SAVE_POINT_AFTER}" == "1" ]]; then
  err "direct restore created an internal-looking save point"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(curl -sS -D "${HEADERS_FILE}" -o "${DOWNLOAD_FILE}" -w '%{http_code}' \
  -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
  "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/download?path=$(node -p "encodeURIComponent('docs/guide.txt')")")"
if [[ "${status}" != "200" ]]; then
  err "failed to download restored file: ${status}"
  cat "${DOWNLOAD_FILE}" >&2 || true
  exit 1
fi
if ! grep -q 'hello from file-library smoke' "${DOWNLOAD_FILE}"; then
  err "restored file content mismatch"
  cat "${DOWNLOAD_FILE}" >&2 || true
  exit 1
fi

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/task-file-templates" "{\"name\":\"Smoke task file template\",\"source_library_id\":\"${LIBRARY_ID}\"}")"
if [[ "${status}" != "201" ]]; then
  err "failed to create task file template: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "task file template create"
TASK_FILE_TEMPLATE_ID="$(cat "${BODY_FILE}" | json_field "j.id")"

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/task-file-templates/${TASK_FILE_TEMPLATE_ID}/publish")"
if [[ "${status}" != "200" ]]; then
  err "failed to publish task file template: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "task file template publish"

status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/task-file-templates")"
if [[ "${status}" != "200" ]]; then
  err "failed to list task file templates: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "task file template list"
TASK_FILE_TEMPLATE_LIST_HAS_PUBLISHED="$(cat "${BODY_FILE}" | json_field "Array.isArray(j.items) && j.items.some((item) => item.id === '${TASK_FILE_TEMPLATE_ID}' && item.status === 'published') ? '1' : ''" || true)"
if [[ "${TASK_FILE_TEMPLATE_LIST_HAS_PUBLISHED}" != "1" ]]; then
  err "published task file template missing from template list"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/tasks" "{\"title\":\"Smoke task from file template\",\"workspace_mode\":\"use_template\",\"task_file_template_id\":\"${TASK_FILE_TEMPLATE_ID}\"}")"
if [[ "${status}" != "201" ]]; then
  err "failed to create task from task file template: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "task create from task file template"
TEMPLATE_TASK_ID="$(cat "${BODY_FILE}" | json_field "j.id")"
TEMPLATE_LIBRARY_ID="$(cat "${BODY_FILE}" | json_field "j.workspace_file_library_id")"
if [[ -z "${TEMPLATE_LIBRARY_ID}" || "${TEMPLATE_LIBRARY_ID}" == "${LIBRARY_ID}" ]]; then
  err "task file template clone did not create an independent file library"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${TEMPLATE_LIBRARY_ID}/entries?path=docs/")"
if [[ "${status}" != "200" ]]; then
  err "failed to list cloned task file library entries: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "cloned task file library entries"
if ! grep -q 'guide.txt' "${BODY_FILE}"; then
  err "cloned task file library is missing template source file"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/move" '{"from_path":"docs/guide.txt","to_path":"docs/guide-renamed.txt"}')"
if [[ "${status}" != "204" ]]; then
  err "failed to move file: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(curl -sS -D "${HEADERS_FILE}" -o "${BODY_FILE}" -w '%{http_code}' \
  -X DELETE \
  -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
  "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}")"
if [[ "${status}" != "409" ]]; then
  err "expected non-empty library delete to fail with 409, got ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "non-empty file library delete conflict"

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/delete" '{"paths":["docs/guide-renamed.txt","docs/"]}')"
if [[ "${status}" != "200" ]]; then
  err "failed to delete uploaded artifacts: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
assert_no_raw_storage_fields "file library delete entries"

delete_empty_library_when_terminal

LIBRARY_ID=""
info "real smoke passed"
