#!/usr/bin/env bash
set -euo pipefail

MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
MINIO_PORT="${MINIO_PORT:-19000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"

for _ in $(seq 1 15); do
  if docker run --rm --network host --entrypoint /bin/sh minio/mc:latest -lc \
    "mc alias set local http://${MINIO_ENDPOINT}:${MINIO_PORT} ${MINIO_ACCESS_KEY} ${MINIO_SECRET_KEY} >/dev/null && mc mb --ignore-existing local/${MINIO_BUCKET} >/dev/null && mc anonymous set private local/${MINIO_BUCKET} >/dev/null"; then
    echo "[substrate] minio bucket ready: ${MINIO_BUCKET}"
    exit 0
  fi
  sleep 2
 done

echo "[substrate] ERROR: unable to ensure minio bucket ${MINIO_BUCKET}" >&2
exit 1
