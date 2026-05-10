#!/usr/bin/env bash
set -euo pipefail

STATE_FILE="${INTERNAL_SANDBOX_REAL_STATE_FILE:-}"
[[ -n "${STATE_FILE}" ]] || { echo "[internal-sandbox-control] missing INTERNAL_SANDBOX_REAL_STATE_FILE" >&2; exit 1; }
[[ -f "${STATE_FILE}" ]] || { echo "[internal-sandbox-control] state file not found: ${STATE_FILE}" >&2; exit 1; }
# shellcheck disable=SC1090
source "${STATE_FILE}"

COMMAND="${1:-status}"
MANAGER_PID_FILE="${INTERNAL_REAL_DIR}/sandbox-manager.pid"
CLEANER_PID_FILE="${INTERNAL_REAL_DIR}/sandbox-cleaner.pid"
CLEANER_BIN="${INTERNAL_REAL_DIR}/sandbox-cleaner"

info() { echo "[internal-sandbox-control] $*"; }

launch_detached() {
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" </dev/null &
  else
    nohup "$@" </dev/null >/dev/null 2>&1 &
  fi
  echo $!
}

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

resolve_kubeconfig() {
  if [[ -n "${KUBECONFIG:-}" ]]; then
    printf '%s\n' "${KUBECONFIG}"
    return 0
  fi
  if [[ -f "${HOME}/.kube/config" ]]; then
    printf '%s\n' "${HOME}/.kube/config"
    return 0
  fi
  printf '\n'
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

ensure_cleaner_bin() {
  if [[ -x "${CLEANER_BIN}" ]]; then
    return 0
  fi
  (
    cd "${SANDBOX_ROOT}/manager-service" && \
      env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
      go build -o "${CLEANER_BIN}" ./cmd/cleaner
  )
}

start_manager() {
  local pid
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
  launch_detached_shell "${SANDBOX_LOG}" "
    cd '${SANDBOX_ROOT}/manager-service' && \
    env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
      CONFIG_PATH='${CONFIG_PATH}' \
      SERVICE_KEYS='${SANDBOX_SERVICE_KEY_VALUE}' \
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

run_cleaner_once() {
  local cleaner_args
  local kubeconfig_path
  ensure_cleaner_bin
  cleaner_args=(
    "--namespace=${K8S_NAMESPACE}"
    "--dry-run=false"
    "--log-level=info"
  )
  kubeconfig_path="$(resolve_kubeconfig)"
  if [[ -n "${kubeconfig_path}" ]]; then
    cleaner_args+=("--kubeconfig=${kubeconfig_path}")
  fi
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
    "${CLEANER_BIN}" \
    "${cleaner_args[@]}" >>"${CLEANER_LOG}" 2>&1
}

start_cleaner() {
  local pid
  local cleaner_args
  local kubeconfig_path
  pid="$(read_pid "${CLEANER_PID_FILE}")"
  if pid_alive "${pid}"; then
    info "cleaner loop already running pid=${pid}"
    return 0
  fi
  ensure_cleaner_bin
  cleaner_args=(
    "--namespace=${K8S_NAMESPACE}"
    "--dry-run=false"
    "--log-level=info"
  )
  kubeconfig_path="$(resolve_kubeconfig)"
  if [[ -n "${kubeconfig_path}" ]]; then
    cleaner_args+=("--kubeconfig=${kubeconfig_path}")
  fi
  local cleaner_command
  cleaner_command="$(printf "%q " env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY "${CLEANER_BIN}" "${cleaner_args[@]}")"
  launch_detached_shell "${CLEANER_LOG}" "
    while true; do
      ${cleaner_command} || true
      sleep '${CLEANER_INTERVAL_SECONDS}'
    done
  " > "${CLEANER_PID_FILE}"
  info "started cleaner loop"
}

stop_manager() {
  stop_pid "${MANAGER_PID_FILE}"
  kill_port_listeners
}

stop_cleaner() {
  stop_pid "${CLEANER_PID_FILE}"
}

status() {
  local manager_pid cleaner_pid
  manager_pid="$(read_pid "${MANAGER_PID_FILE}")"
  cleaner_pid="$(read_pid "${CLEANER_PID_FILE}")"
  echo "manager_pid=${manager_pid:-}"
  echo "manager_alive=$(pid_alive "${manager_pid}" && echo 1 || echo 0)"
  echo "manager_listener_pids=$(tr '\n' ',' <<< \"$(port_pids "${SANDBOX_PORT}")\" | sed 's/,$//')"
  echo "manager_ready=$(port_ready && echo 1 || echo 0)"
  echo "cleaner_pid=${cleaner_pid:-}"
  echo "cleaner_alive=$(pid_alive "${cleaner_pid}" && echo 1 || echo 0)"
}

case "${COMMAND}" in
  start-manager) start_manager ;;
  stop-manager) stop_manager ;;
  restart-manager) stop_manager; start_manager ;;
  start-cleaner) start_cleaner ;;
  stop-cleaner) stop_cleaner ;;
  restart-cleaner) stop_cleaner; start_cleaner ;;
  run-cleaner-once) run_cleaner_once ;;
  status) status ;;
  *)
    echo "[internal-sandbox-control] unknown command: ${COMMAND}" >&2
    exit 1
    ;;
esac
