#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_dev_real_env

bash "${ROOT_DIR}/scripts/dev-real/down.sh"
remove_dev_real_runtime_files
reset_dev_real_state

info "starting local dependencies"
(cd "${ROOT_DIR}" && make deps-up && make deps-ready && make deps-init)

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

bash "${ROOT_DIR}/scripts/dev-real/start-proxy.sh"
bash "${ROOT_DIR}/scripts/dev-real/start-api.sh"
bash "${ROOT_DIR}/scripts/dev-real/start-web.sh"
bash "${ROOT_DIR}/scripts/dev-real/verify.sh"

info "ready"
info "Web: http://localhost:${PORT_WEB}/${LOCALE}/login/workspace"
info "API: http://localhost:${PORT_API}"
info "Keycloak: ${KEYCLOAK_BASE_URL}"
info "Proxy: ${MBOS_UNIVERSAL_PROXY_BASE_URL}"
info "Next step for notebook manual testing: make dev-real-seed-notebook"
