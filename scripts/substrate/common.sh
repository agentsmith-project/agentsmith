#!/usr/bin/env bash
set -euo pipefail

DEFAULT_PROXY_URL="${DEFAULT_PROXY_URL:-}"
DEFAULT_NO_PROXY="${DEFAULT_NO_PROXY:-localhost,127.0.0.1,::1,0.0.0.0,host.docker.internal,.svc,.cluster.local,10.0.0.0/8,10.7.0.0/16,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16}"
export HTTP_PROXY="${HTTP_PROXY:-${http_proxy:-${DEFAULT_PROXY_URL}}}"
export HTTPS_PROXY="${HTTPS_PROXY:-${https_proxy:-${DEFAULT_PROXY_URL}}}"
export NO_PROXY="${NO_PROXY:-${no_proxy:-${DEFAULT_NO_PROXY}}}"
export http_proxy="${HTTP_PROXY}"
export https_proxy="${HTTPS_PROXY}"
export no_proxy="${NO_PROXY}"
unset all_proxy ALL_PROXY

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/universal-proxy-runtime.sh"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/local-redis-auth.sh"
SUBSTRATE="${SUBSTRATE:-local-dev}"
SUBSTRATE_CONFIG_FILE="${SUBSTRATE_CONFIG_FILE:-${ROOT_DIR}/infra/substrate/${SUBSTRATE}.env}"
SUBSTRATE_ENV_FILE="${SUBSTRATE_ENV_FILE:-}"

info() { echo "[substrate:${SUBSTRATE}] $*"; }
err() { echo "[substrate:${SUBSTRATE}] ERROR: $*" >&2; }
warn() { echo "[substrate:${SUBSTRATE}] WARN: $*" >&2; }

die() {
  err "$*"
  exit 1
}

[[ -f "${SUBSTRATE_CONFIG_FILE}" ]] || die "missing substrate config: ${SUBSTRATE_CONFIG_FILE}"
set -a
source "${SUBSTRATE_CONFIG_FILE}"
set +a
if [[ -n "${SUBSTRATE_ENV_FILE}" && -f "${SUBSTRATE_ENV_FILE}" ]]; then
  set -a
  source "${SUBSTRATE_ENV_FILE}"
  set +a
fi

SUBSTRATE_TYPE="${SUBSTRATE_TYPE:-compose}"
SUBSTRATE_STATE_ROOT="${SUBSTRATE_STATE_ROOT:-artifacts/runtime/substrate/${SUBSTRATE}}"
[[ "${SUBSTRATE_STATE_ROOT}" = /* ]] || SUBSTRATE_STATE_ROOT="${ROOT_DIR}/${SUBSTRATE_STATE_ROOT}"
SUBSTRATE_LOG_DIR="${SUBSTRATE_STATE_ROOT}/logs"
SUBSTRATE_CONNECTION_ENV="${SUBSTRATE_STATE_ROOT}/connection.env"
SUBSTRATE_STATUS_JSON="${SUBSTRATE_STATE_ROOT}/status.json"
SUBSTRATE_SEED_SUMMARY_ENV="${SUBSTRATE_STATE_ROOT}/seed-summary.env"
SUBSTRATE_PROXY_PID_FILE="${SUBSTRATE_STATE_ROOT}/proxy.pid"
SUBSTRATE_PROXY_LOG="${SUBSTRATE_LOG_DIR}/proxy.log"
SUBSTRATE_PROXY_READY_FILE="${SUBSTRATE_STATE_ROOT}/proxy.ready"
SUBSTRATE_PROXY_CONFIG_FILE="${SUBSTRATE_STATE_ROOT}/universal-proxy.yaml"
SUBSTRATE_COMPOSE_FILE="${SUBSTRATE_COMPOSE_FILE:-${ROOT_DIR}/infra/integration/docker-compose.yml}"
[[ "${SUBSTRATE_COMPOSE_FILE}" = /* ]] || SUBSTRATE_COMPOSE_FILE="${ROOT_DIR}/${SUBSTRATE_COMPOSE_FILE}"

SUBSTRATE_POSTGRES_PORT="${POSTGRES_PORT:-${SUBSTRATE_POSTGRES_PORT:-15432}}"
SUBSTRATE_MONGO_PORT="${MONGO_PORT:-${SUBSTRATE_MONGO_PORT:-17017}}"
SUBSTRATE_REDIS_PORT="${REDIS_PORT:-${SUBSTRATE_REDIS_PORT:-16379}}"
SUBSTRATE_REDIS_PASSWORD="${REDIS_PASSWORD:-${SUBSTRATE_REDIS_PASSWORD:-mbos_dev_password}}"
local_redis_require_simple_password SUBSTRATE_REDIS_PASSWORD "${SUBSTRATE_REDIS_PASSWORD}" "[substrate:${SUBSTRATE}]"
SUBSTRATE_MINIO_API_PORT="${MINIO_API_PORT:-${SUBSTRATE_MINIO_API_PORT:-19000}}"
SUBSTRATE_MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-${SUBSTRATE_MINIO_CONSOLE_PORT:-19001}}"
SUBSTRATE_KEYCLOAK_PORT="${KEYCLOAK_PORT:-${SUBSTRATE_KEYCLOAK_PORT:-18080}}"
SUBSTRATE_PROXY_PORT="${SUBSTRATE_PROXY_PORT:-38080}"
SUBSTRATE_COMPOSE_PROJECT_NAME="${SUBSTRATE_COMPOSE_PROJECT_NAME:-mbos-integration-deps}"
SUBSTRATE_DB_USER="${SUBSTRATE_DB_USER:-mbos}"
SUBSTRATE_DB_PASSWORD="${SUBSTRATE_DB_PASSWORD:-mbos_dev_password}"
SUBSTRATE_DB_NAME="${SUBSTRATE_DB_NAME:-mbos}"
SUBSTRATE_MONGO_USER="${SUBSTRATE_MONGO_USER:-mbos}"
SUBSTRATE_MONGO_PASSWORD="${SUBSTRATE_MONGO_PASSWORD:-mbos_dev_password}"
SUBSTRATE_MONGO_DB="${SUBSTRATE_MONGO_DB:-mbos}"
SUBSTRATE_MINIO_ACCESS_KEY="${SUBSTRATE_MINIO_ACCESS_KEY:-mbos}"
SUBSTRATE_MINIO_SECRET_KEY="${SUBSTRATE_MINIO_SECRET_KEY:-mbos_dev_password}"
SUBSTRATE_MINIO_BUCKET="${SUBSTRATE_MINIO_BUCKET:-mbos-dev}"
SUBSTRATE_KEYCLOAK_REALM="${SUBSTRATE_KEYCLOAK_REALM:-mbos}"
SUBSTRATE_KEYCLOAK_CLIENT_ID="${SUBSTRATE_KEYCLOAK_CLIENT_ID:-agentsmith}"
SUBSTRATE_ALLOW_RESET="${SUBSTRATE_ALLOW_RESET:-1}"
SUBSTRATE_KEYCLOAK_BASE_URL="${SUBSTRATE_KEYCLOAK_BASE_URL:-http://localhost:${SUBSTRATE_KEYCLOAK_PORT}}"
SUBSTRATE_KEYCLOAK_ISSUER_URL="${SUBSTRATE_KEYCLOAK_ISSUER_URL:-${SUBSTRATE_KEYCLOAK_BASE_URL%/}/realms/${SUBSTRATE_KEYCLOAK_REALM}}"
SUBSTRATE_PROXY_BASE_URL="${SUBSTRATE_PROXY_BASE_URL:-http://127.0.0.1:${SUBSTRATE_PROXY_PORT}}"
INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT:-${PORT_WEB:-3001}}"

ensure_substrate_dirs() {
  mkdir -p "${SUBSTRATE_STATE_ROOT}" "${SUBSTRATE_LOG_DIR}"
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
      die "${label} not ready in time (${url})"
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
      die "${label} port ${port} is still busy"
    fi
    sleep 1
  done
}

stop_matching_listeners_on_port() {
  local port="$1"
  local pattern="$2"
  local pids pid
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "${pids}" ]] || return 0
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    if ps -p "${pid}" -o command= 2>/dev/null | grep -q "${pattern}"; then
      info "stopping stale listener on port ${port}: pid=${pid} pattern=${pattern}"
      kill "${pid}" >/dev/null 2>&1 || true
      sleep 1
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
  done <<< "${pids}"
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

stop_pid_file_if_running() {
  local pid_file="$1"
  local label="$2"
  [[ -f "${pid_file}" ]] || return 0
  local pid
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  rm -f "${pid_file}"
  [[ -n "${pid}" ]] || return 0
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    return 0
  fi
  info "stopping ${label} pid=${pid}"
  kill "${pid}" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  kill -9 "${pid}" >/dev/null 2>&1 || true
}

write_connection_env() {
  ensure_substrate_dirs
  cat > "${SUBSTRATE_CONNECTION_ENV}" <<EOF_ENV
DATABASE_URL=postgresql://${SUBSTRATE_DB_USER}:${SUBSTRATE_DB_PASSWORD}@localhost:${SUBSTRATE_POSTGRES_PORT}/${SUBSTRATE_DB_NAME}
MONGO_URL=mongodb://${SUBSTRATE_MONGO_USER}:${SUBSTRATE_MONGO_PASSWORD}@localhost:${SUBSTRATE_MONGO_PORT}/admin
MONGO_DB_NAME=${SUBSTRATE_MONGO_DB}
REDIS_URL=redis://:${SUBSTRATE_REDIS_PASSWORD}@localhost:${SUBSTRATE_REDIS_PORT}
SUBSTRATE_REDIS_PASSWORD=${SUBSTRATE_REDIS_PASSWORD}
MINIO_ENDPOINT=localhost
MINIO_PORT=${SUBSTRATE_MINIO_API_PORT}
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=${SUBSTRATE_MINIO_ACCESS_KEY}
MINIO_SECRET_KEY=${SUBSTRATE_MINIO_SECRET_KEY}
MINIO_BUCKET=${SUBSTRATE_MINIO_BUCKET}
KEYCLOAK_BASE_URL=${SUBSTRATE_KEYCLOAK_BASE_URL}
KEYCLOAK_REALM=${SUBSTRATE_KEYCLOAK_REALM}
KEYCLOAK_CLIENT_ID=${SUBSTRATE_KEYCLOAK_CLIENT_ID}
KEYCLOAK_ISSUER_URL=${SUBSTRATE_KEYCLOAK_ISSUER_URL}
MBOS_UNIVERSAL_PROXY_BASE_URL=${SUBSTRATE_PROXY_BASE_URL}
MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN=${MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN:-}
EOF_ENV
}

write_seed_summary() {
  ensure_substrate_dirs
  cat > "${SUBSTRATE_SEED_SUMMARY_ENV}" <<EOF_SUMMARY
SUBSTRATE=${SUBSTRATE}
SEEDED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
MINIO_BUCKET=${SUBSTRATE_MINIO_BUCKET}
KEYCLOAK_REALM=${SUBSTRATE_KEYCLOAK_REALM}
DEFAULT_WORKSPACE_ID=${MBOS_DEFAULT_WORKSPACE_ID:-ws_default}
EOF_SUMMARY
}

write_status_json() {
  ensure_substrate_dirs
  local connection_present=false
  local proxy_ready=false
  [[ -f "${SUBSTRATE_CONNECTION_ENV}" ]] && connection_present=true
  [[ -f "${SUBSTRATE_PROXY_READY_FILE}" ]] && proxy_ready=true
  cat > "${SUBSTRATE_STATUS_JSON}" <<EOF_STATUS
{
  "substrate": "${SUBSTRATE}",
  "type": "${SUBSTRATE_TYPE}",
  "connection_env": ${connection_present},
  "proxy_ready": ${proxy_ready},
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF_STATUS
}

load_provider() {
  case "${SUBSTRATE_TYPE}" in
    compose) source "${ROOT_DIR}/scripts/substrate/providers/compose.sh" ;;
    external) source "${ROOT_DIR}/scripts/substrate/providers/external.sh" ;;
    k8s) source "${ROOT_DIR}/scripts/substrate/providers/k8s.sh" ;;
    *) die "unsupported SUBSTRATE_TYPE=${SUBSTRATE_TYPE}" ;;
  esac
}

ensure_substrate_dirs
load_provider
