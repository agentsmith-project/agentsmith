#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
load_backend_real_env

API_PORT="${FILE_LIBRARY_GATE_API_PORT:-21010}"
API_LOG="${FILE_LIBRARY_GATE_API_LOG:-/tmp/agentsmith-file-library-gate-api.log}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-${INTEGRATION_KEYCLOAK_PORT:-28081}}"
clear_runtime_stack_env
resolve_loopback_runtime_stack "${API_PORT}" "${WEB_PORT:-3001}" "${KEYCLOAK_PORT}" "${KEYCLOAK_REALM}" "${KEYCLOAK_CLIENT_ID}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-${KEYCLOAK_URL:-${RUNTIME_HOST_KEYCLOAK_BASE_URL}}}"
PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-${RUNTIME_BROWSER_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}}"
INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL:-${RUNTIME_HOST_KEYCLOAK_BASE_URL:-${KEYCLOAK_BASE_URL}}}"
KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL:-${PUBLIC_KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}}"
DATABASE_URL="${DATABASE_URL:-postgresql://mbos:mbos_dev_password@localhost:${INTEGRATION_POSTGRES_PORT:-25432}/mbos}"
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:${INTEGRATION_MONGO_PORT:-27027}/admin}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-localhost}"
MINIO_PORT="${MINIO_PORT:-${INTEGRATION_MINIO_API_PORT:-29000}}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-mbos}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-mbos_dev_password}"
MINIO_BUCKET="${MINIO_BUCKET:-mbos-dev}"
API_BASE="http://localhost:${API_PORT}"

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

PORT="${API_PORT}" \
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL}" \
DATABASE_URL="${DATABASE_URL}" \
MONGO_URL="${MONGO_URL}" \
MINIO_ENDPOINT="${MINIO_ENDPOINT}" \
MINIO_PORT="${MINIO_PORT}" \
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY}" \
MINIO_SECRET_KEY="${MINIO_SECRET_KEY}" \
MINIO_BUCKET="${MINIO_BUCKET}" \
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
npm run api:node:dev >"${API_LOG}" 2>&1 &
API_PID=$!

cleanup() {
  kill "${API_PID}" >/dev/null 2>&1 || true
  wait "${API_PID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

ready=0
for _ in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/public/workspaces" || true)"
  if [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" ]]; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "${ready}" -ne 1 ]]; then
  echo "File library gate API did not become ready in time (last status: ${code:-n/a})." >&2
  echo "API log: ${API_LOG}" >&2
  exit 1
fi

API_BASE="${API_BASE}" \
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL}" \
INTEGRATION_KEYCLOAK_PORT="${KEYCLOAK_PORT}" \
bash "${ROOT_DIR}/scripts/file-library-real-smoke.sh"
API_BASE="${API_BASE}" \
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL}" \
KEYCLOAK_ISSUER_URL="${KEYCLOAK_ISSUER_URL}" \
INTEGRATION_KEYCLOAK_PORT="${KEYCLOAK_PORT}" \
bash "${ROOT_DIR}/scripts/file-library-mount-sync-smoke.sh"
