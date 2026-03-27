#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_local_manual_env

wait_port_free "${PORT_WEB}" "web" 30
launch_detached "${WEB_PID_FILE}" "${WEB_LOG}" "
  cd '${ROOT_DIR}' && \
  export NEXT_PUBLIC_USE_MSW=false \
    NEXT_PUBLIC_API_BASE='http://localhost:${PORT_API}/api/v1' \
    NEXT_PUBLIC_KEYCLOAK_URL='${KEYCLOAK_URL}' \
    NEXT_PUBLIC_KEYCLOAK_REALM='${KEYCLOAK_REALM}' \
    NEXT_PUBLIC_KEYCLOAK_CLIENT_ID='${KEYCLOAK_CLIENT_ID}' \
    KEYCLOAK_BASE_URL='${KEYCLOAK_BASE_URL}' \
    PUBLIC_KEYCLOAK_BASE_URL='${PUBLIC_KEYCLOAK_BASE_URL}' \
    INTERNAL_KEYCLOAK_BASE_URL='${INTERNAL_KEYCLOAK_BASE_URL}' \
    MONGO_URL='${MONGO_URL}' \
    MONGO_DB_NAME='${MONGO_DB_NAME}' \
    NEXT_DEV_PID_FILE='${WEB_PID_FILE}' \
    NEXT_DEV_PORT_FILE='${WEB_PORT_FILE}' \
    NEXT_DEV_PORT='${PORT_WEB}' && \
  exec npm run dev:test -- --port '${PORT_WEB}'
"
wait_http "http://localhost:${PORT_WEB}/${LOCALE}/login/workspace" "web" 180
wait_http "http://localhost:${PORT_WEB}/api/public/workspaces" "public workspaces" 60
write_ready_file "${WEB_READY_FILE}"
