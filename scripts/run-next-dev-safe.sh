#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"
DEFAULT_MAX_OLD_SPACE_SIZE="${NEXT_MAX_OLD_SPACE_SIZE:-4096}"
NEXT_GENERATED_ROOT_MANAGED="${NEXT_GENERATED_ROOT_MANAGED:-0}"
export PATH="${ROOT_DIR}/node_modules/.bin:${PATH}"
NEXT_DEV_EXIT_MARKER_WRITTEN=0
NEXT_DEV_ROOT_GUARD_PID=""

if [[ -n "${NODE_OPTIONS:-}" ]]; then
  export NODE_OPTIONS="${NODE_OPTIONS} --max-old-space-size=${DEFAULT_MAX_OLD_SPACE_SIZE}"
else
  export NODE_OPTIONS="--max-old-space-size=${DEFAULT_MAX_OLD_SPACE_SIZE}"
fi

next_dev_live_process_identity() {
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

next_dev_classify_existing_process_owner() {
  local pid_from_file state_file parsed status pid token token_source kind port identity current_token
  if [[ -z "${NEXT_DEV_PID_FILE:-}" ]]; then
    printf 'missing|pid_file_unconfigured\n'
    return 0
  fi

  pid_from_file="$(cat "${NEXT_DEV_PID_FILE}" 2>/dev/null || true)"
  if [[ -z "${pid_from_file}" ]]; then
    printf 'missing|tracked_pid_missing\n'
    return 0
  fi

  state_file="${NEXT_DEV_PROCESS_STATE_FILE:-}"
  if [[ -n "${state_file}" && -f "${state_file}" ]]; then
    parsed="$(
      node - <<'NODE' "${state_file}" "${NEXT_DEV_PROCESS_KIND:-web}" "${NEXT_DEV_PORT:-}"
const fs = require('node:fs');
const [file, expectedKind, expectedPortRaw] = process.argv.slice(2);
const expectedPort = expectedPortRaw ? Number.parseInt(expectedPortRaw, 10) : null;
let payload;
try {
  payload = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  process.exit(1);
}
const pid = Number.parseInt(String(payload?.pid ?? ''), 10);
const port = Number.parseInt(String(payload?.port ?? ''), 10);
if (
  payload?.schema_version !== 1
  || payload?.kind !== expectedKind
  || !Number.isFinite(pid)
  || pid <= 0
  || !Number.isFinite(port)
  || (Number.isFinite(expectedPort) && port !== expectedPort)
  || typeof payload?.process_identity?.token !== 'string'
  || typeof payload?.process_identity?.source !== 'string'
  || typeof payload?.cwd !== 'string'
  || typeof payload?.command !== 'string'
) {
  process.exit(1);
}
process.stdout.write([
  'valid',
  String(pid),
  payload.process_identity.token,
  payload.process_identity.source,
  payload.kind,
  String(port),
].join('\t'));
NODE
    )" || {
      if kill -0 "${pid_from_file}" >/dev/null 2>&1; then
        printf 'unverified|tracked_state_invalid|%s\n' "${pid_from_file}"
      else
        printf 'stale|tracked_state_invalid_pid_missing|%s\n' "${pid_from_file}"
      fi
      return 0
    }
    IFS=$'\t' read -r status pid token token_source kind port <<< "${parsed}"
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      printf 'stale|tracked_pid_missing|%s\n' "${pid}"
      return 0
    fi
    identity="$(next_dev_live_process_identity "${pid}" 2>/dev/null || true)"
    IFS='|' read -r current_token _ <<< "${identity}"
    if [[ -z "${current_token}" || "${current_token}" != "${token}" ]]; then
      printf 'unverified|tracked_pid_reused|%s\n' "${pid}"
      return 0
    fi
    printf 'current_active|tracked_next_dev_%s|%s|%s\n' "${kind}" "${pid}" "${port}"
    return 0
  fi

  if kill -0 "${pid_from_file}" >/dev/null 2>&1; then
    printf 'unverified|tracked_pid_without_process_state|%s\n' "${pid_from_file}"
    return 0
  fi
  printf 'stale|tracked_pid_missing|%s\n' "${pid_from_file}"
}

next_dev_clear_stale_process_owner_state() {
  [[ -z "${NEXT_DEV_PID_FILE:-}" ]] || rm -f "${NEXT_DEV_PID_FILE}"
  [[ -z "${NEXT_DEV_PORT_FILE:-}" ]] || rm -f "${NEXT_DEV_PORT_FILE}"
  [[ -z "${NEXT_DEV_PROCESS_STATE_FILE:-}" ]] || rm -f "${NEXT_DEV_PROCESS_STATE_FILE}"
}

next_dev_assert_no_existing_process_owner() {
  local classification authority reason pid detail
  classification="$(next_dev_classify_existing_process_owner)"
  IFS='|' read -r authority reason pid detail <<< "${classification}"
  case "${authority}" in
    missing)
      return 0
      ;;
    stale)
      next_dev_clear_stale_process_owner_state
      return 0
      ;;
    current_active)
      cat >&2 <<EOF
[next-dev-safe] active Next.js dev process already owns this workspace (${reason}, pid=${pid}, port=${detail:-unknown}).
[next-dev-safe] Stop the existing dev server first, or run the owning lane cleanup command before starting another one.
EOF
      return 2
      ;;
    unverified)
      cat >&2 <<EOF
[next-dev-safe] unverified Next.js dev tracking state blocks startup (${reason}, pid=${pid:-unknown}).
[next-dev-safe] Refusing to overwrite pid/state files because doing so can leave .next/types, tsconfig.json, and next-env.d.ts owned by different dev servers.
EOF
      return 2
      ;;
    *)
      printf '[next-dev-safe] unrecognized process owner state: %s\n' "${classification}" >&2
      return 2
      ;;
  esac
}

next_dev_assert_no_existing_process_owner

running_processes="$(pgrep -af "next-server|next dev" || true)"
if [[ -n "${running_processes}" ]]; then
  running_count="$(
    printf '%s\n' "${running_processes}" \
      | { grep -F "${ROOT_DIR}" || true; } \
      | { grep -v "run-next-dev-safe.sh" || true; } \
      | wc -l \
      | tr -d ' '
  )"
else
  running_count="0"
fi

if [[ "${running_count}" -ge 2 ]]; then
  cat >&2 <<EOF
[next-dev-safe] warning: detected ${running_count} Next.js dev processes for this workspace.
[next-dev-safe] This repo has previously hit host OOM when multiple dev servers ran in parallel.
[next-dev-safe] Consider stopping unused dev servers before continuing.
EOF
fi

if [[ -n "${NEXT_DEV_PID_FILE:-}" ]]; then
  mkdir -p "$(dirname "${NEXT_DEV_PID_FILE}")"
  printf '%s\n' "$$" > "${NEXT_DEV_PID_FILE}"
fi

if [[ -n "${NEXT_DEV_PORT_FILE:-}" && -n "${NEXT_DEV_PORT:-}" ]]; then
  mkdir -p "$(dirname "${NEXT_DEV_PORT_FILE}")"
  printf '%s\n' "${NEXT_DEV_PORT}" > "${NEXT_DEV_PORT_FILE}"
fi

NEXT_DEV_CHILD_PID=""

write_next_dev_exit_marker() {
  local event="$1"
  local exit_status="$2"
  local signal_value="${3:-null}"
  local child_pid_value="${4:-null}"
  [[ -n "${NEXT_DEV_EXIT_MARKER_FILE:-}" ]] || return 0
  if [[ "${NEXT_DEV_EXIT_MARKER_WRITTEN}" == "1" ]]; then
    return 0
  fi
  mkdir -p "$(dirname "${NEXT_DEV_EXIT_MARKER_FILE}")"
  cat > "${NEXT_DEV_EXIT_MARKER_FILE}" <<EOF
{
  "event": "${event}",
  "exit_status": ${exit_status},
  "signal": ${signal_value},
  "wrapper_pid": $$,
  "child_pid": ${child_pid_value},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
}
EOF
  NEXT_DEV_EXIT_MARKER_WRITTEN=1
}

write_next_dev_process_state() {
  [[ -n "${NEXT_DEV_PROCESS_STATE_FILE:-}" && -n "${NEXT_DEV_CHILD_PID:-}" && -n "${NEXT_DEV_PORT:-}" ]] || return 0
  local kind="${NEXT_DEV_PROCESS_KIND:-web}"
  local captured_by="${NEXT_DEV_PROCESS_CAPTURED_BY:-run-next-dev-safe}"
  node - <<'NODE' "${NEXT_DEV_PROCESS_STATE_FILE}" "${kind}" "${NEXT_DEV_CHILD_PID}" "${NEXT_DEV_PORT}" "${captured_by}"
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [file, kind, pidRaw, portRaw, capturedBy] = process.argv.slice(2);
const pid = Number.parseInt(pidRaw, 10);
const port = Number.parseInt(portRaw, 10);
if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(port)) {
  process.exit(1);
}

function readCommand(targetPid) {
  const result = spawnSync('ps', ['-o', 'command=', '-p', String(targetPid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return String(result.stdout ?? '').trim();
}

function readCwd(targetPid) {
  try {
    return fs.realpathSync(`/proc/${targetPid}/cwd`);
  } catch {
    const result = spawnSync('ps', ['-o', 'cwd=', '-p', String(targetPid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return String(result.stdout ?? '').trim();
  }
}

function readIdentity(targetPid) {
  if (process.platform === 'linux') {
    try {
      const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      const statRaw = fs.readFileSync(`/proc/${targetPid}/stat`, 'utf8');
      const closeParen = statRaw.lastIndexOf(')');
      const trailing = closeParen === -1 ? [] : statRaw.slice(closeParen + 2).trim().split(/\s+/);
      const startTime = trailing[19];
      if (bootId && startTime) {
        return {
          token: `linux:boot=${bootId}:start=${startTime}`,
          source: 'linux_boot_id_proc_stat',
        };
      }
    } catch {
      // Fall through to ps-based fallback.
    }
  }

  const ps = spawnSync('ps', ['-o', 'lstart=', '-p', String(targetPid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const startedAt = String(ps.stdout ?? '').trim();
  if (!startedAt) {
    return null;
  }
  return {
    token: startedAt,
    source: 'ps_lstart_raw',
  };
}

const command = readCommand(pid);
const cwd = readCwd(pid);
const identity = readIdentity(pid);
if (!command || !cwd || !identity) {
  process.exit(1);
}

const payload = {
  schema_version: 1,
  kind,
  pid,
  port,
  command,
  cwd,
  process_identity: identity,
  captured_at: new Date().toISOString(),
  captured_by: capturedBy,
};
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

finalize_managed_root_contract() {
  [[ "${NEXT_GENERATED_ROOT_MANAGED}" == "1" && -n "${NEXT_DEV_CHILD_PID}" ]] || return 0

  if [[ -n "${NEXT_DEV_ROOT_GUARD_PID}" ]]; then
    next_generated_root_stop_contract_guard "${NEXT_DEV_ROOT_GUARD_PID}"
    wait "${NEXT_DEV_ROOT_GUARD_PID}" >/dev/null 2>&1 || true
    NEXT_DEV_ROOT_GUARD_PID=""
  fi

  next_generated_root_final_reconcile_source_contract
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  if [[ -n "${NEXT_DEV_CHILD_PID}" ]]; then
    if kill -0 "${NEXT_DEV_CHILD_PID}" >/dev/null 2>&1; then
      local cleanup_signal="null"
      if [[ "${status}" -ge 128 ]]; then
        cleanup_signal="$((status - 128))"
      fi
      write_next_dev_exit_marker "wrapper_cleanup" "${status}" "${cleanup_signal}" "${NEXT_DEV_CHILD_PID}"
      next_generated_root_stop_pid_tree_gracefully "${NEXT_DEV_CHILD_PID}" 5
    fi
    wait "${NEXT_DEV_CHILD_PID}" >/dev/null 2>&1 || true
    local finalize_status=0
    set +e
    finalize_managed_root_contract
    finalize_status=$?
    set -e
    if [[ "${finalize_status}" -ne 0 && "${status}" -eq 0 ]]; then
      status="${finalize_status}"
    fi
    NEXT_DEV_CHILD_PID=""
  fi

  if [[ -n "${NEXT_DEV_ROOT_GUARD_PID}" ]]; then
    next_generated_root_stop_contract_guard "${NEXT_DEV_ROOT_GUARD_PID}"
    wait "${NEXT_DEV_ROOT_GUARD_PID}" >/dev/null 2>&1 || true
    NEXT_DEV_ROOT_GUARD_PID=""
  fi

  exit "${status}"
}
trap cleanup EXIT INT TERM

if [[ "${NEXT_GENERATED_ROOT_MANAGED}" == "1" ]]; then
  next_generated_root_prepare_for_validation
fi

next dev "$@" &
NEXT_DEV_CHILD_PID=$!

if [[ "${NEXT_GENERATED_ROOT_MANAGED}" == "1" ]]; then
  next_generated_root_guard_source_contract "${NEXT_DEV_CHILD_PID}" &
  NEXT_DEV_ROOT_GUARD_PID=$!
fi

if [[ -n "${NEXT_DEV_PID_FILE:-}" ]]; then
  mkdir -p "$(dirname "${NEXT_DEV_PID_FILE}")"
  printf '%s\n' "${NEXT_DEV_CHILD_PID}" > "${NEXT_DEV_PID_FILE}"
fi
write_next_dev_process_state || true

set +e
wait "${NEXT_DEV_CHILD_PID}"
NEXT_DEV_CHILD_STATUS=$?
set -e

NEXT_DEV_CHILD_SIGNAL="null"
if [[ "${NEXT_DEV_CHILD_STATUS}" -ge 128 ]]; then
  NEXT_DEV_CHILD_SIGNAL="$((NEXT_DEV_CHILD_STATUS - 128))"
fi
write_next_dev_exit_marker "child_exit" "${NEXT_DEV_CHILD_STATUS}" "${NEXT_DEV_CHILD_SIGNAL}" "${NEXT_DEV_CHILD_PID}"
FINALIZE_MANAGED_ROOT_STATUS=0
set +e
finalize_managed_root_contract
FINALIZE_MANAGED_ROOT_STATUS=$?
set -e
if [[ "${FINALIZE_MANAGED_ROOT_STATUS}" -ne 0 && "${NEXT_DEV_CHILD_STATUS}" -eq 0 ]]; then
  NEXT_DEV_CHILD_STATUS="${FINALIZE_MANAGED_ROOT_STATUS}"
fi

if [[ "${NEXT_DEV_CHILD_STATUS}" -ge 128 ]]; then
  echo "[next-dev-safe] next dev child exited due to signal ${NEXT_DEV_CHILD_SIGNAL} (status ${NEXT_DEV_CHILD_STATUS})" >&2
else
  echo "[next-dev-safe] next dev child exited with status ${NEXT_DEV_CHILD_STATUS}" >&2
fi

NEXT_DEV_CHILD_PID=""
exit "${NEXT_DEV_CHILD_STATUS}"
