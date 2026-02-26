#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

PORT_API="${PORT_API:-20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"

info() { echo "[gov-agent-quota-smoke] $*"; }
err() { echo "[gov-agent-quota-smoke] ERROR: $*" >&2; }

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

usage_tokens_for_user_agent() {
  local base="$1"
  local token="$2"
  local agent_id="$3"
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
      "${base}/usage?start_time=${enc_start}&end_time=${enc_end}&resource_type=agent&resource_id=${agent_id}&end_user_id=$(urlencode "${user_id}")&group_by=day&page=1&page_size=50" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${code}" != "200" ]]; then
    err "usage query failed while reading current tokens (HTTP ${code})"
    cat "${out_file}" >&2 || true
    rm -f "${out_file}"
    return 1
  fi
  cat "${out_file}" | json_get "const items=Array.isArray(data.items)?data.items:[]; const row=items.find(i=>String(i.resource_type||'')==='agent'&&String(i.resource_id||'')==='${agent_id}'&&String(i.end_user_id||'')==='${user_id}'); process.stdout.write(String(Number(row?.tokens||0)));"
  rm -f "${out_file}"
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

  local original_policy_file patch_resp_file task_file msg_file audit_file usage_file
  original_policy_file="$(mktemp)"
  patch_resp_file="$(mktemp)"
  task_file="$(mktemp)"
  msg_file="$(mktemp)"
  audit_file="$(mktemp)"
  usage_file="$(mktemp)"
  trap 'rm -f "${patch_resp_file}" "${task_file}" "${msg_file}" "${audit_file}" "${usage_file}"; if [[ -n "${token:-}" && -s "${original_policy_file}" ]]; then curl -sS -o /dev/null -X PATCH "${policy_url}" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data-binary @"${original_policy_file}" || true; fi; rm -f "${original_policy_file}"' EXIT

  info "reading current agent policy"
  local policy_get_code
  policy_get_code="$(
    curl -sS -o "${original_policy_file}" -w '%{http_code}' \
      "${policy_url}" -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${policy_get_code}" != "200" ]]; then
    err "failed to read agent policy (HTTP ${policy_get_code})"
    exit 1
  fi

  local current_tokens
  current_tokens="$(usage_tokens_for_user_agent "${base}" "${token}" "${agent_id}" "${user_id}")"
  info "current agent tokens for user ${user_id} today: ${current_tokens}"
  if [[ "${current_tokens}" == "0" ]]; then
    info "no agent token usage found; running warm-up notebook smoke once"
    if ! env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
      make notebook-agent-smoke-task >/tmp/gov_agent_quota_warmup.log 2>&1; then
      err "warm-up notebook smoke failed; cannot bootstrap agent token usage"
      cat /tmp/gov_agent_quota_warmup.log >&2 || true
      exit 1
    fi
    sleep 2
    current_tokens="$(usage_tokens_for_user_agent "${base}" "${token}" "${agent_id}" "${user_id}")"
    info "agent tokens after warm-up: ${current_tokens}"
    if [[ "${current_tokens}" == "0" ]]; then
      err "agent token usage still 0 after warm-up; cannot deterministically trigger quota"
      exit 1
    fi
  fi

  local quota_limit patch_code
  quota_limit="${current_tokens}"
  info "patching agent policy with daily token quota=${quota_limit}"
  patch_code="$(
    curl -sS -o "${patch_resp_file}" -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H 'Content-Type: application/json' \
      --data "{
        \"access_mode\":\"allow_all_members\",
        \"allowed_subjects\":[],
        \"rate_limits\":{\"rules\":[{\"key\":\"agent.requests_per_minute\",\"value\":1000}]},
        \"quota_limits\":{\"rules\":[{\"key\":\"agent.daily_token_limit\",\"value\":${quota_limit}}]}
      }" || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch agent policy (HTTP ${patch_code})"
    cat "${patch_resp_file}" >&2 || true
    exit 1
  fi

  local start_time end_time
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  end_time="$(date -u -d '5 minutes' +"%Y-%m-%dT%H:%M:%SZ")"

  info "creating task and posting message (should trigger agent quota preflight)"
  local create_task_code
  create_task_code="$(post_json "${base}/tasks" "${token}" "{\"title\":\"gov-agent-quota-smoke\",\"agent_id\":\"${agent_id}\"}" "${task_file}")"
  if [[ "${create_task_code}" != "201" ]]; then
    err "failed to create task (HTTP ${create_task_code})"
    cat "${task_file}" >&2 || true
    exit 1
  fi
  local task_id
  task_id="$(cat "${task_file}" | json_get 'process.stdout.write(String(data.id||""))' || true)"
  [[ -n "${task_id}" ]] || { err "missing task id"; exit 1; }

  local msg_code
  msg_code="$(post_json "${base}/tasks/${task_id}/messages" "${token}" '{"role":"user","content":"agent quota smoke"}' "${msg_file}")"
  if [[ "${msg_code}" != "200" ]]; then
    err "task message post failed (HTTP ${msg_code})"
    cat "${msg_file}" >&2 || true
    exit 1
  fi

  local enc_start enc_end
  enc_start="$(urlencode "${start_time}")"
  enc_end="$(urlencode "${end_time}")"

  info "checking audit evidence for agent quota"
  local audit_has="0"
  for _ in $(seq 1 10); do
    local audit_code
    audit_code="$(
      curl -sS -o "${audit_file}" -w '%{http_code}' \
        "${base}/audit?start_time=${enc_start}&end_time=${enc_end}&action=resource_policy.quota_exceeded&resource_type=agent&resource_id=${agent_id}&actor_id=$(urlencode "${user_id}")&page=1&page_size=50" \
        -H "Authorization: Bearer ${token}" || true
    )"
    if [[ "${audit_code}" != "200" ]]; then
      err "audit query failed (HTTP ${audit_code})"
      cat "${audit_file}" >&2 || true
      exit 1
    fi
    audit_has="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.action==='resource_policy.quota_exceeded'&&String(i.resource_type||'')==='agent'&&String(i.resource_id||'')==='${agent_id}'&&String(i.actor_id||'')==='${user_id}'&&String(i.error_code||'')==='RESOURCE_POLICY_QUOTA_EXCEEDED'); process.stdout.write(ok?'1':'0');")"
    if [[ "${audit_has}" == "1" ]]; then
      break
    fi
    sleep 1
  done
  if [[ "${audit_has}" != "1" ]]; then
    err "audit missing resource_policy.quota_exceeded for agent ${agent_id}"
    cat "${audit_file}" >&2 || true
    exit 1
  fi

  info "checking usage evidence for agent quota"
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
    err "usage missing agent row for quota evidence agent ${agent_id} user ${user_id}"
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
  rm -f "${patch_resp_file}" "${task_file}" "${msg_file}" "${audit_file}" "${usage_file}" "${original_policy_file}"
  info "OK"
}

main "$@"
