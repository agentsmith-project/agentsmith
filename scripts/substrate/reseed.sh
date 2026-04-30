#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

if [[ -f "${SUBSTRATE_CONNECTION_ENV}" ]]; then
  existing_proxy_base_url="$(awk -F= '$1=="MBOS_UNIVERSAL_PROXY_BASE_URL"{print substr($0, index($0,$2))}' "${SUBSTRATE_CONNECTION_ENV}" | tail -n1)"
  existing_proxy_admin_token="$(awk -F= '$1=="MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN"{print substr($0, index($0,$2))}' "${SUBSTRATE_CONNECTION_ENV}" | tail -n1)"
  if [[ -n "${existing_proxy_base_url}" ]]; then
    SUBSTRATE_PROXY_BASE_URL="${existing_proxy_base_url}"
  fi
  if [[ -n "${existing_proxy_admin_token}" ]]; then
    MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN="${existing_proxy_admin_token}"
    export MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN
  fi
fi

write_connection_env
set -a
source "${SUBSTRATE_CONNECTION_ENV}"
set +a

(
  cd "${ROOT_DIR}" && \
  DATABASE_URL="${DATABASE_URL}" \
  npm run integration:deps:init:postgres
)
(
  cd "${ROOT_DIR}" && \
  INTERNAL_KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
  PUBLIC_KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
  KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
  KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
  INTEGRATION_WEB_PORT="${INTEGRATION_WEB_PORT}" \
  npm run integration:deps:init:keycloak
)
(
  cd "${ROOT_DIR}" && \
  MINIO_ENDPOINT="${MINIO_ENDPOINT}" \
  MINIO_PORT="${MINIO_PORT}" \
  MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY}" \
  MINIO_SECRET_KEY="${MINIO_SECRET_KEY}" \
  MINIO_BUCKET="${MINIO_BUCKET}" \
  bash scripts/substrate/ensure-minio-bucket.sh
)
(
  cd "${ROOT_DIR}" && \
  MONGO_URL="${MONGO_URL}" \
  MONGO_DB_NAME="${MONGO_DB_NAME}" \
  KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
  KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
  KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
  make ensure-default-workspace
)
(
  cd "${ROOT_DIR}" && \
  POSTGRES_URL="${DATABASE_URL}" \
  MONGO_URL="${MONGO_URL}" \
  REDIS_URL="${REDIS_URL}" \
  MINIO_ENDPOINT="${MINIO_ENDPOINT}" \
  MINIO_PORT="${MINIO_PORT}" \
  MINIO_USE_SSL="${MINIO_USE_SSL}" \
  MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY}" \
  MINIO_SECRET_KEY="${MINIO_SECRET_KEY}" \
  MINIO_BUCKET="${MINIO_BUCKET}" \
  KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
  npm run integration:deps:smoke
)

write_seed_summary
write_status_json
info "reseed complete"
