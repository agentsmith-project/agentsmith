#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

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
