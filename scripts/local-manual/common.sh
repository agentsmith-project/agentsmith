#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.local-manual}"
SUBSTRATE="${SUBSTRATE:-local-dev}"
SUBSTRATE_ENV_FILE="${ENV_FILE}"
LOCAL_MANUAL_ENABLE_INTERNAL="${LOCAL_MANUAL_ENABLE_INTERNAL:-0}"
LOCAL_MANUAL_INTERNAL_ENV_FILE="${LOCAL_MANUAL_INTERNAL_ENV_FILE:-${ROOT_DIR}/infra/flows/local-manual-internal.env}"

source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/runtime-config.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
source "${ROOT_DIR}/scripts/scenarios/common.sh"
source "${ROOT_DIR}/scripts/substrate/common.sh"
ensure_backend_real_state

LOCAL_MANUAL_ROOT="$(backend_real_state_root)/local-manual"
mkdir -p "${LOCAL_MANUAL_ROOT}"
LOCAL_MANUAL_EVIDENCE_DIR="${LOCAL_MANUAL_ROOT}/evidence"

API_PID_FILE="${LOCAL_MANUAL_ROOT}/api.pid"
WEB_PID_FILE="${LOCAL_MANUAL_ROOT}/web.pid"
RUNNER_PID_FILE="${LOCAL_MANUAL_ROOT}/runner.pid"

API_READY_FILE="${LOCAL_MANUAL_ROOT}/api.ready"
WEB_READY_FILE="${LOCAL_MANUAL_ROOT}/web.ready"
RUNNER_READY_FILE="${LOCAL_MANUAL_ROOT}/runner.ready"
PROXY_READY_FILE="${SUBSTRATE_PROXY_READY_FILE}"

API_PORT_FILE="${LOCAL_MANUAL_ROOT}/api.port"
WEB_PORT_FILE="${LOCAL_MANUAL_ROOT}/web.port"

API_LOG="${LOCAL_MANUAL_ROOT}/api.log"
WEB_LOG="${LOCAL_MANUAL_ROOT}/web.log"
RUNNER_LOG="${LOCAL_MANUAL_ROOT}/runner.log"

info() { echo "[local-manual] $*"; }
err() { echo "[local-manual] ERROR: $*" >&2; }
warn() { echo "[local-manual] WARN: $*" >&2; }

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

remove_local_manual_runtime_files() {
  rm -f \
    "${API_READY_FILE}" "${WEB_READY_FILE}" "${RUNNER_READY_FILE}" \
    "${API_PORT_FILE}" "${WEB_PORT_FILE}" \
    "${API_PID_FILE}" "${WEB_PID_FILE}" "${RUNNER_PID_FILE}"
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

maybe_stop_untracked_port() {
  local port="$1"
  if [[ "${LOCAL_MANUAL_ALLOW_UNTRACKED_PORT_CLEANUP}" != "1" ]]; then
    return 0
  fi
  stop_listeners_on_port "${port}"
}

stop_local_manual_processes() {
  stop_pid_file_if_running "${RUNNER_PID_FILE}" "runner"
  stop_pid_file_if_running "${WEB_PID_FILE}" "web"
  stop_pid_file_if_running "${API_PID_FILE}" "api"

  stop_matching_processes "run-next-dev-safe.sh --port ${PORT_WEB}"
  stop_matching_processes "npm run dev:test --port ${PORT_WEB}"
  stop_matching_processes "next dev --port ${PORT_WEB}"
  stop_matching_processes 'node .*/node_modules/.bin/tsx src/index.ts'
  stop_matching_processes 'make notebook-runner'

  maybe_stop_untracked_port "${PORT_WEB}"
  maybe_stop_untracked_port "${PORT_API}"
}
