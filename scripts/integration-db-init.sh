#!/bin/bash
set -euo pipefail

COMPOSE_FILE="infra/integration/docker-compose.yml"
SQL_FILE="packages/adapters-private/sql/projects.sql"
POSTGRES_USER="${POSTGRES_USER:-mbos}"
POSTGRES_DB="${POSTGRES_DB:-mbos}"

if ! docker compose -f "$COMPOSE_FILE" ps postgres >/dev/null 2>&1; then
  echo "[integration-db-init] postgres service not found. Start deps first."
  exit 1
fi

if ! docker compose -f "$COMPOSE_FILE" ps --status running postgres | grep -q postgres; then
  echo "[integration-db-init] postgres is not running. Start deps first."
  exit 1
fi

echo "[integration-db-init] applying schema from $SQL_FILE"
docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$SQL_FILE"
echo "[integration-db-init] done"
