#!/bin/bash
set -euo pipefail

COMPOSE_FILE="infra/integration/docker-compose.yml"
SQL_DIR="packages/adapters-private/sql"
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

shopt -s nullglob
SQL_FILES=("$SQL_DIR"/*.sql)

if [ ${#SQL_FILES[@]} -eq 0 ]; then
  echo "[integration-db-init] no SQL files found in $SQL_DIR"
  exit 1
fi

for sql_file in "${SQL_FILES[@]}"; do
  echo "[integration-db-init] applying schema from $sql_file"
  docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$sql_file"
done

echo "[integration-db-init] done (${#SQL_FILES[@]} files)"
