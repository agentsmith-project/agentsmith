#!/usr/bin/env bash

local_runtime_root_dir() {
  if [[ -n "${ROOT_DIR:-}" ]]; then
    printf '%s\n' "${ROOT_DIR}"
    return 0
  fi
  (cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
}

local_runtime_process_state_dir() {
  local root_dir
  root_dir="$(local_runtime_root_dir)"
  printf '%s\n' "${LOCAL_RUNTIME_PROCESS_STATE_DIR:-${root_dir}/artifacts/local-runtime/processes}"
}

local_runtime_now_utc() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

local_runtime_hash_text() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
    return 0
  fi
  cksum | awk '{print $1}'
}

local_runtime_pid_is_alive() {
  local pid="$1"
  [[ -n "${pid}" ]] || return 1
  kill -0 "${pid}" >/dev/null 2>&1 || return 1
  local state
  state="$(ps -p "${pid}" -o stat= 2>/dev/null | awk '{print $1}' || true)"
  [[ "${state}" != Z* ]]
}

local_runtime_process_command() {
  local pid="$1"
  if [[ -r "/proc/${pid}/cmdline" ]]; then
    tr '\0' ' ' <"/proc/${pid}/cmdline" | sed 's/[[:space:]]*$//'
    return 0
  fi
  ps -p "${pid}" -o command= 2>/dev/null || true
}

local_runtime_process_cwd() {
  local pid="$1"
  if [[ -e "/proc/${pid}/cwd" ]]; then
    readlink "/proc/${pid}/cwd" 2>/dev/null || pwd
    return 0
  fi
  pwd
}

local_runtime_process_start_time() {
  local pid="$1"
  local start_time
  [[ -r "/proc/${pid}/stat" ]] || return 1
  start_time="$(awk '{print $22}' "/proc/${pid}/stat" 2>/dev/null || true)"
  [[ -n "${start_time}" ]] || return 1
  printf '%s\n' "${start_time}"
}

local_runtime_process_identity_token() {
  local pid="$1"
  local command cwd start_time command_hash
  local_runtime_pid_is_alive "${pid}" || return 1
  command="$(local_runtime_process_command "${pid}")"
  [[ -n "${command}" ]] || return 1
  cwd="$(local_runtime_process_cwd "${pid}")"
  start_time="$(local_runtime_process_start_time "${pid}" || true)"
  command_hash="$(printf '%s\n%s\n' "${cwd}" "${command}" | local_runtime_hash_text)"
  printf 'pid:%s:start:%s:cmd:%s\n' "${pid}" "${start_time:-unknown}" "${command_hash}"
}

local_runtime_identity_token_start_time() {
  local identity_token="$1"
  [[ "${identity_token}" =~ ^pid:[0-9]+:start:([^:]+):cmd: ]] || return 1
  [[ -n "${BASH_REMATCH[1]}" && "${BASH_REMATCH[1]}" != "unknown" ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
}

local_runtime_capture_process_identity_token() {
  local pid="$1"
  local attempts="${2:-50}"
  local sleep_seconds="${3:-0.02}"
  local attempt token

  for attempt in $(seq 1 "${attempts}"); do
    token="$(local_runtime_process_identity_token "${pid}" || true)"
    if [[ -n "${token}" ]] && local_runtime_identity_token_start_time "${token}" >/dev/null 2>&1; then
      printf '%s\n' "${token}"
      return 0
    fi

    local_runtime_pid_is_alive "${pid}" || return 1
    [[ "${attempt}" -lt "${attempts}" ]] || break
    sleep "${sleep_seconds}"
  done

  return 1
}

local_runtime_process_owner_token() {
  local pid="$1"
  local owner_token
  [[ -r "/proc/${pid}/environ" ]] || return 1
  owner_token="$(tr '\0' '\n' <"/proc/${pid}/environ" 2>/dev/null | sed -n 's/^LOCAL_RUNTIME_OWNER_TOKEN=//p' | head -n 1 || true)"
  [[ -n "${owner_token}" ]] || return 1
  printf '%s\n' "${owner_token}"
}

local_runtime_process_service_kind_matches() {
  local pid="$1"
  local expected_service_kind="$2"
  local live_service_kind
  [[ -n "${expected_service_kind}" ]] || return 1
  [[ -r "/proc/${pid}/environ" ]] || return 1
  live_service_kind="$(tr '\0' '\n' <"/proc/${pid}/environ" 2>/dev/null | sed -n 's/^LOCAL_RUNTIME_SERVICE_KIND=//p' | head -n 1 || true)"
  [[ -n "${live_service_kind}" && "${live_service_kind}" == "${expected_service_kind}" ]]
}

local_runtime_process_tree_root_pid_matches() {
  local pid="$1"
  local expected_root_pid="$2"
  local live_root_pid
  [[ -n "${expected_root_pid}" ]] || return 1
  [[ -r "/proc/${pid}/environ" ]] || return 1
  live_root_pid="$(tr '\0' '\n' <"/proc/${pid}/environ" 2>/dev/null | sed -n 's/^LOCAL_RUNTIME_TREE_ROOT_PID=//p' | head -n 1 || true)"
  [[ -n "${live_root_pid}" && "${live_root_pid}" == "${expected_root_pid}" ]]
}

local_runtime_process_group_id() {
  local pid="$1"
  ps -p "${pid}" -o pgid= 2>/dev/null | awk '{print $1}'
}

local_runtime_process_session_id() {
  local pid="$1"
  ps -p "${pid}" -o sid= 2>/dev/null | awk '{print $1}'
}

local_runtime_same_session_or_group_pids() {
  local expected_group_id="${1:-}"
  local expected_session_id="${2:-}"
  [[ -n "${expected_group_id}" || -n "${expected_session_id}" ]] || return 0
  ps -e -o pid=,pgid=,sid= 2>/dev/null | awk -v expected_group_id="${expected_group_id}" -v expected_session_id="${expected_session_id}" '
    {
      if ((expected_group_id != "" && $2 == expected_group_id) || (expected_session_id != "" && $3 == expected_session_id)) {
        print $1
      }
    }
  ' | awk 'NF && !seen[$1]++'
}

local_runtime_all_process_pids() {
  ps -e -o pid= 2>/dev/null | awk 'NF && !seen[$1]++'
}

local_runtime_filter_owned_tree_candidate_pids() {
  local expected_owner_token="$1"
  local expected_service_kind="$2"
  local expected_root_pid="$3"
  local tree_pid owner_token service_kind tree_root_pid env_line
  [[ -n "${expected_owner_token}" && -n "${expected_service_kind}" && -n "${expected_root_pid}" ]] || return 0
  while read -r tree_pid; do
    [[ -n "${tree_pid}" ]] || continue
    [[ -r "/proc/${tree_pid}/environ" ]] || continue
    owner_token=""
    service_kind=""
    tree_root_pid=""
    while IFS= read -r env_line; do
      case "${env_line}" in
        LOCAL_RUNTIME_OWNER_TOKEN=*)
          owner_token="${env_line#LOCAL_RUNTIME_OWNER_TOKEN=}"
          ;;
        LOCAL_RUNTIME_SERVICE_KIND=*)
          service_kind="${env_line#LOCAL_RUNTIME_SERVICE_KIND=}"
          ;;
        LOCAL_RUNTIME_TREE_ROOT_PID=*)
          tree_root_pid="${env_line#LOCAL_RUNTIME_TREE_ROOT_PID=}"
          ;;
      esac
    done < <(tr '\0' '\n' <"/proc/${tree_pid}/environ" 2>/dev/null || true)
    [[ "${owner_token}" == "${expected_owner_token}" ]] || continue
    [[ "${service_kind}" == "${expected_service_kind}" ]] || continue
    [[ "${tree_root_pid}" == "${expected_root_pid}" ]] || continue
    printf '%s\n' "${tree_pid}"
  done
}

local_runtime_owned_tree_process_pids() {
  local expected_owner_token="$1"
  local expected_service_kind="$2"
  local expected_root_pid="$3"
  local expected_group_id="${4:-}"
  local expected_session_id="${5:-}"
  local_runtime_same_session_or_group_pids "${expected_group_id}" "${expected_session_id}" \
    | local_runtime_filter_owned_tree_candidate_pids "${expected_owner_token}" "${expected_service_kind}" "${expected_root_pid}"
}

local_runtime_owned_tree_process_pids_all() {
  local expected_owner_token="$1"
  local expected_service_kind="$2"
  local expected_root_pid="$3"
  [[ -n "${expected_owner_token}" && -n "${expected_service_kind}" && -n "${expected_root_pid}" ]] || return 0
  LOCAL_RUNTIME_SCAN_OWNER_TOKEN="${expected_owner_token}" \
  LOCAL_RUNTIME_SCAN_SERVICE_KIND="${expected_service_kind}" \
  LOCAL_RUNTIME_SCAN_ROOT_PID="${expected_root_pid}" \
  node <<'NODE'
const fs = require('node:fs');

const expectedOwnerToken = process.env.LOCAL_RUNTIME_SCAN_OWNER_TOKEN;
const expectedServiceKind = process.env.LOCAL_RUNTIME_SCAN_SERVICE_KIND;
const expectedRootPid = process.env.LOCAL_RUNTIME_SCAN_ROOT_PID;
const matches = [];

for (const entry of fs.readdirSync('/proc', { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
    continue;
  }

  let envText;
  try {
    envText = fs.readFileSync(`/proc/${entry.name}/environ`, 'utf8');
  } catch {
    continue;
  }

  let ownerToken = '';
  let serviceKind = '';
  let treeRootPid = '';

  for (const envLine of envText.split('\0')) {
    if (!ownerToken && envLine.startsWith('LOCAL_RUNTIME_OWNER_TOKEN=')) {
      ownerToken = envLine.slice('LOCAL_RUNTIME_OWNER_TOKEN='.length);
      continue;
    }
    if (!serviceKind && envLine.startsWith('LOCAL_RUNTIME_SERVICE_KIND=')) {
      serviceKind = envLine.slice('LOCAL_RUNTIME_SERVICE_KIND='.length);
      continue;
    }
    if (!treeRootPid && envLine.startsWith('LOCAL_RUNTIME_TREE_ROOT_PID=')) {
      treeRootPid = envLine.slice('LOCAL_RUNTIME_TREE_ROOT_PID='.length);
      continue;
    }
    if (ownerToken && serviceKind && treeRootPid) {
      break;
    }
  }

  if (ownerToken !== expectedOwnerToken || serviceKind !== expectedServiceKind || treeRootPid !== expectedRootPid) {
    continue;
  }

  matches.push(entry.name);
}

if (matches.length > 0) {
  process.stdout.write(`${matches.join('\n')}\n`);
}
NODE
}

local_runtime_sidecar_file_for() {
  local service_kind="$1"
  local pid="$2"
  local port="$3"
  local state_dir
  state_dir="$(local_runtime_process_state_dir)"
  printf '%s/%s-%s-%s.json\n' "${state_dir}" "${service_kind}" "${port}" "${pid}"
}

local_runtime_write_process_sidecar() {
  local service_kind="$1"
  local pid="$2"
  local port="$3"
  local command="$4"
  local state_dir sidecar_file token cwd started_at run_id line_kind owner_token process_group_id session_id identity_attempts identity_sleep_seconds

  state_dir="$(local_runtime_process_state_dir)"
  mkdir -p "${state_dir}"
  sidecar_file="$(local_runtime_sidecar_file_for "${service_kind}" "${pid}" "${port}")"
  identity_attempts="$(local_runtime_sidecar_identity_capture_attempts)"
  identity_sleep_seconds="$(local_runtime_sidecar_identity_capture_sleep_seconds)"
  token="$(local_runtime_capture_process_identity_token "${pid}" "${identity_attempts}" "${identity_sleep_seconds}")" || {
    echo "[local-runtime-processes] cannot capture process identity for ${service_kind} pid ${pid}" >&2
    return 1
  }
  cwd="$(local_runtime_process_cwd "${pid}")"
  started_at="$(local_runtime_now_utc)"
  run_id="${LOCAL_RUNTIME_RUN_ID:-local-runtime-$$}"
  line_kind="${LOCAL_RUNTIME_LINE_KIND:-local_runtime}"
  owner_token="${LOCAL_RUNTIME_OWNER_TOKEN:-${run_id}:${line_kind}:$$}"
  process_group_id="$(local_runtime_process_group_id "${pid}" || true)"
  session_id="$(local_runtime_process_session_id "${pid}" || true)"

  LOCAL_RUNTIME_SIDECAR_FILE="${sidecar_file}" \
  LOCAL_RUNTIME_SIDECAR_SCHEMA_VERSION="2" \
  LOCAL_RUNTIME_SIDECAR_RUN_ID="${run_id}" \
  LOCAL_RUNTIME_SIDECAR_LINE_KIND="${line_kind}" \
  LOCAL_RUNTIME_SIDECAR_SERVICE_KIND="${service_kind}" \
  LOCAL_RUNTIME_SIDECAR_PID="${pid}" \
  LOCAL_RUNTIME_SIDECAR_PORT="${port}" \
  LOCAL_RUNTIME_SIDECAR_CWD="${cwd}" \
  LOCAL_RUNTIME_SIDECAR_COMMAND="${command}" \
  LOCAL_RUNTIME_SIDECAR_OWNER_TOKEN="${owner_token}" \
  LOCAL_RUNTIME_SIDECAR_STARTED_AT="${started_at}" \
  LOCAL_RUNTIME_SIDECAR_PROCESS_GROUP_ID="${process_group_id}" \
  LOCAL_RUNTIME_SIDECAR_SESSION_ID="${session_id}" \
  LOCAL_RUNTIME_SIDECAR_IDENTITY_TOKEN="${token}" \
  node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const file = process.env.LOCAL_RUNTIME_SIDECAR_FILE;
if (!file) {
  throw new Error('LOCAL_RUNTIME_SIDECAR_FILE is required');
}

const payload = {
  schema_version: Number(process.env.LOCAL_RUNTIME_SIDECAR_SCHEMA_VERSION || '2'),
  run_id: process.env.LOCAL_RUNTIME_SIDECAR_RUN_ID,
  line_kind: process.env.LOCAL_RUNTIME_SIDECAR_LINE_KIND,
  service_kind: process.env.LOCAL_RUNTIME_SIDECAR_SERVICE_KIND,
  pid: Number(process.env.LOCAL_RUNTIME_SIDECAR_PID),
  port: Number(process.env.LOCAL_RUNTIME_SIDECAR_PORT),
  cwd: process.env.LOCAL_RUNTIME_SIDECAR_CWD,
  command: process.env.LOCAL_RUNTIME_SIDECAR_COMMAND,
  owner_token: process.env.LOCAL_RUNTIME_SIDECAR_OWNER_TOKEN,
  started_at: process.env.LOCAL_RUNTIME_SIDECAR_STARTED_AT,
  captured_at: process.env.LOCAL_RUNTIME_SIDECAR_STARTED_AT,
  process_group_id: process.env.LOCAL_RUNTIME_SIDECAR_PROCESS_GROUP_ID
    ? Number(process.env.LOCAL_RUNTIME_SIDECAR_PROCESS_GROUP_ID)
    : null,
  session_id: process.env.LOCAL_RUNTIME_SIDECAR_SESSION_ID
    ? Number(process.env.LOCAL_RUNTIME_SIDECAR_SESSION_ID)
    : null,
  captured_by: 'local-runtime-processes',
  process_identity: {
    token: process.env.LOCAL_RUNTIME_SIDECAR_IDENTITY_TOKEN,
    source: 'pid-start-command-cwd',
  },
};

fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

local_runtime_start_owned_service() {
  local service_kind="$1"
  local port="$2"
  local log_file="$3"
  shift 3

  mkdir -p "$(dirname "${log_file}")"

  local run_id line_kind owner_token
  run_id="${LOCAL_RUNTIME_RUN_ID:-local-runtime-$$}"
  line_kind="${LOCAL_RUNTIME_LINE_KIND:-local_runtime}"
  owner_token="${LOCAL_RUNTIME_OWNER_TOKEN:-${run_id}:${line_kind}:$$}"

  (
    export LOCAL_RUNTIME_RUN_ID="${run_id}"
    export LOCAL_RUNTIME_LINE_KIND="${line_kind}"
    export LOCAL_RUNTIME_OWNER_TOKEN="${owner_token}"
    export LOCAL_RUNTIME_SERVICE_KIND="${service_kind}"
    export LOCAL_RUNTIME_TREE_ROOT_PID="${BASHPID}"
    exec "$@"
  ) >"${log_file}" 2>&1 &

  local pid="$!"
  local command="$*"
  if ! local_runtime_write_process_sidecar "${service_kind}" "${pid}" "${port}" "${command}"; then
    kill "${pid}" >/dev/null 2>&1 || true
    return 1
  fi
  printf '%s\n' "${pid}"
}

local_runtime_start_detached_owned_service() {
  local service_kind="$1"
  local port="$2"
  local log_file="$3"
  shift 3

  mkdir -p "$(dirname "${log_file}")"

  local run_id line_kind owner_token state_dir pid_capture_file launcher_pid pid command start_wait_attempt
  run_id="${LOCAL_RUNTIME_RUN_ID:-local-runtime-$$}"
  line_kind="${LOCAL_RUNTIME_LINE_KIND:-local_runtime}"
  owner_token="${LOCAL_RUNTIME_OWNER_TOKEN:-${run_id}:${line_kind}:$$}"
  state_dir="$(local_runtime_process_state_dir)"
  mkdir -p "${state_dir}"
  pid_capture_file="${state_dir}/.${service_kind}-${port}-$$.launch.pid"
  rm -f "${pid_capture_file}"

  if command -v setsid >/dev/null 2>&1; then
    setsid bash -c '
      set -euo pipefail
      pid_capture_file="$1"
      run_id="$2"
      line_kind="$3"
      owner_token="$4"
      service_kind="$5"
      shift 5
      export LOCAL_RUNTIME_RUN_ID="${run_id}"
      export LOCAL_RUNTIME_LINE_KIND="${line_kind}"
      export LOCAL_RUNTIME_OWNER_TOKEN="${owner_token}"
      export LOCAL_RUNTIME_SERVICE_KIND="${service_kind}"
      export LOCAL_RUNTIME_TREE_ROOT_PID="${BASHPID}"
      printf "%s\n" "${BASHPID}" > "${pid_capture_file}"
      exec "$@"
    ' local-runtime-owned-detached "${pid_capture_file}" "${run_id}" "${line_kind}" "${owner_token}" "${service_kind}" "$@" >"${log_file}" 2>&1 < /dev/null &
  else
    nohup bash -c '
      set -euo pipefail
      pid_capture_file="$1"
      run_id="$2"
      line_kind="$3"
      owner_token="$4"
      service_kind="$5"
      shift 5
      export LOCAL_RUNTIME_RUN_ID="${run_id}"
      export LOCAL_RUNTIME_LINE_KIND="${line_kind}"
      export LOCAL_RUNTIME_OWNER_TOKEN="${owner_token}"
      export LOCAL_RUNTIME_SERVICE_KIND="${service_kind}"
      export LOCAL_RUNTIME_TREE_ROOT_PID="${BASHPID}"
      printf "%s\n" "${BASHPID}" > "${pid_capture_file}"
      exec "$@"
    ' local-runtime-owned-detached "${pid_capture_file}" "${run_id}" "${line_kind}" "${owner_token}" "${service_kind}" "$@" >"${log_file}" 2>&1 < /dev/null &
  fi

  launcher_pid="$!"
  pid=""
  for start_wait_attempt in $(seq 1 50); do
    if [[ -s "${pid_capture_file}" ]]; then
      pid="$(cat "${pid_capture_file}" 2>/dev/null || true)"
      break
    fi
    sleep 0.02
  done
  rm -f "${pid_capture_file}"
  pid="${pid:-${launcher_pid}}"
  command="$*"
  if ! local_runtime_write_process_sidecar "${service_kind}" "${pid}" "${port}" "${command}"; then
    kill "${pid}" >/dev/null 2>&1 || true
    return 1
  fi
  printf '%s\n' "${pid}"
}

local_runtime_find_sidecar() {
  local pid="$1"
  local service_kind="${2:-}"
  local port="${3:-}"
  local state_dir
  state_dir="$(local_runtime_process_state_dir)"
  [[ -d "${state_dir}" ]] || return 1

  LOCAL_RUNTIME_FIND_DIR="${state_dir}" \
  LOCAL_RUNTIME_FIND_PID="${pid}" \
  LOCAL_RUNTIME_FIND_SERVICE_KIND="${service_kind}" \
  LOCAL_RUNTIME_FIND_PORT="${port}" \
  node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const dir = process.env.LOCAL_RUNTIME_FIND_DIR;
const pid = Number(process.env.LOCAL_RUNTIME_FIND_PID);
const serviceKind = process.env.LOCAL_RUNTIME_FIND_SERVICE_KIND || '';
const port = process.env.LOCAL_RUNTIME_FIND_PORT ? Number(process.env.LOCAL_RUNTIME_FIND_PORT) : null;
const matches = [];

for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.json')) {
    continue;
  }
  const file = path.join(dir, name);
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (![1, 2].includes(payload.schema_version) || payload.pid !== pid) {
      continue;
    }
    if (serviceKind && payload.service_kind !== serviceKind) {
      continue;
    }
    if (port !== null && payload.port !== port) {
      continue;
    }
    matches.push({ file, started_at: payload.started_at || '' });
  } catch {
    continue;
  }
}

matches.sort((left, right) => String(right.started_at).localeCompare(String(left.started_at)));
if (matches.length === 0) {
  process.exit(1);
}
process.stdout.write(matches[0].file);
NODE
}

local_runtime_read_sidecar_field() {
  local sidecar_file="$1"
  local field_path="$2"
  LOCAL_RUNTIME_READ_SIDECAR="${sidecar_file}" \
  LOCAL_RUNTIME_READ_FIELD="${field_path}" \
  node <<'NODE'
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(process.env.LOCAL_RUNTIME_READ_SIDECAR, 'utf8'));
const value = String(process.env.LOCAL_RUNTIME_READ_FIELD || '')
  .split('.')
  .filter(Boolean)
  .reduce((current, part) => (current && typeof current === 'object' ? current[part] : undefined), payload);
if (value === undefined || value === null) {
  process.exit(1);
}
process.stdout.write(String(value));
NODE
}

local_runtime_verify_exec_handoff_identity() {
  local pid="$1"
  local sidecar_file="$2"
  local sidecar_token="$3"
  local schema_version sidecar_start_time live_start_time owner_token service_kind

  schema_version="$(local_runtime_read_sidecar_field "${sidecar_file}" schema_version || true)"
  [[ "${schema_version}" == "2" ]] || return 1

  sidecar_start_time="$(local_runtime_identity_token_start_time "${sidecar_token}" || true)"
  live_start_time="$(local_runtime_process_start_time "${pid}" || true)"
  [[ -n "${sidecar_start_time}" && -n "${live_start_time}" && "${sidecar_start_time}" == "${live_start_time}" ]] || return 1

  owner_token="$(local_runtime_read_sidecar_field "${sidecar_file}" owner_token || true)"
  [[ -n "${owner_token}" ]] || return 1
  local_runtime_process_owner_token_matches "${pid}" "${owner_token}" || return 1

  service_kind="$(local_runtime_read_sidecar_field "${sidecar_file}" service_kind || true)"
  [[ -n "${service_kind}" ]] || return 1
  local_runtime_process_service_kind_matches "${pid}" "${service_kind}" || return 1

  local_runtime_process_tree_root_pid_matches "${pid}" "${pid}" || return 1
}

local_runtime_verify_owned_process() {
  local pid="$1"
  local service_kind="${2:-}"
  local port="${3:-}"
  local sidecar_file owner_token sidecar_token live_token

  sidecar_file="$(local_runtime_find_sidecar "${pid}" "${service_kind}" "${port}")" || {
    echo "[local-runtime-processes] ownership verification failed for pid ${pid}: missing sidecar" >&2
    return 1
  }

  if [[ -n "${LOCAL_RUNTIME_OWNER_TOKEN:-}" ]]; then
    owner_token="$(local_runtime_read_sidecar_field "${sidecar_file}" owner_token || true)"
    if [[ "${owner_token}" != "${LOCAL_RUNTIME_OWNER_TOKEN}" ]]; then
      echo "[local-runtime-processes] ownership verification failed for pid ${pid}: owner token mismatch" >&2
      return 1
    fi
  fi

  sidecar_token="$(local_runtime_read_sidecar_field "${sidecar_file}" process_identity.token || true)"
  live_token="$(local_runtime_process_identity_token "${pid}" || true)"
  if [[ -z "${sidecar_token}" || -z "${live_token}" || "${sidecar_token}" != "${live_token}" ]]; then
    if [[ -n "${sidecar_token}" ]] && local_runtime_verify_exec_handoff_identity "${pid}" "${sidecar_file}" "${sidecar_token}"; then
      return 0
    fi
    echo "[local-runtime-processes] ownership verification failed for pid ${pid}: process identity mismatch" >&2
    return 1
  fi
}

local_runtime_parent_pid() {
  local pid="$1"
  ps -p "${pid}" -o ppid= 2>/dev/null | awk '{print $1}'
}

local_runtime_pid_has_ancestor() {
  local pid="$1"
  local expected_ancestor_pid="$2"
  local current_pid="${pid}"
  local parent_pid
  [[ -n "${current_pid}" && -n "${expected_ancestor_pid}" ]] || return 1

  for _ in $(seq 1 32); do
    parent_pid="$(local_runtime_parent_pid "${current_pid}")"
    [[ -n "${parent_pid}" && "${parent_pid}" != "${current_pid}" && "${parent_pid}" != "0" ]] || return 1
    [[ "${parent_pid}" == "${expected_ancestor_pid}" ]] && return 0
    current_pid="${parent_pid}"
  done

  return 1
}

local_runtime_verified_owner_pid_for_tree_member() {
  local pid="$1"
  local service_kind="${2:-}"
  local port="${3:-}"
  local current_pid="${pid}"
  local parent_pid

  for _ in $(seq 1 32); do
    [[ -n "${current_pid}" ]] || return 1
    if local_runtime_verify_owned_process "${current_pid}" "${service_kind}" "${port}" >/dev/null 2>&1; then
      printf '%s\n' "${current_pid}"
      return 0
    fi
    parent_pid="$(local_runtime_parent_pid "${current_pid}")"
    [[ -n "${parent_pid}" && "${parent_pid}" != "${current_pid}" && "${parent_pid}" != "0" ]] || return 1
    current_pid="${parent_pid}"
  done

  return 1
}

local_runtime_descendant_pids() {
  local root_pid="$1"
  local child
  while read -r child; do
    [[ -n "${child}" ]] || continue
    local_runtime_descendant_pids "${child}"
    printf '%s\n' "${child}"
  done < <(pgrep -P "${root_pid}" 2>/dev/null || true)
}

local_runtime_process_tree_pids() {
  local root_pid="$1"
  {
    local_runtime_descendant_pids "${root_pid}"
    printf '%s\n' "${root_pid}"
  } | awk 'NF && !seen[$1]++'
}

local_runtime_captured_pid_identity_matches() {
  local pid="$1"
  local expected_token="$2"
  local live_token
  live_token="$(local_runtime_process_identity_token "${pid}" || true)"
  [[ -n "${expected_token}" && -n "${live_token}" && "${live_token}" == "${expected_token}" ]]
}

local_runtime_process_owner_token_matches() {
  local pid="$1"
  local expected_owner_token="$2"
  local live_owner_token
  [[ -n "${expected_owner_token}" ]] || return 1
  live_owner_token="$(local_runtime_process_owner_token "${pid}" || true)"
  [[ -n "${live_owner_token}" && "${live_owner_token}" == "${expected_owner_token}" ]]
}

local_runtime_tracked_pid_ownership_status() {
  local pid="$1"
  local expected_token="${2:-}"
  local expected_owner_token="${3:-}"
  local role="${4:-descendant}"
  local expected_start_time="${5:-}"
  local live_token live_start_time

  if ! local_runtime_pid_is_alive "${pid}"; then
    printf 'exited\n'
    return 0
  fi

  live_token="$(local_runtime_process_identity_token "${pid}" || true)"
  if [[ -n "${expected_token}" && -n "${live_token}" && "${live_token}" == "${expected_token}" ]]; then
    printf 'identity_match\n'
    return 0
  fi

  if [[ "${role}" == "root" ]]; then
    if [[ -z "${live_token}" ]]; then
      printf 'identity_unknown\n'
      return 0
    fi
    printf 'identity_changed\n'
    return 0
  fi

  if [[ -n "${expected_token}" && -n "${live_token}" ]]; then
    printf 'identity_changed\n'
    return 0
  fi

  if local_runtime_process_owner_token_matches "${pid}" "${expected_owner_token}"; then
    printf 'owner_token_match\n'
    return 0
  fi

  if [[ -n "${expected_start_time}" ]]; then
    live_start_time="$(local_runtime_process_start_time "${pid}" || true)"
    if [[ -n "${live_start_time}" && "${live_start_time}" == "${expected_start_time}" ]]; then
      printf 'start_time_match\n'
      return 0
    fi
  fi

  if [[ -z "${live_token}" ]]; then
    printf 'identity_unknown\n'
    return 0
  fi

  printf 'identity_changed\n'
}

local_runtime_tracked_pid_refusal_reason() {
  local ownership_status="$1"
  local role="${2:-descendant}"
  case "${ownership_status}" in
    identity_unknown)
      if [[ "${role}" == "root" ]]; then
        printf 'cannot confirm root process identity\n'
        return 0
      fi
      printf 'cannot confirm descendant ownership\n'
      return 0
      ;;
    identity_changed)
      printf 'captured process identity changed\n'
      return 0
      ;;
  esac

  if [[ "${role}" == "root" ]]; then
    printf 'cannot confirm root process identity\n'
    return 0
  fi
  printf 'cannot confirm descendant ownership\n'
}

local_runtime_all_pids_exited() {
  local pid
  for pid in "$@"; do
    [[ -n "${pid}" ]] || continue
    if local_runtime_pid_is_alive "${pid}"; then
      return 1
    fi
  done
  return 0
}

local_runtime_has_tracked_descendants() {
  local root_pid="$1"
  shift || true
  local tree_pid
  for tree_pid in "$@"; do
    [[ -n "${tree_pid}" && "${tree_pid}" != "${root_pid}" ]] && return 0
  done
  return 1
}

local_runtime_track_owned_tree_candidate_pid() {
  local tree_pid="$1"
  local expected_owner_token="$2"
  local captured_token captured_start_time
  [[ -n "${tree_pid}" ]] || return 1
  [[ -z "${tracked_pids[${tree_pid}]+x}" ]] || return 1

  captured_token="$(local_runtime_process_identity_token "${tree_pid}" || true)"
  captured_start_time="$(local_runtime_process_start_time "${tree_pid}" || true)"
  if [[ -z "${captured_token}" ]]; then
    if ! local_runtime_pid_is_alive "${tree_pid}"; then
      return 1
    fi
    # The candidate stream already narrowed this pid by owner token, service
    # kind, and tree root. Preserve that confirmation even if follow-up token
    # rereads race.
    pids+=("${tree_pid}")
    tracked_pids["${tree_pid}"]=1
    captured_tokens["${tree_pid}"]=""
    captured_start_times["${tree_pid}"]="${captured_start_time}"
    return 0
  fi

  pids+=("${tree_pid}")
  tracked_pids["${tree_pid}"]=1
  captured_tokens["${tree_pid}"]="${captured_token}"
  captured_start_times["${tree_pid}"]="${captured_start_time}"
  return 0
}

local_runtime_discover_owned_tree_candidates_from_stream() {
  local expected_owner_token="$1"
  local tree_pid track_status added_pids=0
  while read -r tree_pid; do
    [[ -n "${tree_pid}" ]] || continue
    if local_runtime_track_owned_tree_candidate_pid "${tree_pid}" "${expected_owner_token}"; then
      track_status=0
    else
      track_status=$?
    fi
    case "${track_status}" in
      0)
        added_pids=1
        ;;
      1)
        ;;
      *)
        return "${track_status}"
        ;;
    esac
  done
  [[ "${added_pids}" -eq 1 ]]
}

local_runtime_discover_owned_tree_candidates_with_quiesce() {
  local expected_owner_token="$1"
  local service_kind="$2"
  local root_pid="$3"
  local sleep_seconds="$4"
  local attempts="$5"
  local attempt discover_status added_pids=0

  for attempt in $(seq 1 "${attempts}"); do
    if local_runtime_discover_owned_tree_candidates_from_stream "${expected_owner_token}" \
      < <(local_runtime_owned_tree_process_pids_all "${expected_owner_token}" "${service_kind}" "${root_pid}"); then
      discover_status=0
    else
      discover_status=$?
    fi
    case "${discover_status}" in
      0)
        added_pids=1
        ;;
      1)
        ;;
      *)
        return "${discover_status}"
        ;;
    esac
    [[ "${attempt}" -lt "${attempts}" ]] || break
    sleep "${sleep_seconds}"
  done

  [[ "${added_pids}" -eq 1 ]]
}

local_runtime_discover_same_session_or_group_owned_tree_candidates() {
  local expected_owner_token="$1"
  local service_kind="$2"
  local root_pid="$3"
  local root_process_group_id="${4:-}"
  local root_session_id="${5:-}"
  local discover_status
  [[ -n "${root_process_group_id}" || -n "${root_session_id}" ]] || return 1

  if local_runtime_discover_owned_tree_candidates_from_stream "${expected_owner_token}" \
    < <(local_runtime_owned_tree_process_pids "${expected_owner_token}" "${service_kind}" "${root_pid}" "${root_process_group_id}" "${root_session_id}"); then
    return 0
  fi
  discover_status=$?
  case "${discover_status}" in
    1)
      return 1
      ;;
  esac
  return "${discover_status}"
}

local_runtime_discover_authoritative_descendants_for_tracked_pids() {
  local expected_owner_token="$1"
  local root_pid="$2"
  local expansion_root expansion_role expansion_status discover_status added_pids=0

  for expansion_root in "${pids[@]}"; do
    expansion_role="descendant"
    [[ "${expansion_root}" == "${root_pid}" ]] && expansion_role="root"
    expansion_status="$(local_runtime_tracked_pid_ownership_status "${expansion_root}" "${captured_tokens[${expansion_root}]}" "${expected_owner_token}" "${expansion_role}" "${captured_start_times[${expansion_root}]}")"
    case "${expansion_status}" in
      exited)
        continue
        ;;
      identity_match|owner_token_match|start_time_match)
        if local_runtime_discover_owned_tree_candidates_from_stream "${expected_owner_token}" \
          < <(local_runtime_descendant_pids "${expansion_root}"); then
          discover_status=0
        else
          discover_status=$?
        fi
        case "${discover_status}" in
          0)
            added_pids=1
            ;;
          1)
            ;;
          *)
            return "${discover_status}"
            ;;
        esac
        ;;
      *)
        if [[ "${expansion_role}" == "root" ]] && local_runtime_pid_is_alive "${expansion_root}"; then
          local refusal_reason
          refusal_reason="$(local_runtime_tracked_pid_refusal_reason "${expansion_status}" "${expansion_role}")"
          echo "[local-runtime-processes] refusing to expand descendants for pid ${expansion_root}: ${refusal_reason}" >&2
          return 2
        fi
        ;;
    esac
  done

  [[ "${added_pids}" -eq 1 ]]
}

local_runtime_discover_descendants_for_tracked_pid_with_quiesce() {
  local expected_owner_token="$1"
  local expansion_root="$2"
  local sleep_seconds="$3"
  local attempts="$4"
  local attempt discover_status added_pids=0

  for attempt in $(seq 1 "${attempts}"); do
    if local_runtime_discover_owned_tree_candidates_from_stream "${expected_owner_token}" \
      < <(local_runtime_descendant_pids "${expansion_root}"); then
      discover_status=0
    else
      discover_status=$?
    fi
    case "${discover_status}" in
      0)
        added_pids=1
        ;;
      1)
        ;;
      *)
        return "${discover_status}"
        ;;
    esac
    [[ "${attempt}" -lt "${attempts}" ]] || break
    sleep "${sleep_seconds}"
  done

  [[ "${added_pids}" -eq 1 ]]
}

local_runtime_quiesce_authoritative_descendant_discovery() {
  local expected_owner_token="$1"
  local root_pid="$2"
  local sleep_seconds="$3"
  local attempts="$4"
  local attempt discover_status added_pids=0

  for attempt in $(seq 1 "${attempts}"); do
    if local_runtime_discover_authoritative_descendants_for_tracked_pids "${expected_owner_token}" "${root_pid}"; then
      discover_status=0
    else
      discover_status=$?
    fi
    case "${discover_status}" in
      0)
        added_pids=1
        ;;
      1)
        ;;
      *)
        return "${discover_status}"
        ;;
    esac
    [[ "${attempt}" -lt "${attempts}" ]] || break
    sleep "${sleep_seconds}"
  done

  [[ "${added_pids}" -eq 1 ]]
}

local_runtime_find_untracked_owned_tree_hint_pid_from_stream() {
  local tree_pid
  while read -r tree_pid; do
    [[ -n "${tree_pid}" ]] || continue
    [[ -z "${tracked_pids[${tree_pid}]+x}" ]] || continue
    local_runtime_pid_is_alive "${tree_pid}" || continue
    printf '%s\n' "${tree_pid}"
    return 0
  done
  return 1
}

local_runtime_find_untracked_owned_tree_hint_pid_with_quiesce() {
  local expected_owner_token="$1"
  local service_kind="$2"
  local root_pid="$3"
  local sleep_seconds="$4"
  local attempts="$5"
  local attempt hint_pid

  for attempt in $(seq 1 "${attempts}"); do
    hint_pid="$(local_runtime_find_untracked_owned_tree_hint_pid_from_stream \
      < <(local_runtime_owned_tree_process_pids_all "${expected_owner_token}" "${service_kind}" "${root_pid}") || true)"
    if [[ -n "${hint_pid}" ]]; then
      printf '%s\n' "${hint_pid}"
      return 0
    fi
    [[ "${attempt}" -lt "${attempts}" ]] || break
    sleep "${sleep_seconds}"
  done

  return 1
}

local_runtime_find_untracked_same_session_or_group_ambiguity_pid() {
  local expected_group_id="${1:-}"
  local expected_session_id="${2:-}"
  local root_pid="$3"
  local minimum_start_time="${4:-}"
  local candidate_pid candidate_start_time
  [[ -n "${expected_group_id}" || -n "${expected_session_id}" ]] || return 1
  [[ "${minimum_start_time}" =~ ^[0-9]+$ ]] || return 1

  while read -r candidate_pid; do
    [[ -n "${candidate_pid}" ]] || continue
    [[ "${candidate_pid}" != "${root_pid}" ]] || continue
    [[ -z "${tracked_pids[${candidate_pid}]+x}" ]] || continue
    local_runtime_pid_is_alive "${candidate_pid}" || continue
    [[ "${candidate_pid}" != "$$" ]] || continue
    local_runtime_pid_has_ancestor "${candidate_pid}" "$$" && continue
    candidate_start_time="$(local_runtime_process_start_time "${candidate_pid}" || true)"
    [[ "${candidate_start_time}" =~ ^[0-9]+$ ]] || continue
    (( candidate_start_time >= minimum_start_time )) || continue
    printf '%s\n' "${candidate_pid}"
    return 0
  done < <(local_runtime_same_session_or_group_pids "${expected_group_id}" "${expected_session_id}")

  return 1
}

local_runtime_find_untracked_same_session_or_group_ambiguity_pid_with_quiesce() {
  local expected_group_id="${1:-}"
  local expected_session_id="${2:-}"
  local root_pid="$3"
  local minimum_start_time="${4:-}"
  local sleep_seconds="$5"
  local attempts="$6"
  local attempt ambiguity_pid previous_ambiguity_pid=""

  for attempt in $(seq 1 "${attempts}"); do
    ambiguity_pid="$(local_runtime_find_untracked_same_session_or_group_ambiguity_pid \
      "${expected_group_id}" "${expected_session_id}" "${root_pid}" "${minimum_start_time}" || true)"
    if [[ -n "${ambiguity_pid}" && "${ambiguity_pid}" == "${previous_ambiguity_pid}" ]]; then
      printf '%s\n' "${ambiguity_pid}"
      return 0
    fi
    previous_ambiguity_pid="${ambiguity_pid}"
    [[ "${attempt}" -lt "${attempts}" ]] || break
    sleep "${sleep_seconds}"
  done

  return 1
}

local_runtime_remove_sidecars_for_pid() {
  local pid="$1"
  local state_dir
  state_dir="$(local_runtime_process_state_dir)"
  [[ -d "${state_dir}" ]] || return 0
  find "${state_dir}" -maxdepth 1 -type f -name "*-${pid}.json" -delete 2>/dev/null || true
}

local_runtime_positive_integer_env_or_default() {
  local env_name="$1"
  local default_value="$2"
  local env_value="${!env_name-}"
  if [[ "${env_value}" =~ ^[1-9][0-9]*$ ]]; then
    printf '%s\n' "${env_value}"
    return 0
  fi
  printf '%s\n' "${default_value}"
}

local_runtime_positive_decimal_env_or_default() {
  local env_name="$1"
  local default_value="$2"
  local env_value="${!env_name-}"
  if [[ "${env_value}" =~ ^([0-9]+([.][0-9]+)?|[.][0-9]+)$ && ! "${env_value}" =~ ^0*([.]0*)?$ ]]; then
    printf '%s\n' "${env_value}"
    return 0
  fi
  printf '%s\n' "${default_value}"
}

local_runtime_sidecar_identity_capture_attempts() {
  local_runtime_positive_integer_env_or_default LOCAL_RUNTIME_IDENTITY_CAPTURE_ATTEMPTS 50
}

local_runtime_sidecar_identity_capture_sleep_seconds() {
  local_runtime_positive_decimal_env_or_default LOCAL_RUNTIME_IDENTITY_CAPTURE_SLEEP_SECONDS 0.02
}

local_runtime_term_grace_attempts() {
  local_runtime_positive_integer_env_or_default LOCAL_RUNTIME_TERM_GRACE_ATTEMPTS 20
}

local_runtime_term_grace_sleep_seconds() {
  local_runtime_positive_decimal_env_or_default LOCAL_RUNTIME_TERM_GRACE_SLEEP_SECONDS 0.2
}

local_runtime_kill_grace_attempts() {
  local_runtime_positive_integer_env_or_default LOCAL_RUNTIME_KILL_GRACE_ATTEMPTS 10
}

local_runtime_kill_grace_sleep_seconds() {
  local_runtime_positive_decimal_env_or_default LOCAL_RUNTIME_KILL_GRACE_SLEEP_SECONDS 0.2
}

local_runtime_stop_owned_process_tree() {
  local pid="$1"
  local service_kind="${2:-}"
  local port="${3:-}"
  local sidecar_file expected_owner_token root_process_group_id root_session_id sidecar_token sidecar_command sidecar_schema_version root_start_time root_is_alive=0
  [[ -n "${pid}" ]] || return 0

  sidecar_file="$(local_runtime_find_sidecar "${pid}" "${service_kind}" "${port}")" || {
    echo "[local-runtime-processes] ownership verification failed for pid ${pid}: missing sidecar" >&2
    return 1
  }
  if [[ -n "${LOCAL_RUNTIME_OWNER_TOKEN:-}" ]]; then
    expected_owner_token="$(local_runtime_read_sidecar_field "${sidecar_file}" owner_token || true)"
    if [[ "${expected_owner_token}" != "${LOCAL_RUNTIME_OWNER_TOKEN}" ]]; then
      echo "[local-runtime-processes] ownership verification failed for pid ${pid}: owner token mismatch" >&2
      return 1
    fi
  else
    expected_owner_token="$(local_runtime_read_sidecar_field "${sidecar_file}" owner_token || true)"
  fi
  sidecar_schema_version="$(local_runtime_read_sidecar_field "${sidecar_file}" schema_version || true)"
  sidecar_token="$(local_runtime_read_sidecar_field "${sidecar_file}" process_identity.token || true)"
  root_start_time="$(local_runtime_identity_token_start_time "${sidecar_token}" || true)"
  sidecar_command="$(local_runtime_read_sidecar_field "${sidecar_file}" command || true)"
  root_process_group_id="$(local_runtime_read_sidecar_field "${sidecar_file}" process_group_id || true)"
  root_session_id="$(local_runtime_read_sidecar_field "${sidecar_file}" session_id || true)"

  if local_runtime_pid_is_alive "${pid}"; then
    local_runtime_verify_owned_process "${pid}" "${service_kind}" "${port}" || return 1
    root_is_alive=1
    root_process_group_id="$(local_runtime_process_group_id "${pid}" || printf '%s\n' "${root_process_group_id}")"
    root_session_id="$(local_runtime_process_session_id "${pid}" || printf '%s\n' "${root_session_id}")"
  elif [[ ! "${sidecar_schema_version}" =~ ^[0-9]+$ || "${sidecar_schema_version}" -lt 2 ]]; then
    echo "[local-runtime-processes] ownership verification failed for pid ${pid}: legacy sidecar schema does not support post-root cleanup" >&2
    return 1
  elif [[ -z "${root_process_group_id}" && -z "${root_session_id}" ]]; then
    echo "[local-runtime-processes] ownership verification failed for pid ${pid}: missing post-root cleanup authority" >&2
    return 1
  fi

  local pids=()
  local tree_pid captured_token captured_start_time failed_signal=0 ownership_status signal_role refusal_reason track_status
  declare -A captured_tokens=()
  declare -A captured_start_times=()
  declare -A tracked_pids=()
  if [[ "${root_is_alive}" -eq 1 ]]; then
    while read -r tree_pid; do
      [[ -n "${tree_pid}" ]] || continue
      [[ -z "${tracked_pids[${tree_pid}]+x}" ]] || continue
      captured_token="$(local_runtime_process_identity_token "${tree_pid}" || true)"
      captured_start_time="$(local_runtime_process_start_time "${tree_pid}" || true)"
      if [[ -z "${captured_token}" ]]; then
        if local_runtime_pid_is_alive "${tree_pid}"; then
          if [[ "${tree_pid}" != "${pid}" ]] && local_runtime_process_owner_token_matches "${tree_pid}" "${expected_owner_token}"; then
            pids+=("${tree_pid}")
            tracked_pids["${tree_pid}"]=1
            captured_tokens["${tree_pid}"]=""
            captured_start_times["${tree_pid}"]="${captured_start_time}"
            continue
          fi
          if [[ "${tree_pid}" == "${pid}" ]]; then
            echo "[local-runtime-processes] ownership verification failed for pid ${tree_pid}: cannot capture root process identity" >&2
            return 1
          fi
          echo "[local-runtime-processes] ownership verification failed for pid ${tree_pid}: cannot confirm descendant ownership" >&2
          return 1
        fi
        continue
      fi
      pids+=("${tree_pid}")
      tracked_pids["${tree_pid}"]=1
      captured_tokens["${tree_pid}"]="${captured_token}"
      captured_start_times["${tree_pid}"]="${captured_start_time}"
    done < <(local_runtime_process_tree_pids "${pid}")
  else
    pids+=("${pid}")
    tracked_pids["${pid}"]=1
    captured_tokens["${pid}"]="${sidecar_token}"
    captured_start_times["${pid}"]=""
  fi

  for tree_pid in "${pids[@]}"; do
    signal_role="descendant"
    [[ "${tree_pid}" == "${pid}" ]] && signal_role="root"
    ownership_status="$(local_runtime_tracked_pid_ownership_status "${tree_pid}" "${captured_tokens[${tree_pid}]}" "${expected_owner_token}" "${signal_role}" "${captured_start_times[${tree_pid}]}")"
    case "${ownership_status}" in
      exited)
        continue
        ;;
      identity_match|owner_token_match|start_time_match)
        kill -TERM "${tree_pid}" >/dev/null 2>&1 || true
        if local_runtime_discover_descendants_for_tracked_pid_with_quiesce "${expected_owner_token}" "${tree_pid}" 0.005 20; then
          track_status=0
        else
          track_status=$?
        fi
        case "${track_status}" in
          0|1)
            ;;
          *)
            return "${track_status}"
            ;;
        esac
        continue
        ;;
    esac
    if local_runtime_pid_is_alive "${tree_pid}"; then
      refusal_reason="$(local_runtime_tracked_pid_refusal_reason "${ownership_status}" "${signal_role}")"
      echo "[local-runtime-processes] refusing to TERM pid ${tree_pid}: ${refusal_reason}" >&2
      failed_signal=1
    fi
  done
  [[ "${failed_signal}" -eq 0 ]] || return 1

  local term_grace_attempts term_grace_sleep_seconds term_tracked_pids_exited=0
  term_grace_attempts="$(local_runtime_term_grace_attempts)"
  term_grace_sleep_seconds="$(local_runtime_term_grace_sleep_seconds)"
  if local_runtime_quiesce_authoritative_descendant_discovery "${expected_owner_token}" "${pid}" 0.01 10; then
    track_status=0
  else
    track_status=$?
  fi
  case "${track_status}" in
    0|1)
      ;;
    *)
      return "${track_status}"
      ;;
  esac
  for _ in $(seq 1 "${term_grace_attempts}"); do
    if local_runtime_discover_authoritative_descendants_for_tracked_pids "${expected_owner_token}" "${pid}"; then
      track_status=0
    else
      track_status=$?
    fi
    case "${track_status}" in
      0|1)
        ;;
      *)
        return "${track_status}"
        ;;
    esac
    if local_runtime_all_pids_exited "${pids[@]}"; then
      term_tracked_pids_exited=1
      break
    fi
    sleep "${term_grace_sleep_seconds}"
  done

  if local_runtime_discover_authoritative_descendants_for_tracked_pids "${expected_owner_token}" "${pid}"; then
    track_status=0
  else
    track_status=$?
  fi
  case "${track_status}" in
    0|1)
      ;;
    *)
      return "${track_status}"
      ;;
  esac

  if [[ "${root_is_alive}" -eq 1 && "${term_tracked_pids_exited}" -eq 1 ]]; then
    if local_runtime_discover_same_session_or_group_owned_tree_candidates "${expected_owner_token}" "${service_kind}" "${pid}" "${root_process_group_id}" "${root_session_id}"; then
      track_status=0
    else
      track_status=$?
    fi
    case "${track_status}" in
      0|1)
        ;;
      *)
        return "${track_status}"
        ;;
    esac
  fi

  if [[ "${root_is_alive}" -eq 0 ]]; then
    # Once the root has already exited we can only fail closed. Do one immediate
    # owned-marker scan and one same-session/group ambiguity scan so we still
    # surface suspicious descendants without waiting through shell-oriented
    # late-discovery loops that cannot restore completion authority.
    local root_dead_owned_tree_hint_pid=""
    root_dead_owned_tree_hint_pid="$(local_runtime_find_untracked_owned_tree_hint_pid_from_stream \
      < <(local_runtime_owned_tree_process_pids_all "${expected_owner_token}" "${service_kind}" "${pid}") || true)"
    if [[ -n "${root_dead_owned_tree_hint_pid}" ]]; then
      echo "[local-runtime-processes] ownership verification failed for pid ${root_dead_owned_tree_hint_pid}: cannot confirm descendant ownership" >&2
      return 1
    fi
    local root_dead_ambiguity_pid=""
    root_dead_ambiguity_pid="$(local_runtime_find_untracked_same_session_or_group_ambiguity_pid \
      "${root_process_group_id}" "${root_session_id}" "${pid}" "${root_start_time}" || true)"
    if [[ -n "${root_dead_ambiguity_pid}" ]]; then
      echo "[local-runtime-processes] ownership verification failed for pid ${root_dead_ambiguity_pid}: cannot confirm descendant ownership" >&2
      return 1
    fi
    echo "[local-runtime-processes] ownership verification failed for pid ${pid}: missing post-root cleanup completion authority" >&2
    return 1
  fi

  local late_discovery_hint_pid="" late_discovery_attempts_after_term
  if [[ "${term_tracked_pids_exited}" -eq 1 ]]; then
    late_discovery_attempts_after_term=3
    if ! local_runtime_has_tracked_descendants "${pid}" "${pids[@]}" && [[ "${sidecar_command}" =~ ^(bash|sh|zsh)([[:space:]]|$) ]]; then
      late_discovery_attempts_after_term=20
    fi
    late_discovery_hint_pid="$(local_runtime_find_untracked_owned_tree_hint_pid_with_quiesce "${expected_owner_token}" "${service_kind}" "${pid}" "${term_grace_sleep_seconds}" "${late_discovery_attempts_after_term}" || true)"
    if [[ -n "${late_discovery_hint_pid}" ]]; then
      echo "[local-runtime-processes] ownership verification failed for pid ${late_discovery_hint_pid}: cannot confirm descendant ownership" >&2
      return 1
    fi
  fi

  if local_runtime_all_pids_exited "${pids[@]}"; then
    local_runtime_remove_sidecars_for_pid "${pid}"
    return 0
  fi

  local all_exited_after_kill=0 kill_grace_attempts kill_grace_sleep_seconds late_discovery_attempts_after_kill
  kill_grace_attempts="$(local_runtime_kill_grace_attempts)"
  kill_grace_sleep_seconds="$(local_runtime_kill_grace_sleep_seconds)"
  while true; do
    failed_signal=0
    for tree_pid in "${pids[@]}"; do
      signal_role="descendant"
      [[ "${tree_pid}" == "${pid}" ]] && signal_role="root"
      ownership_status="$(local_runtime_tracked_pid_ownership_status "${tree_pid}" "${captured_tokens[${tree_pid}]}" "${expected_owner_token}" "${signal_role}" "${captured_start_times[${tree_pid}]}")"
      case "${ownership_status}" in
        exited)
          continue
          ;;
        identity_match|owner_token_match|start_time_match)
          kill -KILL "${tree_pid}" >/dev/null 2>&1 || true
          continue
          ;;
      esac
      if local_runtime_pid_is_alive "${tree_pid}"; then
        refusal_reason="$(local_runtime_tracked_pid_refusal_reason "${ownership_status}" "${signal_role}")"
        echo "[local-runtime-processes] refusing to KILL pid ${tree_pid}: ${refusal_reason}" >&2
        failed_signal=1
      fi
    done
    [[ "${failed_signal}" -eq 0 ]] || return 1

    all_exited_after_kill=0
    for _ in $(seq 1 "${kill_grace_attempts}"); do
      if local_runtime_discover_authoritative_descendants_for_tracked_pids "${expected_owner_token}" "${pid}"; then
        track_status=0
      else
        track_status=$?
      fi
      case "${track_status}" in
        0|1)
          ;;
        *)
          return "${track_status}"
          ;;
      esac
      if local_runtime_all_pids_exited "${pids[@]}"; then
        all_exited_after_kill=1
        break
      fi
      sleep "${kill_grace_sleep_seconds}"
    done

    [[ "${all_exited_after_kill}" -eq 1 ]] || break

    late_discovery_attempts_after_kill=2
    if ! local_runtime_has_tracked_descendants "${pid}" "${pids[@]}" && [[ "${sidecar_command}" =~ ^(bash|sh|zsh)([[:space:]]|$) ]]; then
      late_discovery_attempts_after_kill=20
    fi
    late_discovery_hint_pid="$(local_runtime_find_untracked_owned_tree_hint_pid_with_quiesce "${expected_owner_token}" "${service_kind}" "${pid}" "${kill_grace_sleep_seconds}" "${late_discovery_attempts_after_kill}" || true)"
    if [[ -n "${late_discovery_hint_pid}" ]]; then
      echo "[local-runtime-processes] ownership verification failed for pid ${late_discovery_hint_pid}: cannot confirm descendant ownership" >&2
      return 1
    fi

    local_runtime_remove_sidecars_for_pid "${pid}"
    return 0
  done

  echo "[local-runtime-processes] failed to stop owned ${service_kind:-process} tree rooted at pid ${pid}" >&2
  return 1
}

local_runtime_stop_process_tree_unverified() {
  local pid="$1"
  [[ -n "${pid}" ]] || return 0
  local_runtime_pid_is_alive "${pid}" || return 0

  local pids=()
  local tree_pid
  while read -r tree_pid; do
    [[ -n "${tree_pid}" ]] && pids+=("${tree_pid}")
  done < <(local_runtime_process_tree_pids "${pid}")

  for tree_pid in "${pids[@]}"; do
    kill -TERM "${tree_pid}" >/dev/null 2>&1 || true
  done
  for _ in $(seq 1 10); do
    local_runtime_all_pids_exited "${pids[@]}" && return 0
    sleep 0.2
  done
  for tree_pid in "${pids[@]}"; do
    kill -KILL "${tree_pid}" >/dev/null 2>&1 || true
  done
}

local_runtime_port_listener_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"${port}" -sTCP:LISTEN -Pn 2>/dev/null | sort -u || true
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "( sport = :${port} )" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u || true
    return 0
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "${port}" 2>/dev/null | tr ' ' '\n' | awk 'NF' | sort -u || true
  fi
}

local_runtime_port_is_listening() {
  local port="$1"
  [[ -n "$(local_runtime_port_listener_pids "${port}")" ]]
}

local_runtime_refresh_owned_process_sidecar() {
  local service_kind="$1"
  local pid="$2"
  local port="$3"
  local command

  command="$(local_runtime_process_command "${pid}" || true)"
  [[ -n "${command}" ]] || {
    echo "[local-runtime-processes] cannot refresh process identity for ${service_kind} pid ${pid}" >&2
    return 1
  }

  local_runtime_write_process_sidecar "${service_kind}" "${pid}" "${port}" "${command}"
}

local_runtime_owned_port_listener_pids() {
  local root_pid="$1"
  local service_kind="$2"
  local port="$3"
  local owner_token="${LOCAL_RUNTIME_OWNER_TOKEN:-}"
  local listener_pid

  [[ -n "${root_pid}" && -n "${service_kind}" && -n "${port}" ]] || return 0

  while read -r listener_pid; do
    [[ -n "${listener_pid}" ]] || continue
    local_runtime_pid_is_alive "${listener_pid}" || continue
    local_runtime_process_service_kind_matches "${listener_pid}" "${service_kind}" || continue
    local_runtime_process_tree_root_pid_matches "${listener_pid}" "${root_pid}" || continue
    if [[ -n "${owner_token}" ]] && ! local_runtime_process_owner_token_matches "${listener_pid}" "${owner_token}"; then
      continue
    fi
    printf '%s\n' "${listener_pid}"
  done < <(local_runtime_port_listener_pids "${port}")
}

local_runtime_capture_authoritative_service_pid() {
  local root_pid="$1"
  local service_kind="$2"
  local port="$3"
  local timeout_seconds="${4:-30}"
  local deadline=$((SECONDS + timeout_seconds))
  local listener_pid
  local -a owned_listener_pids=()

  [[ -n "${root_pid}" && -n "${service_kind}" && -n "${port}" ]] || return 1

  while (( SECONDS <= deadline )); do
    mapfile -t owned_listener_pids < <(local_runtime_owned_port_listener_pids "${root_pid}" "${service_kind}" "${port}")
    if [[ "${#owned_listener_pids[@]}" -eq 1 ]]; then
      listener_pid="${owned_listener_pids[0]}"
      if ! local_runtime_refresh_owned_process_sidecar "${service_kind}" "${root_pid}" "${port}"; then
        echo "[local-runtime-processes] failed to refresh ${service_kind} root pid ${root_pid} while capturing authoritative pid on port ${port}" >&2
        return 1
      fi
      printf '%s\n' "${listener_pid}"
      return 0
    fi

    if [[ "${#owned_listener_pids[@]}" -gt 1 ]]; then
      echo "[local-runtime-processes] expected exactly one owned ${service_kind} listener on port ${port}, found ${#owned_listener_pids[@]}" >&2
      return 1
    fi

    if ! local_runtime_pid_is_alive "${root_pid}" && ! local_runtime_port_is_listening "${port}"; then
      break
    fi
    sleep 0.2
  done

  echo "[local-runtime-processes] failed to capture authoritative ${service_kind} listener pid on port ${port} for root pid ${root_pid}" >&2
  return 1
}

local_runtime_wait_port_free() {
  local port="$1"
  local label="${2:-service}"
  local timeout="${3:-30}"
  for _ in $(seq 1 "${timeout}"); do
    if ! local_runtime_port_is_listening "${port}"; then
      return 0
    fi
    sleep 1
  done
  echo "[local-runtime-processes] ${label} port ${port} did not become free" >&2
  return 1
}

local_runtime_process_env_contains() {
  local pid="$1"
  local expected="$2"
  [[ -r "/proc/${pid}/environ" ]] || return 1
  grep -zq -- "${expected}" "/proc/${pid}/environ"
}
