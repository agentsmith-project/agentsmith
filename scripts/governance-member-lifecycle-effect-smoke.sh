#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

PORT_API="${PORT_API:-20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
OWNER_TOKEN_FILE="${OWNER_TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
BASE_URL="${BASE_URL:-http://localhost:3001}"
LOCALE="${LOCALE:-zh-CN}"

MEMBER_USERNAME="${MEMBER_USERNAME:-integration-user}"
MEMBER_PASSWORD="${MEMBER_PASSWORD:-integration-user-123}"

info() { echo "[gov-member-lifecycle-smoke] $*"; }
err() { echo "[gov-member-lifecycle-smoke] ERROR: $*" >&2; }

require_file() {
  local path="$1"
  [[ -f "${path}" ]] || { err "missing file: ${path}"; return 1; }
}

token_is_valid() {
  local token="$1"
  [[ -n "${token}" ]] || return 1
  local code
  code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      "${KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/userinfo" \
      -H "Authorization: Bearer ${token}" 2>/dev/null || true
  )"
  [[ "${code}" == "200" ]]
}

jwt_claim() {
  local token="$1"
  local claim="$2"
  node -e 'const t=process.argv[1]||""; const k=process.argv[2]||""; try { const p=JSON.parse(Buffer.from(String(t).split(".")[1]||"", "base64url").toString("utf8")); const v=p?.[k]; process.stdout.write(v == null ? "" : String(v)); } catch { process.stdout.write(""); }' \
    "${token}" "${claim}"
}

json_get() {
  local script="$1"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); ${script}"
}

refresh_member_token() {
  local out_file="$1"
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
    BASE_URL="${BASE_URL}" \
    LOCALE="${LOCALE}" \
    USERNAME="${MEMBER_USERNAME}" \
    PASSWORD="${MEMBER_PASSWORD}" \
    TOKEN_OUT_FILE="${out_file}" \
    node ./scripts/notebook-agent-refresh-token.js >/dev/null
}

ensure_membership_active() {
  local membership_url="$1"
  local owner_token="$2"
  local out_file
  out_file="$(mktemp)"
  local code
  code="$(
    curl -sS -o "${out_file}" -w '%{http_code}' \
      -X PATCH "${membership_url}" \
      -H "Authorization: Bearer ${owner_token}" \
      -H "Content-Type: application/json" \
      --data '{"status":"active"}' || true
  )"
  rm -f "${out_file}"
  [[ "${code}" == "204" ]]
}

main() {
  require_file "${OWNER_TOKEN_FILE}"
  require_file /tmp/agentsmith_project_id.txt

  local owner_token project_id
  owner_token="$(cat "${OWNER_TOKEN_FILE}")"
  project_id="$(cat /tmp/agentsmith_project_id.txt)"
  [[ -n "${owner_token}" && -n "${project_id}" ]] || {
    err "required owner token/project metadata is empty"
    exit 1
  }
  if ! token_is_valid "${owner_token}"; then
    err "owner token invalid/expired; run: BASE_URL=${BASE_URL} make notebook-agent-refresh-token"
    exit 1
  fi

  local member_token_file member_token member_user_id
  member_token_file="$(mktemp)"
  local membership_file members_file patch_file
  membership_file="$(mktemp)"
  members_file="$(mktemp)"
  patch_file="$(mktemp)"
  local removed_member=0
  trap 'rm -f "${member_token_file:-}" "${membership_file:-}" "${members_file:-}" "${patch_file:-}"; if [[ "${removed_member:-0}" == "1" && -n "${membership_url:-}" && -n "${owner_token:-}" ]]; then ensure_membership_active "${membership_url}" "${owner_token}" || true; fi' EXIT

  info "refreshing token for ${MEMBER_USERNAME}"
  refresh_member_token "${member_token_file}"
  member_token="$(cat "${member_token_file}")"
  if ! token_is_valid "${member_token}"; then
    err "member token invalid after refresh"
    exit 1
  fi
  member_user_id="$(jwt_claim "${member_token}" "sub")"
  [[ -n "${member_user_id}" ]] || {
    err "failed to read member user sub from token"
    exit 1
  }
  info "member user id = ${member_user_id}"

  local base="http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}"
  local membership_url="${base}/memberships/${member_user_id}"
  local members_url="${base}/members"

  info "ensuring membership is active"
  if ! ensure_membership_active "${membership_url}" "${owner_token}"; then
    err "failed to activate/bootstrap membership"
    exit 1
  fi

  info "reading current membership"
  local get_code
  get_code="$(
    curl -sS -o "${membership_file}" -w '%{http_code}' \
      "${membership_url}" -H "Authorization: Bearer ${owner_token}" || true
  )"
  if [[ "${get_code}" != "200" ]]; then
    err "failed to read membership (HTTP ${get_code})"
    cat "${membership_file}" >&2 || true
    exit 1
  fi

  info "suspending membership"
  local suspend_code
  suspend_code="$(
    curl -sS -o "${patch_file}" -w '%{http_code}' \
      -X PATCH "${membership_url}" \
      -H "Authorization: Bearer ${owner_token}" \
      -H "Content-Type: application/json" \
      --data '{"status":"suspended"}' || true
  )"
  if [[ "${suspend_code}" != "204" ]]; then
    err "failed to suspend membership (HTTP ${suspend_code})"
    cat "${patch_file}" >&2 || true
    exit 1
  fi

  info "verifying membership status = suspended"
  get_code="$(
    curl -sS -o "${membership_file}" -w '%{http_code}' \
      "${membership_url}" -H "Authorization: Bearer ${owner_token}" || true
  )"
  if [[ "${get_code}" != "200" ]]; then
    err "failed to re-read membership after suspend (HTTP ${get_code})"
    exit 1
  fi
  local status_after_suspend
  status_after_suspend="$(cat "${membership_file}" | json_get 'process.stdout.write(String(data.status||""))' || true)"
  if [[ "${status_after_suspend}" != "suspended" ]]; then
    err "expected suspended status, got ${status_after_suspend}"
    cat "${membership_file}" >&2 || true
    exit 1
  fi

  info "removing membership"
  local delete_code
  delete_code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      -X DELETE "${membership_url}" -H "Authorization: Bearer ${owner_token}" || true
  )"
  if [[ "${delete_code}" != "204" ]]; then
    err "failed to remove membership (HTTP ${delete_code})"
    exit 1
  fi
  removed_member=1

  info "verifying removed user is absent from members list"
  local members_code listed
  members_code="$(
    curl -sS -o "${members_file}" -w '%{http_code}' \
      "${members_url}" -H "Authorization: Bearer ${owner_token}" || true
  )"
  if [[ "${members_code}" != "200" ]]; then
    err "failed to list members (HTTP ${members_code})"
    cat "${members_file}" >&2 || true
    exit 1
  fi
  listed="$(cat "${members_file}" | json_get "const items=Array.isArray(data.items)?data.items:[]; const found=items.some(i=>String(i.id||'')==='${member_user_id}'); process.stdout.write(found?'1':'0');" || true)"
  if [[ "${listed}" == "1" ]]; then
    err "removed member still appears in members list"
    cat "${members_file}" >&2 || true
    exit 1
  fi

  info "restoring membership for environment stability"
  if ! ensure_membership_active "${membership_url}" "${owner_token}"; then
    err "failed to restore membership to active"
    exit 1
  fi
  removed_member=0

  info "OK"
}

main "$@"
