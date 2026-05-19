#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASBCP_IMAGE_ERROR_PREFIX="[internal-sandbox-control]"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/asbcp-image-lock.sh"

STATE_FILE="${INTERNAL_SANDBOX_REAL_STATE_FILE:-}"
[[ -n "${STATE_FILE}" ]] || { echo "[internal-sandbox-control] missing INTERNAL_SANDBOX_REAL_STATE_FILE" >&2; exit 1; }
[[ -f "${STATE_FILE}" ]] || { echo "[internal-sandbox-control] state file not found: ${STATE_FILE}" >&2; exit 1; }
# shellcheck disable=SC1090
source "${STATE_FILE}"

COMMAND="${1:-status}"
ASBCP_PID_FILE="${INTERNAL_REAL_DIR}/asbcp.pid"
ASBCP_CONTAINER_ID_FILE="${INTERNAL_REAL_DIR}/asbcp.container"
ASBCP_CONTAINER_NAME="${ASBCP_CONTAINER_NAME:-agentsmith-asbcp-$(basename "${INTERNAL_REAL_DIR}" | tr -cs 'A-Za-z0-9_.-' '-')}"
ASBCP_IMAGE_LOCK_PATH="${ASBCP_IMAGE_LOCK_PATH:-${ROOT_DIR}/infra/deploy/shared/asbcp-image.lock}"
ASBCP_PORT="${ASBCP_PORT:-28080}"
ASBCP_INTERNAL_BASE_URL="${ASBCP_INTERNAL_BASE_URL:-http://127.0.0.1:${ASBCP_PORT}}"
ASBCP_LOG="${ASBCP_LOG:-${INTERNAL_REAL_DIR}/asbcp.log}"
ASBCP_SERVICE_KEY_VALUE="${ASBCP_SERVICE_KEY_VALUE:-${ASBCP_SERVICE_KEY:-}}"
ASBCP_CONFIG_PATH="${ASBCP_CONFIG_PATH:-}"
ASBCP_CONTAINER_CONFIG_PATH="/etc/asbcp/asbcp-config.yaml"

info() { echo "[internal-sandbox-control] $*"; }

redact_internal_sandbox_output() {
  local line redacted secret
  while IFS= read -r line || [[ -n "${line}" ]]; do
    redacted="${line}"
    for secret in \
      "${ASBCP_SERVICE_KEY_VALUE:-}" \
      "${ASBCP_SERVICE_KEY:-}" \
      "${AFSCP_ORCHESTRATOR_TOKEN:-}" \
      "${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-}"; do
      if [[ "${#secret}" -ge 4 ]]; then
        redacted="${redacted//${secret}/[REDACTED]}"
      fi
    done
    printf '%s\n' "${redacted}"
  done
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
  curl -fsS -H "X-Service-Key: ${ASBCP_SERVICE_KEY_VALUE}" "${ASBCP_INTERNAL_BASE_URL%/}/readyz" >/dev/null 2>&1
}

kill_port_listeners() {
  local pid
  for pid in $(port_pids "${ASBCP_PORT}"); do
    kill "${pid}" >/dev/null 2>&1 || true
  done
  for _ in $(seq 1 20); do
    if [[ -z "$(port_pids "${ASBCP_PORT}")" ]]; then
      return 0
    fi
    sleep 1
  done
  for pid in $(port_pids "${ASBCP_PORT}"); do
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

resolve_asbcp_image() {
  asbcp_resolve_locked_image "${ASBCP_IMAGE:-}" "${ASBCP_IMAGE_LOCK_PATH}"
}

asbcp_container_id() {
  if [[ -f "${ASBCP_CONTAINER_ID_FILE}" ]]; then
    tr -d '[:space:]' < "${ASBCP_CONTAINER_ID_FILE}"
  fi
}

asbcp_container_running() {
  local container_id
  container_id="$(asbcp_container_id)"
  [[ -n "${container_id}" ]] || return 1
  docker inspect -f '{{.State.Running}}' "${container_id}" 2>/dev/null | grep -qx 'true'
}

start_asbcp() {
  local pid image afscp_internal_base_url afscp_orchestrator_token afscp_caller_service afscp_actor_type afscp_actor_id
  local -a docker_args
  pid="$(read_pid "${ASBCP_PID_FILE}")"
  if pid_alive "${pid}" && port_ready; then
    info "ASBCP already running pid=${pid}"
    return 0
  fi
  if port_ready; then
    info "ASBCP already running at ${ASBCP_INTERNAL_BASE_URL} without tracked pid"
    return 0
  fi
  if [[ -n "$(port_pids "${ASBCP_PORT}")" ]]; then
    kill_port_listeners
  fi
  [[ -n "${ASBCP_CONFIG_PATH}" ]] || { echo "[internal-sandbox-control] missing ASBCP_CONFIG_PATH" >&2; exit 1; }
  [[ -f "${ASBCP_CONFIG_PATH}" ]] || { echo "[internal-sandbox-control] ASBCP config not found: ${ASBCP_CONFIG_PATH}" >&2; exit 1; }
  [[ -n "${ASBCP_SERVICE_KEY_VALUE}" ]] || { echo "[internal-sandbox-control] missing ASBCP_SERVICE_KEY" >&2; exit 1; }
  afscp_internal_base_url="${AFSCP_INTERNAL_BASE_URL:-${AFSCP_BASE_URL:-}}"
  afscp_orchestrator_token="${AFSCP_ORCHESTRATOR_TOKEN:-${AFSCP_ORCHESTRATOR_SERVICE_TOKEN:-}}"
  afscp_caller_service="${AFSCP_ORCHESTRATOR_CALLER_SERVICE:-${AFSCP_CALLER_SERVICE:-agentsmith-sandbox-control-plane}}"
  afscp_actor_type="${AFSCP_ACTOR_TYPE:-${AFSCP_ORCHESTRATOR_ACTOR_TYPE:-system}}"
  afscp_actor_id="${AFSCP_ACTOR_ID:-${AFSCP_ORCHESTRATOR_ACTOR_ID:-${afscp_caller_service}}}"
  [[ -n "${afscp_internal_base_url}" ]] || { echo "[internal-sandbox-control] missing AFSCP_INTERNAL_BASE_URL for ASBCP" >&2; exit 1; }
  [[ -n "${afscp_orchestrator_token}" ]] || { echo "[internal-sandbox-control] missing AFSCP_ORCHESTRATOR_TOKEN for ASBCP" >&2; exit 1; }
  command -v docker >/dev/null 2>&1 || { echo "[internal-sandbox-control] docker is required to run ASBCP image" >&2; exit 1; }
  image="$(resolve_asbcp_image)"
  if ! docker image inspect "${image}" >/dev/null 2>&1; then
    info "pulling ASBCP image ${image}"
    docker pull --platform linux/amd64 "${image}" >/dev/null
  fi
  docker rm -f "${ASBCP_CONTAINER_NAME}" >/dev/null 2>&1 || true
  docker_args=(
    run
    --rm
    --name "${ASBCP_CONTAINER_NAME}"
    --network host
    -v "${ASBCP_CONFIG_PATH}:${ASBCP_CONTAINER_CONFIG_PATH}:ro"
    -e "ASBCP_CONFIG_PATH=${ASBCP_CONTAINER_CONFIG_PATH}"
    -e "ASBCP_SERVICE_KEYS=${ASBCP_SERVICE_KEY_VALUE}"
    -e "ASBCP_WORKLOAD_NAMESPACE=${K8S_NAMESPACE}"
    -e "ASBCP_AFSCP_INTERNAL_BASE_URL=${afscp_internal_base_url}"
    -e "ASBCP_AFSCP_ORCHESTRATOR_TOKEN=${afscp_orchestrator_token}"
    -e "ASBCP_AFSCP_CALLER_SERVICE=${afscp_caller_service}"
    -e "ASBCP_AFSCP_ACTOR_TYPE=${afscp_actor_type}"
    -e "ASBCP_AFSCP_ACTOR_ID=${afscp_actor_id}"
  )
  if [[ -n "${KUBECONFIG:-}" && -f "${KUBECONFIG}" ]]; then
    docker_args+=(-e "KUBECONFIG=${KUBECONFIG}" -v "${KUBECONFIG}:${KUBECONFIG}:ro")
  fi
  : > "${ASBCP_LOG}"
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
    docker "${docker_args[@]}" "${image}" > >(redact_internal_sandbox_output >> "${ASBCP_LOG}") 2>&1 &
  pid="$!"
  printf '%s\n' "${pid}" > "${ASBCP_PID_FILE}"
  printf '%s\n' "${ASBCP_CONTAINER_NAME}" > "${ASBCP_CONTAINER_ID_FILE}"
  for _ in $(seq 1 60); do
    if port_ready; then
      info "ASBCP ready"
      return 0
    fi
    sleep 1
  done
  echo "[internal-sandbox-control] ASBCP failed to become ready" >&2
  tail -n 120 "${ASBCP_LOG}" >&2 || true
  exit 1
}

stop_asbcp() {
  docker rm -f "${ASBCP_CONTAINER_NAME}" >/dev/null 2>&1 || true
  rm -f "${ASBCP_CONTAINER_ID_FILE}"
  stop_pid "${ASBCP_PID_FILE}"
  kill_port_listeners
}

status() {
  local asbcp_pid
  asbcp_pid="$(read_pid "${ASBCP_PID_FILE}")"
  echo "asbcp_pid=${asbcp_pid:-}"
  echo "asbcp_alive=$(pid_alive "${asbcp_pid}" && echo 1 || echo 0)"
  echo "asbcp_container_running=$(asbcp_container_running && echo 1 || echo 0)"
  echo "asbcp_listener_pids=$(tr '\n' ',' <<< \"$(port_pids "${ASBCP_PORT}")\" | sed 's/,$//')"
  echo "asbcp_ready=$(port_ready && echo 1 || echo 0)"
}

case "${COMMAND}" in
  start-asbcp) start_asbcp ;;
  stop-asbcp) stop_asbcp ;;
  restart-asbcp) stop_asbcp; start_asbcp ;;
  status) status ;;
  *)
    echo "[internal-sandbox-control] unknown command: ${COMMAND}" >&2
    exit 1
    ;;
esac
