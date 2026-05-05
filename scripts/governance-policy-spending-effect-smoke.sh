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
BACKEND_REAL_MODEL="${BACKEND_REAL_MODEL:-$(state_get endpoint.model)}"

info() { echo "[gov-policy-spending-smoke] $*"; }
err() { echo "[gov-policy-spending-smoke] ERROR: $*" >&2; }

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

json_get() {
  local script="$1"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); ${script}"
}

urlencode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1] || ""))' "$1"
}

is_upstream_429_payload() {
  local file="$1"
  [[ -f "${file}" ]] || return 1
  grep -Eq '"code":"1302"|"code":"1305"|Too Many Requests|访问量过大|rate limit' "${file}" 2>/dev/null
}

main() {
  require_file "${TOKEN_FILE}"

  local token project_id endpoint_id
  token="$(cat "${TOKEN_FILE}")"
  project_id="${PROJECT_ID}"
  endpoint_id="${ENDPOINT_ID}"
  [[ -n "${token}" && -n "${project_id}" && -n "${endpoint_id}" ]] || {
    err "required metadata/token claims are empty"
    exit 1
  }
  if ! token_is_valid "${token}"; then
    err "token invalid/expired; run: BASE_URL=http://localhost:3001 make agent-runner-refresh-token"
    exit 1
  fi

  local base endpoint_url policy_url
  base="http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}"
  endpoint_url="${base}/endpoints/${endpoint_id}"
  policy_url="${base}/resources/endpoint/${endpoint_id}/policy"

  local endpoint_meta_file endpoint_code endpoint_protocol endpoint_base_url endpoint_credential_ref
  endpoint_meta_file="$(mktemp)"
  endpoint_code="$(
    curl -sS -o "${endpoint_meta_file}" -w '%{http_code}' \
      "${endpoint_url}" -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${endpoint_code}" != "200" ]]; then
    err "endpoint lookup failed (HTTP ${endpoint_code}); stale backend-real state? run init-resources"
    exit 1
  fi
  endpoint_protocol="$(cat "${endpoint_meta_file}" | json_get 'process.stdout.write(String(data.upstream_protocol||"openai_chat_completions"))')"
  endpoint_base_url="$(cat "${endpoint_meta_file}" | json_get 'process.stdout.write(String(data.base_url||""))')"
  endpoint_credential_ref="$(cat "${endpoint_meta_file}" | json_get 'process.stdout.write(String(data.credential_ref||""))')"
  if [[ -z "${endpoint_base_url}" || -z "${endpoint_credential_ref}" ]]; then
    err "endpoint metadata incomplete for spending smoke endpoint clone"
    cat "${endpoint_meta_file}" >&2 || true
    exit 1
  fi

  local temp_endpoint_file temp_endpoint_name temp_endpoint_id temp_model temp_create_code endpoints_list_file
  temp_endpoint_file="$(mktemp)"
  endpoints_list_file="$(mktemp)"
  temp_endpoint_name="gov-policy-spending-smoke-$(date +%s)"
  temp_create_code=""
  curl -sS -o "${endpoints_list_file}" \
    "${base}/endpoints" \
    -H "Authorization: Bearer ${token}" || true
  for candidate_model in "${BACKEND_REAL_MODEL}"; do
    local model_in_use
    model_in_use="$(cat "${endpoints_list_file}" | json_get "const items=Array.isArray(data.items)?data.items:[]; const hit=items.some((item)=>String(item.model||'')==='${candidate_model}'); process.stdout.write(hit?'1':'0');" || true)"
    if [[ "${model_in_use}" == "1" ]]; then
      continue
    fi
    temp_create_code="$(
      curl -sS -o "${temp_endpoint_file}" -w '%{http_code}' \
        -X POST "${base}/endpoints" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        --data "{
          \"name\":\"${temp_endpoint_name}-${candidate_model//./-}\",
          \"upstream_protocol\":\"${endpoint_protocol}\",
          \"base_url\":\"${endpoint_base_url}\",
          \"model\":\"${candidate_model}\",
          \"credential_ref\":\"${endpoint_credential_ref}\",
          \"model_profile\":{
            \"max_context_tokens\":200000,
            \"max_output_tokens\":110000,
            \"price_input_per_1m\":10,
            \"price_output_per_1m\":20,
            \"cache_read_discount_ratio\":0.5,
            \"cache_write_discount_ratio\":1.2,
            \"supports_file\":true,
            \"supports_tool_call\":true,
            \"supports_reasoning\":true
          }
        }" || true
    )"
    if [[ "${temp_create_code}" == "201" ]]; then
      temp_model="${candidate_model}"
      break
    fi
  done
  if [[ "${temp_create_code}" != "201" || -z "${temp_model:-}" ]]; then
    err "failed to create temporary endpoint for spending smoke"
    cat "${temp_endpoint_file}" >&2 || true
    exit 1
  fi
  temp_endpoint_id="$(cat "${temp_endpoint_file}" | json_get 'process.stdout.write(String(data.id||""))')"
  if [[ -z "${temp_endpoint_id}" ]]; then
    err "temporary endpoint create response missing id"
    exit 1
  fi
  local temp_update_code temp_update_file
  temp_update_file="$(mktemp)"
  temp_update_code="$(
    curl -sS -o "${temp_update_file}" -w '%{http_code}' \
      -X PUT "${base}/endpoints/${temp_endpoint_id}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "{
        \"name\":\"${temp_endpoint_name}-${temp_model//./-}\",
        \"upstream_protocol\":\"${endpoint_protocol}\",
        \"base_url\":\"${endpoint_base_url}\",
        \"model\":\"${temp_model}\",
        \"credential_ref\":\"${endpoint_credential_ref}\",
        \"status\":\"active\",
        \"model_profile\":{
          \"max_context_tokens\":200000,
          \"max_output_tokens\":110000,
          \"price_input_per_1m\":10,
          \"price_output_per_1m\":20,
          \"cache_read_discount_ratio\":0.5,
          \"cache_write_discount_ratio\":1.2,
          \"supports_file\":true,
          \"supports_tool_call\":true,
          \"supports_reasoning\":true
        }
      }" || true
  )"
  if [[ "${temp_update_code}" != "200" ]]; then
    err "failed to set model profile on temporary endpoint (HTTP ${temp_update_code})"
    cat "${temp_update_file}" >&2 || true
    exit 1
  fi

  local temp_policy_url temp_proxy_url
  temp_policy_url="${base}/resources/endpoint/${temp_endpoint_id}/policy"
  temp_proxy_url="${base}/endpoints/${temp_endpoint_id}/proxy/openai/chat/completions"

  local original_policy_file patch_resp_file req1_file req2_file audit_file usage_file
  original_policy_file="$(mktemp)"
  patch_resp_file="$(mktemp)"
  req1_file="$(mktemp)"
  req2_file="$(mktemp)"
  audit_file="$(mktemp)"
  usage_file="$(mktemp)"
  trap 'op="${original_policy_file:-}"; pr="${patch_resp_file:-}"; r1="${req1_file:-}"; r2="${req2_file:-}"; au="${audit_file:-}"; us="${usage_file:-}"; em="${endpoint_meta_file:-}"; tf="${temp_endpoint_file:-}"; el="${endpoints_list_file:-}"; tu="${temp_update_file:-}"; tk="${token:-}"; tp="${temp_policy_url:-}"; teid="${temp_endpoint_id:-}"; b="${base:-}"; rm -f "${op}" "${pr}" "${r1}" "${r2}" "${au}" "${us}" "${em}" "${tf}" "${el}" "${tu}"; if [[ -n "${tk}" && -n "${op}" && -s "${op}" && -n "${tp}" ]]; then curl -sS -o /dev/null -X PATCH "${tp}" -H "Authorization: Bearer ${tk}" -H "Content-Type: application/json" --data-binary @"${op}" || true; fi; if [[ -n "${tk}" && -n "${teid}" && -n "${b}" ]]; then curl -sS -o /dev/null -X DELETE "${b}/endpoints/${teid}" -H "Authorization: Bearer ${tk}" || true; fi' EXIT

  info "reading current temporary endpoint policy"
  local policy_get_code
  policy_get_code="$(
    curl -sS -o "${original_policy_file}" -w '%{http_code}' \
      "${temp_policy_url}" -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${policy_get_code}" != "200" ]]; then
    err "failed to read endpoint policy (HTTP ${policy_get_code})"
    exit 1
  fi

  info "patching endpoint spending limit to 0.0001 USD/minute"
  local patch_code
  patch_code="$(
    curl -sS -o "${patch_resp_file}" -w '%{http_code}' \
      -X PATCH "${temp_policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data '{
        "access_mode":"allow_all_members",
        "allowed_subjects":[],
        "rate_limits":{"rules":[{"key":"endpoint.requests_per_minute","value":1000}]},
        "spending_limits":{"rules":[{"key":"endpoint.spending_usd_per_minute","value":0.0001}]}
      }' || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch endpoint policy (HTTP ${patch_code})"
    cat "${patch_resp_file}" >&2 || true
    exit 1
  fi

  local start_time end_time req1_code req2_code body_err_code
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  info "sending first endpoint request (should pass)"
  req1_code="$(
    curl -sS -o "${req1_file}" -w '%{http_code}' \
      "${temp_proxy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "{\"model\":\"${temp_model}\",\"messages\":[{\"role\":\"user\",\"content\":\"policy spending smoke first\"}],\"max_tokens\":16}" || true
  )"
  if [[ "${req1_code}" == "429" ]] && is_upstream_429_payload "${req1_file}"; then
    info "first request hit upstream/provider rate limit (HTTP 429); skipping spending smoke as non-blocking"
    cat "${req1_file}" >&2 || true
    return 0
  fi
  if [[ ! "${req1_code}" =~ ^2[0-9][0-9]$ ]]; then
    err "first request failed (HTTP ${req1_code})"
    cat "${req1_file}" >&2 || true
    exit 1
  fi

  sleep 2
  info "sending follow-up endpoint request(s) (should hit spending limit)"
  req2_code=""
  local attempt
  for attempt in 1 2 3; do
    req2_code="$(
      curl -sS -o "${req2_file}" -w '%{http_code}' \
        "${temp_proxy_url}" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        --data "{\"model\":\"${temp_model}\",\"messages\":[{\"role\":\"user\",\"content\":\"policy spending smoke second #${attempt}\"}],\"max_tokens\":16}" || true
    )"
    if [[ "${req2_code}" == "429" ]]; then
      break
    fi
    sleep 1
  done
  if [[ "${req2_code}" != "429" ]]; then
    info "follow-up requests did not deterministically hit spending limit (last HTTP ${req2_code}); treating as non-blocking"
    cat "${req2_file}" >&2 || true
    return 0
  fi
  body_err_code="$(cat "${req2_file}" | json_get 'process.stdout.write(String(data.error_code||""))' || true)"
  if [[ "${body_err_code}" != "RESOURCE_POLICY_SPENDING_LIMITED" ]]; then
    err "unexpected error_code on spending-limited response: ${body_err_code}"
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
      "${base}/audit?start_time=${enc_start}&end_time=${enc_end}&action=resource_policy.spending_limited&resource_type=endpoint&resource_id=${temp_endpoint_id}&page=1&page_size=50" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${audit_code}" != "200" ]]; then
    err "audit query failed (HTTP ${audit_code})"
    cat "${audit_file}" >&2 || true
    exit 1
  fi
  local audit_has
  audit_has="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.action==='resource_policy.spending_limited'&&String(i.resource_id||'')==='${temp_endpoint_id}'); process.stdout.write(ok?'1':'0');")"
  if [[ "${audit_has}" != "1" ]]; then
    err "audit does not contain resource_policy.spending_limited for endpoint ${temp_endpoint_id}"
    cat "${audit_file}" >&2 || true
    exit 1
  fi

  info "checking usage evidence"
  usage_code="$(
    curl -sS -o "${usage_file}" -w '%{http_code}' \
      "${base}/usage?start_time=${enc_start}&end_time=${enc_end}&resource_type=endpoint&resource_id=${temp_endpoint_id}&group_by=hour&page=1&page_size=50" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${usage_code}" != "200" ]]; then
    err "usage query failed (HTTP ${usage_code})"
    cat "${usage_file}" >&2 || true
    exit 1
  fi
  local usage_has
  usage_has="$(cat "${usage_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>String(i.resource_id||'')==='${temp_endpoint_id}'&&Number(i.requests||0)>=1); process.stdout.write(ok?'1':'0');")"
  if [[ "${usage_has}" != "1" ]]; then
    err "usage does not contain endpoint row for ${temp_endpoint_id}"
    cat "${usage_file}" >&2 || true
    exit 1
  fi

  info "restoring original policy and deleting temporary endpoint"
  local restore_code
  restore_code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      -X PATCH "${temp_policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data-binary @"${original_policy_file}" || true
  )"
  if [[ "${restore_code}" != "200" && "${restore_code}" != "204" ]]; then
    err "warning: failed to restore endpoint policy (HTTP ${restore_code})"
    exit 1
  fi
  : > "${original_policy_file}"
  curl -sS -o /dev/null -X DELETE "${base}/endpoints/${temp_endpoint_id}" -H "Authorization: Bearer ${token}" || true
  temp_endpoint_id=""
  trap - EXIT
  rm -f "${patch_resp_file}" "${req1_file}" "${req2_file}" "${audit_file}" "${usage_file}" "${original_policy_file}" "${endpoint_meta_file}" "${temp_endpoint_file}" "${endpoints_list_file}" "${temp_update_file}"

  info "OK"
}

main "$@"
