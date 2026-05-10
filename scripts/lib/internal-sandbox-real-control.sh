#!/usr/bin/env bash
set -euo pipefail

STATE_FILE="${INTERNAL_SANDBOX_REAL_STATE_FILE:-}"
[[ -n "${STATE_FILE}" ]] || { echo "[internal-sandbox-control] missing INTERNAL_SANDBOX_REAL_STATE_FILE" >&2; exit 1; }
[[ -f "${STATE_FILE}" ]] || { echo "[internal-sandbox-control] state file not found: ${STATE_FILE}" >&2; exit 1; }
# shellcheck disable=SC1090
source "${STATE_FILE}"

COMMAND="${1:-status}"
MANAGER_PID_FILE="${INTERNAL_REAL_DIR}/sandbox-manager.pid"

info() { echo "[internal-sandbox-control] $*"; }

launch_detached_shell() {
  local log_file="$1"
  local command="$2"
  local pid
  : > "${log_file}"
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -lc "${command}" >> "${log_file}" 2>&1 < /dev/null &
  else
    nohup bash -lc "${command}" >> "${log_file}" 2>&1 < /dev/null &
  fi
  pid="$!"
  printf '%s\n' "${pid}"
}

read_pid() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    tr -d '[:space:]' < "${file}"
  fi
}

pid_alive() {
  local pid="${1:-}"
  [[ -n "${pid}" ]] || return 1
  kill -0 "${pid}" >/dev/null 2>&1
}

port_pids() {
  local port="${1:-}"
  [[ -n "${port}" ]] || return 0
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "( sport = :${port} )" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u || true
    return 0
  fi
}

port_ready() {
  curl -fsS -H "X-Service-Key: ${SANDBOX_SERVICE_KEY_VALUE}" "http://127.0.0.1:${SANDBOX_PORT}/readyz" >/dev/null 2>&1
}

kill_port_listeners() {
  local pid
  for pid in $(port_pids "${SANDBOX_PORT}"); do
    kill "${pid}" >/dev/null 2>&1 || true
  done
  for _ in $(seq 1 20); do
    if [[ -z "$(port_pids "${SANDBOX_PORT}")" ]]; then
      return 0
    fi
    sleep 1
  done
  for pid in $(port_pids "${SANDBOX_PORT}"); do
    kill -9 "${pid}" >/dev/null 2>&1 || true
  done
}

stop_pid() {
  local file="$1"
  local pid
  pid="$(read_pid "${file}")"
  if ! pid_alive "${pid}"; then
    rm -f "${file}"
    return 0
  fi
  kill "${pid}" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    if ! pid_alive "${pid}"; then
      break
    fi
    sleep 1
  done
  if pid_alive "${pid}"; then
    kill -9 "${pid}" >/dev/null 2>&1 || true
  fi
  rm -f "${file}"
}

start_manager() {
  local pid
  local afscp_internal_base_url afscp_orchestrator_token afscp_caller_service afscp_actor_type afscp_actor_id
  pid="$(read_pid "${MANAGER_PID_FILE}")"
  if pid_alive "${pid}" && port_ready; then
    info "manager already running pid=${pid}"
    return 0
  fi
  if port_ready; then
    info "manager already running on :${SANDBOX_PORT} without tracked pid"
    return 0
  fi
  if [[ -n "$(port_pids "${SANDBOX_PORT}")" ]]; then
    kill_port_listeners
  fi
  afscp_internal_base_url="${AFSCP_INTERNAL_BASE_URL:-${AFSCP_BASE_URL:-}}"
  afscp_orchestrator_token="${AFSCP_ORCHESTRATOR_TOKEN:-${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-}}"
  afscp_caller_service="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-${AFSCP_CALLER_SERVICE:-agentsmith-sandbox-manager}}"
  afscp_actor_type="${AFSCP_ACTOR_TYPE:-${AFSCP_ORCHESTRATOR_ACTOR_TYPE:-system}}"
  afscp_actor_id="${AFSCP_ACTOR_ID:-${AFSCP_ORCHESTRATOR_ACTOR_ID:-${afscp_caller_service}}}"
  [[ -n "${afscp_internal_base_url}" ]] || { echo "[internal-sandbox-control] missing AFSCP_INTERNAL_BASE_URL for sandbox manager" >&2; exit 1; }
  [[ -n "${afscp_orchestrator_token}" ]] || { echo "[internal-sandbox-control] missing AFSCP_ORCHESTRATOR_TOKEN for sandbox manager" >&2; exit 1; }
  launch_detached_shell "${SANDBOX_LOG}" "
    cd '${SANDBOX_ROOT}/manager-service' && \
    env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
      CONFIG_PATH='${CONFIG_PATH}' \
      SERVICE_KEYS='${SANDBOX_SERVICE_KEY_VALUE}' \
      AFSCP_INTERNAL_BASE_URL='${afscp_internal_base_url}' \
      AFSCP_ORCHESTRATOR_TOKEN='${afscp_orchestrator_token}' \
      AFSCP_CALLER_SERVICE='${afscp_caller_service}' \
      AFSCP_ACTOR_TYPE='${afscp_actor_type}' \
      AFSCP_ACTOR_ID='${afscp_actor_id}' \
      JUICEFS_CSI_DRIVER='${AFSCP_STORAGE_CSI_DRIVER:-csi.juicefs.com}' \
      JUICEFS_STORAGE_CAPACITY='${AFSCP_STORAGE_CAPACITY:-1Pi}' \
      JUICEFS_STORAGE_CLASS_NAME='${AFSCP_STORAGE_CLASS_NAME:-}' \
      JUICEFS_MOUNT_OPTIONS='${AFSCP_STORAGE_CSI_MOUNT_OPTIONS:-}' \
      JUICEFS_SUBDIR='${AFSCP_STORAGE_CSI_SUBDIR:-}' \
      JUICEFS_MOUNT_SERVICE_ACCOUNT='${AFSCP_STORAGE_CSI_MOUNT_SERVICE_ACCOUNT:-}' \
      JUICEFS_MOUNT_IMAGE='${AFSCP_STORAGE_CSI_MOUNT_IMAGE:-}' \
      JUICEFS_STORAGE_ENDPOINT='${AFSCP_SUBSTRATE_OBJECT_STORAGE_ENDPOINT_VALUE}' \
      JUICEFS_STORAGE_ACCESS_KEY='${MINIO_ACCESS_KEY}' \
      JUICEFS_STORAGE_SECRET_KEY='${MINIO_SECRET_KEY}' \
      STORAGE_ENDPOINT='localhost:19000' \
      STORAGE_ACCESS_KEY='${MINIO_ACCESS_KEY}' \
      STORAGE_SECRET_KEY='${MINIO_SECRET_KEY}' \
      STORAGE_BUCKET='${MINIO_BUCKET}' \
      STORAGE_USE_SSL='false' \
      KUBECONFIG='${KUBECONFIG:-}' \
      go run ./cmd/manager
  " > "${MANAGER_PID_FILE}"
  for _ in $(seq 1 60); do
    if port_ready; then
      info "manager ready"
      return 0
    fi
    sleep 1
  done
  echo "[internal-sandbox-control] manager failed to become ready" >&2
  tail -n 120 "${SANDBOX_LOG}" >&2 || true
  exit 1
}

stop_manager() {
  stop_pid "${MANAGER_PID_FILE}"
  kill_port_listeners
}

status() {
  local manager_pid
  manager_pid="$(read_pid "${MANAGER_PID_FILE}")"
  echo "manager_pid=${manager_pid:-}"
  echo "manager_alive=$(pid_alive "${manager_pid}" && echo 1 || echo 0)"
  echo "manager_listener_pids=$(tr '\n' ',' <<< \"$(port_pids "${SANDBOX_PORT}")\" | sed 's/,$//')"
  echo "manager_ready=$(port_ready && echo 1 || echo 0)"
}

case "${COMMAND}" in
  start-manager) start_manager ;;
  stop-manager) stop_manager ;;
  restart-manager) stop_manager; start_manager ;;
  status) status ;;
  *)
    echo "[internal-sandbox-control] unknown command: ${COMMAND}" >&2
    exit 1
    ;;
esac
