#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

RUN_SMOKE_FIRST="${RUN_SMOKE_FIRST:-1}"
TASK_ID_FILE="${TASK_ID_FILE:-/tmp/agentsmith_last_task_id.txt}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"

info() { echo "[file-read-smoke] $*"; }
err() { echo "[file-read-smoke] ERROR: $*" >&2; }

sanitize_part() {
  local input="$1"
  local out
  out="$(printf '%s' "${input}" | sed -E 's/[^a-zA-Z0-9._-]/_/g' | cut -c1-64)"
  if [[ -z "${out}" ]]; then
    out="unknown_user"
  fi
  printf '%s' "${out}"
}

read_preferred_username() {
  local token="$1"
  curl -sS \
    "${KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/userinfo" \
    -H "Authorization: Bearer ${token}" | \
    node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);if(typeof j.preferred_username==="string"&&j.preferred_username.trim()){process.stdout.write(j.preferred_username.trim());return;}if(typeof j.email==="string"&&j.email.trim()){process.stdout.write(j.email.trim());return;}process.exit(2);}catch{process.exit(2);}})'
}

resolve_task_cwd() {
  local task_id="$1"
  local preferred_username="$2"
  local candidate

  if [[ -n "${preferred_username}" ]]; then
    candidate="/tmp/$(sanitize_part "${preferred_username}")/${task_id}"
    if [[ -d "${candidate}" ]]; then
      printf '%s' "${candidate}"
      return 0
    fi
  fi

  candidate="$(find /tmp -maxdepth 2 -mindepth 2 -type d -name "${task_id}" 2>/dev/null | head -n1 || true)"
  if [[ -n "${candidate}" ]]; then
    printf '%s' "${candidate}"
    return 0
  fi
  return 1
}

main() {
  if [[ "${RUN_SMOKE_FIRST}" == "1" ]]; then
    info "running notebook-agent-smoke-task to produce fresh task workspace"
    (cd "${ROOT_DIR}" && make notebook-agent-smoke-task)
  fi

  if [[ ! -f "${TASK_ID_FILE}" ]]; then
    err "missing task id file: ${TASK_ID_FILE}"
    exit 1
  fi
  if [[ ! -f "${TOKEN_FILE}" ]]; then
    err "missing token file: ${TOKEN_FILE}"
    exit 1
  fi

  local task_id token preferred_username cwd
  task_id="$(tr -d '\r\n' < "${TASK_ID_FILE}")"
  token="$(tr -d '\r\n' < "${TOKEN_FILE}")"
  if [[ -z "${task_id}" || -z "${token}" ]]; then
    err "task id or token is empty"
    exit 1
  fi

  preferred_username="$(read_preferred_username "${token}" || true)"
  cwd="$(resolve_task_cwd "${task_id}" "${preferred_username}" || true)"
  if [[ -z "${cwd}" ]]; then
    err "failed to resolve task workspace path for task_id=${task_id}"
    exit 1
  fi

  local skill_dir script_path skill_md
  skill_dir="${cwd}/.codex/skills/file-read"
  skill_md="${skill_dir}/SKILL.md"
  script_path="${skill_dir}/fetch_input.mjs"

  if [[ ! -d "${skill_dir}" ]]; then
    err "missing file-read skill dir: ${skill_dir}"
    exit 1
  fi
  if [[ ! -f "${skill_md}" ]]; then
    err "missing file-read SKILL.md: ${skill_md}"
    exit 1
  fi
  if [[ ! -f "${script_path}" ]]; then
    err "missing file-read helper script: ${script_path}"
    exit 1
  fi

  if ! grep -q "name: file-read" "${skill_md}"; then
    err "file-read SKILL.md content mismatch: ${skill_md}"
    exit 1
  fi

  info "file-read skill mounted OK"
  info "workspace=${cwd}"
  info "verified files: .codex/skills/file-read/{SKILL.md,fetch_input.mjs}"
}

main "$@"
