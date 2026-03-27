#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
ensure_backend_real_state

PORT_API="${PORT_API:-20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-$(backend_real_token_file)}"
PROJECT_ID="${PROJECT_ID:-$(state_get project.id)}"
ENDPOINT_ID="${ENDPOINT_ID:-$(state_get endpoint.id)}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
CURL_MAX_TIME="${CURL_MAX_TIME:-40}"
GROUP_PERMISSION_TEMPLATE_ID="${GROUP_PERMISSION_TEMPLATE_ID:-perm_tpl_default}"
BACKEND_REAL_MODEL="${BACKEND_REAL_MODEL:-$(state_get endpoint.model)}"

info() { echo "[gov-policy-group-smoke] $*"; }
err() { echo "[gov-policy-group-smoke] ERROR: $*" >&2; }

refresh_token() {
  local refreshed
  refreshed="$(
    BASE_URL="${BASE_URL:-http://localhost:3001}" \
    KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
    KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
    TOKEN_OUT_FILE="${TOKEN_FILE}" \
    PRINT_TOKEN=1 \
    node ./scripts/notebook-agent-refresh-token.js 2>/dev/null || true
  )"
  [[ -n "${refreshed}" ]] || return 1
  printf '%s' "${refreshed}" > "${TOKEN_FILE}"
  printf '%s' "${refreshed}"
}

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

urlencode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1] || ""))' "$1"
}

main() {
  require_file "${TOKEN_FILE}"

  local token project_id endpoint_id user_id
  token="$(cat "${TOKEN_FILE}")"
  project_id="${PROJECT_ID}"
  endpoint_id="${ENDPOINT_ID}"
  user_id="$(jwt_claim "${token}" "sub")"
  [[ -n "${token}" && -n "${project_id}" && -n "${endpoint_id}" && -n "${user_id}" ]] || {
    err "required metadata/token claims are empty"
    exit 1
  }
  if ! token_is_valid "${token}"; then
    info "token invalid/expired; refreshing automatically"
    token="$(refresh_token)"
    user_id="$(jwt_claim "${token}" "sub")"
    if [[ -z "${token}" || -z "${user_id}" ]] || ! token_is_valid "${token}"; then
      err "token refresh failed"
      exit 1
    fi
  fi

  local base="http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}"
  local endpoint_url="${base}/endpoints/${endpoint_id}"
  local proxy_url="${endpoint_url}/proxy/chat/completions"
  local policy_url="${base}/resources/endpoint/${endpoint_id}/policy"
  local groups_url="${base}/groups"

  local endpoint_code
  endpoint_code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      "${endpoint_url}" -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${endpoint_code}" != "200" ]]; then
    err "endpoint lookup failed (HTTP ${endpoint_code}); stale backend-real state? run init-resources"
    exit 1
  fi

  local original_policy_file patch_resp_file deny_file allow_file audit_file usage_file group_file
  original_policy_file="$(mktemp)"
  patch_resp_file="$(mktemp)"
  deny_file="$(mktemp)"
  allow_file="$(mktemp)"
  audit_file="$(mktemp)"
  usage_file="$(mktemp)"
  group_file="$(mktemp)"
  local created_group_id=""
  trap 'rm -f "${original_policy_file}" "${patch_resp_file}" "${deny_file}" "${allow_file}" "${audit_file}" "${usage_file}" "${group_file}"; if [[ -n "${token:-}" && -n "${created_group_id:-}" ]]; then curl -sS -o /dev/null -X DELETE "'"${groups_url}"'/${created_group_id}" -H "Authorization: Bearer ${token}" || true; fi; if [[ -n "${token:-}" && -s "${original_policy_file}" ]]; then curl -sS -o /dev/null -X PATCH "${policy_url}" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data-binary @"${original_policy_file}" || true; fi' EXIT

  info "reading current endpoint policy"
  local policy_get_code
  policy_get_code="$(
    curl -sS -o "${original_policy_file}" -w '%{http_code}' \
      "${policy_url}" -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${policy_get_code}" != "200" ]]; then
    err "failed to read endpoint policy (HTTP ${policy_get_code})"
    exit 1
  fi

  info "patching deny policy (allow_list for different user)"
  local patch_code
  patch_code="$(
    curl -sS -o "${patch_resp_file}" -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data '{
        "access_mode":"allow_list",
        "allowed_subjects":[{"subject_type":"user","subject_id":"someone_else"}],
        "rate_limits":{"rules":[{"key":"endpoint.requests_per_minute","value":1000}]},
        "spending_limits":{"rules":[]}
      }' || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch deny policy (HTTP ${patch_code})"
    cat "${patch_resp_file}" >&2 || true
    exit 1
  fi

  local start_time end_time deny_code deny_err
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  info "sending endpoint request (should be denied by allow-list)"
  deny_code="$(
    curl -sS -o "${deny_file}" -w '%{http_code}' \
      --max-time "${CURL_MAX_TIME}" \
      "${proxy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "$(node -e 'console.log(JSON.stringify({model:process.argv[1],messages:[{role:"user",content:"policy group deny smoke"}]}))' "${BACKEND_REAL_MODEL}")" || true
  )"
  if [[ "${deny_code}" != "403" ]]; then
    err "expected 403 on deny policy, got HTTP ${deny_code}"
    cat "${deny_file}" >&2 || true
    exit 1
  fi
  deny_err="$(cat "${deny_file}" | json_get 'process.stdout.write(String(data.error_code||""))' || true)"
  if [[ "${deny_err}" != "RESOURCE_POLICY_DENIED" ]]; then
    err "unexpected error_code on deny response: ${deny_err}"
    cat "${deny_file}" >&2 || true
    exit 1
  fi
  sleep 2
  end_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  local enc_start enc_end audit_code usage_code
  enc_start="$(urlencode "${start_time}")"
  enc_end="$(urlencode "${end_time}")"
  info "checking audit evidence for access deny"
  audit_code="$(
    curl -sS -o "${audit_file}" -w '%{http_code}' \
      "${base}/audit?start_time=${enc_start}&end_time=${enc_end}&action=resource_policy.access_denied&actor_id=$(urlencode "${user_id}")&resource_type=endpoint&resource_id=${endpoint_id}&page=1&page_size=50" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${audit_code}" != "200" ]]; then
    err "audit query failed (HTTP ${audit_code})"
    cat "${audit_file}" >&2 || true
    exit 1
  fi
  local audit_has
  audit_has="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.action==='resource_policy.access_denied'&&String(i.resource_id||'')==='${endpoint_id}'&&String(i.actor_id||'')==='${user_id}'); process.stdout.write(ok?'1':'0');")"
  if [[ "${audit_has}" != "1" ]]; then
    err "audit missing resource_policy.access_denied for endpoint ${endpoint_id} user ${user_id}"
    cat "${audit_file}" >&2 || true
    exit 1
  fi

  info "checking usage evidence for denied request"
  usage_code="$(
    curl -sS -o "${usage_file}" -w '%{http_code}' \
      "${base}/usage?start_time=${enc_start}&end_time=${enc_end}&resource_type=endpoint&resource_id=${endpoint_id}&end_user_id=$(urlencode "${user_id}")&group_by=hour&page=1&page_size=50" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${usage_code}" != "200" ]]; then
    err "usage query failed (HTTP ${usage_code})"
    cat "${usage_file}" >&2 || true
    exit 1
  fi
  local usage_has
  usage_has="$(cat "${usage_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>String(i.resource_id||'')==='${endpoint_id}'&&String(i.end_user_id||'')==='${user_id}'&&Number(i.requests||0)>=1); process.stdout.write(ok?'1':'0');")"
  if [[ "${usage_has}" != "1" ]]; then
    err "usage missing endpoint row for denied request endpoint ${endpoint_id} user ${user_id}"
    cat "${usage_file}" >&2 || true
    exit 1
  fi

  info "creating group with current user for group-subject allow-list"
  local group_name group_code
  group_name="policy-group-smoke-$(date +%s)"
  group_code="$(
    curl -sS -o "${group_file}" -w '%{http_code}' \
      -X POST "${groups_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "{\"name\":\"${group_name}\",\"permission_template_id\":\"${GROUP_PERMISSION_TEMPLATE_ID}\",\"member_ids\":[\"${user_id}\"]}" || true
  )"
  if [[ "${group_code}" != "200" ]]; then
    err "failed to create group (HTTP ${group_code})"
    cat "${group_file}" >&2 || true
    exit 1
  fi
  created_group_id="$(cat "${group_file}" | json_get 'process.stdout.write(String(data.id||""))' || true)"
  if [[ -z "${created_group_id}" ]]; then
    err "group create response missing id"
    cat "${group_file}" >&2 || true
    exit 1
  fi

  info "patching policy to allow created group and verifying deny is cleared"
  patch_code="$(
    curl -sS -o "${patch_resp_file}" -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "{\"access_mode\":\"allow_list\",\"allowed_subjects\":[{\"subject_type\":\"group\",\"subject_id\":\"${created_group_id}\"}],\"rate_limits\":{\"rules\":[{\"key\":\"endpoint.requests_per_minute\",\"value\":1000}]},\"spending_limits\":{\"rules\":[]}}" || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch allow-list group policy (HTTP ${patch_code})"
    cat "${patch_resp_file}" >&2 || true
    exit 1
  fi

  local allow_code
  allow_code="$(
    curl -sS -o "${allow_file}" -w '%{http_code}' \
      --max-time "${CURL_MAX_TIME}" \
      "${proxy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "$(node -e 'console.log(JSON.stringify({model:process.argv[1],messages:[{role:"user",content:"policy group allow smoke"}]}))' "${BACKEND_REAL_MODEL}")" || true
  )"
  if [[ "${allow_code}" == "403" ]]; then
    err "group allow-list did not clear deny (still 403)"
    cat "${allow_file}" >&2 || true
    exit 1
  fi
  if [[ "${allow_code}" != "200" && "${allow_code}" != "000" && "${allow_code}" != "429" ]]; then
    err "unexpected allow-path status after group allow-list: HTTP ${allow_code}"
    cat "${allow_file}" >&2 || true
    exit 1
  fi
  if [[ "${allow_code}" == "000" ]]; then
    info "allow-path request timed out (HTTP 000); treating as pass because deny preflight was cleared and upstream can be slow"
  elif [[ "${allow_code}" == "429" ]]; then
    info "allow-path request hit upstream rate limit (HTTP 429); treating as pass because deny preflight was cleared"
  fi

  info "restoring original endpoint policy and cleaning up group"
  local restore_code delete_group_code
  restore_code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data-binary @"${original_policy_file}" || true
  )"
  if [[ "${restore_code}" != "200" && "${restore_code}" != "204" ]]; then
    err "warning: failed to restore endpoint policy (HTTP ${restore_code})"
    exit 1
  fi
  : > "${original_policy_file}"

  delete_group_code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      -X DELETE "${groups_url}/${created_group_id}" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${delete_group_code}" != "204" ]]; then
    err "warning: failed to delete temporary group ${created_group_id} (HTTP ${delete_group_code})"
    exit 1
  fi
  created_group_id=""
  trap - EXIT
  rm -f "${patch_resp_file}" "${deny_file}" "${allow_file}" "${audit_file}" "${usage_file}" "${group_file}" "${original_policy_file}"

  info "OK"
}

main "$@"
