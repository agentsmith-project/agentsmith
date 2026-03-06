#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${SSH_HOST:-mbos@mbos.imotion.ai}"
PG_CONTAINER="${PG_CONTAINER:-agentsmith-postgres}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-postgres}"
PGVECTOR_PKG="${PGVECTOR_PKG:-postgresql-17-pgvector}"

info() { echo "[preprod-pgvector] $*"; }
err() { echo "[preprod-pgvector] ERROR: $*" >&2; }

info "host=${SSH_HOST}"
info "postgres_container=${PG_CONTAINER}"
info "package=${PGVECTOR_PKG}"

ssh "${SSH_HOST}" "bash -s" <<EOF
set -euo pipefail

if ! docker ps --format '{{.Names}}' | grep -qx '${PG_CONTAINER}'; then
  echo '[preprod-pgvector] ERROR: postgres container not running: ${PG_CONTAINER}' >&2
  exit 1
fi

echo '[preprod-pgvector] installing package (${PGVECTOR_PKG})'
docker exec '${PG_CONTAINER}' bash -lc 'DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${PGVECTOR_PKG} >/dev/null'

echo '[preprod-pgvector] creating extension if missing'
docker exec '${PG_CONTAINER}' psql -U '${PG_USER}' -d '${PG_DB}' -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

echo '[preprod-pgvector] verifying extension'
docker exec '${PG_CONTAINER}' psql -U '${PG_USER}' -d '${PG_DB}' -c "select extname, extversion from pg_extension where extname='vector';"
EOF

info "done"
