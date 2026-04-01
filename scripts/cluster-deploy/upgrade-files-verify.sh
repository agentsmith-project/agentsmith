#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

ensure_dirs
ensure_operator_site_env
ensure_operator_kubeconfig
set -a
source "${RELEASE_ROOT}/env/site.env"
set +a
bash "${ROOT_DIR}/scripts/cluster-deploy/render-env.sh"
load_release_env
load_kubeconfig

bash "${ROOT_DIR}/scripts/cluster-deploy/upgrade-status.sh"

API_BASE="${HOST_LOCAL_API_BASE_URL:-http://127.0.0.1:${API_PORT:-20000}}" \
KEYCLOAK_BASE_URL="${HOST_LOCAL_KEYCLOAK_BASE_URL:-http://127.0.0.1:${KEYCLOAK_PORT:-18080}}" \
PUBLIC_WEB_BASE_URL="${PUBLIC_WEB_BASE_URL:-}" \
CLIENT_PUBLIC_POSTGRES_HOST="${CLIENT_PUBLIC_POSTGRES_HOST:-}" \
CLIENT_PUBLIC_POSTGRES_PORT="${CLIENT_PUBLIC_POSTGRES_PORT:-}" \
CLIENT_PUBLIC_MINIO_ENDPOINT="${CLIENT_PUBLIC_MINIO_ENDPOINT:-}" \
HOST_LOCAL_POSTGRES_HOST="${HOST_LOCAL_POSTGRES_HOST:-127.0.0.1}" \
HOST_LOCAL_MINIO_ENDPOINT="${HOST_LOCAL_MINIO_ENDPOINT:-http://127.0.0.1:${MINIO_API_PORT:-19000}}" \
FILE_LIBRARY_VERIFY_ENFORCE_DEPLOY_CLIENT_TRUTH=1 \
bash "${ROOT_DIR}/scripts/file-library-real-smoke.sh"

mkdir -p "${REPORT_DIR}/verify-artifacts"
docker run --rm \
  --network host \
  -v "${REPORT_DIR}/verify-artifacts:/app/test-results" \
  -v "${RELEASE_ROOT}/e2e/integration-files.spec.ts:/app/e2e/integration-files.spec.ts:ro" \
  -v "${RELEASE_ROOT}/e2e/integration-workspace-access.ts:/app/e2e/integration-workspace-access.ts:ro" \
  -e BASE_URL="${HOST_LOCAL_WEB_BASE_URL:-http://127.0.0.1:${WEB_PORT:-3001}}" \
  -e INTEGRATION_API_BASE="${HOST_LOCAL_API_BASE_URL:-http://127.0.0.1:${API_PORT:-20000}}" \
  -e KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
  -e KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}" \
  -e KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}" \
  -e INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES=true \
  -e INTEGRATION_KEYCLOAK_USERNAME="${INTEGRATION_DEV_ADMIN_USERNAME:-dev-admin}" \
  -e INTEGRATION_KEYCLOAK_PASSWORD="${INTEGRATION_DEV_ADMIN_PASSWORD:-dev-admin-123}" \
  "${VERIFY_RUNNER_IMAGE}" \
  npx playwright test \
    --config playwright.config.integration.ts \
    e2e/integration-files.spec.ts \
    --project=chromium \
    --workers=1

state_set release.phase upgrade_files_verified
log "upgrade-files-verify ok"
