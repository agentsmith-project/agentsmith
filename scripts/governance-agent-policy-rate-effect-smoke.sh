#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

PORT_API="${PORT_API:-20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"

info() { echo "[gov-agent-rate-smoke] $*"; }
err() { echo "[gov-agent-rate-smoke] ERROR: $*" >&2; }

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

post_json() {
  local url="$1"
  local token="$2"
  local body="$3"
  local out_file="$4"
  curl -sS -o "${out_file}" -w '%{http_code}' \
    -X POST "${url}" \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    --data "${body}" || true
}

main() {
  require_file "${TOKEN_FILE}"
  require_file /tmp/agentsmith_project_id.txt
  require_file /tmp/agentsmith_agent_id.txt

  local token project_id agent_id user_id
  token="$(cat "${TOKEN_FILE}")"
  project_id="$(cat /tmp/agentsmith_project_id.txt)"
  agent_id="$(cat /tmp/agentsmith_agent_id.txt)"
  user_id="$(jwt_claim "${token}" "sub")"
  [[ -n "${token}" && -n "${project_id}" && -n "${agent_id}" && -n "${user_id}" ]] || {
    err "required metadata/token claims are empty"
    exit 1
  }

  if ! token_is_valid "${token}"; then
    err "token invalid/expired; run: BASE_URL=http://localhost:3001 make notebook-agent-refresh-token"
    exit 1
  fi

  local base="http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}"
  local policy_url="${base}/resources/agent/${agent_id}/policy"

  local original_policy_file patch_resp_file task1_file task2_file msg1_file msg2_file audit_file usage_file
  original_policy_file="$(mktemp)"
  patch_resp_file="$(mktemp)"
  task1_file="$(mktemp)"
  task2_file="$(mktemp)"
  msg1_file="$(mktemp)"
  msg2_file="$(mktemp)"
  audit_file="$(mktemp)"
  usage_file="$(mktemp)"
  trap 'rm -f "${patch_resp_file}" "${task1_file}" "${task2_file}" "${msg1_file}" "${msg2_file}" "${audit_file}" "${usage_file}"; if [[ -n "${token:-}" && -s "${original_policy_file}" ]]; then curl -sS -o /dev/null -X PATCH "${policy_url}" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data-binary @"${original_policy_file}" || true; fi; rm -f "${original_policy_file}"' EXIT

  info "reading current agent policy"
  local get_code
  get_code="$(curl -sS -o "${original_policy_file}" -w '%{http_code}' "${policy_url}" -H "Authorization: Bearer ${token}" || true)"
  if [[ "${get_code}" != "200" ]]; then
    err "failed to read agent policy (HTTP ${get_code})"
    exit 1
  fi

  info "patching agent policy with requests_per_minute=1"
  local patch_code
  patch_code="$(
    curl -sS -o "${patch_resp_file}" -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H 'Content-Type: application/json' \
      --data '{
        "access_mode":"allow_all_members",
        "allowed_subjects":[],
        "rate_limits":{"rules":[{"key":"agent.requests_per_minute","value":1}]},
        "quota_limits":{"rules":[]}
      }' || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch agent policy (HTTP ${patch_code})"
    cat "${patch_resp_file}" >&2 || true
    exit 1
  fi

  local start_time end_time
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  end_time="$(date -u -d '5 minutes' +"%Y-%m-%dT%H:%M:%SZ")"

  info "creating task-1 and posting first run"
  local create_task1_code
  create_task1_code="$(post_json "${base}/tasks" "${token}" "{\"title\":\"gov-agent-rate-smoke-1\",\"agent_id\":\"${agent_id}\"}" "${task1_file}")"
  if [[ "${create_task1_code}" != "201" ]]; then
    err "failed to create task-1 (HTTP ${create_task1_code})"
    cat "${task1_file}" >&2 || true
    exit 1
  fi
  local task1_id
  task1_id="$(cat "${task1_file}" | json_get 'process.stdout.write(String(data.id||""))' || true)"
  [[ -n "${task1_id}" ]] || { err "missing task-1 id"; exit 1; }

  local msg1_code
  msg1_code="$(post_json "${base}/tasks/${task1_id}/messages" "${token}" '{"role":"user","content":"agent rate smoke first"}' "${msg1_file}")"
  if [[ "${msg1_code}" != "200" ]]; then
    err "first task message failed (HTTP ${msg1_code})"
    cat "${msg1_file}" >&2 || true
    exit 1
  fi

  info "creating task-2 and posting second run (should hit agent rate limit preflight)"
  local create_task2_code
  create_task2_code="$(post_json "${base}/tasks" "${token}" "{\"title\":\"gov-agent-rate-smoke-2\",\"agent_id\":\"${agent_id}\"}" "${task2_file}")"
  if [[ "${create_task2_code}" != "201" ]]; then
    err "failed to create task-2 (HTTP ${create_task2_code})"
    cat "${task2_file}" >&2 || true
    exit 1
  fi
  local task2_id
  task2_id="$(cat "${task2_file}" | json_get 'process.stdout.write(String(data.id||""))' || true)"
  [[ -n "${task2_id}" ]] || { err "missing task-2 id"; exit 1; }

  local msg2_code
  msg2_code="$(post_json "${base}/tasks/${task2_id}/messages" "${token}" '{"role":"user","content":"agent rate smoke second"}' "${msg2_file}")"
  if [[ "${msg2_code}" != "200" ]]; then
    err "second task message failed unexpectedly (HTTP ${msg2_code})"
    cat "${msg2_file}" >&2 || true
    exit 1
  fi

  local enc_start enc_end
  enc_start="$(urlencode "${start_time}")"
  enc_end="$(urlencode "${end_time}")"

  info "checking audit evidence for agent rate limit"
  local audit_has="0"
  for _ in $(seq 1 10); do
    local audit_code
    audit_code="$(
      curl -sS -o "${audit_file}" -w '%{http_code}' \
        "${base}/audit?start_time=${enc_start}&end_time=${enc_end}&action=resource_policy.rate_limited&resource_type=agent&resource_id=${agent_id}&page=1&page_size=50" \
        -H "Authorization: Bearer ${token}" || true
    )"
    if [[ "${audit_code}" != "200" ]]; then
      err "audit query failed (HTTP ${audit_code})"
      cat "${audit_file}" >&2 || true
      exit 1
    fi
    audit_has="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.action==='resource_policy.rate_limited'&&String(i.resource_type||'')==='agent'&&String(i.resource_id||'')==='${agent_id}'&&String(i.error_code||'')==='RESOURCE_POLICY_RATE_LIMITED'); process.stdout.write(ok?'1':'0');")"
    if [[ "${audit_has}" == "1" ]]; then
      break
    fi
    sleep 1
  done
  if [[ "${audit_has}" != "1" ]]; then
    err "audit missing resource_policy.rate_limited for agent ${agent_id}"
    cat "${audit_file}" >&2 || true
    exit 1
  fi

  info "checking usage evidence for agent rate limit"
  local usage_has="0"
  for _ in $(seq 1 10); do
    local usage_code
    usage_code="$(
      curl -sS -o "${usage_file}" -w '%{http_code}' \
        "${base}/usage?start_time=${enc_start}&end_time=${enc_end}&resource_type=agent&resource_id=${agent_id}&end_user_id=$(urlencode "${user_id}")&group_by=hour&page=1&page_size=50" \
        -H "Authorization: Bearer ${token}" || true
    )"
    if [[ "${usage_code}" != "200" ]]; then
      err "usage query failed (HTTP ${usage_code})"
      cat "${usage_file}" >&2 || true
      exit 1
    fi
    usage_has="$(cat "${usage_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>String(i.resource_type||'')==='agent'&&String(i.resource_id||'')==='${agent_id}'&&String(i.end_user_id||'')==='${user_id}'&&Number(i.requests||0)>=1); process.stdout.write(ok?'1':'0');")"
    if [[ "${usage_has}" == "1" ]]; then
      break
    fi
    sleep 1
  done
  if [[ "${usage_has}" != "1" ]]; then
    err "usage missing agent row for rate limit evidence agent ${agent_id} user ${user_id}"
    cat "${usage_file}" >&2 || true
    exit 1
  fi

  info "restoring original agent policy"
  local restore_code
  restore_code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H 'Content-Type: application/json' \
      --data-binary @"${original_policy_file}" || true
  )"
  if [[ "${restore_code}" != "200" && "${restore_code}" != "204" ]]; then
    err "failed to restore agent policy (HTTP ${restore_code})"
    exit 1
  fi

  : > "${original_policy_file}"
  trap - EXIT
  rm -f "${patch_resp_file}" "${task1_file}" "${task2_file}" "${msg1_file}" "${msg2_file}" "${audit_file}" "${usage_file}" "${original_policy_file}"
  info "OK"
}

main "$@"
