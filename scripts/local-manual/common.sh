#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.local-manual}"
SUBSTRATE="${SUBSTRATE:-local-dev}"
SUBSTRATE_ENV_FILE="${ENV_FILE}"
LOCAL_MANUAL_ENABLE_INTERNAL="${LOCAL_MANUAL_ENABLE_INTERNAL:-0}"
LOCAL_MANUAL_INTERNAL_ENV_FILE="${LOCAL_MANUAL_INTERNAL_ENV_FILE:-${ROOT_DIR}/infra/flows/local-manual-internal.env}"

source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/runtime-line-state.sh"
source "${ROOT_DIR}/scripts/lib/runtime-config.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
source "${ROOT_DIR}/scripts/scenarios/common.sh"
source "${ROOT_DIR}/scripts/substrate/common.sh"
ensure_backend_real_state
backend_real_prune_forbidden_current_entries

LOCAL_MANUAL_ROOT="$(ensure_runtime_line_current_root local-manual)"
LOCAL_MANUAL_EVIDENCE_DIR="${LOCAL_MANUAL_ROOT}/evidence"
LOCAL_MANUAL_NEXT_DIST_DIR="${LOCAL_MANUAL_NEXT_DIST_DIR:-$(local_manual_next_dist_dir)}"
LOCAL_MANUAL_NEXT_ROOT_CONTRACT_DIR="${LOCAL_MANUAL_NEXT_ROOT_CONTRACT_DIR:-${LOCAL_MANUAL_ROOT}/next-generated-root}"
LOCAL_MANUAL_INTERNAL_RUNTIME_CLEANUP_MARKER="${LOCAL_MANUAL_ROOT}/local-manual-internal-runtime.cleanup"

API_PID_FILE="${LOCAL_MANUAL_ROOT}/api.pid"
WEB_PID_FILE="${LOCAL_MANUAL_ROOT}/web.pid"
RUNNER_PID_FILE="${LOCAL_MANUAL_ROOT}/runner.pid"

API_READY_FILE="${LOCAL_MANUAL_ROOT}/api.ready"
WEB_READY_FILE="${LOCAL_MANUAL_ROOT}/web.ready"
RUNNER_READY_FILE="${LOCAL_MANUAL_ROOT}/runner.ready"
PROXY_READY_FILE="${SUBSTRATE_PROXY_READY_FILE}"

API_PORT_FILE="${LOCAL_MANUAL_ROOT}/api.port"
WEB_PORT_FILE="${LOCAL_MANUAL_ROOT}/web.port"
API_PROCESS_STATE_FILE="${LOCAL_MANUAL_ROOT}/api.process.json"
WEB_PROCESS_STATE_FILE="${LOCAL_MANUAL_ROOT}/web.process.json"

API_LOG="${LOCAL_MANUAL_ROOT}/api.log"
WEB_LOG="${LOCAL_MANUAL_ROOT}/web.log"
RUNNER_LOG="${LOCAL_MANUAL_ROOT}/runner.log"

info() { echo "[local-manual] $*"; }
err() { echo "[local-manual] ERROR: $*" >&2; }
warn() { echo "[local-manual] WARN: $*" >&2; }

run_juicefs_orphan_preflight() {
  local context="${1:-local-manual}"
  if [[ "${LOCAL_MANUAL_SKIP_JUICEFS_ORPHAN_PREFLIGHT:-0}" == "1" ]]; then
    info "skipping stale JuiceFS preflight for ${context}"
    return 0
  fi
  "${ROOT_DIR}/node_modules/.bin/tsx" "${ROOT_DIR}/scripts/juicefs-orphan-preflight.ts" --apply --context "${context}"
}

detect_local_manual_file_library_client_postgres_host() {
  printf 'localhost\n'
}

require_var() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    err "missing required env: ${key}"
    exit 1
  fi
}

load_local_manual_substrate_env() {
  if [[ ! -f "${SUBSTRATE_CONNECTION_ENV}" ]]; then
    if [[ "${LOCAL_MANUAL_ALLOW_MISSING_SUBSTRATE_CONNECTION:-0}" == "1" ]]; then
      KEYCLOAK_BASE_URL="${SUBSTRATE_KEYCLOAK_BASE_URL}"
      KEYCLOAK_REALM="${SUBSTRATE_KEYCLOAK_REALM}"
      KEYCLOAK_CLIENT_ID="${SUBSTRATE_KEYCLOAK_CLIENT_ID}"
      KEYCLOAK_ISSUER_URL="${SUBSTRATE_KEYCLOAK_ISSUER_URL}"
      MBOS_UNIVERSAL_PROXY_BASE_URL="${SUBSTRATE_PROXY_BASE_URL}"
      PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
      INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
      KEYCLOAK_URL="${KEYCLOAK_URL:-${KEYCLOAK_BASE_URL}/realms}"
      PROXY_PORT="${PROXY_PORT:-${MBOS_UNIVERSAL_PROXY_BASE_URL##*:}}"
      return 0
    fi
    err "missing substrate connection env: ${SUBSTRATE_CONNECTION_ENV}"
    err "start the shared substrate first with: make substrate-up && make substrate-reseed"
    exit 1
  fi
  set -a
  source "${SUBSTRATE_CONNECTION_ENV}"
  set +a
  PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
  INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
  KEYCLOAK_URL="${KEYCLOAK_URL:-${KEYCLOAK_BASE_URL}/realms}"
  PROXY_PORT="${PROXY_PORT:-${MBOS_UNIVERSAL_PROXY_BASE_URL##*:}}"
}

load_local_manual_internal_env() {
  [[ "${LOCAL_MANUAL_ENABLE_INTERNAL}" == "1" ]] || return 0
  [[ -f "${LOCAL_MANUAL_INTERNAL_ENV_FILE}" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "${LOCAL_MANUAL_INTERNAL_ENV_FILE}"
  set +a
}

init_local_manual_env() {
  load_runtime_env_stack "local-manual" "${ENV_FILE}"
  load_local_manual_internal_env

  PORT_API="${PORT_API:-20000}"
  PORT_WEB="${PORT_WEB:-3001}"
  LOCAL_MANUAL_ALLOW_UNTRACKED_PORT_CLEANUP="${LOCAL_MANUAL_ALLOW_UNTRACKED_PORT_CLEANUP:-0}"
  LOCAL_MANUAL_ALLOW_UNTRACKED_PROCESS_RESCUE="${LOCAL_MANUAL_ALLOW_UNTRACKED_PROCESS_RESCUE:-0}"
  LOCALE="${LOCALE:-zh-CN}"
  WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"

  load_local_manual_substrate_env

  FILE_LIBRARY_CLIENT_POSTGRES_HOST="${FILE_LIBRARY_CLIENT_POSTGRES_HOST:-$(detect_local_manual_file_library_client_postgres_host)}"
  FILE_LIBRARY_CLIENT_POSTGRES_PORT="${FILE_LIBRARY_CLIENT_POSTGRES_PORT:-15432}"
}



resolve_local_manual_runner_modes() {
  if [[ "${LOCAL_MANUAL_ENABLE_INTERNAL}" == "1" ]]; then
    printf 'external_host,internal_k8s\n'
  else
    printf 'external_host\n'
  fi
}

setup_local_manual_runtime_evidence() {
  local keycloak_host_url public_api_url host_api_url host_web_url public_web_url
  public_web_url="http://localhost:${PORT_WEB}"
  host_web_url="http://127.0.0.1:${PORT_WEB}"
  public_api_url="http://localhost:${PORT_API}/api/v1"
  host_api_url="http://127.0.0.1:${PORT_API}/api/v1"
  keycloak_host_url="${INTERNAL_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
  LOCAL_MANUAL_PUBLIC_WEB_URL="${LOCAL_MANUAL_PUBLIC_WEB_URL:-${public_web_url}}"
  LOCAL_MANUAL_HOST_WEB_URL="${LOCAL_MANUAL_HOST_WEB_URL:-${host_web_url}}"
  LOCAL_MANUAL_PUBLIC_API_URL="${LOCAL_MANUAL_PUBLIC_API_URL:-${public_api_url}}"
  LOCAL_MANUAL_HOST_API_URL="${LOCAL_MANUAL_HOST_API_URL:-${host_api_url}}"
  LOCAL_MANUAL_HOST_KEYCLOAK_URL="${LOCAL_MANUAL_HOST_KEYCLOAK_URL:-${keycloak_host_url}}"

  export RUNTIME_LINE_ID="${RUNTIME_LINE_ID:-local-manual}"
  export RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-$(resolve_local_manual_runner_modes)}"
  KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
  KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
  resolve_public_runtime_stack \
    "${LOCAL_MANUAL_PUBLIC_WEB_URL}" \
    "${LOCAL_MANUAL_PUBLIC_API_URL}" \
    "${PUBLIC_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}" \
    "${LOCAL_MANUAL_HOST_WEB_URL}" \
    "${LOCAL_MANUAL_HOST_API_URL}" \
    "${LOCAL_MANUAL_HOST_KEYCLOAK_URL}" \
    "${KEYCLOAK_REALM}" \
    "${KEYCLOAK_CLIENT_ID}"

  if [[ ! -f "${LOCAL_MANUAL_EVIDENCE_DIR}/preflight.json" || "${LOCAL_MANUAL_RESET_EVIDENCE:-0}" == "1" ]]; then
    gate_evidence_init "${LOCAL_MANUAL_EVIDENCE_DIR}" "local_manual"
  fi
  gate_write_runtime_descriptor "${LOCAL_MANUAL_EVIDENCE_DIR}" "local_manual"
  gate_write_resolved_env "${LOCAL_MANUAL_EVIDENCE_DIR}"
  gate_record_task_summary "${LOCAL_MANUAL_EVIDENCE_DIR}" "{\"line_kind\":\"local_manual\",\"workspace_id\":\"${WORKSPACE_ID}\",\"internal_enabled\":\"${LOCAL_MANUAL_ENABLE_INTERNAL}\",\"api_port\":\"${PORT_API}\",\"web_port\":\"${PORT_WEB}\"}"
}


local_manual_assert_shared_substrate_available() {
  local ports labels expected_name existing_name line
  ports=("${SUBSTRATE_POSTGRES_PORT}" "${SUBSTRATE_MONGO_PORT}" "${SUBSTRATE_REDIS_PORT}" "${SUBSTRATE_MINIO_API_PORT}" "${SUBSTRATE_KEYCLOAK_PORT}")
  labels=(postgres mongo redis minio keycloak)
  expected_name="${SUBSTRATE_COMPOSE_PROJECT_NAME:-mbos-integration-deps}"

  local i=0
  for port in "${ports[@]}"; do
    [[ -n "${port}" ]] || continue
    line="$(docker ps --format '{{.Names}} {{.Ports}}' | awk -v target=":${port}->" '$0 ~ target { print; exit }')"
    if [[ -z "${line}" ]]; then
      i=$((i + 1))
      continue
    fi
    existing_name="${line%% *}"
    if [[ "${existing_name}" == mbos-* || "${existing_name}" == ${expected_name}* ]]; then
      i=$((i + 1))
      continue
    fi
    gate_record_failure "${LOCAL_MANUAL_EVIDENCE_DIR}" "infra_dependency_unready" "shared_substrate_conflict" "${labels[$i]} port ${port} is occupied by ${existing_name}"
    err "shared substrate port ${port} (${labels[$i]}) is occupied by ${existing_name}"
    err "stop the other line first, or switch back after running its *-down / *-reset"
    exit 1
  done
}

require_preset_endpoint_env() {
  require_var PRESET_ENDPOINT_API_KEY
  require_var PRESET_ENDPOINT_MODEL
  require_var PRESET_ENDPOINT_MAX_CONTEXT_TOKENS
  require_var PRESET_ENDPOINT_MAX_OUTPUT_TOKENS
  require_var PRESET_ANTHROPIC_ENDPOINT_BASE_URL
  require_var PRESET_ANTHROPIC_ENDPOINT_PROTOCOL
  require_var PRESET_OPENAI_ENDPOINT_BASE_URL
  require_var PRESET_OPENAI_ENDPOINT_PROTOCOL
}

launch_detached() {
  local pid_file="$1"
  local log_file="$2"
  local command="$3"
  : > "${log_file}"
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -lc "${command}" >> "${log_file}" 2>&1 < /dev/null &
  else
    nohup bash -lc "${command}" >> "${log_file}" 2>&1 < /dev/null &
  fi
  echo $! > "${pid_file}"
}

wait_http() {
  local url="$1"
  local label="$2"
  local timeout="${3:-120}"
  local start code
  start="$(date +%s)"
  while true; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "${url}" || true)"
    if [[ "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ]]; then
      info "${label} ready (${url})"
      return 0
    fi
    if (( "$(date +%s)" - start > timeout )); then
      err "${label} not ready in time (${url})"
      return 1
    fi
    sleep 1
  done
}

wait_port_free() {
  local port="$1"
  local label="$2"
  local timeout="${3:-30}"
  local start
  start="$(date +%s)"
  while true; do
    if ! lsof -tiTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    if (( "$(date +%s)" - start > timeout )); then
      err "${label} port ${port} is still busy"
      lsof -nP -iTCP:"${port}" -sTCP:LISTEN || true
      return 1
    fi
    sleep 1
  done
}

capture_listener_pid() {
  local port="$1"
  local pid_file="$2"
  local label="$3"
  local pid
  pid="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -z "${pid}" ]]; then
    warn "could not determine ${label} listener pid on port ${port}; continuing without pid tracking"
    rm -f "${pid_file}"
    return 0
  fi
  echo "${pid}" > "${pid_file}"
}

write_ready_file() {
  local file="$1"
  mkdir -p "$(dirname "${file}")"
  printf 'ready\n' > "${file}"
}

local_manual_platform_ready_state() {
  local missing=()

  [[ -f "${API_READY_FILE}" ]] || missing+=(api)
  [[ -f "${WEB_READY_FILE}" ]] || missing+=(web)
  [[ -f "${PROXY_READY_FILE}" ]] || missing+=(proxy)

  if (( ${#missing[@]} == 0 )); then
    printf 'ready\n'
    return 0
  fi

  printf 'missing:%s\n' "$(IFS=,; echo "${missing[*]}")"
}

local_manual_platform_is_ready() {
  [[ "$(local_manual_platform_ready_state)" == "ready" ]]
}

local_manual_tracked_service_pid_file() {
  local kind="$1"
  case "${kind}" in
    web) printf '%s\n' "${WEB_PID_FILE}" ;;
    api) printf '%s\n' "${API_PID_FILE}" ;;
    *) return 1 ;;
  esac
}

local_manual_tracked_service_ready_file() {
  local kind="$1"
  case "${kind}" in
    web) printf '%s\n' "${WEB_READY_FILE}" ;;
    api) printf '%s\n' "${API_READY_FILE}" ;;
    *) return 1 ;;
  esac
}

local_manual_tracked_service_port_file() {
  local kind="$1"
  case "${kind}" in
    web) printf '%s\n' "${WEB_PORT_FILE}" ;;
    api) printf '%s\n' "${API_PORT_FILE}" ;;
    *) return 1 ;;
  esac
}

local_manual_tracked_service_process_state_file() {
  local kind="$1"
  case "${kind}" in
    web) printf '%s\n' "${WEB_PROCESS_STATE_FILE}" ;;
    api) printf '%s\n' "${API_PROCESS_STATE_FILE}" ;;
    *) return 1 ;;
  esac
}

local_manual_tracked_service_port() {
  local kind="$1"
  case "${kind}" in
    web) printf '%s\n' "${PORT_WEB}" ;;
    api) printf '%s\n' "${PORT_API}" ;;
    *) return 1 ;;
  esac
}

local_manual_service_stop_evidence_file() {
  local kind="$1"
  printf '%s/%s/stop-authority.json\n' "${LOCAL_MANUAL_EVIDENCE_DIR}" "${kind}"
}

local_manual_live_process_identity() {
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

local_manual_process_command_line() {
  local pid="$1"
  ps -o command= -p "${pid}" 2>/dev/null | head -n 1
}

local_manual_process_cwd() {
  local pid="$1"
  if [[ -e "/proc/${pid}/cwd" ]]; then
    readlink -f "/proc/${pid}/cwd" 2>/dev/null || true
    return 0
  fi
  ps -o cwd= -p "${pid}" 2>/dev/null | head -n 1 | xargs
}

local_manual_write_tracked_service_process_state() {
  local kind="$1"
  local pid="$2"
  local captured_by="${3:-local-manual}"
  local port="${4:-}"
  local state_file command_line cwd identity token source
  state_file="$(local_manual_tracked_service_process_state_file "${kind}")"
  [[ -n "${pid}" ]] || return 1
  if [[ -z "${port}" ]]; then
    port="$(local_manual_tracked_service_port "${kind}")"
  fi
  command_line="$(local_manual_process_command_line "${pid}")"
  cwd="$(local_manual_process_cwd "${pid}")"
  identity="$(local_manual_live_process_identity "${pid}" 2>/dev/null || true)"
  IFS='|' read -r token source <<< "${identity}"
  [[ -n "${command_line}" && -n "${cwd}" && -n "${token}" && -n "${source}" ]] || return 1

  node - <<'NODE' "${state_file}" "${kind}" "${pid}" "${port}" "${command_line}" "${cwd}" "${token}" "${source}" "${captured_by}"
const fs = require('node:fs');
const path = require('node:path');
const [file, kind, pidRaw, portRaw, command, cwd, token, source, capturedBy] = process.argv.slice(2);
const pid = Number.parseInt(pidRaw, 10);
const port = Number.parseInt(portRaw, 10);
if (!Number.isFinite(pid) || !Number.isFinite(port) || !command || !cwd || !token || !source) {
  process.exit(1);
}
const payload = {
  schema_version: 1,
  kind,
  pid,
  port,
  command,
  cwd,
  process_identity: {
    token,
    source,
  },
  captured_at: new Date().toISOString(),
  captured_by: capturedBy,
};
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

local_manual_read_tracked_service_process_state_status() {
  local kind="$1"
  local pid="$2"
  local state_file parsed status stored_token stored_source identity current_token current_source
  state_file="$(local_manual_tracked_service_process_state_file "${kind}")"
  if [[ ! -f "${state_file}" ]]; then
    printf 'missing\tprocess_state_missing\n'
    return 0
  fi

  parsed="$(
    node - <<'NODE' "${state_file}" "${kind}" "${pid}"
const fs = require('node:fs');
const [file, expectedKind, expectedPidRaw] = process.argv.slice(2);
const expectedPid = Number.parseInt(expectedPidRaw, 10);
let payload;
try {
  payload = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  process.exit(1);
}
if (
  payload?.schema_version !== 1
  || payload?.kind !== expectedKind
  || payload?.pid !== expectedPid
  || !Number.isFinite(payload?.port)
  || typeof payload?.command !== 'string'
  || typeof payload?.cwd !== 'string'
  || typeof payload?.process_identity?.token !== 'string'
  || typeof payload?.process_identity?.source !== 'string'
  || typeof payload?.captured_at !== 'string'
  || typeof payload?.captured_by !== 'string'
) {
  process.exit(1);
}
process.stdout.write(`valid\t${payload.process_identity.token}\t${payload.process_identity.source}\n`);
NODE
  )" || {
    printf 'invalid\ttracked_state_invalid\n'
    return 0
  }

  IFS=$'\t' read -r status stored_token stored_source <<< "${parsed}"
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    printf 'stale\ttracked_pid_missing\n'
    return 0
  fi
  identity="$(local_manual_live_process_identity "${pid}" 2>/dev/null || true)"
  IFS='|' read -r current_token current_source <<< "${identity}"
  if [[ -z "${current_token}" || -z "${current_source}" ]]; then
    printf 'invalid\ttracked_state_invalid\n'
    return 0
  fi
  if [[ "${stored_token}" != "${current_token}" ]]; then
    printf 'reused\ttracked_pid_reused\n'
    return 0
  fi

  printf 'valid\t%s\t%s\n' "${stored_token}" "${stored_source}"
}

local_manual_service_launch_root() {
  local kind="$1"
  case "${kind}" in
    web | api) printf '%s\n' "${ROOT_DIR}" ;;
    *) return 1 ;;
  esac
}

local_manual_service_allowed_cwds() {
  local kind="$1"
  local launch_root
  launch_root="$(local_manual_service_launch_root "${kind}")"
  case "${kind}" in
    web)
      printf '%s\n' "${launch_root}"
      ;;
    api)
      printf '%s\n' "${launch_root}"
      printf '%s\n' "${launch_root}/packages/api-entry-node"
      ;;
    *)
      return 1
      ;;
  esac
}

local_manual_service_command_matches_kind() {
  local kind="$1"
  local command_line="$2"
  case "${kind}" in
    web)
      [[ "${command_line}" == *"run-next-dev-safe.sh"* || "${command_line}" == *"next/dist/bin/next"* || "${command_line}" == *"next dev"* || "${command_line}" == *"npm run dev:test"* ]]
      ;;
    api)
      [[ "${command_line}" == *"@mbos/api-entry-node"* || "${command_line}" == *"packages/api-entry-node"* || "${command_line}" == *"api-entry-node"* || ( "${command_line}" == *"tsx"* && "${command_line}" == *"src/index.ts"* ) ]]
      ;;
    *)
      return 1
      ;;
  esac
}

local_manual_service_cwd_matches_kind() {
  local kind="$1"
  local cwd="$2"
  local allowed_cwd
  while IFS= read -r allowed_cwd; do
    [[ -n "${allowed_cwd}" ]] || continue
    if [[ "${cwd}" == "${allowed_cwd}" ]]; then
      return 0
    fi
  done < <(local_manual_service_allowed_cwds "${kind}")
  return 1
}

local_manual_service_pid_matches_expected_port() {
  local kind="$1"
  local pid="$2"
  local command_line="${3:-}"
  local listeners
  listeners="$(local_manual_service_listener_pids "${kind}")"
  if [[ -n "${listeners}" ]] && grep -Fxq "${pid}" <<< "${listeners}"; then
    return 0
  fi
  local expected_port
  expected_port="$(local_manual_tracked_service_port "${kind}")"
  [[ "${command_line}" == *"--port ${expected_port}"* || "${command_line}" == *"--port=${expected_port}"* ]]
}

local_manual_service_listener_pids() {
  local kind="$1"
  local expected_port
  expected_port="$(local_manual_tracked_service_port "${kind}")"
  lsof -tiTCP:"${expected_port}" -sTCP:LISTEN 2>/dev/null || true
}

local_manual_classify_tracked_service_authority() {
  local kind="$1"
  local pid="${2:-}"
  local pid_file command_line cwd state_status state_reason state_token state_source
  pid_file="$(local_manual_tracked_service_pid_file "${kind}")"
  if [[ -z "${pid}" ]]; then
    pid="$(cat "${pid_file}" 2>/dev/null || true)"
  fi
  if [[ -z "${pid}" ]]; then
    printf 'stale_reclaimable|tracked_pid_missing\n'
    return 0
  fi

  state_status="$(local_manual_read_tracked_service_process_state_status "${kind}" "${pid}")"
  IFS=$'\t' read -r state_reason state_token state_source <<< "${state_status}"
  case "${state_reason}" in
    valid)
      printf 'current_active|tracked_local_manual_%s|%s|%s\n' "${kind}" "${state_token}" "${state_source}"
      return 0
      ;;
    reused)
      printf 'unverified|tracked_pid_reused\n'
      return 0
      ;;
    stale)
      printf 'stale_reclaimable|tracked_pid_missing\n'
      return 0
      ;;
    invalid)
      printf 'unverified|tracked_state_invalid\n'
      return 0
      ;;
    missing)
      ;;
    *)
      printf 'unverified|tracked_state_invalid\n'
      return 0
      ;;
  esac

  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    printf 'stale_reclaimable|tracked_pid_missing\n'
    return 0
  fi

  command_line="$(local_manual_process_command_line "${pid}")"
  cwd="$(local_manual_process_cwd "${pid}")"
  if [[ -z "${command_line}" ]]; then
    printf 'unverified|tracked_pid_command_unavailable\n'
    return 0
  fi
  if [[ -z "${cwd}" || "${cwd}" == "-" ]]; then
    printf 'unverified|tracked_pid_cwd_unavailable\n'
    return 0
  fi
  if ! local_manual_service_cwd_matches_kind "${kind}" "${cwd}"; then
    printf 'unverified|tracked_pid_foreign_cwd\n'
    return 0
  fi
  if ! local_manual_service_command_matches_kind "${kind}" "${command_line}"; then
    printf 'unverified|tracked_pid_reused\n'
    return 0
  fi
  if ! local_manual_service_pid_matches_expected_port "${kind}" "${pid}" "${command_line}"; then
    printf 'unverified|tracked_pid_unexpected_port\n'
    return 0
  fi

  if ! local_manual_write_tracked_service_process_state "${kind}" "${pid}" "legacy_adopt" "$(local_manual_tracked_service_port "${kind}")"; then
    printf 'unverified|tracked_state_invalid\n'
    return 0
  fi

  state_status="$(local_manual_read_tracked_service_process_state_status "${kind}" "${pid}")"
  IFS=$'\t' read -r state_reason state_token state_source <<< "${state_status}"
  case "${state_reason}" in
    valid)
      printf 'current_active|tracked_local_manual_%s|%s|%s\n' "${kind}" "${state_token}" "${state_source}"
      return 0
      ;;
    reused)
      printf 'unverified|tracked_pid_reused\n'
      return 0
      ;;
    stale)
      printf 'stale_reclaimable|tracked_pid_missing\n'
      return 0
      ;;
    *)
      printf 'unverified|tracked_state_invalid\n'
      return 0
      ;;
  esac
}

local_manual_write_service_stop_evidence() {
  local kind="$1"
  local authority="$2"
  local action="$3"
  local reason="$4"
  local pid="$5"
  local evidence_file
  evidence_file="$(local_manual_service_stop_evidence_file "${kind}")"
  mkdir -p "$(dirname "${evidence_file}")"
  node - <<'NODE' "${evidence_file}" "${kind}" "${authority}" "${action}" "${reason}" "${pid}"
const fs = require('node:fs');
const path = require('node:path');
const [file, kind, authority, action, reason, pid] = process.argv.slice(2);
const payload = {
  kind,
  authority,
  action,
  reason,
  pid,
  lifecycle: 'stop_line',
  recorded_at: new Date().toISOString(),
};
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
NODE
}

local_manual_clear_tracked_service_state() {
  local kind="$1"
  rm -f \
    "$(local_manual_tracked_service_ready_file "${kind}")" \
    "$(local_manual_tracked_service_port_file "${kind}")" \
    "$(local_manual_tracked_service_process_state_file "${kind}")"
}

local_manual_tracked_service_pid_value() {
  local kind="$1"
  local pid_file
  pid_file="$(local_manual_tracked_service_pid_file "${kind}")"
  cat "${pid_file}" 2>/dev/null || true
}

local_manual_capture_tracked_service_stop_snapshot() {
  local kind="$1"
  local pid classification authority reason token token_source
  pid="$(local_manual_tracked_service_pid_value "${kind}")"
  classification="$(local_manual_classify_tracked_service_authority "${kind}" "${pid}")"
  IFS='|' read -r authority reason token token_source <<< "${classification}"
  printf '%s\t%s\t%s\t%s\n' "${authority}" "${reason}" "${pid}" "${token}"
}

local_manual_apply_tracked_service_stop_authority() {
  local kind="$1"
  local authority="$2"
  local reason="$3"
  local pid="$4"
  local pid_file
  pid_file="$(local_manual_tracked_service_pid_file "${kind}")"

  if [[ "${authority}" == "stale_reclaimable" ]]; then
    rm -f "${pid_file}"
    local_manual_clear_tracked_service_state "${kind}"
    return 0
  fi

  rm -f "$(local_manual_tracked_service_ready_file "${kind}")"
  local_manual_write_service_stop_evidence "${kind}" "${authority}" "mark_degraded" "${reason}" "${pid}"
  gate_record_preflight_check "${LOCAL_MANUAL_EVIDENCE_DIR}" "${kind}_stop_authority" "warning" "${kind} ownership is unverified during stop_line cleanup: ${reason}"
  warn "${kind} ownership is unverified; preserving tracked pid file until ownership can be verified"
  return 0
}

local_manual_signal_tracked_service_pid() {
  local signal_name="$1"
  local pid="$2"
  local expected_token="${3:-}"
  [[ -n "${pid}" ]] || return 0
  if [[ -n "${expected_token}" ]]; then
    local current_identity current_token
    current_identity="$(local_manual_live_process_identity "${pid}" 2>/dev/null || true)"
    IFS='|' read -r current_token _ <<< "${current_identity}"
    if [[ -z "${current_token}" || "${current_token}" != "${expected_token}" ]]; then
      return 0
    fi
  fi
  kill "-${signal_name}" "${pid}" >/dev/null 2>&1 || true
}

local_manual_recheck_tracked_service_identity_authority() {
  local kind="$1"
  local pid="$2"
  local expected_token="${3:-}"
  local identity current_token classification
  if [[ -z "${pid}" ]]; then
    printf 'stale_reclaimable|tracked_pid_missing\n'
    return 0
  fi
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    printf 'stale_reclaimable|tracked_pid_missing\n'
    return 0
  fi
  if [[ -n "${expected_token}" ]]; then
    identity="$(local_manual_live_process_identity "${pid}" 2>/dev/null || true)"
    IFS='|' read -r current_token _ <<< "${identity}"
    if [[ -z "${current_token}" || "${current_token}" != "${expected_token}" ]]; then
      printf 'unverified|tracked_pid_reused\n'
      return 0
    fi
  fi
  classification="$(local_manual_classify_tracked_service_authority "${kind}" "${pid}")"
  printf '%s\n' "${classification}"
}

local_manual_verify_tracked_service_stop_contract() {
  local kind="$1"
  local pid="$2"
  local expected_token="${3:-}"
  local listeners identity_authority identity_reason

  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    IFS='|' read -r identity_authority identity_reason <<< "$(local_manual_recheck_tracked_service_identity_authority "${kind}" "${pid}" "${expected_token}")"
    if [[ "${identity_authority}" == "current_active" ]]; then
      return 1
    fi
  fi

  listeners="$(local_manual_service_listener_pids "${kind}")"
  [[ -z "${listeners}" ]]
}

local_manual_actuate_tracked_service_stop_contract() {
  local kind="$1"
  local pid="$2"
  local expected_token="${3:-}"
  local _i identity_authority identity_reason

  IFS='|' read -r identity_authority identity_reason <<< "$(local_manual_recheck_tracked_service_identity_authority "${kind}" "${pid}" "${expected_token}")"
  if [[ "${identity_authority}" != "current_active" ]]; then
    return 2
  fi
  local_manual_signal_tracked_service_pid TERM "${pid}" "${expected_token}"
  for _i in $(seq 1 20); do
    if local_manual_verify_tracked_service_stop_contract "${kind}" "${pid}" "${expected_token}"; then
      return 0
    fi
    sleep 0.25
  done

  IFS='|' read -r identity_authority identity_reason <<< "$(local_manual_recheck_tracked_service_identity_authority "${kind}" "${pid}" "${expected_token}")"
  if [[ "${identity_authority}" != "current_active" ]]; then
    return 0
  fi
  local_manual_signal_tracked_service_pid KILL "${pid}" "${expected_token}"
  for _i in $(seq 1 20); do
    if local_manual_verify_tracked_service_stop_contract "${kind}" "${pid}" "${expected_token}"; then
      return 0
    fi
    sleep 0.25
  done

  return 0
}

local_manual_restore_errexit_state() {
  local was_enabled="${1:-0}"
  if [[ "${was_enabled}" == "1" ]]; then
    set -e
  else
    set +e
  fi
}

stop_local_manual_tracked_service_owner_aware() {
  local kind="$1"
  local pid_file snapshot authority reason pid expected_token final_snapshot final_authority final_reason final_pid final_token actuation_status
  local errexit_was_enabled=0
  if [[ "$-" == *e* ]]; then
    errexit_was_enabled=1
  fi
  pid_file="$(local_manual_tracked_service_pid_file "${kind}")"
  [[ -f "${pid_file}" ]] || return 0
  snapshot="$(local_manual_capture_tracked_service_stop_snapshot "${kind}")"
  IFS=$'\t' read -r authority reason pid expected_token <<< "${snapshot}"

  if [[ "${authority}" == "current_active" ]]; then
    final_snapshot="$(local_manual_capture_tracked_service_stop_snapshot "${kind}")"
    IFS=$'\t' read -r final_authority final_reason final_pid final_token <<< "${final_snapshot}"

    if [[ "${final_authority}" != "current_active" ]]; then
      local_manual_apply_tracked_service_stop_authority "${kind}" "${final_authority}" "${final_reason}" "${final_pid}"
      local_manual_restore_errexit_state "${errexit_was_enabled}"
      return 0
    fi

    set +e
    local_manual_actuate_tracked_service_stop_contract "${kind}" "${final_pid}" "${final_token}"
    actuation_status=$?
    local_manual_restore_errexit_state "${errexit_was_enabled}"
    if [[ "${actuation_status}" -eq 2 ]]; then
      final_snapshot="$(local_manual_capture_tracked_service_stop_snapshot "${kind}")"
      IFS=$'\t' read -r final_authority final_reason final_pid final_token <<< "${final_snapshot}"
      local_manual_apply_tracked_service_stop_authority "${kind}" "${final_authority}" "${final_reason}" "${final_pid}"
      local_manual_restore_errexit_state "${errexit_was_enabled}"
      return 0
    fi
    set +e
    local_manual_verify_tracked_service_stop_contract "${kind}" "${final_pid}" "${final_token}"
    actuation_status=$?
    local_manual_restore_errexit_state "${errexit_was_enabled}"
    if [[ "${actuation_status}" -ne 0 ]]; then
      warn "${kind} stop verification failed; keeping tracked state until the verified local-manual process exits"
      local_manual_restore_errexit_state "${errexit_was_enabled}"
      return 1
    fi
    rm -f "${pid_file}"
    local_manual_clear_tracked_service_state "${kind}"
    local_manual_restore_errexit_state "${errexit_was_enabled}"
    return 0
  fi

  local_manual_apply_tracked_service_stop_authority "${kind}" "${authority}" "${reason}" "${pid}"
  local_manual_restore_errexit_state "${errexit_was_enabled}"
}

runner_socket_health_state() {
  local pid current_state line
  pid="$(cat "${RUNNER_PID_FILE}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]] || ! kill -0 "${pid}" >/dev/null 2>&1; then
    printf 'disconnected\n'
    return 0
  fi

  current_state="unknown"
  if [[ -f "${RUNNER_LOG}" ]]; then
    while IFS= read -r line; do
      case "${line}" in
        *"[notebook-codex-runner] connected"*) current_state="connected" ;;
        *"[notebook-codex-runner] disconnected"*) current_state="disconnected" ;;
      esac
    done < "${RUNNER_LOG}"
  fi

  if [[ "${current_state}" == "connected" ]]; then
    printf 'connected\n'
  else
    printf 'disconnected\n'
  fi
}

runner_socket_is_connected() {
  [[ "$(runner_socket_health_state)" == "connected" ]]
}

ensure_local_manual_runner_connected() {
  if runner_socket_is_connected; then
    return 0
  fi
  info "restarting local-manual runner because socket is $(runner_socket_health_state)"
  bash "${ROOT_DIR}/scripts/local-manual/start-runner.sh"
}

remove_local_manual_runtime_files() {
  rm -f \
    "${API_READY_FILE}" "${WEB_READY_FILE}" "${RUNNER_READY_FILE}" \
    "${API_PORT_FILE}" "${WEB_PORT_FILE}" \
    "${API_PROCESS_STATE_FILE}" "${WEB_PROCESS_STATE_FILE}" \
    "${API_PID_FILE}" "${WEB_PID_FILE}" "${RUNNER_PID_FILE}" \
    "${LOCAL_MANUAL_INTERNAL_RUNTIME_CLEANUP_MARKER}"
}

reset_local_manual_state() {
  ensure_backend_real_state
  node - <<'NODE' "$(backend_real_state_file)" "${WORKSPACE_ID:-ws_default}"
const fs = require('node:fs');
const [file, workspaceId] = process.argv.slice(2);
const next = { workspace: { id: workspaceId } };
fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
NODE
  rm -f "$(backend_real_token_file)"
  state_write_summary
}

stop_listeners_on_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "${pids}" ]] || return 0
  info "stopping listeners on port ${port}: ${pids//$'\n'/ }"
  xargs -r kill >/dev/null 2>&1 <<< "${pids}" || true
  sleep 1
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "${pids}" ]] || return 0
  xargs -r kill -9 >/dev/null 2>&1 <<< "${pids}" || true
}

stop_matching_processes() {
  local pattern="$1"
  local pids
  pids="$(pgrep -f "${pattern}" || true)"
  [[ -n "${pids}" ]] || return 0
  info "stopping processes matching ${pattern}: ${pids//$'\n'/ }"
  xargs -r kill >/dev/null 2>&1 <<< "${pids}" || true
  sleep 1
  pids="$(pgrep -f "${pattern}" || true)"
  [[ -n "${pids}" ]] || return 0
  xargs -r kill -9 >/dev/null 2>&1 <<< "${pids}" || true
}

local_manual_runner_stop_evidence_file() {
  printf '%s/runner/stop-owner-janitor.json\n' "${LOCAL_MANUAL_EVIDENCE_DIR}"
}

local_manual_runner_owner_janitor_plan() {
  local intent="${1:-stop_line}"
  "${ROOT_DIR}/node_modules/.bin/tsx" "${ROOT_DIR}/scripts/local-manual/owner-janitor.ts" \
    --kind runner \
    --intent "${intent}" \
    --runner-pid-file "${RUNNER_PID_FILE}" 2>/dev/null || true
}

local_manual_runner_owner_janitor_fallback_plan() {
  local intent="${1:-stop_line}"
  local reason="${2:-planner_unavailable}"
  if [[ "${intent}" == "stop_line" ]]; then
    printf '{"kind":"runner","authority":"unverified","action":"mark_degraded","reason":"%s","lifecycle":"stop_line"}\n' "${reason}"
    return 0
  fi

  printf '{"kind":"runner","authority":"unverified","action":"block","reason":"%s"}\n' "${reason}"
}

local_manual_runner_owner_janitor_normalize_plan() {
  local intent="${1:-stop_line}"
  local raw_plan="${2:-}"
  local normalized_output normalized_trimmed fallback_reason
  normalized_output="$(
    printf '%s' "${raw_plan}" \
      | "${ROOT_DIR}/node_modules/.bin/tsx" "${ROOT_DIR}/scripts/local-manual/owner-janitor.ts" \
        --kind runner \
        --intent "${intent}" \
        --normalize-plan-stdin 2>/dev/null || true
  )"
  normalized_trimmed="$(printf '%s' "${normalized_output}" | tr -d '[:space:]')"
  if [[ -n "${normalized_trimmed}" ]]; then
    printf '%s\n' "${normalized_output}"
    return 0
  fi

  fallback_reason="planner_malformed"
  if [[ -z "$(printf '%s' "${raw_plan}" | tr -d '[:space:]')" ]]; then
    fallback_reason="planner_unavailable"
  fi
  local_manual_runner_owner_janitor_fallback_plan "${intent}" "${fallback_reason}"
}

local_manual_write_runner_stop_evidence() {
  local plan_json="$1"
  local intent="${2:-stop_line}"
  local evidence_file
  evidence_file="$(local_manual_runner_stop_evidence_file)"
  mkdir -p "$(dirname "${evidence_file}")"
  node - <<'NODE' "${evidence_file}" "${intent}" "${plan_json}"
const fs = require('node:fs');
const path = require('node:path');
const [file, intent, rawPlan] = process.argv.slice(2);
const raw = String(rawPlan ?? '').trim();
const payload = raw ? JSON.parse(raw) : {};
const next = {
  ...payload,
  intent,
  recorded_at: new Date().toISOString(),
};
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
NODE
}

local_manual_mark_runner_degraded() {
  local plan_json="$1"
  local reason
  reason="$(node - <<'NODE' "${plan_json}"
const [rawPlan] = process.argv.slice(2);
const raw = String(rawPlan ?? '').trim();
if (!raw) {
  process.exit(0);
}
const plan = JSON.parse(raw);
process.stdout.write(String(plan.reason ?? 'runner_unverified'));
NODE
)"
  local_manual_write_runner_stop_evidence "${plan_json}" "stop_line"
  rm -f "${RUNNER_READY_FILE}"
  gate_record_preflight_check "${LOCAL_MANUAL_EVIDENCE_DIR}" "runner_stop_authority" "warning" "runner ownership is unverified during stop_line cleanup: ${reason}"
}

local_manual_runner_stop_contract_root_pid() {
  local plan_json="$1"
  node - <<'NODE' "${plan_json}"
const [rawPlan] = process.argv.slice(2);
const raw = String(rawPlan ?? '').trim();
if (!raw) {
  process.exit(0);
}
const plan = JSON.parse(raw);
process.stdout.write(String(plan.stop?.root_pid ?? ''));
NODE
}

local_manual_runner_stop_contract_owned_pids() {
  local plan_json="$1"
  node - <<'NODE' "${plan_json}"
const [rawPlan] = process.argv.slice(2);
const raw = String(rawPlan ?? '').trim();
if (!raw) {
  process.exit(0);
}
const plan = JSON.parse(raw);
process.stdout.write((plan.stop?.owned_pids ?? []).join(' '));
NODE
}

local_manual_runner_stop_contract_action() {
  local plan_json="$1"
  node - <<'NODE' "${plan_json}"
const [rawPlan] = process.argv.slice(2);
const raw = String(rawPlan ?? '').trim();
if (!raw) {
  process.exit(0);
}
const plan = JSON.parse(raw);
process.stdout.write(String(plan.action ?? ''));
NODE
}

local_manual_signal_runner_pid_list() {
  local signal_name="$1"
  shift || true
  local pid
  for pid in "$@"; do
    [[ -n "${pid}" ]] || continue
    kill "-${signal_name}" "${pid}" >/dev/null 2>&1 || true
  done
}

local_manual_runner_process_group_id() {
  local pid="$1"
  [[ -n "${pid}" ]] || return 0
  ps -o pgid= -p "${pid}" 2>/dev/null | tr -d '[:space:]'
}

local_manual_verify_runner_stop_contract() {
  local plan_json="$1"
  local owned_pids_line pid
  owned_pids_line="$(local_manual_runner_stop_contract_owned_pids "${plan_json}")"
  [[ -n "${owned_pids_line}" ]] || return 0
  read -r -a owned_pids <<< "${owned_pids_line}"
  for pid in "${owned_pids[@]}"; do
    [[ -n "${pid}" ]] || continue
    if kill -0 "${pid}" >/dev/null 2>&1; then
      return 1
    fi
  done
  return 0
}

local_manual_actuate_runner_stop_contract() {
  local plan_json="$1"
  local root_pid owned_pids_line pgid
  root_pid="$(local_manual_runner_stop_contract_root_pid "${plan_json}")"
  owned_pids_line="$(local_manual_runner_stop_contract_owned_pids "${plan_json}")"
  local -a owned_pids=()
  if [[ -n "${owned_pids_line}" ]]; then
    read -r -a owned_pids <<< "${owned_pids_line}"
  fi

  pgid="$(local_manual_runner_process_group_id "${root_pid}")"
  if [[ -n "${pgid}" && "${pgid}" == "${root_pid}" && "${pgid}" != "$$" ]]; then
    kill -TERM -- "-${pgid}" >/dev/null 2>&1 || true
  fi
  local_manual_signal_runner_pid_list TERM "${owned_pids[@]}"

  local _i
  for _i in $(seq 1 20); do
    if local_manual_verify_runner_stop_contract "${plan_json}"; then
      return 0
    fi
    sleep 0.25
  done

  if [[ -n "${pgid}" && "${pgid}" == "${root_pid}" && "${pgid}" != "$$" ]]; then
    kill -KILL -- "-${pgid}" >/dev/null 2>&1 || true
  fi
  local_manual_signal_runner_pid_list KILL "${owned_pids[@]}"
}

stop_local_manual_runner_owner_aware() {
  local intent="${1:-stop_line}"
  if [[ ! -f "${RUNNER_PID_FILE}" ]]; then
    return 0
  fi

  local owner_janitor_raw_output owner_janitor_output
  owner_janitor_raw_output="$(local_manual_runner_owner_janitor_plan "${intent}")"
  owner_janitor_output="$(local_manual_runner_owner_janitor_normalize_plan "${intent}" "${owner_janitor_raw_output}")"
  local owner_janitor_action
  owner_janitor_action="$(local_manual_runner_stop_contract_action "${owner_janitor_output}")"

  if [[ "${owner_janitor_action}" == "stop_runner_tree" ]]; then
    local_manual_actuate_runner_stop_contract "${owner_janitor_output}"
    if ! local_manual_verify_runner_stop_contract "${owner_janitor_output}"; then
      warn "runner full-stop verification failed; keeping tracking state until the owned runner tree exits"
      return 1
    fi
    rm -f "${RUNNER_PID_FILE}"
    rm -f "${RUNNER_READY_FILE}"
    return 0
  fi

  if [[ "${owner_janitor_action}" == "remove_state_only" ]]; then
    rm -f "${RUNNER_PID_FILE}" "${RUNNER_READY_FILE}"
    return 0
  fi

  if [[ "${owner_janitor_action}" == "mark_degraded" ]]; then
    local_manual_mark_runner_degraded "${owner_janitor_output}"
    return 0
  fi

  warn "runner ownership is unverified; refusing to stop tracked local-manual runner"
  return 1
}

count_matching_processes() {
  local pattern="$1"
  local pids
  pids="$(pgrep -f "${pattern}" || true)"
  if [[ -z "${pids}" ]]; then
    echo 0
    return 0
  fi
  printf '%s\n' "${pids}" | awk 'NF { count += 1 } END { print count + 0 }'
}

rescue_stop_untracked_local_manual_processes() {
  if [[ "${LOCAL_MANUAL_ALLOW_UNTRACKED_PROCESS_RESCUE}" != "1" ]]; then
    return 0
  fi
  stop_matching_processes "run-next-dev-safe.sh --port ${PORT_WEB}"
  stop_matching_processes "npm run dev:test -- --port ${PORT_WEB}"
  stop_matching_processes "next dev --port ${PORT_WEB}"
  stop_matching_processes 'node .*/node_modules/.bin/tsx src/index.ts'
  stop_matching_processes 'make notebook-runner'
  if [[ "${LOCAL_MANUAL_ALLOW_UNTRACKED_PORT_CLEANUP}" == "1" ]]; then
    stop_listeners_on_port "${PORT_WEB}"
    stop_listeners_on_port "${PORT_API}"
  fi
}

stop_local_manual_processes() {
  stop_local_manual_runner_owner_aware stop_line
  stop_local_manual_tracked_service_owner_aware web
  stop_local_manual_tracked_service_owner_aware api

  rescue_stop_untracked_local_manual_processes
}
