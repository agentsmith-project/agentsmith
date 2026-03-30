#!/bin/bash
set -euo pipefail

COMPOSE_FILE="infra/integration/docker-compose.yml"
SQL_DIR="packages/adapters-private/sql"
POSTGRES_USER="${POSTGRES_USER:-mbos}"
POSTGRES_DB="${POSTGRES_DB:-mbos}"
POSTGRES_PORT="${POSTGRES_PORT:-15432}"
INTEGRATION_POSTGRES_CONTAINER="${INTEGRATION_POSTGRES_CONTAINER:-}"

apply_sql_via_compose() {
  local sql_file="$1"
  docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$sql_file"
}

apply_sql_via_container() {
  local container="$1"
  local sql_file="$2"
  docker exec -i "$container" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$sql_file"
}

if docker compose -f "$COMPOSE_FILE" ps postgres >/dev/null 2>&1   && docker compose -f "$COMPOSE_FILE" ps --status running postgres | grep -q postgres; then
  POSTGRES_INIT_MODE="compose"
elif [[ -n "$INTEGRATION_POSTGRES_CONTAINER" ]]; then
  POSTGRES_INIT_MODE="container"
else
  INTEGRATION_POSTGRES_CONTAINER="$({ docker ps --format '{{.Names}}	{{.Ports}}' || true; } | awk -F '	' -v port=":${POSTGRES_PORT}->5432/tcp" '$2 ~ port { print $1; exit }')"
  if [[ -n "$INTEGRATION_POSTGRES_CONTAINER" ]]; then
    POSTGRES_INIT_MODE="container"
  else
    echo "[integration-db-init] postgres service not found. Start deps first."
    exit 1
  fi
fi

shopt -s nullglob
SQL_FILES=("$SQL_DIR"/*.sql)

if [ ${#SQL_FILES[@]} -eq 0 ]; then
  echo "[integration-db-init] no SQL files found in $SQL_DIR"
  exit 1
fi

for sql_file in "${SQL_FILES[@]}"; do
  echo "[integration-db-init] applying schema from $sql_file"
  if [[ "$POSTGRES_INIT_MODE" == "compose" ]]; then
    apply_sql_via_compose "$sql_file"
  else
    apply_sql_via_container "$INTEGRATION_POSTGRES_CONTAINER" "$sql_file"
  fi
done

echo "[integration-db-init] done (${#SQL_FILES[@]} files)"
