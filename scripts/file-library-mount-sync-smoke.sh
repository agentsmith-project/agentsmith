#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${INTEGRATION_API_PORT:-20000}"
API_BASE="${API_BASE:-http://localhost:${API_PORT}}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
MBOS_DEV_USERNAME="${MBOS_DEV_USERNAME:-dev-admin}"
MBOS_DEV_PASSWORD="${MBOS_DEV_PASSWORD:-dev-admin-123}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
PROJECT_ID="${PROJECT_ID:-}"
PROJECT_CREATED="0"

TMP_DIR="$(mktemp -d /tmp/agentsmith-filelib-mount.XXXXXX)"
TOKEN_FILE="${TMP_DIR}/token.txt"
BODY_FILE="${TMP_DIR}/body.json"
HEADERS_FILE="${TMP_DIR}/headers.txt"
UPLOAD_FILE="${TMP_DIR}/from-web.txt"
MOUNT_LOG="${TMP_DIR}/juicefs-mount.log"
MOUNT_POINT="${TMP_DIR}/mount"
LIBRARY_ID=""
MOUNTED="0"

info() { echo "[file-library-mount-sync] $*"; }
err() { echo "[file-library-mount-sync] ERROR: $*" >&2; }

cleanup() {
  if [[ "${MOUNTED}" == "1" ]]; then
    juicefs umount "${MOUNT_POINT}" >/dev/null 2>&1 || juicefs umount -f "${MOUNT_POINT}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${LIBRARY_ID}" && -n "${WORKSPACE_ID}" && -n "${PROJECT_ID}" ]]; then
    curl -sS -o /dev/null -X POST \
      -H "Authorization: Bearer $(cat "${TOKEN_FILE}" 2>/dev/null || true)" \
      -H 'Content-Type: application/json' \
      --data '{"paths":["local-sync/from-local.txt","web-sync/from-web.txt","local-sync/","web-sync/"]}' \
      "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/delete" || true
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
  local discovered
  discovered="$(cat "${BODY_FILE}" | json_field "Array.isArray(j.items) && j.items[0] ? j.items[0].id : ''" || true)"
  PROJECT_ID="${PROJECT_ID:-${discovered}}"
  if [[ -z "${PROJECT_ID}" ]]; then
    info "no existing project found; creating temporary project"
    local create_status
    create_status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects" '{"name":"File Library Mount Sync Project","visibility":"private","join_policy":"approval_required"}')"
    if [[ "${create_status}" != "201" ]]; then
      err "failed to create temporary project: ${create_status}"
      cat "${BODY_FILE}" >&2
      exit 1
    fi
    PROJECT_ID="$(cat "${BODY_FILE}" | json_field "j.id")"
    PROJECT_CREATED="1"
  fi
}

wait_library_ready() {
  for _ in $(seq 1 30); do
    local status
    status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}")"
    if [[ "${status}" == "200" ]]; then
      local library_status
      library_status="$(cat "${BODY_FILE}" | json_field "j.status" || true)"
      if [[ "${library_status}" == "ready" ]]; then return 0; fi
      if [[ "${library_status}" == "failed" ]]; then
        err "library provisioning failed"
        cat "${BODY_FILE}" >&2
        exit 1
      fi
    fi
    sleep 1
  done
  err "timed out waiting for library ready"
  exit 1
}

wait_for_file() {
  local path="$1"
  for _ in $(seq 1 20); do
    local parent
    parent="$(dirname "${path}")"
    ls -la "${parent}" >/dev/null 2>&1 || true
    [[ -f "${path}" ]] && return 0
    sleep 1
  done
  return 1
}

wait_entries_contains() {
  local path="$1"
  local needle="$2"
  for _ in $(seq 1 20); do
    local status
    status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/entries?path=$(node -p "encodeURIComponent('${path}')")")"
    if [[ "${status}" == "200" ]] && grep -q "${needle}" "${BODY_FILE}"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

require_cmd curl
require_cmd node
require_cmd juicefs

REFRESH_TOKEN_FORCE_PASSWORD_GRANT=1 PRINT_TOKEN=1 \
MBOS_DEV_USERNAME="${MBOS_DEV_USERNAME}" \
MBOS_DEV_PASSWORD="${MBOS_DEV_PASSWORD}" \
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
node "${ROOT_DIR}/scripts/notebook-agent-refresh-token.js" > "${TOKEN_FILE}"

discover_workspace
discover_project
mkdir -p "${MOUNT_POINT}"

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries" "{\"name\":\"Mount Sync $(date +%s)\",\"description\":\"Mount sync smoke\"}")"
if [[ "${status}" != "201" ]]; then
  err "failed to create file library: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
LIBRARY_ID="$(cat "${BODY_FILE}" | json_field "j.id")"
wait_library_ready

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/storage-credential-exchange")"
if [[ "${status}" != "200" ]]; then
  err "failed to exchange mount credentials: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
METADATA_URL="$(cat "${BODY_FILE}" | json_field "j.client_mount_access.metadata_url")"
STORAGE_BUCKET_URL="$(cat "${BODY_FILE}" | json_field "j.client_mount_access.storage_bucket_url")"
MOUNT_ARGS=(mount "${METADATA_URL}" "${MOUNT_POINT}" -d --log "${MOUNT_LOG}" --check-storage --attr-cache 0 --entry-cache 0 --dir-entry-cache 0)
if [[ -n "${STORAGE_BUCKET_URL}" ]]; then
  MOUNT_ARGS+=(--bucket "${STORAGE_BUCKET_URL}")
fi

info "mounting ${LIBRARY_ID} at ${MOUNT_POINT}"
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy -u NO_PROXY -u no_proxy \
  juicefs "${MOUNT_ARGS[@]}" >/dev/null 2>&1
MOUNTED="1"

mkdir -p "${MOUNT_POINT}/local-sync"
printf 'hello-from-local\n' > "${MOUNT_POINT}/local-sync/from-local.txt"

if ! wait_entries_contains "local-sync/" 'from-local.txt'; then
  err "web entries never observed local file"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/folders" '{"path":"web-sync"}')"
if [[ "${status}" != "204" ]]; then
  err "failed to create web-sync folder: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi

printf 'hello-from-web\n' > "${UPLOAD_FILE}"
status="$(curl -sS -D "${HEADERS_FILE}" -o "${BODY_FILE}" -w '%{http_code}' \
  -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
  -F "prefix=web-sync/" \
  -F "file=@${UPLOAD_FILE};type=text/plain" \
  "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/upload")"
if [[ "${status}" != "200" && "${status}" != "201" ]]; then
  err "failed to upload web file: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi

if ! wait_for_file "${MOUNT_POINT}/web-sync/from-web.txt"; then
  err "local mount never observed web-uploaded file"
  [[ -f "${MOUNT_LOG}" ]] && cat "${MOUNT_LOG}" >&2
  exit 1
fi

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/delete" '{"paths":["web-sync/from-web.txt"]}')"
if [[ "${status}" != "200" ]]; then
  err "failed to delete web file via API: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi

for _ in $(seq 1 20); do
  [[ ! -f "${MOUNT_POINT}/web-sync/from-web.txt" ]] && break
  sleep 1
done
if [[ -f "${MOUNT_POINT}/web-sync/from-web.txt" ]]; then
  err "local mount still sees deleted web file"
  exit 1
fi

rm -f "${MOUNT_POINT}/local-sync/from-local.txt"
sleep 1
status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/entries?path=local-sync/")"
if [[ "${status}" != "200" ]]; then
  err "failed to list local-sync entries: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
if grep -q 'from-local.txt' "${BODY_FILE}"; then
  err "web entries still see deleted local file"
  cat "${BODY_FILE}" >&2
  exit 1
fi

info "unmounting ${MOUNT_POINT}"
juicefs umount "${MOUNT_POINT}" >/dev/null
MOUNTED="0"

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/delete" '{"paths":["local-sync/","web-sync/"]}')"
if [[ "${status}" != "200" ]]; then
  err "failed to delete sync folders: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(curl -sS -D "${HEADERS_FILE}" -o "${BODY_FILE}" -w '%{http_code}' \
  -X DELETE \
  -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
  "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}")"
if [[ "${status}" != "204" ]]; then
  err "failed to delete synced file library: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
LIBRARY_ID=""

info "mount sync smoke passed"
