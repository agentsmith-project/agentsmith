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
WAIT_NEXT_MINUTE="${WAIT_NEXT_MINUTE:-1}"
BACKEND_REAL_MODEL="${BACKEND_REAL_MODEL:-$(state_get endpoint.model)}"

info() { echo "[gov-policy-smoke] $*"; }
err() { echo "[gov-policy-smoke] ERROR: $*" >&2; }
warn() { echo "[gov-policy-smoke] WARN: $*" >&2; }

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

wait_until_next_minute() {
  local now sec sleep_for
  now="$(date +%s)"
  sec=$(( now % 60 ))
  sleep_for=$(( 61 - sec ))
  if (( sleep_for < 1 )); then sleep_for=1; fi
  info "waiting ${sleep_for}s for a fresh minute bucket"
  sleep "${sleep_for}"
}

is_upstream_429_payload() {
  local file="$1"
  [[ -f "${file}" ]] || return 1
  grep -Eq '"code":"1302"|Too Many Requests|速率限制|rate limit' "${file}" 2>/dev/null
}

main() {
  local token project_id endpoint_id
  require_file "${TOKEN_FILE}"

  token="$(cat "${TOKEN_FILE}")"
  project_id="${PROJECT_ID}"
  endpoint_id="${ENDPOINT_ID}"
  [[ -n "${token}" && -n "${project_id}" && -n "${endpoint_id}" ]] || {
    err "required metadata files are empty"
    exit 1
  }
  if ! token_is_valid "${token}"; then
    err "token invalid/expired; run: BASE_URL=http://localhost:3001 make notebook-agent-refresh-token"
    exit 1
  fi

  local base="http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}"
  local endpoint_url="${base}/endpoints/${endpoint_id}"
  local proxy_url="${endpoint_url}/proxy/openai/chat/completions"
  local policy_url="${base}/resources/endpoint/${endpoint_id}/policy"
  local endpoint_meta_file temp_endpoint_meta_file temp_endpoint_id=""
  local endpoint_protocol endpoint_base_url endpoint_model endpoint_credential_ref
  endpoint_meta_file="$(mktemp)"
  temp_endpoint_meta_file="$(mktemp)"

  local endpoint_code
  endpoint_code="$(
    curl -sS -o "${endpoint_meta_file}" -w '%{http_code}' \
      "${endpoint_url}" -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${endpoint_code}" != "200" ]]; then
    err "endpoint lookup failed (HTTP ${endpoint_code}); stale backend-real state? run init-resources"
    exit 1
  fi
  endpoint_protocol="$(cat "${endpoint_meta_file}" | json_get 'process.stdout.write(String(data.protocol||"openai_chat_completions"))')"
  endpoint_base_url="$(cat "${endpoint_meta_file}" | json_get 'process.stdout.write(String(data.base_url||""))')"
  endpoint_model="$(cat "${endpoint_meta_file}" | json_get 'process.stdout.write(String(data.model||""))')"
  endpoint_credential_ref="$(cat "${endpoint_meta_file}" | json_get 'process.stdout.write(String(data.credential_ref||""))')"
  if [[ -z "${endpoint_base_url}" || -z "${endpoint_model}" || -z "${endpoint_credential_ref}" ]]; then
    err "endpoint metadata incomplete for smoke endpoint clone"
    cat "${endpoint_meta_file}" >&2 || true
    exit 1
  fi

  info "creating isolated temporary endpoint for deterministic rate-limit smoke"
  local temp_endpoint_name temp_create_code temp_model endpoints_list_file
  endpoints_list_file="$(mktemp)"
  temp_endpoint_name="gov-policy-smoke-$(date +%s)"
  temp_create_code=""
  curl -sS -o "${endpoints_list_file}" \
    "${base}/endpoints" \
    -H "Authorization: Bearer ${token}" || true
  for candidate_model in "${endpoint_model}" "${BACKEND_REAL_MODEL}"; do
    local model_in_use
    model_in_use="$(cat "${endpoints_list_file}" | json_get "const items=Array.isArray(data.items)?data.items:[]; const hit=items.some((item)=>String(item.model||'')==='${candidate_model}'); process.stdout.write(hit?'1':'0');" || true)"
    if [[ "${model_in_use}" == "1" ]]; then
      continue
    fi
    temp_create_code="$(
      curl -sS -o "${temp_endpoint_meta_file}" -w '%{http_code}' \
        -X POST "${base}/endpoints" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        --data "{
          \"name\":\"${temp_endpoint_name}-${candidate_model//./-}\",
          \"protocol\":\"${endpoint_protocol}\",
          \"base_url\":\"${endpoint_base_url}\",
          \"model\":\"${candidate_model}\",
          \"credential_ref\":\"${endpoint_credential_ref}\"
        }" || true
    )"
    if [[ "${temp_create_code}" == "201" ]]; then
      temp_model="${candidate_model}"
      break
    fi
    local create_error_code
    create_error_code="$(cat "${temp_endpoint_meta_file}" | json_get 'process.stdout.write(String(data.error_code||""))' || true)"
    if [[ "${create_error_code}" != "ENDPOINT_MODEL_CONFLICT" ]]; then
      err "failed to create temporary endpoint for smoke (HTTP ${temp_create_code})"
      cat "${temp_endpoint_meta_file}" >&2 || true
      exit 1
    fi
  done
  if [[ "${temp_create_code}" != "201" || -z "${temp_model:-}" ]]; then
    err "failed to create temporary endpoint: all candidate models conflicted"
    cat "${temp_endpoint_meta_file}" >&2 || true
    exit 1
  fi
  temp_endpoint_id="$(cat "${temp_endpoint_meta_file}" | json_get 'process.stdout.write(String(data.id||""))')"
  if [[ -z "${temp_endpoint_id}" ]]; then
    err "temporary endpoint create response missing id"
    cat "${temp_endpoint_meta_file}" >&2 || true
    exit 1
  fi
  endpoint_id="${temp_endpoint_id}"
  endpoint_url="${base}/endpoints/${endpoint_id}"
  proxy_url="${endpoint_url}/proxy/openai/chat/completions"
  policy_url="${base}/resources/endpoint/${endpoint_id}/policy"

  info "reading current endpoint policy"
  local original_policy_file patch_resp_file req1_file req2_file audit_file usage_file
  original_policy_file="$(mktemp)"
  patch_resp_file="$(mktemp)"
  req1_file="$(mktemp)"
  req2_file="$(mktemp)"
  audit_file="$(mktemp)"
  usage_file="$(mktemp)"
  trap 'op="${original_policy_file:-}"; pr="${patch_resp_file:-}"; r1="${req1_file:-}"; r2="${req2_file:-}"; au="${audit_file:-}"; us="${usage_file:-}"; em="${endpoint_meta_file:-}"; tm="${temp_endpoint_meta_file:-}"; el="${endpoints_list_file:-}"; teid="${temp_endpoint_id:-}"; tk="${token:-}"; pu="${policy_url:-}"; b="${base:-}"; rm -f "${op}" "${pr}" "${r1}" "${r2}" "${au}" "${us}" "${em}" "${tm}" "${el}"; if [[ -n "${tk}" && -n "${op}" && -s "${op}" && -n "${pu}" ]]; then curl -sS -o /dev/null -X PATCH "${pu}" -H "Authorization: Bearer ${tk}" -H "Content-Type: application/json" --data-binary @"${op}" || true; fi; if [[ -n "${tk}" && -n "${teid}" && -n "${b}" ]]; then curl -sS -o /dev/null -X DELETE "${b}/endpoints/${teid}" -H "Authorization: Bearer ${tk}" || true; fi' EXIT

  local policy_get_code
  policy_get_code="$(
    curl -sS -o "${original_policy_file}" -w '%{http_code}' \
      "${policy_url}" -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${policy_get_code}" != "200" ]]; then
    err "failed to read endpoint policy (HTTP ${policy_get_code})"
    exit 1
  fi

  info "patching endpoint policy with RPM=1 for smoke"
  local patch_code
  patch_code="$(
    curl -sS -o "${patch_resp_file}" -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data '{
        "access_mode":"allow_all_members",
        "allowed_subjects":[],
        "rate_limits":{"rules":[{"key":"endpoint.requests_per_minute","value":1}]},
        "spending_limits":{"rules":[]}
      }' || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch endpoint policy for smoke (HTTP ${patch_code})"
    cat "${patch_resp_file}" >&2 || true
    exit 1
  fi

  if [[ "${WAIT_NEXT_MINUTE}" == "1" ]]; then
    wait_until_next_minute
  fi

  local start_time end_time req1_code req2_code retry_after body_err_code
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  info "sending first endpoint request (should pass)"
  req1_code="$(
    curl -sS -o "${req1_file}" -w '%{http_code}' \
      "${proxy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "{\"model\":\"${temp_model}\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}" || true
  )"
  if [[ "${req1_code}" == "429" ]]; then
    if is_upstream_429_payload "${req1_file}"; then
      warn "first request hit upstream/provider rate limit (HTTP 429); skipping this smoke as non-blocking"
      cat "${req1_file}" >&2 || true
      return 0
    fi
    err "first request unexpectedly rate-limited (existing bucket state not reset?)"
    cat "${req1_file}" >&2 || true
    exit 1
  fi
  info "first request HTTP ${req1_code}"

  info "sending second endpoint request (should hit rate limit)"
  req2_code="$(
    curl -sS -D /tmp/gov_policy_smoke_headers.$$ -o "${req2_file}" -w '%{http_code}' \
      "${proxy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "{\"model\":\"${temp_model}\",\"messages\":[{\"role\":\"user\",\"content\":\"ping again\"}]}" || true
  )"
  if [[ "${req2_code}" != "429" ]]; then
    err "second request did not hit rate limit (HTTP ${req2_code})"
    cat "${req2_file}" >&2 || true
    rm -f /tmp/gov_policy_smoke_headers.$$ || true
    exit 1
  fi
  body_err_code="$(cat "${req2_file}" | json_get 'process.stdout.write(String(data.error_code||""))' || true)"
  if [[ "${body_err_code}" != "RESOURCE_POLICY_RATE_LIMITED" ]]; then
    err "unexpected error_code on rate-limited response: ${body_err_code}"
    cat "${req2_file}" >&2 || true
    rm -f /tmp/gov_policy_smoke_headers.$$ || true
    exit 1
  fi
  retry_after="$(node -e 'const fs=require("fs"); const p=process.argv[1]; const t=fs.readFileSync(p,"utf8"); const m=t.match(/^Retry-After:\\s*(\\d+)/mi); process.stdout.write(m?m[1]:"");' /tmp/gov_policy_smoke_headers.$$ || true)"
  rm -f /tmp/gov_policy_smoke_headers.$$ || true
  if [[ -n "${retry_after}" ]]; then
    info "rate limit hit with Retry-After=${retry_after}s"
  else
    info "rate limit hit (no Retry-After parsed)"
  fi

  # Give audit/usage writes a brief settle window.
  sleep 2
  end_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  info "checking audit evidence"
  local audit_code usage_code
  local enc_start enc_end
  enc_start="$(urlencode "${start_time}")"
  enc_end="$(urlencode "${end_time}")"
  audit_code="$(
    curl -sS -o "${audit_file}" -w '%{http_code}' \
      "${base}/audit?start_time=${enc_start}&end_time=${enc_end}&action=resource_policy.rate_limited&page=1&page_size=50" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${audit_code}" != "200" ]]; then
    err "audit query failed (HTTP ${audit_code})"
    cat "${audit_file}" >&2 || true
    exit 1
  fi
  local audit_has
  audit_has="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.action==='resource_policy.rate_limited'&&i.resource_type==='endpoint'&&String(i.resource_id||'')==='${endpoint_id}'); process.stdout.write(ok?'1':'0');")"
  if [[ "${audit_has}" != "1" ]]; then
    err "audit does not contain resource_policy.rate_limited for endpoint ${endpoint_id}"
    cat "${audit_file}" >&2 || true
    exit 1
  fi

  info "checking usage evidence"
  usage_code="$(
    curl -sS -o "${usage_file}" -w '%{http_code}' \
      "${base}/usage?start_time=${enc_start}&end_time=${enc_end}&resource_type=endpoint&resource_id=${endpoint_id}&group_by=hour&page=1&page_size=50" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${usage_code}" != "200" ]]; then
    err "usage query failed (HTTP ${usage_code})"
    cat "${usage_file}" >&2 || true
    exit 1
  fi
  local usage_has
  usage_has="$(cat "${usage_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>String(i.resource_type||'')==='endpoint'&&String(i.resource_id||'')==='${endpoint_id}'&&Number(i.requests||0)>=1); process.stdout.write(ok?'1':'0');")"
  if [[ "${usage_has}" != "1" ]]; then
    err "usage does not contain endpoint usage row for ${endpoint_id}"
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
    err "warning: failed to restore endpoint policy automatically (HTTP ${restore_code})"
    exit 1
  fi
  : > "${original_policy_file}" # prevent trap restore duplicate call
  if [[ -n "${temp_endpoint_id}" ]]; then
    curl -sS -o /dev/null -X DELETE "${base}/endpoints/${temp_endpoint_id}" \
      -H "Authorization: Bearer ${token}" || true
    temp_endpoint_id=""
  fi
  trap - EXIT

  info "OK"
}

main "$@"
