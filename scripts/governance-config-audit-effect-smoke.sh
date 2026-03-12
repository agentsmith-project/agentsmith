#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

PORT_API="${PORT_API:-20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
PROJECT_ID_FILE="${PROJECT_ID_FILE:-/tmp/agentsmith_project_id.txt}"

info() { echo "[gov-config-audit-smoke] $*"; }
err() { echo "[gov-config-audit-smoke] ERROR: $*" >&2; }

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

credential_file=''
endpoint_ok_file=''
endpoint_conflict_file=''
update_file=''
audit_file=''

cleanup() {
  rm -f "${credential_file:-}" "${endpoint_ok_file:-}" "${endpoint_conflict_file:-}" "${update_file:-}" "${audit_file:-}"
}

main() {
  require_file "${TOKEN_FILE}"
  require_file "${PROJECT_ID_FILE}"

  local token project_id
  token="$(cat "${TOKEN_FILE}")"
  project_id="$(cat "${PROJECT_ID_FILE}")"
  [[ -n "${token}" && -n "${project_id}" ]] || {
    err "required metadata/token is empty"
    exit 1
  }
  if ! token_is_valid "${token}"; then
    err "token invalid/expired; run: BASE_URL=http://localhost:3001 make notebook-agent-refresh-token"
    exit 1
  fi

  local base="http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}"
  local start_time end_time
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  local suffix model credential_id endpoint_ok_id
  suffix="$(date +%s)"
  model="gov-config-audit-model-${suffix}"
  credential_file="$(mktemp)"
  endpoint_ok_file="$(mktemp)"
  endpoint_conflict_file="$(mktemp)"
  update_file="$(mktemp)"
  audit_file="$(mktemp)"
  trap cleanup EXIT

  info "creating credential and expecting audit event"
  local credential_code
  credential_code="$(
    curl -sS -o "${credential_file}" -w '%{http_code}' \
      -X POST "${base}/credentials" \
      -H "Authorization: Bearer ${token}" \
      -H 'Content-Type: application/json' \
      -H 'x-request-id: req_cfg_smoke_credential_create' \
      --data '{"name":"gov-config-audit-key-'"${suffix}"'","type":"api_key","value":"sk-gov-config-audit"}' || true
  )"
  if [[ "${credential_code}" != "201" ]]; then
    err "credential create failed (HTTP ${credential_code})"
    cat "${credential_file}" >&2 || true
    exit 1
  fi
  credential_id="$(cat "${credential_file}" | json_get 'process.stdout.write(String(data.id||""))')"
  [[ -n "${credential_id}" ]] || {
    err "credential create response missing id"
    cat "${credential_file}" >&2 || true
    exit 1
  }

  info "creating endpoint and expecting success audit event"
  local endpoint_ok_code
  endpoint_ok_code="$(
    curl -sS -o "${endpoint_ok_file}" -w '%{http_code}' \
      -X POST "${base}/endpoints" \
      -H "Authorization: Bearer ${token}" \
      -H 'Content-Type: application/json' \
      -H 'x-request-id: req_cfg_smoke_endpoint_create' \
      --data '{"name":"gov-config-audit-endpoint-'"${suffix}"'","model":"'"${model}"'","type":"openai","mode":"openai","base_url":"https://api.example.invalid","credential_ref":"'"${credential_id}"'"}' || true
  )"
  if [[ "${endpoint_ok_code}" != "201" ]]; then
    err "endpoint create failed (HTTP ${endpoint_ok_code})"
    cat "${endpoint_ok_file}" >&2 || true
    exit 1
  fi
  endpoint_ok_id="$(cat "${endpoint_ok_file}" | json_get 'process.stdout.write(String(data.id||""))')"
  [[ -n "${endpoint_ok_id}" ]] || {
    err "endpoint create response missing id"
    cat "${endpoint_ok_file}" >&2 || true
    exit 1
  }

  info "creating conflicting endpoint and expecting error audit event"
  local endpoint_conflict_code
  endpoint_conflict_code="$(
    curl -sS -o "${endpoint_conflict_file}" -w '%{http_code}' \
      -X POST "${base}/endpoints" \
      -H "Authorization: Bearer ${token}" \
      -H 'Content-Type: application/json' \
      -H 'x-request-id: req_cfg_smoke_endpoint_conflict' \
      --data '{"name":"gov-config-audit-endpoint-conflict-'"${suffix}"'","model":"'"${model}"'","type":"openai","mode":"openai","base_url":"https://api.example.invalid","credential_ref":"'"${credential_id}"'"}' || true
  )"
  if [[ "${endpoint_conflict_code}" != "409" ]]; then
    err "endpoint conflict request did not fail as expected (HTTP ${endpoint_conflict_code})"
    cat "${endpoint_conflict_file}" >&2 || true
    exit 1
  fi

  info "updating endpoint and expecting audit event"
  local endpoint_update_code
  endpoint_update_code="$(
    curl -sS -o "${update_file}" -w '%{http_code}' \
      -X PUT "${base}/endpoints/${endpoint_ok_id}" \
      -H "Authorization: Bearer ${token}" \
      -H 'Content-Type: application/json' \
      -H 'x-request-id: req_cfg_smoke_endpoint_update' \
      --data '{"name":"gov-config-audit-endpoint-'"${suffix}"'-updated","model":"'"${model}"'","base_url":"https://api.example.invalid"}' || true
  )"
  if [[ "${endpoint_update_code}" != "200" ]]; then
    err "endpoint update failed (HTTP ${endpoint_update_code})"
    cat "${update_file}" >&2 || true
    exit 1
  fi

  sleep 1
  end_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  local enc_start enc_end audit_code
  enc_start="$(urlencode "${start_time}")"
  enc_end="$(urlencode "${end_time}")"
  info "checking audit evidence for config changes"
  audit_code="$(
    curl -sS -o "${audit_file}" -w '%{http_code}' \
      "${base}/audit?start_time=${enc_start}&end_time=${enc_end}&page=1&page_size=100" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${audit_code}" != "200" ]]; then
    err "audit query failed (HTTP ${audit_code})"
    cat "${audit_file}" >&2 || true
    exit 1
  fi

  local has_credential has_create has_conflict has_update
  has_credential="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.request_id==='req_cfg_smoke_credential_create'&&i.action==='credential.create'&&i.result==='ok'); process.stdout.write(ok?'1':'0');")"
  has_create="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.request_id==='req_cfg_smoke_endpoint_create'&&i.action==='endpoint.create'&&i.result==='ok'); process.stdout.write(ok?'1':'0');")"
  has_conflict="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.request_id==='req_cfg_smoke_endpoint_conflict'&&i.action==='endpoint.create'&&i.result==='error'&&String(i.error_code||'')==='ENDPOINT_MODEL_CONFLICT'); process.stdout.write(ok?'1':'0');")"
  has_update="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.request_id==='req_cfg_smoke_endpoint_update'&&i.action==='endpoint.update'&&i.result==='ok'&&String(i.resource_id||'')==='${endpoint_ok_id}'); process.stdout.write(ok?'1':'0');")"

  if [[ "${has_credential}" != "1" || "${has_create}" != "1" || "${has_conflict}" != "1" || "${has_update}" != "1" ]]; then
    err "audit missing one or more config-change events"
    cat "${audit_file}" >&2 || true
    exit 1
  fi

  info "OK"
}

main "$@"
