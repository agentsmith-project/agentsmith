#!/usr/bin/env bash

next_generated_root_repo_dir() {
  printf '%s\n' "${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
}

next_generated_root_canonical_next_env() {
  cat <<'EOF'
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
EOF
}

next_generated_root_lane_owner_file() {
  local run_root="$1"
  printf '%s/.lane-owner.env\n' "${run_root}"
}

next_generated_root_state_dir() {
  local repo_dir
  repo_dir="$(next_generated_root_repo_dir)"
  printf '%s\n' "${NEXT_GENERATED_ROOT_STATE_DIR:-${repo_dir}/artifacts/runtime/next-generated-root}"
}

next_generated_root_snapshot_file() {
  local name="$1"
  printf '%s/%s\n' "$(next_generated_root_state_dir)" "${name}"
}

next_generated_root_source_contract_lock_file() {
  next_generated_root_snapshot_file "source-contract.lock"
}

next_generated_root_source_contract_lock_context_token() {
  printf '%s\n' "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN:-}"
}

next_generated_root_source_contract_lock_context_active() {
  [[ "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD:-0}" == "1" ]] \
    && [[ -n "$(next_generated_root_source_contract_lock_context_token)" ]]
}

next_generated_root_source_contract_reentry_scope() {
  printf '%s\n' "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_SCOPE:-}"
}

next_generated_root_source_contract_reentry_context_token() {
  printf '%s\n' "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_CONTEXT_TOKEN:-}"
}

next_generated_root_source_contract_reentry_allowed_for_phase() {
  local phase="${1:-}"
  local reentry_scope reentry_token
  reentry_scope="$(next_generated_root_source_contract_reentry_scope)"
  reentry_token="$(next_generated_root_source_contract_reentry_context_token)"
  [[ -n "${reentry_token}" ]] || return 1

  case "${reentry_scope}:${phase}" in
    build_finalize:build_next_with_root_finalize|build_finalize:build_finalize_trap|build_finalize:repair_prepare_source_safe_for_tsc)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

next_generated_root_source_contract_lock_new_context_token() {
  printf 'source-contract:%s:%s\n' \
    "$(next_generated_root_source_contract_lock_current_process_id)" \
    "$(date -u +%s%N 2>/dev/null || date -u +%s)"
}

next_generated_root_with_source_contract_lock() {
  local _phase="${1:-source_contract}"
  shift || true
  local state_dir lock_file status previous_lock_held previous_lock_was_set previous_lock_owner_pid previous_lock_owner_pid_was_set current_lock_owner_pid previous_lock_context_token previous_lock_context_token_was_set current_lock_context_token
  if next_generated_root_source_contract_lock_owned_by_current_process \
    || next_generated_root_source_contract_lock_context_active \
    || next_generated_root_source_contract_reentry_allowed_for_phase "${_phase}"; then
    "$@"
    return $?
  fi

  state_dir="$(next_generated_root_state_dir)"
  lock_file="$(next_generated_root_source_contract_lock_file)"
  current_lock_owner_pid="$(next_generated_root_source_contract_lock_current_process_id)"
  current_lock_context_token="$(next_generated_root_source_contract_lock_new_context_token)"
  mkdir -p "${state_dir}"
  previous_lock_held="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD:-}"
  previous_lock_was_set=0
  if [[ -n "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD+x}" ]]; then
    previous_lock_was_set=1
  fi
  previous_lock_owner_pid="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID:-}"
  previous_lock_owner_pid_was_set=0
  if [[ -n "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID+x}" ]]; then
    previous_lock_owner_pid_was_set=1
  fi
  previous_lock_context_token="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN:-}"
  previous_lock_context_token_was_set=0
  if [[ -n "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN+x}" ]]; then
    previous_lock_context_token_was_set=1
  fi

  if command -v flock >/dev/null 2>&1; then
    {
      flock -x 9
      export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD=1
      export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID="${current_lock_owner_pid}"
      export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN="${current_lock_context_token}"
      "$@"
      status=$?
    } 9>"${lock_file}"
  else
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD=1
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID="${current_lock_owner_pid}"
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN="${current_lock_context_token}"
    "$@"
    status=$?
  fi

  if [[ "${previous_lock_was_set}" -eq 1 ]]; then
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD="${previous_lock_held}"
  else
    unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD
  fi
  if [[ "${previous_lock_owner_pid_was_set}" -eq 1 ]]; then
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID="${previous_lock_owner_pid}"
  else
    unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID
  fi
  if [[ "${previous_lock_context_token_was_set}" -eq 1 ]]; then
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN="${previous_lock_context_token}"
  else
    unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN
  fi
  return "${status}"
}

next_generated_root_source_contract_lock_current_process_id() {
  printf '%s\n' "${BASHPID:-$$}"
}

next_generated_root_source_contract_lock_owned_by_current_process() {
  local owner_pid="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID:-}"
  [[ -n "${owner_pid}" && "${owner_pid}" == "$(next_generated_root_source_contract_lock_current_process_id)" ]]
}

next_generated_root_contract_event_file() {
  next_generated_root_snapshot_file "source-contract-events.jsonl"
}

next_generated_root_contract_latest_file() {
  next_generated_root_snapshot_file "source-contract-latest"
}

next_generated_root_parse_nonnegative_integer() {
  local raw="${1:-}"
  local fallback="${2:-0}"
  if [[ "${raw}" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "${raw}"
    return 0
  fi
  printf '%s\n' "${fallback}"
}

next_generated_root_parse_delay_seconds() {
  local raw="${1:-}"
  local fallback="${2:-0.05}"
  if [[ "${raw}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    printf '%s\n' "${raw}"
    return 0
  fi
  printf '%s\n' "${fallback}"
}

next_generated_root_retry_count_for_phase() {
  local phase="$1"
  case "${phase}" in
    prepare_for_validation)
      next_generated_root_parse_nonnegative_integer "${NEXT_GENERATED_ROOT_PREPARE_RETRY_COUNT:-}" 6
      ;;
    guard)
      next_generated_root_parse_nonnegative_integer "${NEXT_GENERATED_ROOT_GUARD_RETRY_COUNT:-}" 2
      ;;
    final_reconcile)
      next_generated_root_parse_nonnegative_integer "${NEXT_GENERATED_ROOT_FINALIZE_RETRY_COUNT:-}" 6
      ;;
    *)
      next_generated_root_parse_nonnegative_integer "${NEXT_GENERATED_ROOT_CONTRACT_RETRY_COUNT:-}" 6
      ;;
  esac
}

next_generated_root_retry_delay_for_phase() {
  local phase="$1"
  case "${phase}" in
    prepare_for_validation)
      next_generated_root_parse_delay_seconds "${NEXT_GENERATED_ROOT_PREPARE_RETRY_DELAY_SEC:-}" 0.05
      ;;
    guard)
      next_generated_root_parse_delay_seconds "${NEXT_GENERATED_ROOT_GUARD_RETRY_DELAY_SEC:-}" 0.02
      ;;
    final_reconcile)
      next_generated_root_parse_delay_seconds "${NEXT_GENERATED_ROOT_FINALIZE_RETRY_DELAY_SEC:-}" 0.05
      ;;
    *)
      next_generated_root_parse_delay_seconds "${NEXT_GENERATED_ROOT_CONTRACT_RETRY_DELAY_SEC:-}" 0.05
      ;;
  esac
}

next_generated_root_record_contract_event() {
  local phase="$1"
  local status="$2"
  local reason="$3"
  local attempts="$4"
  local state_dir event_file latest_file signature
  state_dir="$(next_generated_root_state_dir)"
  mkdir -p "${state_dir}"
  event_file="$(next_generated_root_contract_event_file)"
  latest_file="$(next_generated_root_contract_latest_file)"
  signature="${phase}:${status}:${reason}"
  if [[ -f "${latest_file}" ]] && [[ "$(cat "${latest_file}" 2>/dev/null || true)" == "${signature}" ]]; then
    return 0
  fi
  printf '%s\n' "${signature}" > "${latest_file}"
  printf '{"timestamp":"%s","phase":"%s","status":"%s","reason":"%s","attempts":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    "${phase}" \
    "${status}" \
    "${reason}" \
    "${attempts}" >> "${event_file}"
}

next_generated_root_probe_source_contract_once() {
  local repo_dir
  repo_dir="$(next_generated_root_repo_dir)"
  node - <<'NODE' "${repo_dir}"
const fs = require('node:fs');
const path = require('node:path');

const repoDir = process.argv[2];
const canonicalInclude = [
  '.next/types/**/*.ts',
  'next-env.d.ts',
  'src/**/*.ts',
  'src/**/*.tsx',
];
const canonicalNextEnv = `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`;
const rootGeneratedNextEnv = `/// <reference types="next" />
/// <reference types="next/image-types/global" />
/// <reference path="./.next/types/routes.d.ts" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`;
const forbiddenIncludePatterns = [
  /\.next\*\/types\/\*\*\/\*\.ts$/,
  /(?:^|\/)artifacts\/(?:backend-real\/current-run|mock-lane\/current)\/next-dist(?:\/|$)/,
  /(?:^|\/)\.next-local-manual-[^/]+\/types\/\*\*\/\*\.ts$/,
  /(?:^|\/)artifacts\/recovery-manual-next(?:\/|$)/,
  /playwright-managed-/,
  /(?:^|\/)artifacts\/[^/]+\/runs\/[^/]+\/next-dist(?:\/|$)/,
];
const forbiddenNextEnvPatterns = [
  /artifacts\/backend-real\/current-run\/next-dist\//,
  /artifacts\/mock-lane\/current\/next-dist\//,
  /\.next-local-manual-/,
  /artifacts\/recovery-manual-next/,
  /playwright-managed-/,
  /artifacts\/[^/\n]+\/runs\/[^/\n]+\/next-dist\//,
];
const rootRouteTypesPath = path.join(repoDir, '.next/types/routes.d.ts');
const referencePathPattern = /\/\/\/ <reference path=/;
const transientReadErrorCodes = new Set(['ENOENT', 'EBUSY']);
const unexpectedIoErrorCodes = new Set(['EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'EMFILE']);

function emit(status, reason) {
  process.stdout.write(`${status}\t${reason}\n`);
}

function classifyIoError(error, fallbackReason) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code ?? '')
    : '';
  const normalizedCode = code.toLowerCase() || 'unknown';
  if (transientReadErrorCodes.has(code)) {
    emit('transient_unreadable', `${fallbackReason}_${normalizedCode}`);
    return true;
  }
  if (unexpectedIoErrorCodes.has(code) || code) {
    emit('unexpected_io_failure', `${fallbackReason}_${normalizedCode}`);
    return true;
  }
  return false;
}

const tsconfigPath = path.join(repoDir, 'tsconfig.json');
let tsconfigRaw;
try {
  tsconfigRaw = fs.readFileSync(tsconfigPath, 'utf8');
} catch (error) {
  if (!classifyIoError(error, 'tsconfig_read_failed')) {
    emit('unexpected_io_failure', 'tsconfig_read_failed_unknown');
  }
  process.exit(0);
}

let config;
try {
  config = JSON.parse(tsconfigRaw);
} catch (error) {
  emit('transient_unreadable', 'tsconfig_json_parse_failed');
  process.exit(0);
}

const include = Array.isArray(config.include) ? config.include.filter((entry) => typeof entry === 'string') : [];
for (const entry of include) {
  if (forbiddenIncludePatterns.some((pattern) => pattern.test(entry))) {
    emit('semantic_drift', 'tsconfig_generated_lane_state');
    process.exit(0);
  }
}

if (include.length !== canonicalInclude.length || include.some((entry, index) => entry !== canonicalInclude[index])) {
  emit('semantic_drift', 'tsconfig_include_mismatch');
  process.exit(0);
}

const nextEnvPath = path.join(repoDir, 'next-env.d.ts');
if (!fs.existsSync(nextEnvPath)) {
  emit('canonical', 'source_contract_canonical');
  process.exit(0);
}

let nextEnv;
try {
  nextEnv = fs.readFileSync(nextEnvPath, 'utf8');
} catch (error) {
  if (!classifyIoError(error, 'next_env_read_failed')) {
    emit('unexpected_io_failure', 'next_env_read_failed_unknown');
  }
  process.exit(0);
}

if (forbiddenNextEnvPatterns.some((pattern) => pattern.test(nextEnv))) {
  emit('semantic_drift', 'next_env_generated_lane_state');
  process.exit(0);
}
if (nextEnv === rootGeneratedNextEnv) {
  if (fs.existsSync(rootRouteTypesPath)) {
    emit('canonical', 'next_env_generated_root_valid');
    process.exit(0);
  }
  emit('semantic_drift', 'next_env_generated_root_missing_types');
  process.exit(0);
}
if (referencePathPattern.test(nextEnv)) {
  emit('semantic_drift', 'next_env_generated_lane_state');
  process.exit(0);
}
if (nextEnv !== canonicalNextEnv) {
  emit('semantic_drift', 'next_env_mismatch');
  process.exit(0);
}

emit('canonical', 'source_contract_canonical');
NODE
}

NEXT_GENERATED_ROOT_LAST_STATUS=""
NEXT_GENERATED_ROOT_LAST_REASON=""
NEXT_GENERATED_ROOT_LAST_ATTEMPTS=0
NEXT_GENERATED_ROOT_LAST_PAYLOAD=""

next_generated_root_resolve_source_contract_with_once() {
  local phase="$1"
  local once_function="$2"
  local fallback_reason="${3:-resolver_failed}"
  local max_retries retry_delay output status reason payload attempt
  max_retries="$(next_generated_root_retry_count_for_phase "${phase}")"
  retry_delay="$(next_generated_root_retry_delay_for_phase "${phase}")"
  attempt=1

  while true; do
    output="$("${once_function}" 2>/dev/null || true)"
    IFS=$'\t' read -r status reason payload <<< "${output}"
    status="${status:-unexpected_io_failure}"
    reason="${reason:-${fallback_reason}}"
    payload="${payload:-}"

    if [[ "${status}" == "transient_unreadable" ]]; then
      if (( attempt > max_retries )); then
        NEXT_GENERATED_ROOT_LAST_STATUS="persistent_unreadable"
        NEXT_GENERATED_ROOT_LAST_REASON="${reason}"
        NEXT_GENERATED_ROOT_LAST_ATTEMPTS="${attempt}"
        NEXT_GENERATED_ROOT_LAST_PAYLOAD=""
        return 0
      fi
      attempt=$((attempt + 1))
      sleep "${retry_delay}"
      continue
    fi

    NEXT_GENERATED_ROOT_LAST_STATUS="${status}"
    NEXT_GENERATED_ROOT_LAST_REASON="${reason}"
    NEXT_GENERATED_ROOT_LAST_ATTEMPTS="${attempt}"
    NEXT_GENERATED_ROOT_LAST_PAYLOAD="${payload}"
    return 0
  done
}

next_generated_root_resolve_source_contract_status() {
  local phase="$1"
  next_generated_root_resolve_source_contract_with_once \
    "${phase}" \
    next_generated_root_probe_source_contract_once \
    "probe_failed"
}

next_generated_root_report_source_contract_failure() {
  local phase="$1"
  local status="${NEXT_GENERATED_ROOT_LAST_STATUS:-unexpected_io_failure}"
  local reason="${NEXT_GENERATED_ROOT_LAST_REASON:-probe_failed}"
  local attempts="${NEXT_GENERATED_ROOT_LAST_ATTEMPTS:-0}"
  next_generated_root_record_contract_event "${phase}" "${status}" "${reason}" "${attempts}"
  case "${status}" in
    semantic_drift)
      printf '[next-generated-root] root source contract drift detected; validation will not rewrite tsconfig.json or next-env.d.ts.\n' >&2
      return 1
      ;;
    persistent_unreadable)
      printf '[next-generated-root] persistent_unreadable: root source contract stayed unreadable after retry budget (%s, attempts=%s).\n' "${reason}" "${attempts}" >&2
      return 2
      ;;
    unexpected_io_failure)
      printf '[next-generated-root] unexpected_io_failure: root source contract check failed unexpectedly (%s).\n' "${reason}" >&2
      return 3
      ;;
    *)
      printf '[next-generated-root] unexpected_io_failure: unrecognized source contract status (%s:%s).\n' "${status}" "${reason}" >&2
      return 3
      ;;
  esac
}

next_generated_root_write_lane_owner() {
  local run_root="$1"
  local lane_name="$2"
  local owner_pid="$3"
  local owner_label="${4:-}"
  local owner_file owner_identity owner_token owner_token_source
  owner_file="$(next_generated_root_lane_owner_file "${run_root}")"
  owner_identity="$(next_generated_root_live_process_identity "${owner_pid}" 2>/dev/null || true)"
  IFS='|' read -r owner_token owner_token_source <<< "${owner_identity}"
  mkdir -p "$(dirname "${owner_file}")"
  cat > "${owner_file}" <<EOF
lane_name=${lane_name}
owner_pid=${owner_pid}
owner_label=${owner_label}
owner_token=${owner_token}
owner_token_source=${owner_token_source}
started_at=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
EOF
}

next_generated_root_clear_lane_owner() {
  local run_root="$1"
  rm -f "$(next_generated_root_lane_owner_file "${run_root}")"
}

next_generated_root_read_lane_owner_field() {
  local run_root="$1"
  local field_name="$2"
  local owner_file field_value
  owner_file="$(next_generated_root_lane_owner_file "${run_root}")"
  [[ -f "${owner_file}" ]] || return 1
  field_value="$(sed -n "s/^${field_name}=//p" "${owner_file}" | head -n 1)"
  [[ -n "${field_value}" ]] || return 1
  printf '%s\n' "${field_value}"
}

next_generated_root_live_process_identity() {
  local pid="$1"
  node - <<'NODE' "${pid}"
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const pid = Number.parseInt(process.argv[2] ?? '', 10);
if (!Number.isFinite(pid) || pid <= 0) {
  process.exit(1);
}

function linuxIdentity(targetPid) {
  try {
    const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    const statRaw = fs.readFileSync(`/proc/${targetPid}/stat`, 'utf8');
    const closeParen = statRaw.lastIndexOf(')');
    if (!bootId || closeParen === -1) {
      return null;
    }
    const trailing = statRaw.slice(closeParen + 2).trim().split(/\s+/);
    const startTime = trailing[19];
    if (!startTime) {
      return null;
    }
    return {
      token: `linux:boot=${bootId}:start=${startTime}`,
      source: 'linux_boot_id_proc_stat',
    };
  } catch {
    return null;
  }
}

const linux = process.platform === 'linux' ? linuxIdentity(pid) : null;
if (linux) {
  process.stdout.write(`${linux.token}|${linux.source}\n`);
  process.exit(0);
}

const ps = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
const startedAt = String(ps.stdout ?? '').trim();
if (!startedAt) {
  process.exit(1);
}
process.stdout.write(`${startedAt}|ps_lstart_raw\n`);
NODE
}

next_generated_root_is_lane_owner_active() {
  local run_root="$1"
  local owner_pid owner_label owner_cmd owner_token current_identity current_token
  owner_pid="$(next_generated_root_read_lane_owner_field "${run_root}" owner_pid 2>/dev/null || true)"
  [[ -n "${owner_pid}" ]] || return 1
  if ! kill -0 "${owner_pid}" >/dev/null 2>&1; then
    return 1
  fi

  owner_label="$(next_generated_root_read_lane_owner_field "${run_root}" owner_label 2>/dev/null || true)"
  if [[ -z "${owner_label}" ]]; then
    owner_label="next_generated_root_lane_owner"
  fi

  owner_cmd="$(ps -p "${owner_pid}" -o command= 2>/dev/null || true)"
  [[ "${owner_cmd}" == *"${owner_label}"* ]] || return 1

  owner_token="$(next_generated_root_read_lane_owner_field "${run_root}" owner_token 2>/dev/null || true)"
  if [[ -z "${owner_token}" ]]; then
    return 0
  fi
  current_identity="$(next_generated_root_live_process_identity "${owner_pid}" 2>/dev/null || true)"
  IFS='|' read -r current_token _ <<< "${current_identity}"
  [[ -n "${current_token}" && "${current_token}" == "${owner_token}" ]]
}

next_generated_root_is_allowed_active_run_root() {
  local run_root="$1"
  local allowed_run_root="${NEXT_GENERATED_ROOT_ALLOWED_ACTIVE_RUN_ROOT:-}"
  [[ -n "${allowed_run_root}" ]] || return 1
  [[ "$(realpath -m "${run_root}")" == "$(realpath -m "${allowed_run_root}")" ]]
}

next_generated_root_is_allowed_active_lane_run_root() {
  local run_root="$1"
  next_generated_root_is_allowed_active_run_root "${run_root}" || return 1
  next_generated_root_is_lane_owner_active "${run_root}"
}

next_generated_root_current_alias_points_to_allowed_active_run_root() {
  local alias_path="$1"
  local alias_target
  [[ -L "${alias_path}" ]] || return 1
  alias_target="$(realpath -m "${alias_path}")"
  next_generated_root_is_allowed_active_lane_run_root "${alias_target}"
}

next_generated_root_normalize() {
  next_generated_root_cleanup_lane_runtime_state_for_validation || return $?
  next_generated_root_repair_source_contract
}

next_generated_root_repair_acquire_tsconfig_once() {
  local repo_dir
  repo_dir="$(next_generated_root_repo_dir)"

  node - <<'NODE' "${repo_dir}"
const fs = require('node:fs');
const path = require('node:path');

const repoDir = process.argv[2];
const tsconfigPath = path.join(repoDir, 'tsconfig.json');
const transientReadErrorCodes = new Set(['ENOENT', 'EBUSY']);
const unexpectedIoErrorCodes = new Set(['EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'EMFILE']);

function emit(status, reason, payload = '') {
  process.stdout.write(`${status}\t${reason}${payload ? `\t${payload}` : ''}\n`);
}

function classifyIoError(error, fallbackReason) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code ?? '')
    : '';
  const normalizedCode = code.toLowerCase() || 'unknown';
  if (transientReadErrorCodes.has(code)) {
    emit('transient_unreadable', `${fallbackReason}_${normalizedCode}`);
    return true;
  }
  if (unexpectedIoErrorCodes.has(code) || code) {
    emit('unexpected_io_failure', `${fallbackReason}_${normalizedCode}`);
    return true;
  }
  return false;
}

let raw;
try {
  raw = fs.readFileSync(tsconfigPath, 'utf8');
} catch (error) {
  if (!classifyIoError(error, 'tsconfig_read_failed')) {
    emit('unexpected_io_failure', 'tsconfig_read_failed_unknown');
  }
  process.exit(0);
}

try {
  JSON.parse(raw);
} catch {
  emit('transient_unreadable', 'tsconfig_json_parse_failed');
  process.exit(0);
}

emit('readable', 'source_contract_readable', Buffer.from(raw, 'utf8').toString('base64'));
NODE
}

next_generated_root_repair_acquire_next_env_once() {
  local repo_dir
  repo_dir="$(next_generated_root_repo_dir)"

  node - <<'NODE' "${repo_dir}"
const fs = require('node:fs');
const path = require('node:path');

const repoDir = process.argv[2];
const nextEnvPath = path.join(repoDir, 'next-env.d.ts');
const transientReadErrorCodes = new Set(['ENOENT', 'EBUSY']);
const unexpectedIoErrorCodes = new Set(['EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'EMFILE']);

function emit(status, reason, payload = '') {
  process.stdout.write(`${status}\t${reason}${payload ? `\t${payload}` : ''}\n`);
}

function classifyIoError(error, fallbackReason) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code ?? '')
    : '';
  const normalizedCode = code.toLowerCase() || 'unknown';
  if (transientReadErrorCodes.has(code)) {
    emit('transient_unreadable', `${fallbackReason}_${normalizedCode}`);
    return true;
  }
  if (unexpectedIoErrorCodes.has(code) || code) {
    emit('unexpected_io_failure', `${fallbackReason}_${normalizedCode}`);
    return true;
  }
  emit('unexpected_io_failure', `${fallbackReason}_${normalizedCode}`);
  return true;
}

try {
  fs.statSync(nextEnvPath);
} catch (error) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code ?? '')
    : '';
  if (code === 'ENOENT') {
    emit('absent', 'next_env_absent');
    process.exit(0);
  }
  classifyIoError(error, 'next_env_read_failed');
  process.exit(0);
}

let raw;
try {
  raw = fs.readFileSync(nextEnvPath, 'utf8');
} catch (error) {
  classifyIoError(error, 'next_env_read_failed');
  process.exit(0);
}

emit('readable', 'source_contract_readable', Buffer.from(raw, 'utf8').toString('base64'));
NODE
}

next_generated_root_apply_canonical_tsconfig_include() {
  local tsconfig_path="$1"
  local raw_payload="$2"

  node - <<'NODE' "${tsconfig_path}" "${raw_payload}"
const fs = require('node:fs');
const path = require('node:path');

const tsconfigPath = process.argv[2];
const acquiredRaw = Buffer.from(process.argv[3], 'base64').toString('utf8');
const canonicalInclude = [
  '.next/types/**/*.ts',
  'next-env.d.ts',
  'src/**/*.ts',
  'src/**/*.tsx',
];
const retryCount = Number.parseInt(process.env.NEXT_GENERATED_ROOT_APPLY_REREAD_RETRY_COUNT ?? '20', 10);
const retryDelayMs = Number.parseInt(process.env.NEXT_GENERATED_ROOT_APPLY_REREAD_RETRY_DELAY_MS ?? '25', 10);
const maxAttempts = Number.isFinite(retryCount) && retryCount > 0 ? retryCount : 20;
const delayMs = Number.isFinite(retryDelayMs) && retryDelayMs >= 0 ? retryDelayMs : 25;

function sleep(ms) {
  if (ms <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function canonicalize(raw) {
  const config = JSON.parse(raw);
  const nextConfig = { ...config, include: canonicalInclude };
  return `${JSON.stringify(nextConfig, null, 2)}\n`;
}

function tempPathFor(file, attempt) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  return path.join(dir, `.${base}.${process.pid}.${Date.now()}.${attempt}.tmp`);
}

function writeAtomicIfUnchanged(file, expectedRaw, nextContent, attempt) {
  const latestRaw = fs.readFileSync(file, 'utf8');
  if (latestRaw !== expectedRaw) {
    return false;
  }
  const tempPath = tempPathFor(file, attempt);
  let mode;
  try {
    mode = fs.statSync(file).mode;
  } catch {
    mode = 0o644;
  }
  try {
    fs.writeFileSync(tempPath, nextContent, { mode });
    fs.renameSync(tempPath, file);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // best effort cleanup
    }
    throw error;
  }
  return true;
}

JSON.parse(acquiredRaw);

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  let latestRaw;
  try {
    latestRaw = fs.readFileSync(tsconfigPath, 'utf8');
  } catch (error) {
    if (attempt === maxAttempts) {
      throw error;
    }
    sleep(delayMs);
    continue;
  }

  let nextContent;
  try {
    nextContent = canonicalize(latestRaw);
  } catch (error) {
    if (attempt === maxAttempts) {
      process.exit(75);
    }
    sleep(delayMs);
    continue;
  }

  if (latestRaw === nextContent) {
    process.exit(0);
  }

  if (writeAtomicIfUnchanged(tsconfigPath, latestRaw, nextContent, attempt)) {
    process.exit(0);
  }

  sleep(delayMs);
}
process.exit(75);
NODE
}

next_generated_root_apply_canonical_next_env() {
  local next_env_path="$1"
  local raw_payload="$2"

  node - <<'NODE' "${next_env_path}" "${raw_payload}"
const fs = require('node:fs');
const path = require('node:path');

const nextEnvPath = process.argv[2];
Buffer.from(process.argv[3], 'base64').toString('utf8');
const canonicalNextEnv = `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`;
const retryCount = Number.parseInt(process.env.NEXT_GENERATED_ROOT_APPLY_REREAD_RETRY_COUNT ?? '20', 10);
const retryDelayMs = Number.parseInt(process.env.NEXT_GENERATED_ROOT_APPLY_REREAD_RETRY_DELAY_MS ?? '25', 10);
const maxAttempts = Number.isFinite(retryCount) && retryCount > 0 ? retryCount : 20;
const delayMs = Number.isFinite(retryDelayMs) && retryDelayMs >= 0 ? retryDelayMs : 25;

function sleep(ms) {
  if (ms <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tempPathFor(file, attempt) {
  const dir = path.dirname(file);
  const base = path.basename(file);
  return path.join(dir, `.${base}.${process.pid}.${Date.now()}.${attempt}.tmp`);
}

function writeAtomicIfUnchanged(file, expectedRaw, nextContent, attempt) {
  let latestRaw;
  try {
    latestRaw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return 'absent';
    }
    throw error;
  }
  if (latestRaw !== expectedRaw) {
    return 'changed';
  }
  const tempPath = tempPathFor(file, attempt);
  let mode;
  try {
    mode = fs.statSync(file).mode;
  } catch {
    mode = 0o644;
  }
  try {
    fs.writeFileSync(tempPath, nextContent, { mode });
    fs.renameSync(tempPath, file);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // best effort cleanup
    }
    throw error;
  }
  return 'written';
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  let latestRaw;
  try {
    latestRaw = fs.readFileSync(nextEnvPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      process.exit(0);
    }
    if (attempt === maxAttempts) {
      throw error;
    }
    sleep(delayMs);
    continue;
  }

  if (latestRaw === canonicalNextEnv) {
    process.exit(0);
  }

  const result = writeAtomicIfUnchanged(nextEnvPath, latestRaw, canonicalNextEnv, attempt);
  if (result === 'written' || result === 'absent') {
    process.exit(0);
  }
  sleep(delayMs);
}
process.exit(75);
NODE
}

next_generated_root_repair_source_contract() {
  local phase="${1:-final_reconcile}"
  if next_generated_root_source_contract_lock_owned_by_current_process; then
    next_generated_root_repair_source_contract_locked "${phase}"
    return $?
  fi
  next_generated_root_with_source_contract_lock "repair_${phase}" \
    next_generated_root_repair_source_contract_locked "${phase}"
}

next_generated_root_repair_source_contract_locked() {
  local phase="${1:-final_reconcile}"
  local repo_dir
  local tsconfig_path
  local next_env_path
  local raw_payload
  local next_env_payload
  repo_dir="$(next_generated_root_repo_dir)"
  tsconfig_path="${repo_dir}/tsconfig.json"
  next_env_path="${repo_dir}/next-env.d.ts"

  next_generated_root_resolve_source_contract_with_once \
    "${phase}" \
    next_generated_root_repair_acquire_tsconfig_once \
    "repair_tsconfig_acquisition_failed"
  case "${NEXT_GENERATED_ROOT_LAST_STATUS}" in
    readable)
      raw_payload="${NEXT_GENERATED_ROOT_LAST_PAYLOAD:-}"
      ;;
    persistent_unreadable|unexpected_io_failure)
      return 1
      ;;
    *)
      NEXT_GENERATED_ROOT_LAST_STATUS="unexpected_io_failure"
      NEXT_GENERATED_ROOT_LAST_REASON="invalid_tsconfig_repair_acquisition_status"
      NEXT_GENERATED_ROOT_LAST_ATTEMPTS="${NEXT_GENERATED_ROOT_LAST_ATTEMPTS:-1}"
      NEXT_GENERATED_ROOT_LAST_PAYLOAD=""
      return 1
      ;;
  esac

  if ! next_generated_root_apply_canonical_tsconfig_include "${tsconfig_path}" "${raw_payload}"; then
    NEXT_GENERATED_ROOT_LAST_STATUS="unexpected_io_failure"
    NEXT_GENERATED_ROOT_LAST_REASON="tsconfig_repair_apply_failed"
    NEXT_GENERATED_ROOT_LAST_ATTEMPTS="${NEXT_GENERATED_ROOT_LAST_ATTEMPTS:-1}"
    NEXT_GENERATED_ROOT_LAST_PAYLOAD=""
    return 1
  fi

  next_generated_root_resolve_source_contract_with_once \
    "${phase}" \
    next_generated_root_repair_acquire_next_env_once \
    "repair_next_env_acquisition_failed"
  case "${NEXT_GENERATED_ROOT_LAST_STATUS}" in
    absent)
      return 0
      ;;
    readable)
      next_env_payload="${NEXT_GENERATED_ROOT_LAST_PAYLOAD:-}"
      ;;
    persistent_unreadable|unexpected_io_failure)
      return 1
      ;;
    *)
      NEXT_GENERATED_ROOT_LAST_STATUS="unexpected_io_failure"
      NEXT_GENERATED_ROOT_LAST_REASON="invalid_next_env_repair_acquisition_status"
      NEXT_GENERATED_ROOT_LAST_ATTEMPTS="${NEXT_GENERATED_ROOT_LAST_ATTEMPTS:-1}"
      NEXT_GENERATED_ROOT_LAST_PAYLOAD=""
      return 1
      ;;
  esac

  if ! next_generated_root_apply_canonical_next_env "${next_env_path}" "${next_env_payload}"; then
    NEXT_GENERATED_ROOT_LAST_STATUS="unexpected_io_failure"
    NEXT_GENERATED_ROOT_LAST_REASON="next_env_repair_apply_failed"
    NEXT_GENERATED_ROOT_LAST_ATTEMPTS="${NEXT_GENERATED_ROOT_LAST_ATTEMPTS:-1}"
    NEXT_GENERATED_ROOT_LAST_PAYLOAD=""
    return 1
  fi
}

next_generated_root_capture_source_snapshot() {
  :
}

next_generated_root_restore_source_snapshot() {
  next_generated_root_final_reconcile_source_contract
}

next_generated_root_clear_source_snapshot() {
  :
}

next_generated_root_finalize_source_contract() {
  next_generated_root_final_reconcile_source_contract
}

next_generated_root_final_reconcile_source_contract() {
  next_generated_root_reconcile_source_contract final_reconcile
}

next_generated_root_assert_source_contract() {
  local phase="${1:-prepare_for_validation}"
  next_generated_root_resolve_source_contract_status "${phase}"
  case "${NEXT_GENERATED_ROOT_LAST_STATUS}" in
    canonical)
      return 0
      ;;
    semantic_drift|persistent_unreadable|unexpected_io_failure)
      next_generated_root_report_source_contract_failure "${phase}"
      return $?
      ;;
    *)
      NEXT_GENERATED_ROOT_LAST_STATUS="unexpected_io_failure"
      NEXT_GENERATED_ROOT_LAST_REASON="invalid_probe_status"
      NEXT_GENERATED_ROOT_LAST_ATTEMPTS="${NEXT_GENERATED_ROOT_LAST_ATTEMPTS:-1}"
      next_generated_root_report_source_contract_failure "${phase}"
      return $?
      ;;
  esac
}

next_generated_root_reconcile_source_contract() {
  local phase="${1:-final_reconcile}"
  next_generated_root_resolve_source_contract_status "${phase}"
  case "${NEXT_GENERATED_ROOT_LAST_STATUS}" in
    canonical)
      return 0
      ;;
    semantic_drift)
      if next_generated_root_repair_source_contract "${phase}"; then
        return 0
      fi
      next_generated_root_report_source_contract_failure "${phase}"
      return $?
      ;;
    persistent_unreadable|unexpected_io_failure)
      next_generated_root_report_source_contract_failure "${phase}"
      return $?
      ;;
    *)
      NEXT_GENERATED_ROOT_LAST_STATUS="unexpected_io_failure"
      NEXT_GENERATED_ROOT_LAST_REASON="invalid_probe_status"
      NEXT_GENERATED_ROOT_LAST_ATTEMPTS="${NEXT_GENERATED_ROOT_LAST_ATTEMPTS:-1}"
      next_generated_root_report_source_contract_failure "${phase}"
      return $?
      ;;
  esac
}

next_generated_root_stop_pid_tree_gracefully() {
  local pid="$1"
  local wait_seconds="${2:-5}"
  [[ -n "${pid}" ]] || return 0
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi

  local child
  local child_pids=()
  while read -r child; do
    [[ -n "${child}" ]] || continue
    child_pids+=("${child}")
  done < <(pgrep -P "${pid}" 2>/dev/null || true)

  kill -TERM "${pid}" >/dev/null 2>&1 || true
  local _i
  for _i in $(seq 1 "$((wait_seconds * 20))"); do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      break
    fi
    sleep 0.05
  done

  for child in "${child_pids[@]}"; do
    [[ -n "${child}" ]] || continue
    next_generated_root_stop_pid_tree_gracefully "${child}" "${wait_seconds}"
  done

  if kill -0 "${pid}" >/dev/null 2>&1; then
    kill -KILL "${pid}" >/dev/null 2>&1 || true
  fi
}

next_generated_root_remove_lane_current_links() {
  local repo_dir
  repo_dir="$(next_generated_root_repo_dir)"
  next_generated_root_remove_lane_current_alias "${repo_dir}/artifacts/mock-lane/current" || return $?
  next_generated_root_remove_lane_current_alias "${repo_dir}/artifacts/backend-real/current-run" || return $?
}

next_generated_root_remove_lane_current_alias() {
  local alias_path="$1"
  local parent base legacy_path suffix
  [[ -e "${alias_path}" || -L "${alias_path}" ]] || return 0
  if next_generated_root_current_alias_points_to_allowed_active_run_root "${alias_path}"; then
    return 0
  fi
  if [[ -L "${alias_path}" || -f "${alias_path}" ]]; then
    rm -f "${alias_path}"
    return 0
  fi
  if [[ -d "${alias_path}" ]]; then
    parent="$(dirname "${alias_path}")"
    base="$(basename "${alias_path}")"
    suffix="$(date -u +%Y%m%dT%H%M%SZ)-$$"
    legacy_path="${parent}/${base}-legacy-${suffix}"
    local attempt=0
    while [[ -e "${legacy_path}" ]]; do
      attempt=$((attempt + 1))
      legacy_path="${parent}/${base}-legacy-${suffix}-${attempt}"
    done
    mv "${alias_path}" "${legacy_path}"
    return $?
  fi

  rm -f "${alias_path}"
}

next_generated_root_stop_lane_web_processes() {
  local repo_dir lane_root pid_file pid cmd run_root
  local active_conflicts=()
  repo_dir="$(next_generated_root_repo_dir)"

  for lane_root in \
    "${repo_dir}/artifacts/mock-lane/runs" \
    "${repo_dir}/artifacts/backend-real/runs"
  do
    [[ -d "${lane_root}" ]] || continue
    while IFS= read -r pid_file; do
      [[ -n "${pid_file}" ]] || continue
      run_root="$(dirname "${pid_file}")"
      if next_generated_root_is_allowed_active_lane_run_root "${run_root}"; then
        continue
      fi
      if next_generated_root_is_lane_owner_active "${run_root}"; then
        if [[ " ${active_conflicts[*]} " != *" ${run_root} "* ]]; then
          active_conflicts+=("${run_root}")
        fi
        continue
      fi
      pid="$(cat "${pid_file}" 2>/dev/null || true)"
      if [[ -z "${pid}" ]]; then
        rm -f "${pid_file}"
        next_generated_root_clear_lane_owner "${run_root}"
        continue
      fi
      if ! kill -0 "${pid}" >/dev/null 2>&1; then
        rm -f "${pid_file}"
        next_generated_root_clear_lane_owner "${run_root}"
        continue
      fi
      cmd="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
      if [[ "${cmd}" == *"next dev"* || "${cmd}" == *"run-next-dev-safe.sh"* || "${cmd}" == *"npm run dev:test"* ]]; then
        if [[ " ${active_conflicts[*]} " != *" ${run_root} "* ]]; then
          active_conflicts+=("${run_root}")
        fi
        continue
      fi
      rm -f "${pid_file}"
      next_generated_root_clear_lane_owner "${run_root}"
    done < <(find "${lane_root}" -mindepth 2 -maxdepth 2 \( -type f -name 'web.pid' -o -type f -name 'next-dev.pid' \) 2>/dev/null | sort -u)
  done

  if [[ "${#active_conflicts[@]}" -gt 0 ]]; then
    printf '[next-generated-root] active lane owner blocks validation cleanup:\n' >&2
    local conflict
    for conflict in "${active_conflicts[@]}"; do
      printf ' - %s\n' "${conflict}" >&2
    done
    printf '[next-generated-root] stop the active lane before validation, then rerun the command. This prevents concurrent Next dev servers from rewriting .next/types, tsconfig.json, or next-env.d.ts.\n' >&2
    return 2
  fi
}

next_generated_root_cleanup_lane_runtime_state_for_validation() {
  next_generated_root_stop_lane_web_processes || return $?
  next_generated_root_remove_lane_current_links
}

next_generated_root_prepare_for_validation() {
  next_generated_root_cleanup_lane_runtime_state_for_validation || return $?
  next_generated_root_assert_source_contract prepare_for_validation
}

next_generated_root_root_types_dir() {
  local repo_dir
  repo_dir="$(next_generated_root_repo_dir)"
  printf '%s/.next/types\n' "${repo_dir}"
}

next_generated_root_root_routes_types_file() {
  printf '%s/routes.d.ts\n' "$(next_generated_root_root_types_dir)"
}

next_generated_root_reset_root_typegen_artifacts() {
  rm -rf "$(next_generated_root_root_types_dir)"
}

next_generated_root_require_callback_function() {
  local callback_name="$1"
  if declare -F "${callback_name}" >/dev/null 2>&1; then
    return 0
  fi

  printf '[next-generated-root] missing callback function for locked type-state sequence: %s\n' "${callback_name}" >&2
  return 2
}

next_generated_root_export_all_shell_functions() {
  local function_name
  while IFS= read -r function_name; do
    [[ -n "${function_name}" ]] || continue
    export -f "${function_name}"
  done < <(compgen -A function)
}

next_generated_root_run_callback_without_lock_context() {
  local callback_name="$1"
  local previous_lock_held previous_lock_held_was_set previous_lock_owner_pid previous_lock_owner_pid_was_set previous_lock_context_token previous_lock_context_token_was_set previous_reentry_scope previous_reentry_scope_was_set previous_reentry_context_token previous_reentry_context_token_was_set callback_status

  previous_lock_held="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD:-}"
  previous_lock_held_was_set=0
  if [[ -n "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD+x}" ]]; then
    previous_lock_held_was_set=1
  fi
  previous_lock_owner_pid="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID:-}"
  previous_lock_owner_pid_was_set=0
  if [[ -n "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID+x}" ]]; then
    previous_lock_owner_pid_was_set=1
  fi
  previous_lock_context_token="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN:-}"
  previous_lock_context_token_was_set=0
  if [[ -n "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN+x}" ]]; then
    previous_lock_context_token_was_set=1
  fi
  previous_reentry_scope="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_SCOPE:-}"
  previous_reentry_scope_was_set=0
  if [[ -n "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_SCOPE+x}" ]]; then
    previous_reentry_scope_was_set=1
  fi
  previous_reentry_context_token="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_CONTEXT_TOKEN:-}"
  previous_reentry_context_token_was_set=0
  if [[ -n "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_CONTEXT_TOKEN+x}" ]]; then
    previous_reentry_context_token_was_set=1
  fi

  unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD
  unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID
  unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN
  unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_SCOPE
  unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_CONTEXT_TOKEN
  "${callback_name}"
  callback_status=$?

  if [[ "${previous_lock_held_was_set}" -eq 1 ]]; then
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD="${previous_lock_held}"
  else
    unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD
  fi
  if [[ "${previous_lock_owner_pid_was_set}" -eq 1 ]]; then
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID="${previous_lock_owner_pid}"
  else
    unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID
  fi
  if [[ "${previous_lock_context_token_was_set}" -eq 1 ]]; then
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN="${previous_lock_context_token}"
  else
    unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN
  fi
  if [[ "${previous_reentry_scope_was_set}" -eq 1 ]]; then
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_SCOPE="${previous_reentry_scope}"
  else
    unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_SCOPE
  fi
  if [[ "${previous_reentry_context_token_was_set}" -eq 1 ]]; then
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_CONTEXT_TOKEN="${previous_reentry_context_token}"
  else
    unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_CONTEXT_TOKEN
  fi

  return "${callback_status}"
}

next_generated_root_run_build_callback_with_reentry_context() {
  local callback_name="$1"
  local previous_lock_held previous_lock_held_was_set previous_lock_owner_pid previous_lock_owner_pid_was_set previous_lock_context_token previous_lock_context_token_was_set previous_reentry_scope previous_reentry_scope_was_set previous_reentry_context_token previous_reentry_context_token_was_set callback_status

  previous_lock_held="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD:-}"
  previous_lock_held_was_set=0
  if [[ -n "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD+x}" ]]; then
    previous_lock_held_was_set=1
  fi
  previous_lock_owner_pid="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID:-}"
  previous_lock_owner_pid_was_set=0
  if [[ -n "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID+x}" ]]; then
    previous_lock_owner_pid_was_set=1
  fi
  previous_lock_context_token="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN:-}"
  previous_lock_context_token_was_set=0
  if [[ -n "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN+x}" ]]; then
    previous_lock_context_token_was_set=1
  fi
  previous_reentry_scope="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_SCOPE:-}"
  previous_reentry_scope_was_set=0
  if [[ -n "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_SCOPE+x}" ]]; then
    previous_reentry_scope_was_set=1
  fi
  previous_reentry_context_token="${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_CONTEXT_TOKEN:-}"
  previous_reentry_context_token_was_set=0
  if [[ -n "${NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_CONTEXT_TOKEN+x}" ]]; then
    previous_reentry_context_token_was_set=1
  fi

  unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD
  unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID
  unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN
  export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_SCOPE="build_finalize"
  export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_CONTEXT_TOKEN="${previous_lock_context_token}"
  "${callback_name}"
  callback_status=$?

  if [[ "${previous_lock_held_was_set}" -eq 1 ]]; then
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD="${previous_lock_held}"
  else
    unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD
  fi
  if [[ "${previous_lock_owner_pid_was_set}" -eq 1 ]]; then
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID="${previous_lock_owner_pid}"
  else
    unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID
  fi
  if [[ "${previous_lock_context_token_was_set}" -eq 1 ]]; then
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN="${previous_lock_context_token}"
  else
    unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN
  fi
  if [[ "${previous_reentry_scope_was_set}" -eq 1 ]]; then
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_SCOPE="${previous_reentry_scope}"
  else
    unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_SCOPE
  fi
  if [[ "${previous_reentry_context_token_was_set}" -eq 1 ]]; then
    export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_CONTEXT_TOKEN="${previous_reentry_context_token}"
  else
    unset NEXT_GENERATED_ROOT_SOURCE_CONTRACT_REENTRY_CONTEXT_TOKEN
  fi

  return "${callback_status}"
}

next_generated_root_assert_root_routes_types_present() {
  local phase="${1:-typegen}"
  local routes_file
  routes_file="$(next_generated_root_root_routes_types_file)"
  if [[ -s "${routes_file}" ]]; then
    return 0
  fi

  NEXT_GENERATED_ROOT_LAST_STATUS="semantic_drift"
  NEXT_GENERATED_ROOT_LAST_REASON="root_typegen_routes_missing"
  NEXT_GENERATED_ROOT_LAST_ATTEMPTS=1
  NEXT_GENERATED_ROOT_LAST_PAYLOAD=""
  next_generated_root_report_source_contract_failure "${phase}"
}

next_generated_root_run_locked_type_state_gate_sequence_locked() {
  local phase="$1"
  local typegen_callback="$2"
  local tsc_callback="$3"
  local build_callback="${4:-}"

  next_generated_root_require_callback_function "${typegen_callback}" || return $?
  next_generated_root_require_callback_function "${tsc_callback}" || return $?
  if [[ -n "${build_callback}" ]]; then
    next_generated_root_require_callback_function "${build_callback}" || return $?
  fi

  next_generated_root_prepare_source_safe_for_tsc || return $?
  next_generated_root_reset_root_typegen_artifacts

  next_generated_root_run_callback_without_lock_context "${typegen_callback}" || return $?
  next_generated_root_assert_root_routes_types_present "${phase}_typegen" || return $?
  next_generated_root_assert_source_contract "${phase}_typegen" || return $?

  next_generated_root_run_callback_without_lock_context "${tsc_callback}" || return $?

  if [[ -n "${build_callback}" ]]; then
    next_generated_root_run_build_callback_with_reentry_context "${build_callback}" || return $?
  fi

  next_generated_root_prepare_source_safe_for_tsc
}

next_generated_root_run_locked_type_state_gate_sequence() {
  local phase="$1"
  local typegen_callback="$2"
  local tsc_callback="$3"
  local build_callback="${4:-}"
  local helper_path lock_file state_dir lock_context_token status repo_dir

  if next_generated_root_source_contract_lock_owned_by_current_process; then
    next_generated_root_run_locked_type_state_gate_sequence_locked \
      "${phase}" \
      "${typegen_callback}" \
      "${tsc_callback}" \
      "${build_callback}"
    return $?
  fi

  if ! command -v flock >/dev/null 2>&1; then
    next_generated_root_with_source_contract_lock "${phase}" \
      next_generated_root_run_locked_type_state_gate_sequence_locked \
      "${phase}" \
      "${typegen_callback}" \
      "${tsc_callback}" \
      "${build_callback}"
    return $?
  fi

  next_generated_root_require_callback_function "${typegen_callback}" || return $?
  next_generated_root_require_callback_function "${tsc_callback}" || return $?
  if [[ -n "${build_callback}" ]]; then
    next_generated_root_require_callback_function "${build_callback}" || return $?
  fi

  next_generated_root_export_all_shell_functions
  helper_path="${BASH_SOURCE[0]}"
  repo_dir="$(next_generated_root_repo_dir)"
  state_dir="$(next_generated_root_state_dir)"
  lock_file="$(next_generated_root_source_contract_lock_file)"
  lock_context_token="$(next_generated_root_source_contract_lock_new_context_token)"
  mkdir -p "${state_dir}"

  ROOT_DIR="${repo_dir}" \
  NEXT_GENERATED_ROOT_LOCK_HELPER_PATH="${helper_path}" \
  NEXT_GENERATED_ROOT_LOCK_STATE_DIR="${state_dir}" \
  NEXT_GENERATED_ROOT_LOCK_CONTEXT_TOKEN="${lock_context_token}" \
  flock -x -o "${lock_file}" \
    bash -lc '
      set -euo pipefail
      source "${NEXT_GENERATED_ROOT_LOCK_HELPER_PATH}"
      export NEXT_GENERATED_ROOT_STATE_DIR="${NEXT_GENERATED_ROOT_LOCK_STATE_DIR}"
      export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_HELD=1
      export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_OWNER_PID="$(next_generated_root_source_contract_lock_current_process_id)"
      export NEXT_GENERATED_ROOT_SOURCE_CONTRACT_LOCK_CONTEXT_TOKEN="${NEXT_GENERATED_ROOT_LOCK_CONTEXT_TOKEN}"
      next_generated_root_run_locked_type_state_gate_sequence_locked "$@"
    ' bash "${phase}" "${typegen_callback}" "${tsc_callback}" "${build_callback}"
  status=$?

  return "${status}"
}

next_generated_root_prepare_source_safe_for_tsc() {
  next_generated_root_cleanup_lane_runtime_state_for_validation || return $?
  if ! next_generated_root_repair_source_contract prepare_source_safe_for_tsc; then
    next_generated_root_report_source_contract_failure prepare_source_safe_for_tsc
    return $?
  fi
  next_generated_root_assert_source_contract prepare_source_safe_for_tsc
}

next_generated_root_guard_source_contract() {
  local child_pid="$1"
  local interval_seconds="${2:-${NEXT_GENERATED_ROOT_GUARD_INTERVAL_SEC:-0.1}}"
  while kill -0 "${child_pid}" >/dev/null 2>&1; do
    if ! next_generated_root_reconcile_source_contract guard; then
      :
    fi
    sleep "${interval_seconds}"
  done
}

next_generated_root_start_contract_guard() {
  local guard_interval="${1:-${NEXT_GENERATED_ROOT_GUARD_INTERVAL_SEC:-0.1}}"
  (
    while true; do
      if ! next_generated_root_reconcile_source_contract guard; then
        :
      fi
      sleep "${guard_interval}"
    done
  ) >/dev/null 2>&1 < /dev/null &
  printf '%s\n' "$!"
}

next_generated_root_stop_contract_guard() {
  local guard_pid="${1:-}"
  [[ -n "${guard_pid}" ]] || return 0
  kill "${guard_pid}" >/dev/null 2>&1 || true
  local _i
  for _i in $(seq 1 20); do
    if ! kill -0 "${guard_pid}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.05
  done
  kill -KILL "${guard_pid}" >/dev/null 2>&1 || true
}

next_generated_root_finalize_lane_cleanup() {
  :
}
