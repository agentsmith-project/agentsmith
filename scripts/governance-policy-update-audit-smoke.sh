#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

PORT_API="${PORT_API:-20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"

info() { echo "[gov-policy-update-audit-smoke] $*"; }
err() { echo "[gov-policy-update-audit-smoke] ERROR: $*" >&2; }

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

urlencode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1] || ""))' "$1"
}

json_get() {
  local script="$1"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); ${script}"
}

main() {
  require_file "${TOKEN_FILE}"
  require_file /tmp/agentsmith_project_id.txt
  require_file /tmp/agentsmith_endpoint_id.txt

  local token project_id endpoint_id
  token="$(cat "${TOKEN_FILE}")"
  project_id="$(cat /tmp/agentsmith_project_id.txt)"
  endpoint_id="$(cat /tmp/agentsmith_endpoint_id.txt)"
  [[ -n "${token}" && -n "${project_id}" && -n "${endpoint_id}" ]] || {
    err "required metadata/token is empty"
    exit 1
  }
  if ! token_is_valid "${token}"; then
    err "token invalid/expired; run: BASE_URL=http://localhost:3001 make notebook-agent-refresh-token"
    exit 1
  fi

  local base="http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}"
  local policy_url="${base}/resources/endpoint/${endpoint_id}/policy"

  local original_policy_file patch_resp_file audit_file
  original_policy_file="$(mktemp)"
  patch_resp_file="$(mktemp)"
  audit_file="$(mktemp)"
  trap 'rm -f "${patch_resp_file}" "${audit_file}"; if [[ -n "${token:-}" && -s "${original_policy_file}" ]]; then curl -sS -o /dev/null -X PATCH "${policy_url}" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data-binary @"${original_policy_file}" || true; fi; rm -f "${original_policy_file}"' EXIT

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

  local start_time end_time
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  info "patching endpoint policy and expecting audit action resource_policy.updated"
  local patch_code
  patch_code="$(
    curl -sS -o "${patch_resp_file}" -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data '{
        "access_mode":"allow_list",
        "allowed_subjects":[{"subject_type":"group","subject_id":"grp_policy_audit_smoke"}],
        "rate_limits":{"rules":[{"key":"endpoint.requests_per_minute","value":1000}]},
        "quota_limits":{"rules":[]}
      }' || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch policy (HTTP ${patch_code})"
    cat "${patch_resp_file}" >&2 || true
    exit 1
  fi

  sleep 1
  end_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  local enc_start enc_end audit_code
  enc_start="$(urlencode "${start_time}")"
  enc_end="$(urlencode "${end_time}")"
  info "checking audit evidence for policy update"
  audit_code="$(
    curl -sS -o "${audit_file}" -w '%{http_code}' \
      "${base}/audit?start_time=${enc_start}&end_time=${enc_end}&action=resource_policy.updated&resource_type=resource_policy&resource_id=$(urlencode "endpoint:${endpoint_id}")&page=1&page_size=50" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${audit_code}" != "200" ]]; then
    err "audit query failed (HTTP ${audit_code})"
    cat "${audit_file}" >&2 || true
    exit 1
  fi

  local audit_has
  audit_has="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.action==='resource_policy.updated'&&String(i.resource_type||'')==='resource_policy'&&String(i.resource_id||'')==='endpoint:${endpoint_id}'); process.stdout.write(ok?'1':'0');")"
  if [[ "${audit_has}" != "1" ]]; then
    err "audit missing resource_policy.updated for endpoint:${endpoint_id}"
    cat "${audit_file}" >&2 || true
    exit 1
  fi

  info "restoring original endpoint policy"
  local restore_code
  restore_code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data-binary @"${original_policy_file}" || true
  )"
  if [[ "${restore_code}" != "200" && "${restore_code}" != "204" ]]; then
    err "failed to restore endpoint policy (HTTP ${restore_code})"
    exit 1
  fi

  : > "${original_policy_file}"
  trap - EXIT
  rm -f "${patch_resp_file}" "${audit_file}" "${original_policy_file}"
  info "OK"
}

main "$@"
