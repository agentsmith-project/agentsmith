#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
ensure_backend_real_state

PORT_API="${PORT_API:-20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
OWNER_TOKEN_FILE="${OWNER_TOKEN_FILE:-$(backend_real_token_file)}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
BASE_URL="${BASE_URL:-http://localhost:3001}"
LOCALE="${LOCALE:-zh-CN}"

MEMBER_USERNAME="${MEMBER_USERNAME:-integration-user}"
MEMBER_PASSWORD="${MEMBER_PASSWORD:-integration-user-123}"
MEMBER_USER_ID="${MEMBER_USER_ID:-$(state_get governance.member_user_id)}"

info() { echo "[gov-member-perm-smoke] $*"; }
err() { echo "[gov-member-perm-smoke] ERROR: $*" >&2; }

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
    REFRESH_TOKEN_READ_APP_SESSION=0 \
    BASE_URL="${BASE_URL}" \
    LOCALE="${LOCALE}" \
    USERNAME="${MEMBER_USERNAME}" \
    PASSWORD="${MEMBER_PASSWORD}" \
    TOKEN_OUT_FILE="${out_file}" \
    node ./scripts/agent-runner-refresh-token.js >/dev/null
}

main() {
  require_file "${OWNER_TOKEN_FILE}"

  local owner_token project_id
  owner_token="$(cat "${OWNER_TOKEN_FILE}")"
  project_id="$(state_get project.id)"
  [[ -n "${owner_token}" && -n "${project_id}" ]] || {
    err "required owner token/project metadata is empty"
    exit 1
  }
  if ! token_is_valid "${owner_token}"; then
    err "owner token invalid/expired; run: BASE_URL=${BASE_URL} make agent-runner-refresh-token"
    exit 1
  fi

  local member_token_file member_token
  member_token_file="$(mktemp)"
  local join_resp_file list_join_file denied_file allowed_file patch_file get_perms_file restore_file
  join_resp_file="$(mktemp)"
  list_join_file="$(mktemp)"
  denied_file="$(mktemp)"
  allowed_file="$(mktemp)"
  patch_file="$(mktemp)"
  get_perms_file="$(mktemp)"
  restore_file="$(mktemp)"
  local member_user_id="" original_permissions_json=""
  trap 'rm -f "${member_token_file:-}" "${join_resp_file:-}" "${list_join_file:-}" "${denied_file:-}" "${allowed_file:-}" "${patch_file:-}" "${get_perms_file:-}" "${restore_file:-}"; if [[ -n "${owner_token:-}" && -n "${member_user_id:-}" && -n "${project_id:-}" && -f "${restore_file:-}" ]]; then curl -sS -o /dev/null -w "%{http_code}" -X PATCH "http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}/members/${member_user_id}/permissions" -H "Authorization: Bearer ${owner_token}" -H "Content-Type: application/json" --data-binary @"${restore_file}" >/dev/null || true; fi' EXIT

  info "refreshing token for ${MEMBER_USERNAME}"
  refresh_member_token "${member_token_file}"
  member_token="$(cat "${member_token_file}")"
  if ! token_is_valid "${member_token}"; then
    err "member token invalid after refresh"
    exit 1
  fi
  member_user_id="${MEMBER_USER_ID:-$(jwt_claim "${member_token}" "sub")}"
  if [[ -z "${member_user_id}" ]]; then
    err "failed to read member user sub from token"
    exit 1
  fi
  state_set_string governance.member_user_id "${member_user_id}"
  info "member user id = ${member_user_id}"

  local base="http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}"
  local join_requests_url="${base}/join-requests"
  local member_perms_url="${base}/members/${member_user_id}/permissions"
  local perm_templates_url="${base}/permission-templates"

  info "ensuring membership exists (create/approve join request if needed)"
  local join_create_code
  join_create_code="$(
    curl -sS -o "${join_resp_file}" -w '%{http_code}' \
      -X POST "${join_requests_url}" \
      -H "Authorization: Bearer ${member_token}" \
      -H "Content-Type: application/json" \
      --data '{"reason":"permission-effect-smoke"}' || true
  )"
  if [[ "${join_create_code}" == "201" ]]; then
    local join_id approve_code
    join_id="$(cat "${join_resp_file}" | json_get 'process.stdout.write(String(data.id||""))' || true)"
    if [[ -z "${join_id}" ]]; then
      err "join request created but response missing id"
      cat "${join_resp_file}" >&2 || true
      exit 1
    fi
    approve_code="$(
      curl -sS -o /dev/null -w '%{http_code}' \
        -X POST "${join_requests_url}/${join_id}/approve" \
        -H "Authorization: Bearer ${owner_token}" \
        -H "Content-Type: application/json" \
        --data '{}' || true
    )"
    if [[ "${approve_code}" != "204" ]]; then
      err "failed to approve join request (HTTP ${approve_code})"
      exit 1
    fi
    info "join request approved"
  elif [[ "${join_create_code}" == "409" || "${join_create_code}" == "422" || "${join_create_code}" == "403" ]]; then
    # 409 pending, 422 owner/self rule in some envs, 403 if already restricted; continue with current state.
    info "join request create returned HTTP ${join_create_code}; continuing"
    if [[ "${join_create_code}" == "409" ]]; then
      local list_code pending_join_id approve_code
      list_code="$(
        curl -sS -o "${list_join_file}" -w '%{http_code}' \
          "${join_requests_url}" -H "Authorization: Bearer ${owner_token}" || true
      )"
      if [[ "${list_code}" == "200" ]]; then
        pending_join_id="$(cat "${list_join_file}" | json_get "const items=Array.isArray(data.items)?data.items:data; const found=(Array.isArray(items)?items:[]).find(i=>String(i.user_id||'')==='${member_user_id}'&&String(i.status||'')==='pending'); process.stdout.write(String(found?.id||''));" || true)"
        if [[ -n "${pending_join_id}" ]]; then
          approve_code="$(
            curl -sS -o /dev/null -w '%{http_code}' \
              -X POST "${join_requests_url}/${pending_join_id}/approve" \
              -H "Authorization: Bearer ${owner_token}" \
              -H "Content-Type: application/json" \
              --data '{}' || true
          )"
          [[ "${approve_code}" == "204" ]] && info "existing pending join request approved"
        fi
      fi
    fi
  else
    err "unexpected join request create response HTTP ${join_create_code}"
    cat "${join_resp_file}" >&2 || true
    exit 1
  fi

  info "reading current member permissions for restore"
  local get_perms_code
  get_perms_code="$(
    curl -sS -o "${get_perms_file}" -w '%{http_code}' \
      "${member_perms_url}" -H "Authorization: Bearer ${owner_token}" || true
  )"
  if [[ "${get_perms_code}" != "200" ]]; then
    err "failed to read member permissions (HTTP ${get_perms_code})"
    cat "${get_perms_file}" >&2 || true
    exit 1
  fi
  original_permissions_json="$(cat "${get_perms_file}" | json_get 'process.stdout.write(JSON.stringify(Array.isArray(data.platform_permissions)?data.platform_permissions:[]))')"
  printf '{"mode":"custom","permissions":%s}\n' "${original_permissions_json}" > "${restore_file}"

  info "forcing member permissions to empty custom set (expect deny)"
  local patch_empty_code
  patch_empty_code="$(
    curl -sS -o "${patch_file}" -w '%{http_code}' \
      -X PATCH "${member_perms_url}" \
      -H "Authorization: Bearer ${owner_token}" \
      -H "Content-Type: application/json" \
      --data '{"mode":"custom","permissions":[]}' || true
  )"
  if [[ "${patch_empty_code}" != "204" ]]; then
    err "failed to clear member permissions (HTTP ${patch_empty_code})"
    cat "${patch_file}" >&2 || true
    exit 1
  fi

  local smoke_name denied_code
  smoke_name="perm-smoke-denied-$(date +%s)"
  info "verifying restricted member is denied creating permission template"
  denied_code="$(
    curl -sS -o "${denied_file}" -w '%{http_code}' \
      -X POST "${perm_templates_url}" \
      -H "Authorization: Bearer ${member_token}" \
      -H "Content-Type: application/json" \
      --data "{\"name\":\"${smoke_name}\",\"permissions\":[\"project:membership:update\"]}" || true
  )"
  if [[ "${denied_code}" != "403" ]]; then
    err "expected 403 before grant, got HTTP ${denied_code}"
    cat "${denied_file}" >&2 || true
    exit 1
  fi
  local denied_err
  denied_err="$(cat "${denied_file}" | json_get 'process.stdout.write(String(data.error_code||""))' || true)"
  if [[ "${denied_err}" != "FORBIDDEN" ]]; then
    err "expected FORBIDDEN error_code before grant, got ${denied_err}"
    cat "${denied_file}" >&2 || true
    exit 1
  fi

  info "granting project:membership:update to member"
  local patch_grant_code
  patch_grant_code="$(
    curl -sS -o "${patch_file}" -w '%{http_code}' \
      -X PATCH "${member_perms_url}" \
      -H "Authorization: Bearer ${owner_token}" \
      -H "Content-Type: application/json" \
      --data '{"mode":"custom","permissions":["project:membership:update"]}' || true
  )"
  if [[ "${patch_grant_code}" != "204" ]]; then
    err "failed to grant member permission (HTTP ${patch_grant_code})"
    cat "${patch_file}" >&2 || true
    exit 1
  fi

  local allowed_code created_template_id
  smoke_name="perm-smoke-allowed-$(date +%s)"
  info "verifying granted member can create permission template"
  allowed_code="$(
    curl -sS -o "${allowed_file}" -w '%{http_code}' \
      -X POST "${perm_templates_url}" \
      -H "Authorization: Bearer ${member_token}" \
      -H "Content-Type: application/json" \
      --data "{\"name\":\"${smoke_name}\",\"permissions\":[\"project:membership:update\"]}" || true
  )"
  if [[ "${allowed_code}" != "200" ]]; then
    err "expected 200 after grant, got HTTP ${allowed_code}"
    cat "${allowed_file}" >&2 || true
    exit 1
  fi
  created_template_id="$(cat "${allowed_file}" | json_get 'process.stdout.write(String(data.id||""))' || true)"
  if [[ -z "${created_template_id}" ]]; then
    err "template create succeeded but response missing id"
    cat "${allowed_file}" >&2 || true
    exit 1
  fi

  info "restoring original member permissions"
  local restore_code
  restore_code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      -X PATCH "${member_perms_url}" \
      -H "Authorization: Bearer ${owner_token}" \
      -H "Content-Type: application/json" \
      --data-binary @"${restore_file}" || true
  )"
  if [[ "${restore_code}" != "204" ]]; then
    err "warning: failed to restore member permissions (HTTP ${restore_code})"
    exit 1
  fi
  : > "${restore_file}"
  trap - EXIT
  rm -f "${member_token_file}" "${join_resp_file}" "${list_join_file}" "${denied_file}" "${allowed_file}" "${patch_file}" "${get_perms_file}" "${restore_file}"

  info "OK"
}

main "$@"
