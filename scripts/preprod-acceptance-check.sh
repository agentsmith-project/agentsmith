#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:20000/api/v1}"
WEB_BASE="${WEB_BASE:-http://localhost:3001}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
PROJECT_ID="${PROJECT_ID:-proj_placeholder}"
TASK_ID="${TASK_ID:-task_placeholder}"
TOKEN="${TOKEN:-}"

info() { echo "[preprod-check] $*"; }
err() { echo "[preprod-check] ERROR: $*" >&2; }

check_http_code() {
  local name="$1"
  local url="$2"
  local expected_csv="$3"
  local method="${4:-GET}"
  local data="${5:-}"
  local auth_header=()
  if [[ -n "${TOKEN}" ]]; then
    auth_header=(-H "Authorization: Bearer ${TOKEN}")
  fi
  local code
  if [[ -n "${data}" ]]; then
    code="$(curl -sS -o /dev/null -w "%{http_code}" -X "${method}" "${url}" "${auth_header[@]}" -H "Content-Type: application/json" -d "${data}")"
  else
    code="$(curl -sS -o /dev/null -w "%{http_code}" -X "${method}" "${url}" "${auth_header[@]}")"
  fi
  IFS=',' read -r -a expected <<< "${expected_csv}"
  for item in "${expected[@]}"; do
    if [[ "${code}" == "${item}" ]]; then
      info "${name}: HTTP ${code} (OK)"
      return 0
    fi
  done
  err "${name}: HTTP ${code} (expected one of: ${expected_csv})"
  return 1
}

main() {
  info "API_BASE=${API_BASE}"
  info "WEB_BASE=${WEB_BASE}"
  info "WORKSPACE_ID=${WORKSPACE_ID}"
  info "PROJECT_ID=${PROJECT_ID}"
  info "TASK_ID=${TASK_ID}"

  check_http_code "openapi" "${API_BASE}/openapi.json" "200"
  check_http_code "web-login" "${WEB_BASE}/zh-CN/login" "200,307,308"

  # Route existence / auth hardening check for the new cancel endpoint.
  # Without a valid token this should be auth-denied (401/403), not path-missing (404).
  check_http_code \
    "task-cancel-route" \
    "${API_BASE}/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/tasks/${TASK_ID}/cancel" \
    "200,202,401,403,409" \
    "POST" \
    "{}"

  if [[ -n "${TOKEN}" ]]; then
    check_http_code "me-profile" "${API_BASE}/me" "200"
  else
    info "TOKEN not provided, skip authenticated /me check"
  fi

  info "preprod acceptance check PASS"
}

main "$@"
