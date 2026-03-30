#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_local_manual_env

bash "${ROOT_DIR}/scripts/local-manual/down.sh"
remove_local_manual_runtime_files
reset_local_manual_state

run_local_manual_support_services_prepare

info "ensuring default workspace"
(
  cd "${ROOT_DIR}" && \
  MONGO_URL="${MONGO_URL}" \
  MONGO_DB_NAME="${MONGO_DB_NAME}" \
  KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
  KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
  KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
  make ensure-default-workspace
)

bash "${ROOT_DIR}/scripts/local-manual/start-proxy.sh"
bash "${ROOT_DIR}/scripts/local-manual/start-api.sh"
bash "${ROOT_DIR}/scripts/local-manual/start-web.sh"
bash "${ROOT_DIR}/scripts/local-manual/verify.sh"

info "ready"
info "Web: http://localhost:${PORT_WEB}/${LOCALE}/login/workspace"
info "API: http://localhost:${PORT_API}"
info "Keycloak: ${KEYCLOAK_BASE_URL}"
info "Proxy: ${MBOS_UNIVERSAL_PROXY_BASE_URL}"
info "Next step for notebook manual testing: make local-manual-seed-notebook"
