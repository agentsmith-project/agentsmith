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

  local token project_id endpoint_id
  token="$(cat "${TOKEN_FILE}")"
  project_id="${PROJECT_ID}"
  endpoint_id="${ENDPOINT_ID:-}"
  [[ -n "${token}" && -n "${project_id}" ]] || {
    err "required metadata/token is empty"
    exit 1
  }
  if ! token_is_valid "${token}"; then
    err "token invalid/expired; run: BASE_URL=http://localhost:3001 make notebook-agent-refresh-token"
    exit 1
  fi

  local base="http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}"
  local policy_url
  local original_policy_file patch_resp_file invalid_resp_file audit_file bootstrap_credential_file bootstrap_endpoint_file
  local bootstrap_credential_id="" temp_endpoint_id=""
  original_policy_file="$(mktemp)"
  patch_resp_file="$(mktemp)"
  invalid_resp_file="$(mktemp)"
  audit_file="$(mktemp)"
  bootstrap_credential_file="$(mktemp)"
  bootstrap_endpoint_file="$(mktemp)"

  if [[ -z "${endpoint_id}" ]]; then
    local suffix bootstrap_credential_code bootstrap_endpoint_code
    suffix="$(date +%s)"
    info "bootstrapping endpoint for policy audit smoke"
    bootstrap_credential_code="$(
      curl -sS -o "${bootstrap_credential_file}" -w '%{http_code}' \
        -X POST "${base}/credentials" \
        -H "Authorization: Bearer ${token}" \
        -H 'Content-Type: application/json' \
        --data '{"name":"gov-policy-update-audit-key-'"${suffix}"'","type":"api_key","value":"sk-gov-policy-update-audit"}' || true
    )"
    if [[ "${bootstrap_credential_code}" != "201" ]]; then
      err "failed to bootstrap credential (HTTP ${bootstrap_credential_code})"
      cat "${bootstrap_credential_file}" >&2 || true
      exit 1
    fi
    bootstrap_credential_id="$(cat "${bootstrap_credential_file}" | json_get 'process.stdout.write(String(data.id||""))')"

    bootstrap_endpoint_code="$(
      curl -sS -o "${bootstrap_endpoint_file}" -w '%{http_code}' \
        -X POST "${base}/endpoints" \
        -H "Authorization: Bearer ${token}" \
        -H 'Content-Type: application/json' \
        --data '{"name":"gov-policy-update-audit-endpoint-'"${suffix}"'","model":"gov-policy-update-audit-model-'"${suffix}"'","type":"openai","mode":"openai","base_url":"https://api.example.invalid","credential_ref":"'"${bootstrap_credential_id}"'"}' || true
    )"
    if [[ "${bootstrap_endpoint_code}" != "201" ]]; then
      err "failed to bootstrap endpoint (HTTP ${bootstrap_endpoint_code})"
      cat "${bootstrap_endpoint_file}" >&2 || true
      exit 1
    fi
    temp_endpoint_id="$(cat "${bootstrap_endpoint_file}" | json_get 'process.stdout.write(String(data.id||""))')"
    endpoint_id="${temp_endpoint_id}"
  fi

  policy_url="${base}/resources/endpoint/${endpoint_id}/policy"

  cleanup() {
    rm -f "${patch_resp_file}" "${invalid_resp_file}" "${audit_file}" "${bootstrap_credential_file}" "${bootstrap_endpoint_file}"
    if [[ -n "${token:-}" && -s "${original_policy_file}" ]]; then
      curl -sS -o /dev/null -X PATCH "${policy_url}" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        --data-binary @"${original_policy_file}" || true
    fi
    if [[ -n "${temp_endpoint_id}" ]]; then
      curl -sS -o /dev/null -X DELETE "${base}/endpoints/${temp_endpoint_id}" \
        -H "Authorization: Bearer ${token}" || true
    fi
    if [[ -n "${bootstrap_credential_id}" ]]; then
      curl -sS -o /dev/null -X DELETE "${base}/credentials/${bootstrap_credential_id}" \
        -H "Authorization: Bearer ${token}" || true
    fi
    rm -f "${original_policy_file}"
  }
  trap cleanup EXIT

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

  local start_time mid_time end_time
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
        "spending_limits":{"rules":[]}
      }' || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch policy (HTTP ${patch_code})"
    cat "${patch_resp_file}" >&2 || true
    exit 1
  fi

  sleep 1
  mid_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  info "sending invalid endpoint policy patch and expecting error audit event"
  local invalid_patch_code
  invalid_patch_code="$(
    curl -sS -o "${invalid_resp_file}" -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      -H 'x-request-id: req_policy_update_invalid' \
      --data '{
        "access_mode":"allow_list",
        "allowed_subjects":[],
        "rate_limits":{"rules":[{"key":"endpoint.invalid_key","value":1}]},
        "spending_limits":{"rules":[]}
      }' || true
  )"
  if [[ "${invalid_patch_code}" != "422" ]]; then
    err "invalid policy patch did not fail as expected (HTTP ${invalid_patch_code})"
    cat "${invalid_resp_file}" >&2 || true
    exit 1
  fi

  sleep 1
  end_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  local enc_start enc_mid enc_end audit_code
  enc_start="$(urlencode "${start_time}")"
  enc_mid="$(urlencode "${mid_time}")"
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

  local audit_has_success audit_has_error
  audit_has_success="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.action==='resource_policy.updated'&&i.result==='ok'&&String(i.resource_type||'')==='resource_policy'&&String(i.resource_id||'')==='endpoint:${endpoint_id}'); process.stdout.write(ok?'1':'0');")"
  audit_has_error="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.action==='resource_policy.updated'&&i.result==='error'&&String(i.resource_type||'')==='resource_policy'&&String(i.resource_id||'')==='endpoint:${endpoint_id}'&&String(i.request_id||'')==='req_policy_update_invalid'&&String(i.error_code||'')==='VALIDATION_ERROR'); process.stdout.write(ok?'1':'0');")"
  if [[ "${audit_has_success}" != "1" ]]; then
    err "audit missing successful resource_policy.updated for endpoint:${endpoint_id}"
    cat "${audit_file}" >&2 || true
    exit 1
  fi
  if [[ "${audit_has_error}" != "1" ]]; then
    err "audit missing failed resource_policy.updated for endpoint:${endpoint_id}"
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
  cleanup
  info "OK"
}

main "$@"
