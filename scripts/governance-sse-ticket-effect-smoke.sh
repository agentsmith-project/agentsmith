#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
ensure_backend_real_state

PORT_API="${PORT_API:-20000}"
OWNER_TOKEN_FILE="${OWNER_TOKEN_FILE:-$(backend_real_token_file)}"
ticket_file=""
request_check_file=""
query_token_check_file=""

info() { echo "[gov-sse-ticket-smoke] $*"; }
err() { echo "[gov-sse-ticket-smoke] ERROR: $*" >&2; }

require_file() {
  local path="$1"
  [[ -f "${path}" ]] || { err "missing file: ${path}"; return 1; }
}

json_get() {
  local script="$1"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); ${script}"
}

main() {
  require_file "${OWNER_TOKEN_FILE}"

  local token
  token="$(cat "${OWNER_TOKEN_FILE}")"
  [[ -n "${token}" ]] || {
    err "owner token file is empty"
    exit 1
  }

  local base="http://localhost:${PORT_API}/api/v1"
  ticket_file="$(mktemp)"
  request_check_file="$(mktemp)"
  query_token_check_file="$(mktemp)"
  trap 'rm -f "${ticket_file:-}" "${request_check_file:-}" "${query_token_check_file:-}"' EXIT

  info "requesting opaque sse ticket"
  local ticket_code
  ticket_code="$(
    curl -sS -o "${ticket_file}" -w '%{http_code}' \
      -X POST "${base}/sse-ticket" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${ticket_code}" != "200" ]]; then
    err "sse-ticket exchange failed (HTTP ${ticket_code})"
    cat "${ticket_file}" >&2 || true
    exit 1
  fi

  local issued_ticket sso_url
  issued_ticket="$(cat "${ticket_file}" | json_get 'process.stdout.write(String(data.ticket||""))' || true)"
  sso_url="$(cat "${ticket_file}" | json_get 'process.stdout.write(String(data.sso_url||""))' || true)"
  [[ -n "${issued_ticket}" ]] || {
    err "ticket response missing ticket"
    cat "${ticket_file}" >&2 || true
    exit 1
  }
  [[ "${issued_ticket}" =~ ^sse_ ]] || {
    err "ticket is not opaque sse_* value: ${issued_ticket}"
    exit 1
  }
  [[ "${issued_ticket}" != "${token}" ]] || {
    err "ticket unexpectedly equals bearer token"
    exit 1
  }
  [[ "${sso_url}" == *"/api/v1/events?ticket="* ]] || {
    err "sso_url does not point to ticket-based events endpoint"
    cat "${ticket_file}" >&2 || true
    exit 1
  }

  info "verifying ticket query is rejected on non-sse routes"
  local request_check_code
  request_check_code="$(
    curl -sS -o "${request_check_file}" -w '%{http_code}' \
      "${base}/me/notifications?ticket=${issued_ticket}" || true
  )"
  if [[ "${request_check_code}" != "401" ]]; then
    err "expected 401 for non-sse ticket query, got HTTP ${request_check_code}"
    cat "${request_check_file}" >&2 || true
    exit 1
  fi

  info "verifying query-token fallback is disabled"
  local query_token_code
  query_token_code="$(
    curl -sS -o "${query_token_check_file}" -w '%{http_code}' \
      "${base}/me/notifications?token=${token}" || true
  )"
  if [[ "${query_token_code}" != "401" ]]; then
    err "expected 401 for query-token fallback, got HTTP ${query_token_code}"
    cat "${query_token_check_file}" >&2 || true
    exit 1
  fi

  info "SSE ticket hardening verified"
}

main "$@"
