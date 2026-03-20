#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

RUN_SMOKE_FIRST="${RUN_SMOKE_FIRST:-1}"
TASK_ID_FILE="${TASK_ID_FILE:-/tmp/agentsmith_last_task_id.txt}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
RUNNER_LOG="${RUNNER_LOG:-/tmp/agentsmith_demo_runner.log}"

info() { echo "[file-read-smoke] $*"; }
err() { echo "[file-read-smoke] ERROR: $*" >&2; }

resolve_task_cwd() {
  local task_id="$1"
  local request_id cwd
  request_id="$(
    rg -n "\"task_id\":\"${task_id}\"" "${RUNNER_LOG}" | tail -n1 | \
    sed -nE 's/.*"request_id":"([^"]+)".*/\1/p'
  )"
  [[ -n "${request_id}" ]] || return 1
  cwd="$(
    rg -n "\"request_id\":\"${request_id}\"" "${RUNNER_LOG}" | \
      rg 'prepared task workspace' | tail -n1 | \
      sed -nE 's/.*"cwd":"([^"]+)".*/\1/p'
  )"
  [[ -n "${cwd}" ]] || return 1
  printf '%s' "${cwd}"
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

  local task_id cwd
  task_id="$(tr -d '\r\n' < "${TASK_ID_FILE}")"
  if [[ -z "${task_id}" ]]; then
    err "task id is empty"
    exit 1
  fi

  cwd="$(resolve_task_cwd "${task_id}" || true)"
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
