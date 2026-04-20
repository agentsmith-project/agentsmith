#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
resolve_loopback_runtime_stack
API_PORT="${INTEGRATION_API_PORT:-${API_PORT:-20000}}"
API_BASE="${API_BASE:-${RUNTIME_HOST_API_BASE_URL}}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-${KEYCLOAK_URL:-${RUNTIME_HOST_KEYCLOAK_BASE_URL}}}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
MBOS_DEV_USERNAME="${MBOS_DEV_USERNAME:-dev-admin}"
MBOS_DEV_PASSWORD="${MBOS_DEV_PASSWORD:-dev-admin-123}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
PROJECT_ID="${PROJECT_ID:-}"
PROJECT_CREATED="0"
PUBLIC_WEB_BASE_URL="${PUBLIC_WEB_BASE_URL:-}"
CLIENT_PUBLIC_POSTGRES_HOST="${CLIENT_PUBLIC_POSTGRES_HOST:-}"
CLIENT_PUBLIC_POSTGRES_PORT="${CLIENT_PUBLIC_POSTGRES_PORT:-}"
CLIENT_PUBLIC_MINIO_ENDPOINT="${CLIENT_PUBLIC_MINIO_ENDPOINT:-}"
HOST_LOCAL_POSTGRES_HOST="${HOST_LOCAL_POSTGRES_HOST:-}"
HOST_LOCAL_MINIO_ENDPOINT="${HOST_LOCAL_MINIO_ENDPOINT:-}"
EXTERNAL_DEPS_POSTGRES_IP="${EXTERNAL_DEPS_POSTGRES_IP:-}"
EXTERNAL_DEPS_MINIO_IP="${EXTERNAL_DEPS_MINIO_IP:-}"
FILE_LIBRARY_VERIFY_FORBIDDEN_HOSTS="${FILE_LIBRARY_VERIFY_FORBIDDEN_HOSTS:-}"
FILE_LIBRARY_VERIFY_ALLOW_PRIVATE_CLIENT_IPS_WITH_PUBLIC_WEB="${FILE_LIBRARY_VERIFY_ALLOW_PRIVATE_CLIENT_IPS_WITH_PUBLIC_WEB:-0}"
FILE_LIBRARY_VERIFY_ENFORCE_DEPLOY_CLIENT_TRUTH="${FILE_LIBRARY_VERIFY_ENFORCE_DEPLOY_CLIENT_TRUTH:-0}"

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

parse_url_field() {
  local raw="$1"
  local field="$2"
  python3 - "${raw}" "${field}" <<'PY'
from urllib.parse import urlparse
import sys

raw = sys.argv[1]
field = sys.argv[2]
parsed = urlparse(raw)
value = {
    "host": parsed.hostname or "",
    "port": "" if parsed.port is None else str(parsed.port),
    "scheme": parsed.scheme or "",
}.get(field, "")
sys.stdout.write(value)
PY
}

is_loopback_or_special_host() {
  local host="${1,,}"
  [[ -z "${host}" ]] && return 1
  case "${host}" in
    localhost|127.*|::1|host.docker.internal|postgres|minio|api|keycloak|universal-proxy)
      return 0
      ;;
  esac
  return 1
}

is_client_local_alias_host() {
  local host="${1,,}"
  [[ -z "${host}" ]] && return 1
  case "${host}" in
    localhost|127.*|::1|host.docker.internal)
      return 0
      ;;
  esac
  return 1
}

is_container_only_host() {
  local host="${1,,}"
  [[ -z "${host}" ]] && return 1
  case "${host}" in
    postgres|minio|api|keycloak|universal-proxy|*.svc|*.svc.cluster.local)
      return 0
      ;;
  esac
  return 1
}

is_private_ipv4() {
  python3 - "${1}" <<'PY'
import ipaddress
import sys

try:
    ip = ipaddress.ip_address(sys.argv[1])
except ValueError:
    raise SystemExit(1)
if ip.version != 4 or not ip.is_private:
    raise SystemExit(1)
PY
}

validate_client_mount_access() {
  local metadata_url="$1"
  local storage_bucket_url="$2"
  local metadata_host metadata_port storage_host storage_port public_web_host
  metadata_host="$(parse_url_field "${metadata_url}" host)"
  metadata_port="$(parse_url_field "${metadata_url}" port)"
  storage_host="$(parse_url_field "${storage_bucket_url}" host)"
  storage_port="$(parse_url_field "${storage_bucket_url}" port)"
  public_web_host="$(parse_url_field "${PUBLIC_WEB_BASE_URL:-}" host)"

  [[ -n "${metadata_host}" ]] || { err "client mount access missing metadata_url host"; exit 1; }
  [[ -n "${storage_host}" ]] || { err "client mount access missing storage_bucket_url host"; exit 1; }

  if [[ -n "${CLIENT_PUBLIC_POSTGRES_HOST}" && "${metadata_host}" != "${CLIENT_PUBLIC_POSTGRES_HOST}" ]]; then
    err "client mount metadata host mismatch: expected ${CLIENT_PUBLIC_POSTGRES_HOST}, got ${metadata_host}"
    exit 1
  fi
  if [[ -n "${CLIENT_PUBLIC_POSTGRES_PORT}" && "${metadata_port}" != "${CLIENT_PUBLIC_POSTGRES_PORT}" ]]; then
    err "client mount metadata port mismatch: expected ${CLIENT_PUBLIC_POSTGRES_PORT}, got ${metadata_port}"
    exit 1
  fi
  if [[ -n "${CLIENT_PUBLIC_MINIO_ENDPOINT}" ]]; then
    local expected_storage_host expected_storage_port
    expected_storage_host="$(parse_url_field "${CLIENT_PUBLIC_MINIO_ENDPOINT}" host)"
    expected_storage_port="$(parse_url_field "${CLIENT_PUBLIC_MINIO_ENDPOINT}" port)"
    if [[ -n "${expected_storage_host}" && "${storage_host}" != "${expected_storage_host}" ]]; then
      err "client mount storage host mismatch: expected ${expected_storage_host}, got ${storage_host}"
      exit 1
    fi
    if [[ -n "${expected_storage_port}" && "${storage_port}" != "${expected_storage_port}" ]]; then
      err "client mount storage port mismatch: expected ${expected_storage_port}, got ${storage_port}"
      exit 1
    fi
  fi

  local forbidden_hosts=(
    "${HOST_LOCAL_POSTGRES_HOST}"
    "${EXTERNAL_DEPS_POSTGRES_IP}"
    "${EXTERNAL_DEPS_MINIO_IP}"
    "$(parse_url_field "${HOST_LOCAL_MINIO_ENDPOINT:-}" host)"
  )
  if [[ -n "${FILE_LIBRARY_VERIFY_FORBIDDEN_HOSTS}" ]]; then
    while IFS= read -r item; do
      [[ -n "${item}" ]] && forbidden_hosts+=("${item}")
    done < <(printf '%s' "${FILE_LIBRARY_VERIFY_FORBIDDEN_HOSTS}" | tr ', ' '\n\n' | sed '/^$/d')
  fi

  if ! is_client_local_alias_host "${public_web_host}"; then
    if is_loopback_or_special_host "${metadata_host}" || is_loopback_or_special_host "${storage_host}"; then
      err "client mount access leaked a loopback or internal-only host: metadata=${metadata_host} storage=${storage_host}"
      exit 1
    fi
  fi

  if is_container_only_host "${metadata_host}" || is_container_only_host "${storage_host}"; then
    err "client mount access leaked a container-only host: metadata=${metadata_host} storage=${storage_host}"
    exit 1
  fi

  for forbidden in "${forbidden_hosts[@]}"; do
    [[ -z "${forbidden}" ]] && continue
    if is_client_local_alias_host "${public_web_host}" && is_client_local_alias_host "${forbidden}"; then
      continue
    fi
    if [[ "${metadata_host}" == "${forbidden}" || "${storage_host}" == "${forbidden}" ]]; then
      err "client mount access leaked an internal deployment address: ${forbidden}"
      exit 1
    fi
  done

  if [[ "${FILE_LIBRARY_VERIFY_ALLOW_PRIVATE_CLIENT_IPS_WITH_PUBLIC_WEB}" != "1" ]] \
    && [[ -n "${public_web_host}" ]] \
    && ! is_client_local_alias_host "${public_web_host}" \
    && ! is_private_ipv4 "${public_web_host}" >/dev/null 2>&1; then
    if is_private_ipv4 "${metadata_host}" || is_private_ipv4 "${storage_host}"; then
      err "client mount access uses a private IP while PUBLIC_WEB_BASE_URL is not private; this usually means client-facing storage addresses are wrong"
      exit 1
    fi
  fi
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
CLIENT_METADATA_URL="$(cat "${BODY_FILE}" | json_field "j.client_mount_access && j.client_mount_access.metadata_url ? j.client_mount_access.metadata_url : ''" || true)"
CLIENT_STORAGE_BUCKET_URL="$(cat "${BODY_FILE}" | json_field "j.client_mount_access && j.client_mount_access.storage_bucket_url ? j.client_mount_access.storage_bucket_url : ''" || true)"
[[ -n "${CLIENT_METADATA_URL}" ]] || { err "mount credential exchange missing client_mount_access.metadata_url"; cat "${BODY_FILE}" >&2; exit 1; }
[[ -n "${CLIENT_STORAGE_BUCKET_URL}" ]] || { err "mount credential exchange missing client_mount_access.storage_bucket_url"; cat "${BODY_FILE}" >&2; exit 1; }
if grep -q 'access_key' "${BODY_FILE}"; then
  err "credential exchange leaked backend storage credentials"
  exit 1
fi
if [[ "${FILE_LIBRARY_VERIFY_ENFORCE_DEPLOY_CLIENT_TRUTH}" == "1" ]]; then
  validate_client_mount_access "${CLIENT_METADATA_URL}" "${CLIENT_STORAGE_BUCKET_URL}"
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
ROOT_HAS_DOCS_FOLDER="$(cat "${BODY_FILE}" | json_field "Array.isArray(j.items) && j.items.some((item) => item.kind === 'directory' && item.path === 'docs/' && item.name === 'docs') ? '1' : ''" || true)"
if [[ "${ROOT_HAS_DOCS_FOLDER}" != "1" ]]; then
  err "new docs folder missing from root entries immediately after create"
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
SHARE_LINK_URL="$(cat "${BODY_FILE}" | json_field "j.url" || true)"
[[ -n "${SHARE_LINK_URL}" ]] || { err "share link response missing url"; cat "${BODY_FILE}" >&2; exit 1; }

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
