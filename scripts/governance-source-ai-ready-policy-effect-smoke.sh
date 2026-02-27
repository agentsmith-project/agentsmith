#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

PORT_API="${PORT_API:-20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"

info() { echo "[gov-source-ai-ready-smoke] $*"; }
err() { echo "[gov-source-ai-ready-smoke] ERROR: $*" >&2; }

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

  local token project_id user_id
  token="$(cat "${TOKEN_FILE}")"
  project_id="$(cat /tmp/agentsmith_project_id.txt)"
  user_id="$(jwt_claim "${token}" "sub")"
  [[ -n "${token}" && -n "${project_id}" && -n "${user_id}" ]] || {
    err "required metadata/token claims are empty"
    exit 1
  }
  if ! token_is_valid "${token}"; then
    err "token invalid/expired; run: BASE_URL=http://localhost:3001 make notebook-agent-refresh-token"
    exit 1
  fi

  local base="http://localhost:${PORT_API}/api/v1/workspaces/${WORKSPACE_ID}/projects/${project_id}"
  local libraries_url="${base}/source-libraries"
  local sources_url="${base}/sources"

  local library_file source_file deny_file allow_file audit_file usage_file policy_file patch_file
  library_file="$(mktemp)"
  source_file="$(mktemp)"
  deny_file="$(mktemp)"
  allow_file="$(mktemp)"
  audit_file="$(mktemp)"
  usage_file="$(mktemp)"
  policy_file="$(mktemp)"
  patch_file="$(mktemp)"
  local library_id="" source_id=""
  trap 'rm -f "${library_file}" "${source_file}" "${deny_file}" "${allow_file}" "${audit_file}" "${usage_file}" "${policy_file}" "${patch_file}"; if [[ -n "${token:-}" && -n "${library_id:-}" && -s "${policy_file}" ]]; then curl -sS -o /dev/null -X PATCH "'"${base}"'/resources/source_library/${library_id}/policy" -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" --data-binary @"${policy_file}" || true; fi; if [[ -n "${token:-}" && -n "${source_id:-}" ]]; then curl -sS -o /dev/null -X DELETE "'"${sources_url}"'/${source_id}" -H "Authorization: Bearer ${token}" || true; fi; if [[ -n "${token:-}" && -n "${library_id:-}" ]]; then curl -sS -o /dev/null -X DELETE "'"${libraries_url}"'/${library_id}" -H "Authorization: Bearer ${token}" || true; fi' EXIT

  info "creating source library and source"
  local create_library_code
  create_library_code="$(
    curl -sS -o "${library_file}" -w '%{http_code}' \
      -X POST "${libraries_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data '{"name":"gov-source-ai-ready-smoke","visibility":"shared"}' || true
  )"
  if [[ "${create_library_code}" != "201" ]]; then
    err "failed to create source library (HTTP ${create_library_code})"
    cat "${library_file}" >&2 || true
    exit 1
  fi
  library_id="$(cat "${library_file}" | json_get 'process.stdout.write(String(data.id||""))')"
  [[ -n "${library_id}" ]] || { err "source library id missing"; cat "${library_file}" >&2 || true; exit 1; }

  local payload_b64
  payload_b64="$(node -e 'process.stdout.write(Buffer.from("ai-ready-policy-smoke","utf8").toString("base64"))')"
  local create_source_code
  create_source_code="$(
    curl -sS -o "${source_file}" -w '%{http_code}' \
      -X POST "${sources_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "{\"name\":\"gov-source-ai-ready-smoke.txt\",\"library_id\":\"${library_id}\",\"content_type\":\"text/plain\",\"content_base64\":\"${payload_b64}\"}" || true
  )"
  if [[ "${create_source_code}" != "201" ]]; then
    err "failed to create source (HTTP ${create_source_code})"
    cat "${source_file}" >&2 || true
    exit 1
  fi
  source_id="$(cat "${source_file}" | json_get 'process.stdout.write(String(data.id||""))')"
  [[ -n "${source_id}" ]] || { err "source id missing"; cat "${source_file}" >&2 || true; exit 1; }

  local policy_url="${base}/resources/source_library/${library_id}/policy"
  local policy_get_code
  policy_get_code="$(
    curl -sS -o "${policy_file}" -w '%{http_code}' \
      "${policy_url}" -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${policy_get_code}" != "200" ]]; then
    err "failed to read source library policy (HTTP ${policy_get_code})"
    exit 1
  fi

  info "patching deny policy (allow_list for different user)"
  local patch_code
  patch_code="$(
    curl -sS -o "${patch_file}" -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data '{"access_mode":"allow_list","allowed_subjects":[{"subject_type":"user","subject_id":"someone_else"}]}' || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch deny policy (HTTP ${patch_code})"
    cat "${patch_file}" >&2 || true
    exit 1
  fi

  local start_time end_time deny_code deny_err
  start_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  info "calling source ai-ready start (should be denied)"
  deny_code="$(
    curl -sS -o "${deny_file}" -w '%{http_code}' \
      -X POST "${sources_url}/${source_id}/ai-ready/start" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${deny_code}" != "403" ]]; then
    err "expected 403 on deny policy, got HTTP ${deny_code}"
    cat "${deny_file}" >&2 || true
    exit 1
  fi
  deny_err="$(cat "${deny_file}" | json_get 'process.stdout.write(String(data.error_code||""))' || true)"
  if [[ "${deny_err}" != "RESOURCE_POLICY_DENIED" ]]; then
    err "unexpected deny error_code: ${deny_err}"
    cat "${deny_file}" >&2 || true
    exit 1
  fi
  sleep 1
  end_time="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  local enc_start enc_end audit_code usage_code
  enc_start="$(urlencode "${start_time}")"
  enc_end="$(urlencode "${end_time}")"
  info "checking audit evidence"
  audit_code="$(
    curl -sS -o "${audit_file}" -w '%{http_code}' \
      "${base}/audit?start_time=${enc_start}&end_time=${enc_end}&action=resource_policy.access_denied&actor_id=$(urlencode "${user_id}")&resource_type=source_library&resource_id=${library_id}&page=1&page_size=50" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${audit_code}" != "200" ]]; then
    err "audit query failed (HTTP ${audit_code})"
    cat "${audit_file}" >&2 || true
    exit 1
  fi
  local audit_has
  audit_has="$(cat "${audit_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>i.action==='resource_policy.access_denied'&&String(i.resource_type||'')==='source_library'&&String(i.resource_id||'')==='${library_id}'&&String(i.error_code||'')==='RESOURCE_POLICY_DENIED'); process.stdout.write(ok?'1':'0');")"
  if [[ "${audit_has}" != "1" ]]; then
    err "audit missing deny evidence for source_library ${library_id}"
    cat "${audit_file}" >&2 || true
    exit 1
  fi

  info "checking usage evidence"
  usage_code="$(
    curl -sS -o "${usage_file}" -w '%{http_code}' \
      "${base}/usage?start_time=${enc_start}&end_time=${enc_end}&resource_type=source_library&resource_id=${library_id}&end_user_id=$(urlencode "${user_id}")&group_by=hour&page=1&page_size=50" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${usage_code}" != "200" ]]; then
    err "usage query failed (HTTP ${usage_code})"
    cat "${usage_file}" >&2 || true
    exit 1
  fi
  local usage_has
  usage_has="$(cat "${usage_file}" | json_get "const ok=Array.isArray(data.items)&&data.items.some(i=>String(i.resource_type||'')==='source_library'&&String(i.resource_id||'')==='${library_id}'&&String(i.end_user_id||'')==='${user_id}'&&Number(i.requests||0)>=1); process.stdout.write(ok?'1':'0');")"
  if [[ "${usage_has}" != "1" ]]; then
    err "usage missing denied row for source_library ${library_id}"
    cat "${usage_file}" >&2 || true
    exit 1
  fi

  info "patching allow policy for current user"
  patch_code="$(
    curl -sS -o "${patch_file}" -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data "{\"access_mode\":\"allow_list\",\"allowed_subjects\":[{\"subject_type\":\"user\",\"subject_id\":\"${user_id}\"}]}" || true
  )"
  if [[ "${patch_code}" != "200" && "${patch_code}" != "204" ]]; then
    err "failed to patch allow policy (HTTP ${patch_code})"
    cat "${patch_file}" >&2 || true
    exit 1
  fi

  local allow_code
  allow_code="$(
    curl -sS -o "${allow_file}" -w '%{http_code}' \
      -X POST "${sources_url}/${source_id}/ai-ready/start" \
      -H "Authorization: Bearer ${token}" || true
  )"
  if [[ "${allow_code}" != "200" && "${allow_code}" != "429" ]]; then
    err "expected 200 after allow policy, got HTTP ${allow_code}"
    cat "${allow_file}" >&2 || true
    exit 1
  fi
  if [[ "${allow_code}" == "429" ]]; then
    info "allow-path request hit upstream rate limit (HTTP 429); treating as pass because deny preflight was cleared"
  fi

  info "restoring policy and cleanup"
  local restore_code
  restore_code="$(
    curl -sS -o /dev/null -w '%{http_code}' \
      -X PATCH "${policy_url}" \
      -H "Authorization: Bearer ${token}" \
      -H "Content-Type: application/json" \
      --data-binary @"${policy_file}" || true
  )"
  if [[ "${restore_code}" != "200" && "${restore_code}" != "204" ]]; then
    err "warning: failed to restore policy (HTTP ${restore_code})"
    exit 1
  fi
  : > "${policy_file}"
  trap - EXIT
  rm -f "${library_file}" "${source_file}" "${deny_file}" "${allow_file}" "${audit_file}" "${usage_file}" "${policy_file}" "${patch_file}"
  if [[ -n "${source_id}" ]]; then
    curl -sS -o /dev/null -X DELETE "${sources_url}/${source_id}" -H "Authorization: Bearer ${token}" || true
  fi
  if [[ -n "${library_id}" ]]; then
    curl -sS -o /dev/null -X DELETE "${libraries_url}/${library_id}" -H "Authorization: Bearer ${token}" || true
  fi

  info "OK"
}

main "$@"
