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
ASBCP_CONTAINER_KUBECONFIG_PATH="${ASBCP_CONTAINER_KUBECONFIG_PATH:-/etc/asbcp/kubeconfig}"
ASBCP_CONTAINER_UID="${ASBCP_CONTAINER_UID:-10001}"
ASBCP_CONTAINER_GID="${ASBCP_CONTAINER_GID:-10001}"
ASBCP_KUBECONFIG_GROUP_GID="${ASBCP_KUBECONFIG_GROUP_GID:-$(id -g)}"
ASBCP_PROJECTED_KUBECONFIG_DIR="${ASBCP_PROJECTED_KUBECONFIG_DIR:-${INTERNAL_REAL_DIR}/asbcp-secrets}"
ASBCP_PROJECTED_KUBECONFIG_PATH="${ASBCP_PROJECTED_KUBECONFIG_PATH:-${ASBCP_PROJECTED_KUBECONFIG_DIR}/asbcp-kubeconfig}"
ASBCP_PROJECTED_CONFIG_PATH="${ASBCP_PROJECTED_CONFIG_PATH:-${ASBCP_PROJECTED_KUBECONFIG_DIR}/asbcp-config.yaml}"
ASBCP_PROJECTION_DIR_BASENAME="asbcp-secrets"
ASBCP_PROJECTION_MARKER_NAME=".agentsmith-asbcp-projection"
ASBCP_LEGACY_PROJECTED_KUBECONFIG_PATH="${INTERNAL_REAL_DIR}/asbcp-kubeconfig"

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

resolve_asbcp_host_kubeconfig_path() {
  local configured="${ASBCP_HOST_KUBECONFIG_PATH:-${KUBECONFIG:-}}"
  [[ -n "${configured}" ]] || return 1
  [[ "${configured}" != *:* ]] || return 2
  realpath -m "${configured}"
}

prepare_asbcp_projection_dir() {
  local target_dir="$1"
  local marker_tmp
  mkdir -p "${target_dir}"
  chmod 0700 "${target_dir}"
  marker_tmp="${target_dir}/${ASBCP_PROJECTION_MARKER_NAME}.tmp.$$"
  printf 'agentsmith-asbcp-projection\n' > "${marker_tmp}"
  chmod 0600 "${marker_tmp}"
  mv "${marker_tmp}" "${target_dir}/${ASBCP_PROJECTION_MARKER_NAME}"
}

prepare_asbcp_file_projection() {
  local source_path="$1"
  local target_path="$2"
  local target_dir
  local tmp_path
  target_dir="$(dirname "${target_path}")"
  if [[ "${ASBCP_LEGACY_PROJECTED_KUBECONFIG_PATH}" != "${ASBCP_PROJECTED_KUBECONFIG_PATH}" ]]; then
    rm -f "${ASBCP_LEGACY_PROJECTED_KUBECONFIG_PATH}"
  fi
  prepare_asbcp_projection_dir "${target_dir}"
  tmp_path="${target_path}.tmp.$$"
  rm -f "${tmp_path}"
  if ! (umask 0077; cp "${source_path}" "${tmp_path}"); then
    rm -f "${tmp_path}"
    return 1
  fi
  if ! chgrp "${ASBCP_KUBECONFIG_GROUP_GID}" "${tmp_path}"; then
    rm -f "${tmp_path}"
    return 1
  fi
  chmod 0640 "${tmp_path}"
  mv "${tmp_path}" "${target_path}"
  printf '%s\n' "${target_path}"
}

prepare_asbcp_config_projection() {
  prepare_asbcp_file_projection "$1" "${ASBCP_PROJECTED_CONFIG_PATH}"
}

prepare_asbcp_kubeconfig_projection() {
  prepare_asbcp_file_projection "$1" "${ASBCP_PROJECTED_KUBECONFIG_PATH}"
}

owned_asbcp_projection_dir() {
  local configured_dir="$1"
  local internal_real_dir projection_dir marker_path
  [[ -n "${configured_dir}" ]] || return 1
  internal_real_dir="$(realpath -m "${INTERNAL_REAL_DIR}")"
  projection_dir="$(realpath -m "${configured_dir}")"
  [[ "${projection_dir}" != "${internal_real_dir}" ]] || return 1
  case "${projection_dir}/" in
    "${internal_real_dir}/"*) ;;
    *) return 1 ;;
  esac
  [[ "$(basename "${projection_dir}")" == "${ASBCP_PROJECTION_DIR_BASENAME}" ]] || return 1
  marker_path="${projection_dir}/${ASBCP_PROJECTION_MARKER_NAME}"
  [[ -f "${marker_path}" ]] || return 1
  printf '%s\n' "${projection_dir}"
}

cleanup_asbcp_projection() {
  local projection_dir legacy_path internal_real_dir
  projection_dir="$(owned_asbcp_projection_dir "${ASBCP_PROJECTED_KUBECONFIG_DIR}")" || projection_dir=""
  if [[ -n "${projection_dir}" ]]; then
    rm -rf "${projection_dir}"
  fi
  internal_real_dir="$(realpath -m "${INTERNAL_REAL_DIR}")"
  legacy_path="$(realpath -m "${ASBCP_LEGACY_PROJECTED_KUBECONFIG_PATH}")"
  case "${legacy_path}" in
    "${internal_real_dir}/"*) rm -f "${legacy_path}" ;;
  esac
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
  local host_kubeconfig projected_config projected_kubeconfig resolve_status
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
  host_kubeconfig="$(resolve_asbcp_host_kubeconfig_path)" || {
    resolve_status=$?
    if [[ "${resolve_status}" == "2" ]]; then
      echo "[internal-sandbox-control] KUBECONFIG must be a single file path for ASBCP container projection" >&2
    else
      echo "[internal-sandbox-control] missing KUBECONFIG for ASBCP container projection" >&2
    fi
    exit 1
  }
  [[ -f "${host_kubeconfig}" ]] || { echo "[internal-sandbox-control] KUBECONFIG not found: ${host_kubeconfig}" >&2; exit 1; }
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
  projected_config="$(prepare_asbcp_config_projection "${ASBCP_CONFIG_PATH}")"
  projected_kubeconfig="$(prepare_asbcp_kubeconfig_projection "${host_kubeconfig}")"
  docker_args=(
    run
    --rm
    --name "${ASBCP_CONTAINER_NAME}"
    --network host
    --user "${ASBCP_CONTAINER_UID}:${ASBCP_CONTAINER_GID}"
    --group-add "${ASBCP_KUBECONFIG_GROUP_GID}"
    -v "${projected_config}:${ASBCP_CONTAINER_CONFIG_PATH}:ro"
    -v "${projected_kubeconfig}:${ASBCP_CONTAINER_KUBECONFIG_PATH}:ro"
    -e "ASBCP_CONFIG_PATH=${ASBCP_CONTAINER_CONFIG_PATH}"
    -e "KUBECONFIG=${ASBCP_CONTAINER_KUBECONFIG_PATH}"
    -e "ASBCP_SERVICE_KEYS=${ASBCP_SERVICE_KEY_VALUE}"
    -e "ASBCP_WORKLOAD_NAMESPACE=${K8S_NAMESPACE}"
    -e "ASBCP_AFSCP_INTERNAL_BASE_URL=${afscp_internal_base_url}"
    -e "ASBCP_AFSCP_ORCHESTRATOR_TOKEN=${afscp_orchestrator_token}"
    -e "ASBCP_AFSCP_CALLER_SERVICE=${afscp_caller_service}"
    -e "ASBCP_AFSCP_ACTOR_TYPE=${afscp_actor_type}"
    -e "ASBCP_AFSCP_ACTOR_ID=${afscp_actor_id}"
  )
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
  cleanup_asbcp_projection
  exit 1
}

stop_asbcp() {
  docker rm -f "${ASBCP_CONTAINER_NAME}" >/dev/null 2>&1 || true
  rm -f "${ASBCP_CONTAINER_ID_FILE}"
  cleanup_asbcp_projection
  stop_pid "${ASBCP_PID_FILE}"
  kill_port_listeners
}

status() {
  local asbcp_pid listener_pids
  asbcp_pid="$(read_pid "${ASBCP_PID_FILE}")"
  listener_pids="$(tr '\n' ',' <<< "$(port_pids "${ASBCP_PORT}")" | sed 's/,$//')"
  echo "asbcp_pid=${asbcp_pid:-}"
  echo "asbcp_alive=$(pid_alive "${asbcp_pid}" && echo 1 || echo 0)"
  echo "asbcp_container_running=$(asbcp_container_running && echo 1 || echo 0)"
  echo "asbcp_listener_pids=${listener_pids}"
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
