#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

PORT_API="${PORT_API:-20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
WAIT_NEXT_MINUTE="${WAIT_NEXT_MINUTE:-1}"

info() { echo "[gov-policy-requests-rate-smoke] $*"; }
err() { echo "[gov-policy-requests-rate-smoke] ERROR: $*" >&2; }

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

wait_until_next_minute() {
  local now sec sleep_for
  now="$(date +%s)"
  sec=$(( now % 60 ))
  sleep_for=$(( 61 - sec ))
  if (( sleep_for < 1 )); then sleep_for=1; fi
  info "waiting ${sleep_for}s for a fresh minute bucket"
  sleep "${sleep_for}"
}

usage_ok_requests_for_user_endpoint_today() {
  local base="$1"
  local token="$2"
  local endpoint_id="$3"
  local user_id="$4"
  local out_file start_time end_time enc_start enc_end code
  out_file="$(mktemp)"
  start_time="$(node -e 'const n=new Date(); const s=new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate(),0,0,0,0)); process.stdout.write(s.toISOString())')"
  end_time="$(node -e 'const n=new Date(); const e=new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate(),23,59,59,999)); process.stdout.write(e.toISOString())')"
  enc_start="$(urlencode "${start_time}")"
  enc_end="$(urlencode "${end_time}")"
  code="$(
    curl -sS -o "${out_file}" -w '%{http_code}' \
      "${base}/usage/facts?start_time=${enc_start}&end_time=${enc_end}&resource_type=endpoint&resource_id=${endpoint_id}&end_user_id=$(urlencode "${user_id}")&result=ok&page=1&page_size=200" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${code}" != "200" ]]; then
    err "usage facts query failed while reading baseline requests (HTTP ${code})"
    cat "${out_file}" >&2 || true
    rm -f "${out_file}"
    return 1
  fi
  cat "${out_file}" | json_get 'const items=Array.isArray(data.items)?data.items:[]; process.stdout.write(String(items.length));'
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

  local base endpoint_url proxy_url policy_url
  base="http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}"
  endpoint_url="${base}/endpoints/${endpoint_id}"
  proxy_url="${endpoint_url}/proxy/chat/completions"
  policy_url="${base}/resources/endpoint/${endpoint_id}/policy"

  local endpoint_code
  endpoint_code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      "${endpoint_url}" -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${endpoint_code}" != "200" ]]; then
    err "endpoint lookup failed (HTTP ${endpoint_code}); stale /tmp metadata? run init-resources"
    exit 1
  fi

  local original_policy_file patch_resp_file req1_file req2_file audit_file usage_file
  original_policy_file="$(mktemp)"
  patch_resp_file="$(mktemp)"
  req1_file="$(mktemp)"
  req2_file="$(mktemp)"
  audit_file="$(mktemp)"
  usage_file="$(mktemp)"
  trap 'rm -f "${original_policy_file}" "${patch_resp_file}" "${req1_file}" "${req2_file}" "${audit_file}" "${usage_file}"; if [[ -n "${token:-}" && -s "${original_policy_file}" ]]; then curl -sS -o /dev/null -X PATCH "${policy_url}" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data-binary @"${original_policy_file}" || true; fi' EXIT

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

  local baseline_ok_requests day_limit
  baseline_ok_requests="$(usage_ok_requests_for_user_endpoint_today "${base}" "${token}" "${endpoint_id}" "${user_id}")"
  day_limit="$(( baseline_ok_requests + 1 ))"
  info "baseline ok requests today=${baseline_ok_requests}, setting requests/day limit=${day_limit}"

  local patch_code
  patch_code="$(
    curl -sS -o "${patch_resp_file}" -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "{
        \"access_mode\":\"allow_all_members\",
        \"allowed_subjects\":[],
        \"rate_limits\":{\"rules\":[
          {\"key\":\"endpoint.requests_per_minute\",\"value\":1000},
          {\"key\":\"endpoint.requests_per_day\",\"value\":${day_limit}}
        ]},
        \"spending_limits\":{\"rules\":[]}
      }" || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch endpoint policy (HTTP ${patch_code})"
    cat "${patch_resp_file}" >&2 || true
    exit 1
  fi

  if [[ "${WAIT_NEXT_MINUTE}" == "1" ]]; then
    wait_until_next_minute
  fi

  local start_time end_time req1_code req2_code body_err_code
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  info "sending first endpoint request (should pass)"
  req1_code="$(
    curl -sS -o "${req1_file}" -w '%{http_code}' \
      "${proxy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data '{"model":"glm-5","messages":[{"role":"user","content":"policy req/day smoke first"}]}' || true
  )"
  if [[ ! "${req1_code}" =~ ^2[0-9][0-9]$ ]]; then
    err "first request failed (HTTP ${req1_code})"
    cat "${req1_file}" >&2 || true
    exit 1
  fi

  info "sending second endpoint request (should hit requests/day rate limit)"
  req2_code="$(
    curl -sS -o "${req2_file}" -w '%{http_code}' \
      "${proxy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data '{"model":"glm-5","messages":[{"role":"user","content":"policy req/day smoke second"}]}' || true
  )"
  if [[ "${req2_code}" != "429" ]]; then
    err "second request did not hit requests/day rate limit (HTTP ${req2_code})"
    cat "${req2_file}" >&2 || true
    exit 1
  fi
  body_err_code="$(cat "${req2_file}" | json_get 'process.stdout.write(String(data.error_code||""))' || true)"
  if [[ "${body_err_code}" != "RESOURCE_POLICY_RATE_LIMITED" ]]; then
    err "unexpected error_code on rate-limited response: ${body_err_code}"
    cat "${req2_file}" >&2 || true
    exit 1
  fi

  sleep 2
  end_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  local enc_start enc_end audit_code usage_code
  enc_start="$(urlencode "${start_time}")"
  enc_end="$(urlencode "${end_time}")"

  info "checking audit evidence"
  audit_code="$(
    curl -sS -o "${audit_file}" -w '%{http_code}' \
      "${base}/audit?start_time=${enc_start}&end_time=${enc_end}&action=resource_policy.rate_limited&actor_id=$(urlencode "${user_id}")&resource_type=endpoint&resource_id=${endpoint_id}&page=1&page_size=50" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${audit_code}" != "200" ]]; then
    err "audit query failed (HTTP ${audit_code})"
    cat "${audit_file}" >&2 || true
    exit 1
  fi
  local audit_has
  audit_has="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.action==='resource_policy.rate_limited'&&String(i.resource_id||'')==='${endpoint_id}'&&String(i.actor_id||'')==='${user_id}'&&String((i.metadata_json||{}).rate_key||'')==='endpoint.requests_per_day'); process.stdout.write(ok?'1':'0');")"
  if [[ "${audit_has}" != "1" ]]; then
    err "audit does not contain resource_policy.rate_limited(endpoint.requests_per_day) for endpoint ${endpoint_id}"
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
  rm -f "${patch_resp_file}" "${req1_file}" "${req2_file}" "${audit_file}" "${usage_file}" "${original_policy_file}"

  info "OK"
}

main "$@"
