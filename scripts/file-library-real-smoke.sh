#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_BASE="${API_BASE:-http://localhost:20000}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
MBOS_DEV_USERNAME="${MBOS_DEV_USERNAME:-dev-admin}"
MBOS_DEV_PASSWORD="${MBOS_DEV_PASSWORD:-dev-admin-123}"
WORKSPACE_ID="${WORKSPACE_ID:-agentsmith}"
PROJECT_ID="${PROJECT_ID:-test-project}"

TMP_DIR="$(mktemp -d /tmp/agentsmith-filelib-smoke.XXXXXX)"
TOKEN_FILE="${TMP_DIR}/token.txt"
BODY_FILE="${TMP_DIR}/body.json"
HEADERS_FILE="${TMP_DIR}/headers.txt"
UPLOAD_FILE="${TMP_DIR}/guide.txt"
DOWNLOAD_FILE="${TMP_DIR}/download.txt"
LIBRARY_ID=""

info() { echo "[file-library-real-smoke] $*"; }
err() { echo "[file-library-real-smoke] ERROR: $*" >&2; }

cleanup() {
  if [[ -n "${LIBRARY_ID}" && -n "${WORKSPACE_ID}" && -n "${PROJECT_ID}" ]]; then
    curl -sS -o /dev/null -X DELETE \
      -H "Authorization: Bearer $(cat "${TOKEN_FILE}" 2>/dev/null || true)" \
      "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}" || true
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
    err "failed to discover project id"
    exit 1
  fi
}

wait_ready() {
  local tries=0
  while (( tries < 30 )); do
    local status
    status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}")"
    if [[ "${status}" == "200" ]]; then
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
require_cmd juicefs

info "fetching dev token"
REFRESH_TOKEN_FORCE_PASSWORD_GRANT=1 PRINT_TOKEN=1 \
MBOS_DEV_USERNAME="${MBOS_DEV_USERNAME}" \
MBOS_DEV_PASSWORD="${MBOS_DEV_PASSWORD}" \
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
node "${ROOT_DIR}/scripts/notebook-agent-refresh-token.js" > "${TOKEN_FILE}"

discover_workspace
discover_project
info "using workspace=${WORKSPACE_ID} project=${PROJECT_ID}"

local_name="Smoke Library $(date +%s)"
status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries" "{\"name\":\"${local_name}\",\"description\":\"Release smoke library\"}")"
if [[ "${status}" != "201" ]]; then
  err "failed to create file library: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
LIBRARY_ID="$(cat "${BODY_FILE}" | json_field "j.id")"
info "created library ${LIBRARY_ID}"

wait_ready

status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/backend")"
if [[ "${status}" != "200" ]]; then
  err "failed to fetch backend summary: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
if grep -q 'metadata_url' "${BODY_FILE}"; then
  err "backend details leaked metadata_url"
  exit 1
fi

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/storage-credential-exchange")"
if [[ "${status}" != "200" ]]; then
  err "failed to exchange mount credentials: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
if grep -q 'access_key' "${BODY_FILE}"; then
  err "credential exchange leaked backend storage credentials"
  exit 1
fi

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/folders" '{"path":"docs"}')"
if [[ "${status}" != "204" ]]; then
  err "failed to create docs folder: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi

printf 'hello from file-library smoke\n' > "${UPLOAD_FILE}"
status="$(curl -sS -D "${HEADERS_FILE}" -o "${BODY_FILE}" -w '%{http_code}' \
  -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
  -F "prefix=docs/" \
  -F "file=@${UPLOAD_FILE};type=text/plain" \
  "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/upload")"
if [[ "${status}" != "200" && "${status}" != "201" ]]; then
  err "failed to upload file: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(api_json GET "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/entries?path=docs/")"
if [[ "${status}" != "200" ]]; then
  err "failed to list docs entries: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi
if ! grep -q 'guide.txt' "${BODY_FILE}"; then
  err "uploaded file missing from entries"
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

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/share-link" '{"path":"docs/guide.txt"}')"
if [[ "${status}" != "200" ]]; then
  err "failed to create share link: ${status}"
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

status="$(api_json POST "/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}/delete" '{"paths":["docs/guide-renamed.txt","docs/"]}')"
if [[ "${status}" != "200" ]]; then
  err "failed to delete uploaded artifacts: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi

status="$(curl -sS -D "${HEADERS_FILE}" -o "${BODY_FILE}" -w '%{http_code}' \
  -X DELETE \
  -H "Authorization: Bearer $(cat "${TOKEN_FILE}")" \
  "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/file-libraries/${LIBRARY_ID}")"
if [[ "${status}" != "204" ]]; then
  err "failed to delete empty file library: ${status}"
  cat "${BODY_FILE}" >&2
  exit 1
fi

LIBRARY_ID=""
info "real smoke passed"
