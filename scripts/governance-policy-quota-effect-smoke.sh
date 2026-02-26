#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

PORT_API="${PORT_API:-20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
CURL_MAX_TIME="${CURL_MAX_TIME:-40}"

info() { echo "[gov-policy-quota-smoke] $*"; }
err() { echo "[gov-policy-quota-smoke] ERROR: $*" >&2; }

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

utc_day_range() {
  node -e 'const n=new Date(); const s=new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate(),0,0,0,0)); const e=new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate(),23,59,59,999)); process.stdout.write(`${s.toISOString()}\n${e.toISOString()}\n`);'
}

usage_tokens_for_user_endpoint() {
  local base="$1"
  local token="$2"
  local endpoint_id="$3"
  local user_id="$4"
  local out_file
  out_file="$(mktemp)"
  local start_time end_time enc_start enc_end code
  mapfile -t _day_range < <(utc_day_range)
  start_time="${_day_range[0]}"
  end_time="${_day_range[1]}"
  enc_start="$(urlencode "${start_time}")"
  enc_end="$(urlencode "${end_time}")"
  code="$(
    curl -sS -o "${out_file}" -w '%{http_code}' \
      "${base}/usage?start_time=${enc_start}&end_time=${enc_end}&resource_type=endpoint&resource_id=${endpoint_id}&end_user_id=$(urlencode "${user_id}")&group_by=day&page=1&page_size=50" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${code}" != "200" ]]; then
    err "usage query failed while reading current tokens (HTTP ${code})"
    cat "${out_file}" >&2 || true
    rm -f "${out_file}"
    return 1
  fi
  cat "${out_file}" | json_get "const items=Array.isArray(data.items)?data.items:[]; const row=items.find(i=>String(i.resource_type||'')==='endpoint'&&String(i.resource_id||'')==='${endpoint_id}'&&String(i.end_user_id||'')==='${user_id}'); process.stdout.write(String(Number(row?.tokens||0)));"
  rm -f "${out_file}"
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
    err "token invalid/expired; run: BASE_URL=http://localhost:3001 make notebook-agent-refresh-token"
    exit 1
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

  local original_policy_file patch_resp_file req_file audit_file usage_file warmup_file
  original_policy_file="$(mktemp)"
  patch_resp_file="$(mktemp)"
  req_file="$(mktemp)"
  audit_file="$(mktemp)"
  usage_file="$(mktemp)"
  warmup_file="$(mktemp)"
  trap 'rm -f "${original_policy_file}" "${patch_resp_file}" "${req_file}" "${audit_file}" "${usage_file}" "${warmup_file}"; if [[ -n "${token:-}" && -s "${original_policy_file}" ]]; then curl -sS -o /dev/null -X PATCH "${policy_url}" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data-binary @"${original_policy_file}" || true; fi' EXIT

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

  local current_tokens
  current_tokens="$(usage_tokens_for_user_endpoint "${base}" "${token}" "${endpoint_id}" "${user_id}")"
  info "current endpoint tokens for user ${user_id} today: ${current_tokens}"

  if [[ "${current_tokens}" == "0" ]]; then
    info "no endpoint token usage found; sending warm-up request"
    local warmup_code
    warmup_code="$(
      curl -sS -o "${warmup_file}" -w '%{http_code}' \
        --max-time "${CURL_MAX_TIME}" \
        "${proxy_url}" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        --data '{"model":"glm-4.7","messages":[{"role":"user","content":"policy quota smoke warmup"}]}' || true
    )"
    if [[ ! "${warmup_code}" =~ ^2[0-9][0-9]$ ]]; then
      err "warm-up request failed (HTTP ${warmup_code}); endpoint upstream may be unavailable"
      cat "${warmup_file}" >&2 || true
      exit 1
    fi
    sleep 2
    current_tokens="$(usage_tokens_for_user_endpoint "${base}" "${token}" "${endpoint_id}" "${user_id}")"
    info "endpoint tokens after warm-up: ${current_tokens}"
  fi
  if [[ "${current_tokens}" == "0" ]]; then
    err "unable to observe endpoint token usage for user ${user_id}; cannot deterministically trigger policy quota"
    exit 1
  fi

  local quota_limit patch_code
  quota_limit="${current_tokens}"
  info "patching endpoint policy with daily token quota=${quota_limit}"
  patch_code="$(
    curl -sS -o "${patch_resp_file}" -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "{
        \"access_mode\":\"allow_all_members\",
        \"allowed_subjects\":[],
        \"rate_limits\":{\"rules\":[{\"key\":\"endpoint.requests_per_minute\",\"value\":1000}]},
        \"quota_limits\":{\"rules\":[{\"key\":\"endpoint.daily_token_limit\",\"value\":${quota_limit}}]}
      }" || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch endpoint policy (HTTP ${patch_code})"
    cat "${patch_resp_file}" >&2 || true
    exit 1
  fi

  local start_time end_time req_code body_err_code
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  info "sending endpoint request (should hit policy quota)"
  req_code="$(
    curl -sS -D /tmp/gov_policy_quota_smoke_headers.$$ -o "${req_file}" -w '%{http_code}' \
      --max-time "${CURL_MAX_TIME}" \
      "${proxy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data '{"model":"glm-4.7","messages":[{"role":"user","content":"policy quota smoke blocked request"}]}' || true
  )"
  if [[ "${req_code}" != "429" ]]; then
    err "request did not hit policy quota (HTTP ${req_code})"
    cat "${req_file}" >&2 || true
    rm -f /tmp/gov_policy_quota_smoke_headers.$$ || true
    exit 1
  fi
  body_err_code="$(cat "${req_file}" | json_get 'process.stdout.write(String(data.error_code||""))' || true)"
  if [[ "${body_err_code}" != "RESOURCE_POLICY_QUOTA_EXCEEDED" ]]; then
    err "unexpected error_code on quota-limited response: ${body_err_code}"
    cat "${req_file}" >&2 || true
    rm -f /tmp/gov_policy_quota_smoke_headers.$$ || true
    exit 1
  fi
  rm -f /tmp/gov_policy_quota_smoke_headers.$$ || true
  sleep 2
  end_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  local enc_start enc_end audit_code usage_code
  enc_start="$(urlencode "${start_time}")"
  enc_end="$(urlencode "${end_time}")"

  info "checking audit evidence"
  audit_code="$(
    curl -sS -o "${audit_file}" -w '%{http_code}' \
      "${base}/audit?start_time=${enc_start}&end_time=${enc_end}&action=resource_policy.quota_exceeded&actor_id=$(urlencode "${user_id}")&resource_type=endpoint&resource_id=${endpoint_id}&page=1&page_size=50" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${audit_code}" != "200" ]]; then
    err "audit query failed (HTTP ${audit_code})"
    cat "${audit_file}" >&2 || true
    exit 1
  fi
  local audit_has
  audit_has="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.action==='resource_policy.quota_exceeded'&&String(i.resource_id||'')==='${endpoint_id}'&&String(i.actor_id||'')==='${user_id}'); process.stdout.write(ok?'1':'0');")"
  if [[ "${audit_has}" != "1" ]]; then
    err "audit does not contain resource_policy.quota_exceeded for endpoint ${endpoint_id} user ${user_id}"
    cat "${audit_file}" >&2 || true
    exit 1
  fi

  info "checking usage evidence"
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
    err "usage does not contain endpoint row for ${endpoint_id} user ${user_id}"
    cat "${usage_file}" >&2 || true
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
    err "warning: failed to restore endpoint policy (HTTP ${restore_code})"
    exit 1
  fi
  : > "${original_policy_file}"
  trap - EXIT
  rm -f "${patch_resp_file}" "${req_file}" "${audit_file}" "${usage_file}" "${warmup_file}" "${original_policy_file}"

  info "OK"
}

main "$@"
