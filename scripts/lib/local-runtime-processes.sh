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

local_runtime_process_identity_token() {
  local pid="$1"
  local command cwd start_time command_hash
  local_runtime_pid_is_alive "${pid}" || return 1
  command="$(local_runtime_process_command "${pid}")"
  [[ -n "${command}" ]] || return 1
  cwd="$(local_runtime_process_cwd "${pid}")"
  start_time=""
  if [[ -r "/proc/${pid}/stat" ]]; then
    start_time="$(awk '{print $22}' "/proc/${pid}/stat" 2>/dev/null || true)"
  fi
  command_hash="$(printf '%s\n%s\n' "${cwd}" "${command}" | local_runtime_hash_text)"
  printf 'pid:%s:start:%s:cmd:%s\n' "${pid}" "${start_time:-unknown}" "${command_hash}"
}

local_runtime_process_owner_token() {
  local pid="$1"
  local owner_token
  [[ -r "/proc/${pid}/environ" ]] || return 1
  owner_token="$(tr '\0' '\n' <"/proc/${pid}/environ" 2>/dev/null | sed -n 's/^LOCAL_RUNTIME_OWNER_TOKEN=//p' | head -n 1 || true)"
  [[ -n "${owner_token}" ]] || return 1
  printf '%s\n' "${owner_token}"
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
  local state_dir sidecar_file token cwd started_at run_id line_kind owner_token

  state_dir="$(local_runtime_process_state_dir)"
  mkdir -p "${state_dir}"
  sidecar_file="$(local_runtime_sidecar_file_for "${service_kind}" "${pid}" "${port}")"
  token="$(local_runtime_process_identity_token "${pid}")" || {
    echo "[local-runtime-processes] cannot capture process identity for ${service_kind} pid ${pid}" >&2
    return 1
  }
  cwd="$(local_runtime_process_cwd "${pid}")"
  started_at="$(local_runtime_now_utc)"
  run_id="${LOCAL_RUNTIME_RUN_ID:-local-runtime-$$}"
  line_kind="${LOCAL_RUNTIME_LINE_KIND:-local_runtime}"
  owner_token="${LOCAL_RUNTIME_OWNER_TOKEN:-${run_id}:${line_kind}:$$}"

  LOCAL_RUNTIME_SIDECAR_FILE="${sidecar_file}" \
  LOCAL_RUNTIME_SIDECAR_SCHEMA_VERSION="1" \
  LOCAL_RUNTIME_SIDECAR_RUN_ID="${run_id}" \
  LOCAL_RUNTIME_SIDECAR_LINE_KIND="${line_kind}" \
  LOCAL_RUNTIME_SIDECAR_SERVICE_KIND="${service_kind}" \
  LOCAL_RUNTIME_SIDECAR_PID="${pid}" \
  LOCAL_RUNTIME_SIDECAR_PORT="${port}" \
  LOCAL_RUNTIME_SIDECAR_CWD="${cwd}" \
  LOCAL_RUNTIME_SIDECAR_COMMAND="${command}" \
  LOCAL_RUNTIME_SIDECAR_OWNER_TOKEN="${owner_token}" \
  LOCAL_RUNTIME_SIDECAR_STARTED_AT="${started_at}" \
  LOCAL_RUNTIME_SIDECAR_IDENTITY_TOKEN="${token}" \
  node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const file = process.env.LOCAL_RUNTIME_SIDECAR_FILE;
if (!file) {
  throw new Error('LOCAL_RUNTIME_SIDECAR_FILE is required');
}

const payload = {
  schema_version: Number(process.env.LOCAL_RUNTIME_SIDECAR_SCHEMA_VERSION || '1'),
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
    if (payload.schema_version !== 1 || payload.pid !== pid) {
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
    echo "[local-runtime-processes] ownership verification failed for pid ${pid}: process identity mismatch" >&2
    return 1
  fi
}

local_runtime_parent_pid() {
  local pid="$1"
  ps -p "${pid}" -o ppid= 2>/dev/null | awk '{print $1}'
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
  local live_token

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

  if local_runtime_process_owner_token_matches "${pid}" "${expected_owner_token}"; then
    printf 'owner_token_match\n'
    return 0
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
  local sidecar_file expected_owner_token
  [[ -n "${pid}" ]] || return 0
  if ! local_runtime_pid_is_alive "${pid}"; then
    local_runtime_remove_sidecars_for_pid "${pid}"
    return 0
  fi

  local_runtime_verify_owned_process "${pid}" "${service_kind}" "${port}" || return 1
  sidecar_file="$(local_runtime_find_sidecar "${pid}" "${service_kind}" "${port}")" || return 1
  expected_owner_token="$(local_runtime_read_sidecar_field "${sidecar_file}" owner_token || true)"

  local pids=()
  local tree_pid captured_token failed_signal=0 ownership_status signal_role refusal_reason
  declare -A captured_tokens=()
  declare -A tracked_pids=()
  while read -r tree_pid; do
    [[ -n "${tree_pid}" ]] || continue
    [[ -z "${tracked_pids[${tree_pid}]+x}" ]] || continue
    captured_token="$(local_runtime_process_identity_token "${tree_pid}" || true)"
    if [[ -z "${captured_token}" ]]; then
      if local_runtime_pid_is_alive "${tree_pid}"; then
        if [[ "${tree_pid}" != "${pid}" ]] && local_runtime_process_owner_token_matches "${tree_pid}" "${expected_owner_token}"; then
          pids+=("${tree_pid}")
          tracked_pids["${tree_pid}"]=1
          captured_tokens["${tree_pid}"]=""
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
  done < <(local_runtime_process_tree_pids "${pid}")

  for tree_pid in "${pids[@]}"; do
    signal_role="descendant"
    [[ "${tree_pid}" == "${pid}" ]] && signal_role="root"
    ownership_status="$(local_runtime_tracked_pid_ownership_status "${tree_pid}" "${captured_tokens[${tree_pid}]}" "${expected_owner_token}" "${signal_role}")"
    case "${ownership_status}" in
      exited)
        continue
        ;;
      identity_match|owner_token_match)
        kill -TERM "${tree_pid}" >/dev/null 2>&1 || true
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

  local term_grace_attempts term_grace_sleep_seconds
  term_grace_attempts="$(local_runtime_term_grace_attempts)"
  term_grace_sleep_seconds="$(local_runtime_term_grace_sleep_seconds)"
  for _ in $(seq 1 "${term_grace_attempts}"); do
    if local_runtime_all_pids_exited "${pids[@]}"; then
      local_runtime_remove_sidecars_for_pid "${pid}"
      return 0
    fi
    sleep "${term_grace_sleep_seconds}"
  done

  local expansion_root expansion_role expansion_status
  for expansion_root in "${pids[@]}"; do
    expansion_role="descendant"
    [[ "${expansion_root}" == "${pid}" ]] && expansion_role="root"
    expansion_status="$(local_runtime_tracked_pid_ownership_status "${expansion_root}" "${captured_tokens[${expansion_root}]}" "${expected_owner_token}" "${expansion_role}")"
    case "${expansion_status}" in
      exited)
        continue
        ;;
      identity_match|owner_token_match)
        while read -r tree_pid; do
          [[ -n "${tree_pid}" ]] || continue
          [[ -z "${tracked_pids[${tree_pid}]+x}" ]] || continue
          captured_token="$(local_runtime_process_identity_token "${tree_pid}" || true)"
          if [[ -z "${captured_token}" ]]; then
            if ! local_runtime_pid_is_alive "${tree_pid}"; then
              continue
            fi
            if local_runtime_process_owner_token_matches "${tree_pid}" "${expected_owner_token}"; then
              pids+=("${tree_pid}")
              tracked_pids["${tree_pid}"]=1
              captured_tokens["${tree_pid}"]=""
              continue
            fi
            echo "[local-runtime-processes] ownership verification failed for pid ${tree_pid}: cannot confirm descendant ownership" >&2
            return 1
          fi
          pids+=("${tree_pid}")
          tracked_pids["${tree_pid}"]=1
          captured_tokens["${tree_pid}"]="${captured_token}"
        done < <(local_runtime_descendant_pids "${expansion_root}")
        ;;
      *)
        if [[ "${expansion_role}" == "root" ]] && local_runtime_pid_is_alive "${expansion_root}"; then
          refusal_reason="$(local_runtime_tracked_pid_refusal_reason "${expansion_status}" "${expansion_role}")"
          echo "[local-runtime-processes] refusing to expand descendants for pid ${expansion_root}: ${refusal_reason}" >&2
          return 1
        fi
        ;;
    esac
  done

  failed_signal=0
  for tree_pid in "${pids[@]}"; do
    signal_role="descendant"
    [[ "${tree_pid}" == "${pid}" ]] && signal_role="root"
    ownership_status="$(local_runtime_tracked_pid_ownership_status "${tree_pid}" "${captured_tokens[${tree_pid}]}" "${expected_owner_token}" "${signal_role}")"
    case "${ownership_status}" in
      exited)
        continue
        ;;
      identity_match|owner_token_match)
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

  local kill_grace_attempts kill_grace_sleep_seconds
  kill_grace_attempts="$(local_runtime_kill_grace_attempts)"
  kill_grace_sleep_seconds="$(local_runtime_kill_grace_sleep_seconds)"
  for _ in $(seq 1 "${kill_grace_attempts}"); do
    if local_runtime_all_pids_exited "${pids[@]}"; then
      local_runtime_remove_sidecars_for_pid "${pid}"
      return 0
    fi
    sleep "${kill_grace_sleep_seconds}"
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
