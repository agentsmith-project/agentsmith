#!/usr/bin/env bash

real_lane_state_root() {
  local root_dir="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  printf '%s\n' "${REAL_LANE_STATE_DIR:-${root_dir}/artifacts/real-lane/current}"
}

real_lane_state_file() {
  printf '%s/state.json\n' "${REAL_LANE_STATE_FILE:-$(real_lane_state_root)}"
}

real_lane_token_file() {
  printf '%s/token.txt\n' "$(real_lane_state_root)"
}

real_lane_summary_file() {
  printf '%s/summary.env\n' "$(real_lane_state_root)"
}

real_lane_demo_root() {
  printf '%s/demo\n' "$(real_lane_state_root)"
}

real_lane_demo_log_file() {
  printf '%s/%s.log\n' "$(real_lane_demo_root)" "$1"
}

real_lane_demo_pid_file() {
  printf '%s/%s.pid\n' "$(real_lane_demo_root)" "$1"
}

real_lane_tmp_file() {
  printf '%s/%s\n' "$(real_lane_state_root)" "$1"
}

ensure_real_lane_state() {
  local dir file
  dir="$(real_lane_state_root)"
  file="$(real_lane_state_file)"
  mkdir -p "${dir}"
  mkdir -p "$(real_lane_demo_root)"
  if [[ ! -f "${file}" ]]; then
    printf '{}\n' > "${file}"
  fi
}

state_get() {
  local key="$1"
  local fallback="${2-}"
  ensure_real_lane_state
  node - <<'NODE' "$(real_lane_state_file)" "${key}" "${fallback}"
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
  ensure_real_lane_state
  node - <<'NODE' "$(real_lane_state_file)" "${key}" "${value}"
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
  ensure_real_lane_state
  node - <<'NODE' "$(real_lane_state_file)" "${key}" "${json}"
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
  ensure_real_lane_state
  local file
  file="$(real_lane_summary_file)"
  {
    printf 'STATE_DIR=%s\n' "$(real_lane_state_root)"
    printf 'STATE_FILE=%s\n' "$(real_lane_state_file)"
    printf 'TOKEN_FILE=%s\n' "$(real_lane_token_file)"
    printf 'WORKSPACE_ID=%s\n' "$(state_get workspace.id)"
    printf 'PROJECT_ID=%s\n' "$(state_get project.id)"
    printf 'ENDPOINT_ID=%s\n' "$(state_get endpoint.id)"
    printf 'AGENT_ID=%s\n' "$(state_get agent.id)"
    printf 'WS_URL=%s\n' "$(state_get agent.ws_url)"
  } > "${file}"
}
