#!/usr/bin/env bash
set -euo pipefail

compose_env_args() {
  cat <<EOF_VARS
COMPOSE_PROJECT_NAME=${SUBSTRATE_COMPOSE_PROJECT_NAME}
POSTGRES_PORT=${SUBSTRATE_POSTGRES_PORT}
MONGO_PORT=${SUBSTRATE_MONGO_PORT}
REDIS_PORT=${SUBSTRATE_REDIS_PORT}
REDIS_PASSWORD=${SUBSTRATE_REDIS_PASSWORD}
MINIO_API_PORT=${SUBSTRATE_MINIO_API_PORT}
MINIO_CONSOLE_PORT=${SUBSTRATE_MINIO_CONSOLE_PORT}
KEYCLOAK_PORT=${SUBSTRATE_KEYCLOAK_PORT}
POSTGRES_USER=${SUBSTRATE_DB_USER}
POSTGRES_PASSWORD=${SUBSTRATE_DB_PASSWORD}
POSTGRES_DB=${SUBSTRATE_DB_NAME}
MONGO_ROOT_USERNAME=${SUBSTRATE_MONGO_USER}
MONGO_ROOT_PASSWORD=${SUBSTRATE_MONGO_PASSWORD}
MONGO_DB=${SUBSTRATE_MONGO_DB}
MINIO_ROOT_USER=${SUBSTRATE_MINIO_ACCESS_KEY}
MINIO_ROOT_PASSWORD=${SUBSTRATE_MINIO_SECRET_KEY}
MINIO_BUCKET=${SUBSTRATE_MINIO_BUCKET}
KEYCLOAK_REALM=${SUBSTRATE_KEYCLOAK_REALM}
KEYCLOAK_CLIENT_ID=${SUBSTRATE_KEYCLOAK_CLIENT_ID}
EOF_VARS
}

run_compose() {
  local command="$1"
  shift || true
  (
    cd "${ROOT_DIR}" && \
    eval "$(compose_env_args | sed 's/^/export /')" && \
    docker compose -f "${SUBSTRATE_COMPOSE_FILE}" ${command} "$@"
  )
}

start_local_proxy() {
  export UNIVERSAL_PROXY_RUNTIME_ROOT_DIR="${ROOT_DIR}"
  export UNIVERSAL_PROXY_RUNTIME_STATE_DIR="${SUBSTRATE_STATE_ROOT}"
  export UNIVERSAL_PROXY_RUNTIME_PORT="${SUBSTRATE_PROXY_PORT}"
  export UNIVERSAL_PROXY_RUNTIME_BASE_URL="${SUBSTRATE_PROXY_BASE_URL}"
  export UNIVERSAL_PROXY_RUNTIME_DEFAULT_URLS="${SUBSTRATE_PROXY_BASE_URL}"
  export UNIVERSAL_PROXY_RUNTIME_MANAGED_BASE_URLS="${SUBSTRATE_PROXY_BASE_URL}"
  export UNIVERSAL_PROXY_RUNTIME_CONFIG_FILE="${SUBSTRATE_PROXY_CONFIG_FILE}"
  export UNIVERSAL_PROXY_RUNTIME_CONTAINER_ID_FILE="${SUBSTRATE_STATE_ROOT}/proxy.container-id"
  export UNIVERSAL_PROXY_RUNTIME_LOG_FILE="${SUBSTRATE_PROXY_LOG}"
  export UNIVERSAL_PROXY_RUNTIME_CONTAINER_NAME="${SUBSTRATE_UNIVERSAL_PROXY_CONTAINER_NAME:-agentsmith-substrate-${SUBSTRATE}-universal-proxy}"
  export UNIVERSAL_PROXY_RUNTIME_LABEL="substrate-${SUBSTRATE}"
  export UNIVERSAL_PROXY_RUNTIME_LOG_PREFIX="[substrate:${SUBSTRATE}]"
  universal_proxy_runtime_ensure
  SUBSTRATE_PROXY_BASE_URL="${MBOS_UNIVERSAL_PROXY_BASE_URL}"
  MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN="$(universal_proxy_runtime_probe_admin_token 2>/dev/null || true)"
  export MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN
  printf 'ready\n' > "${SUBSTRATE_PROXY_READY_FILE}"
}

substrate_up() {
  run_compose "up -d" postgres mongo redis minio minio-init keycloak
  wait_http "${SUBSTRATE_KEYCLOAK_BASE_URL}/realms/${SUBSTRATE_KEYCLOAK_REALM}/.well-known/openid-configuration" "keycloak" 240
  start_local_proxy
  write_connection_env
  write_status_json
}

substrate_down() {
  UNIVERSAL_PROXY_RUNTIME_ROOT_DIR="${ROOT_DIR}" \
    UNIVERSAL_PROXY_RUNTIME_STATE_DIR="${SUBSTRATE_STATE_ROOT}" \
    UNIVERSAL_PROXY_RUNTIME_CONTAINER_ID_FILE="${SUBSTRATE_STATE_ROOT}/proxy.container-id" \
    UNIVERSAL_PROXY_RUNTIME_LOG_PREFIX="[substrate:${SUBSTRATE}]" \
    universal_proxy_runtime_cleanup_managed_container
  stop_pid_file_if_running "${SUBSTRATE_PROXY_PID_FILE}" "substrate proxy"
  rm -f "${SUBSTRATE_PROXY_READY_FILE}" "${SUBSTRATE_PROXY_CONFIG_FILE}"
  run_compose "down" >/dev/null 2>&1 || true
  write_status_json
}

substrate_reset() {
  [[ "${SUBSTRATE_ALLOW_RESET}" == "1" ]] || die "destructive reset is disabled for substrate ${SUBSTRATE}"
  substrate_down
  run_compose "down -v --remove-orphans" >/dev/null 2>&1 || true
  rm -rf "${SUBSTRATE_STATE_ROOT}"/*
  ensure_substrate_dirs
  write_status_json
}

substrate_status() {
  write_status_json
  local keycloak_base_url="${SUBSTRATE_KEYCLOAK_BASE_URL}"
  local keycloak_realm="${SUBSTRATE_KEYCLOAK_REALM}"
  local proxy_base_url="${SUBSTRATE_PROXY_BASE_URL}"
  local proxy_admin_token="${MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN:-}"
  if [[ -f "${SUBSTRATE_CONNECTION_ENV}" ]]; then
    keycloak_base_url="$(awk -F= '$1=="KEYCLOAK_BASE_URL"{print substr($0, index($0,$2))}' "${SUBSTRATE_CONNECTION_ENV}" | tail -n1)"
    keycloak_realm="$(awk -F= '$1=="KEYCLOAK_REALM"{print substr($0, index($0,$2))}' "${SUBSTRATE_CONNECTION_ENV}" | tail -n1)"
    proxy_base_url="$(awk -F= '$1=="MBOS_UNIVERSAL_PROXY_BASE_URL"{print substr($0, index($0,$2))}' "${SUBSTRATE_CONNECTION_ENV}" | tail -n1)"
    proxy_admin_token="$(awk -F= '$1=="MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN"{print substr($0, index($0,$2))}' "${SUBSTRATE_CONNECTION_ENV}" | tail -n1)"
    keycloak_base_url="${keycloak_base_url:-${SUBSTRATE_KEYCLOAK_BASE_URL}}"
    keycloak_realm="${keycloak_realm:-${SUBSTRATE_KEYCLOAK_REALM}}"
    proxy_base_url="${proxy_base_url:-${SUBSTRATE_PROXY_BASE_URL}}"
    proxy_admin_token="${proxy_admin_token:-${MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN:-}}"
  fi
  local proxy_code="$(universal_proxy_runtime_probe_status "${proxy_base_url}" "${proxy_admin_token}")"
  local keycloak_code="$(curl -sS -o /dev/null -w '%{http_code}' "${keycloak_base_url}/realms/${keycloak_realm}/.well-known/openid-configuration" || true)"
  echo "Substrate: ${SUBSTRATE}"
  echo "Type: ${SUBSTRATE_TYPE}"
  echo "Keycloak: http=${keycloak_code} (${keycloak_base_url})"
  echo "Proxy: http=${proxy_code} (${proxy_base_url})"
  echo "Connection env: ${SUBSTRATE_CONNECTION_ENV}"
}
