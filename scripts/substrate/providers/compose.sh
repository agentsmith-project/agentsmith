#!/usr/bin/env bash
set -euo pipefail

compose_env_args() {
  cat <<EOF_VARS
COMPOSE_PROJECT_NAME=${SUBSTRATE_COMPOSE_PROJECT_NAME}
POSTGRES_PORT=${SUBSTRATE_POSTGRES_PORT}
MONGO_PORT=${SUBSTRATE_MONGO_PORT}
REDIS_PORT=${SUBSTRATE_REDIS_PORT}
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
  wait_port_free "${SUBSTRATE_PROXY_PORT}" "substrate proxy" 30
  if [[ ! -x "${PROXY_ROOT}/target/debug/llm-universal-proxy" ]]; then
    info "building llm-universal-proxy debug binary"
    (cd "${PROXY_ROOT}" && cargo build --quiet)
  fi
  cat > "${SUBSTRATE_PROXY_CONFIG_FILE}" <<EOF_PROXY
listen: 127.0.0.1:${SUBSTRATE_PROXY_PORT}
upstream_timeout_secs: 120
upstreams: {}
model_aliases: {}
EOF_PROXY
  launch_detached "${SUBSTRATE_PROXY_PID_FILE}" "${SUBSTRATE_PROXY_LOG}" "
    cd '${PROXY_ROOT}' && \
    exec ./target/debug/llm-universal-proxy --config '${SUBSTRATE_PROXY_CONFIG_FILE}'
  "
  wait_http "${SUBSTRATE_PROXY_BASE_URL}/admin/state" "substrate proxy" 60
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
  local proxy_code="$(curl -sS -o /dev/null -w '%{http_code}' "${SUBSTRATE_PROXY_BASE_URL}/admin/state" || true)"
  local keycloak_code="$(curl -sS -o /dev/null -w '%{http_code}' "${SUBSTRATE_KEYCLOAK_BASE_URL}/realms/${SUBSTRATE_KEYCLOAK_REALM}/.well-known/openid-configuration" || true)"
  echo "Substrate: ${SUBSTRATE}"
  echo "Type: ${SUBSTRATE_TYPE}"
  echo "Keycloak: http=${keycloak_code}"
  echo "Proxy: http=${proxy_code}"
  echo "Connection env: ${SUBSTRATE_CONNECTION_ENV}"
}
