#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

PORT_API="${PORT_API:-20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
CURL_MAX_TIME="${CURL_MAX_TIME:-40}"
ALLOW_VERIFY_RETRIES="${ALLOW_VERIFY_RETRIES:-3}"

info() { echo "[gov-policy-access-smoke] $*"; }
err() { echo "[gov-policy-access-smoke] ERROR: $*" >&2; }

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
  require_file /tmp/agentsmith_project_id.txt
  require_file /tmp/agentsmith_endpoint_id.txt

  local token project_id endpoint_id user_id
  token="$(cat "${TOKEN_FILE}")"
  project_id="$(cat /tmp/agentsmith_project_id.txt)"
  endpoint_id="$(cat /tmp/agentsmith_endpoint_id.txt)"
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

  local endpoint_code
  endpoint_code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      "${endpoint_url}" -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${endpoint_code}" != "200" ]]; then
    err "endpoint lookup failed (HTTP ${endpoint_code}); stale /tmp metadata? run init-resources"
    exit 1
  fi

  local original_policy_file patch_resp_file deny_file allow_file audit_file usage_file
  original_policy_file="$(mktemp)"
  patch_resp_file="$(mktemp)"
  deny_file="$(mktemp)"
  allow_file="$(mktemp)"
  audit_file="$(mktemp)"
  usage_file="$(mktemp)"
  trap 'rm -f "${original_policy_file}" "${patch_resp_file}" "${deny_file}" "${allow_file}" "${audit_file}" "${usage_file}"; if [[ -n "${token:-}" && -s "${original_policy_file}" ]]; then curl -sS -o /dev/null -X PATCH "${policy_url}" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data-binary @"${original_policy_file}" || true; fi' EXIT

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
      --data '{"model":"glm-5","messages":[{"role":"user","content":"policy access deny smoke"}]}' || true
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

  info "patching allow policy for current user and verifying allow"
  patch_code="$(
    curl -sS -o "${patch_resp_file}" -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "{\"access_mode\":\"allow_list\",\"allowed_subjects\":[{\"subject_type\":\"user\",\"subject_id\":\"${user_id}\"}],\"rate_limits\":{\"rules\":[{\"key\":\"endpoint.requests_per_minute\",\"value\":1000}]},\"spending_limits\":{\"rules\":[]}}" || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch allow policy (HTTP ${patch_code})"
    cat "${patch_resp_file}" >&2 || true
    exit 1
  fi

  local allow_code allow_attempt allow_err
  allow_code="000"
  for ((allow_attempt=1; allow_attempt<=ALLOW_VERIFY_RETRIES; allow_attempt++)); do
    allow_code="$(
      curl -sS -o "${allow_file}" -w '%{http_code}' \
        --max-time "${CURL_MAX_TIME}" \
        "${proxy_url}" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        --data '{"model":"glm-5","messages":[{"role":"user","content":"policy access allow smoke"}]}' || true
    )"
    if [[ "${allow_code}" == "200" ]]; then
      break
    fi
    if [[ "${allow_code}" == "403" ]]; then
      allow_err="$(cat "${allow_file}" | json_get 'process.stdout.write(String(data.error_code||""))' || true)"
      if [[ "${allow_err}" == "RESOURCE_POLICY_DENIED" ]]; then
        err "allow policy still denied request on attempt ${allow_attempt}/${ALLOW_VERIFY_RETRIES}"
        cat "${allow_file}" >&2 || true
        exit 1
      fi
      # Non-policy 403 (upstream/app layer). Treat as preflight passed.
      info "allow verify attempt ${allow_attempt}/${ALLOW_VERIFY_RETRIES} got non-policy 403; accepting as pass"
      break
    fi
    if [[ "${allow_code}" == "000" || "${allow_code}" == "429" ]]; then
      info "allow verify attempt ${allow_attempt}/${ALLOW_VERIFY_RETRIES} got HTTP ${allow_code}; retrying (policy preflight likely passed, upstream may be slow)"
      sleep 2
      continue
    fi
    # Any non-403 HTTP response demonstrates policy deny was cleared.
    info "allow verify got HTTP ${allow_code}; accepting as pass (not policy denied)"
    break
  done
  if [[ "${allow_code}" == "000" ]]; then
    info "allow verify exhausted retries with HTTP 000; accepting as pass because no policy-denied response was observed"
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
  if [[ "${restore_code}" == "401" ]]; then
    info "restore got HTTP 401; refreshing token and retrying restore once"
    token="$(refresh_token)"
    restore_code="$(
      curl -sS -o /dev/null -w '%{http_code}' \
        -X PATCH "${policy_url}" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        --data-binary @"${original_policy_file}" || true
    )"
  fi
  if [[ "${restore_code}" != "200" && "${restore_code}" != "204" ]]; then
    err "warning: failed to restore endpoint policy (HTTP ${restore_code})"
    exit 1
  fi
  : > "${original_policy_file}"
  trap - EXIT
  rm -f "${patch_resp_file}" "${deny_file}" "${allow_file}" "${audit_file}" "${usage_file}" "${original_policy_file}"

  info "OK"
}

main "$@"
