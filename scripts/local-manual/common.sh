#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROXY_ROOT="$(cd "${ROOT_DIR}/../llm-universal-proxy" && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/runtime-config.sh"
ensure_backend_real_state

ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.local-manual}"
LOCAL_MANUAL_ROOT="$(backend_real_state_root)/local-manual"
mkdir -p "${LOCAL_MANUAL_ROOT}"

PROXY_PID_FILE="${LOCAL_MANUAL_ROOT}/proxy.pid"
API_PID_FILE="${LOCAL_MANUAL_ROOT}/api.pid"
WEB_PID_FILE="${LOCAL_MANUAL_ROOT}/web.pid"
RUNNER_PID_FILE="${LOCAL_MANUAL_ROOT}/runner.pid"

PROXY_READY_FILE="${LOCAL_MANUAL_ROOT}/proxy.ready"
API_READY_FILE="${LOCAL_MANUAL_ROOT}/api.ready"
WEB_READY_FILE="${LOCAL_MANUAL_ROOT}/web.ready"
RUNNER_READY_FILE="${LOCAL_MANUAL_ROOT}/runner.ready"

PROXY_PORT_FILE="${LOCAL_MANUAL_ROOT}/proxy.port"
API_PORT_FILE="${LOCAL_MANUAL_ROOT}/api.port"
WEB_PORT_FILE="${LOCAL_MANUAL_ROOT}/web.port"

PROXY_LOG="${LOCAL_MANUAL_ROOT}/proxy.log"
API_LOG="${LOCAL_MANUAL_ROOT}/api.log"
WEB_LOG="${LOCAL_MANUAL_ROOT}/web.log"
RUNNER_LOG="${LOCAL_MANUAL_ROOT}/runner.log"
PROXY_CONFIG="${LOCAL_MANUAL_ROOT}/universal-proxy.yaml"

info() { echo "[local-manual] $*"; }
err() { echo "[local-manual] ERROR: $*" >&2; }
warn() { echo "[local-manual] WARN: $*" >&2; }

require_var() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    err "missing required env: ${key}"
    exit 1
  fi
}

fail_if_legacy_env() {
  local key
  for key in GLM_API_KEY GLM_BASE_URL GLM_MODEL ENDPOINT_PROTOCOL; do
    if [[ -n "${!key:-}" ]]; then
      err "legacy env var is not supported: ${key}"
      err "use PRESET_ENDPOINT_API_KEY plus PRESET_ANTHROPIC_ENDPOINT_* / PRESET_OPENAI_ENDPOINT_*"
      exit 1
    fi
  done
}

init_local_manual_env() {
  load_runtime_env_stack "local-manual" "${ENV_FILE}"
  fail_if_legacy_env

  PORT_API="${PORT_API:-20000}"
  PORT_WEB="${PORT_WEB:-3001}"
  PROXY_PORT="${PROXY_PORT:-38080}"
  LOCALE="${LOCALE:-zh-CN}"
  WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"

  KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
  PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
  INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}"
  KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
  KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
  KEYCLOAK_URL="${KEYCLOAK_URL:-${KEYCLOAK_BASE_URL}/realms}"
  KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL:-${PUBLIC_KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}}"

  DATABASE_URL="${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:15432/mbos}"
  REDIS_URL="${REDIS_URL:-redis://localhost:16379}"
  MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}"
  MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"
  MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
  MINIO_PORT="${MINIO_PORT:-19000}"
  MINIO_USE_SSL="${MINIO_USE_SSL:-false}"
  MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
  MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
  MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"
  MBOS_UNIVERSAL_PROXY_BASE_URL="${MBOS_UNIVERSAL_PROXY_BASE_URL:-http://127.0.0.1:${PROXY_PORT}}"
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
    "${PROXY_READY_FILE}" "${API_READY_FILE}" "${WEB_READY_FILE}" "${RUNNER_READY_FILE}" \
    "${PROXY_PORT_FILE}" "${API_PORT_FILE}" "${WEB_PORT_FILE}" \
    "${PROXY_PID_FILE}" "${API_PID_FILE}" "${WEB_PID_FILE}" "${RUNNER_PID_FILE}"
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
