#!/usr/bin/env bash

backend_real_state_root() {
  local root_dir="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  printf '%s\n' "${BACKEND_REAL_STATE_DIR:-${root_dir}/artifacts/backend-real/current}"
}

backend_real_state_file() {
  printf '%s/state.json\n' "${BACKEND_REAL_STATE_FILE:-$(backend_real_state_root)}"
}

backend_real_token_file() {
  printf '%s/token.txt\n' "$(backend_real_state_root)"
}

backend_real_summary_file() {
  printf '%s/summary.env\n' "$(backend_real_state_root)"
}

backend_real_demo_root() {
  printf '%s/demo\n' "$(backend_real_state_root)"
}

backend_real_demo_log_file() {
  printf '%s/%s.log\n' "$(backend_real_demo_root)" "$1"
}

backend_real_demo_pid_file() {
  printf '%s/%s.pid\n' "$(backend_real_demo_root)" "$1"
}

backend_real_tmp_file() {
  printf '%s/%s\n' "$(backend_real_state_root)" "$1"
}

backend_real_runs_root() {
  local root_dir="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  printf '%s\n' "${BACKEND_REAL_RUNS_DIR:-${root_dir}/artifacts/backend-real/runs}"
}

backend_real_generate_run_id() {
  local prefix="${1:-run}"
  printf '%s-%s-%s-%s\n' "${prefix}" "$(date -u +%Y%m%dT%H%M%SZ)" "$$" "${RANDOM}"
}

backend_real_new_run_dir() {
  local prefix="${1:-run}"
  local runs_root run_id run_dir
  runs_root="$(backend_real_runs_root)"
  run_id="${BACKEND_REAL_RUN_ID:-$(backend_real_generate_run_id "${prefix}")}"
  run_dir="${runs_root}/${run_id}"
  mkdir -p "${run_dir}"
  printf '%s\n' "${run_dir}"
}

backend_real_run_status_file() {
  local run_dir="$1"
  printf '%s/.status\n' "${run_dir}"
}

backend_real_mark_run_status() {
  local run_dir="$1"
  local status="$2"
  printf '%s\n' "${status}" > "$(backend_real_run_status_file "${run_dir}")"
}

backend_real_read_run_status() {
  local run_dir="$1"
  cat "$(backend_real_run_status_file "${run_dir}")" 2>/dev/null || printf 'incomplete'
}

backend_real_prune_run_dirs() {
  local keep_failed_count="${1:-5}"
  local stale_hours="${2:-24}"
  local runs_root dir stale_cutoff now
  runs_root="$(backend_real_runs_root)"
  mkdir -p "${runs_root}"

  if ! [[ "${keep_failed_count}" =~ ^[0-9]+$ ]] || [[ "${keep_failed_count}" -lt 0 ]]; then
    keep_failed_count=5
  fi
  if ! [[ "${stale_hours}" =~ ^[0-9]+$ ]] || [[ "${stale_hours}" -lt 0 ]]; then
    stale_hours=24
  fi

  now="$(date +%s)"
  stale_cutoff="$((now - (stale_hours * 3600)))"

  while IFS= read -r dir; do
    [[ -n "${dir}" ]] || continue
    case "$(backend_real_read_run_status "${dir}")" in
      success)
        rm -rf "${dir}"
        ;;
      incomplete)
        if [[ "$(stat -c '%Y' "${dir}" 2>/dev/null || printf '0')" -lt "${stale_cutoff}" ]]; then
          rm -rf "${dir}"
        fi
        ;;
    esac
  done < <(find "${runs_root}" -mindepth 1 -maxdepth 1 -type d | sort)

  if [[ "${keep_failed_count}" -eq 0 ]]; then
    find "${runs_root}" -mindepth 1 -maxdepth 1 -type d \
      -exec sh -c '[ "$(cat "$1/.status" 2>/dev/null || printf incomplete)" = "failed" ] && rm -rf "$1"' sh {} \;
    return 0
  fi

  local failed_dirs=()
  while IFS= read -r dir; do
    [[ -n "${dir}" ]] || continue
    failed_dirs+=("${dir}")
  done < <(
    find "${runs_root}" -mindepth 1 -maxdepth 1 -type d \
      -exec sh -c '[ "$(cat "$1/.status" 2>/dev/null || printf incomplete)" = "failed" ] && printf "%s\n" "$1"' sh {} \; \
      | xargs -r ls -1dt 2>/dev/null || true
  )

  local index=0
  for dir in "${failed_dirs[@]}"; do
    index=$((index + 1))
    if [[ "${index}" -gt "${keep_failed_count}" ]]; then
      rm -rf "${dir}"
    fi
  done
}

ensure_backend_real_state() {
  local dir file
  dir="$(backend_real_state_root)"
  file="$(backend_real_state_file)"
  mkdir -p "${dir}"
  mkdir -p "$(backend_real_demo_root)"
  if [[ ! -f "${file}" ]]; then
    printf '{}\n' > "${file}"
  fi
}

state_get() {
  local key="$1"
  local fallback="${2-}"
  ensure_backend_real_state
  node - <<'NODE' "$(backend_real_state_file)" "${key}" "${fallback}"
const fs = require('node:fs');
const [file, path, fallback] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
let value = data;
for (const part of path.split('.')) {
  if (!part) continue;
  value = value?.[part];
}
if (value === undefined || value === null || value === '') {
  process.stdout.write(fallback ?? '');
} else if (typeof value === 'string') {
  process.stdout.write(value);
} else {
  process.stdout.write(JSON.stringify(value));
}
NODE
}

state_set_string() {
  local key="$1"
  local value="${2-}"
  ensure_backend_real_state
  node - <<'NODE' "$(backend_real_state_file)" "${key}" "${value}"
const fs = require('node:fs');
const [file, path, value] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const parts = path.split('.').filter(Boolean);
let cursor = data;
for (let i = 0; i < parts.length - 1; i += 1) {
  const part = parts[i];
  if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
    cursor[part] = {};
  }
  cursor = cursor[part];
}
cursor[parts.at(-1)] = value;
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
NODE
}

state_set_json() {
  local key="$1"
  local json="${2-}"
  ensure_backend_real_state
  node - <<'NODE' "$(backend_real_state_file)" "${key}" "${json}"
const fs = require('node:fs');
const [file, path, raw] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const parts = path.split('.').filter(Boolean);
let cursor = data;
for (let i = 0; i < parts.length - 1; i += 1) {
  const part = parts[i];
  if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
    cursor[part] = {};
  }
  cursor = cursor[part];
}
cursor[parts.at(-1)] = JSON.parse(raw);
fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
NODE
}

state_write_summary() {
  ensure_backend_real_state
  local file
  file="$(backend_real_summary_file)"
  {
    printf 'STATE_DIR=%s\n' "$(backend_real_state_root)"
    printf 'STATE_FILE=%s\n' "$(backend_real_state_file)"
    printf 'TOKEN_FILE=%s\n' "$(backend_real_token_file)"
    printf 'WORKSPACE_ID=%s\n' "$(state_get workspace.id)"
    printf 'PROJECT_ID=%s\n' "$(state_get project.id)"
    printf 'ANTHROPIC_ENDPOINT_ID=%s\n' "$(state_get endpoint.anthropic_id)"
    printf 'OPENAI_ENDPOINT_ID=%s\n' "$(state_get endpoint.openai_id)"
    printf 'AGENT_ID=%s\n' "$(state_get agent.id)"
    printf 'WS_URL=%s\n' "$(state_get agent.ws_url)"
  } > "${file}"
}
