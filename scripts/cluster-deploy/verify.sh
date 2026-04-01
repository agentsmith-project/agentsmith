#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
source "${ROOT_DIR}/scripts/lib/preset-common.sh"

load_agentsmith_presets "${ROOT_DIR}"
load_release_env
apply_preset_endpoint_defaults
load_kubeconfig
require_version_images

BACKEND_REAL_ANTHROPIC_BASE_URL="${PRESET_ANTHROPIC_ENDPOINT_BASE_URL:-https://anthropic-compatible.provider.example/v1}"
BACKEND_REAL_OPENAI_BASE_URL="${PRESET_OPENAI_ENDPOINT_BASE_URL:-https://openai-compatible.provider.example/v1}"

PUBLIC_WEB_BASE_URL="${PUBLIC_WEB_BASE_URL:-https://mbos.imotion.ai}"
PUBLIC_API_BASE_URL="${PUBLIC_API_BASE_URL:-https://mbos.imotion.ai/api}"
PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-https://mbos.imotion.ai/keycloak}"
HOST_LOCAL_WEB_BASE_URL="${HOST_LOCAL_WEB_BASE_URL:-http://127.0.0.1:${WEB_PORT:-3001}}"
HOST_LOCAL_API_BASE_URL="${HOST_LOCAL_API_BASE_URL:-http://127.0.0.1:${API_PORT:-20000}}"
HOST_LOCAL_KEYCLOAK_BASE_URL="${HOST_LOCAL_KEYCLOAK_BASE_URL:-http://127.0.0.1:${KEYCLOAK_PORT:-18080}}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
INTEGRATION_DEV_ADMIN_USERNAME="${INTEGRATION_DEV_ADMIN_USERNAME:-dev-admin}"
INTEGRATION_DEV_ADMIN_PASSWORD="${INTEGRATION_DEV_ADMIN_PASSWORD:-dev-admin-123}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-agentsmith-cluster}"
EXTERNAL_RUNNER_CONTAINER_NAME="${EXTERNAL_RUNNER_CONTAINER_NAME:-${COMPOSE_PROJECT_NAME}-external-runner-1}"

wait_http "${HOST_LOCAL_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" 240
wait_tcp "127.0.0.1" "${API_PORT:-20000}" 240
wait_http "${HOST_LOCAL_WEB_BASE_URL}/api/public/workspaces" 240
wait_http "${SANDBOX_MANAGER_PUBLIC_BASE_URL}/readyz" 240

kubectl get deploy sandbox-manager -n "${INTERNAL_AGENT_K8S_NAMESPACE}" >/dev/null
kubectl get cronjob sandbox-manager-cleaner -n "${INTERNAL_AGENT_K8S_NAMESPACE}" >/dev/null
docker inspect -f '{{.State.Running}}' "${EXTERNAL_RUNNER_CONTAINER_NAME}" 2>/dev/null | grep -q true || die "verify failed: external-runner not running"
runner_logs="$(docker logs "${EXTERNAL_RUNNER_CONTAINER_NAME}" 2>&1 || true)"
grep -q '\[agent-codex-runner\] connected' <<<"${runner_logs}" || die "verify failed: external-runner not connected"
docker_compose ps --status running universal-proxy | grep -q universal-proxy || die "verify failed: universal-proxy not running"

mkdir -p "${REPORT_DIR}/verify-artifacts"
docker run --rm \
  --network host \
  --ipc host \
  --privileged \
  --device /dev/fuse \
  --security-opt apparmor:unconfined \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${REPORT_DIR}/verify-artifacts:/app/test-results" \
  -v "${RELEASE_ROOT}/e2e/integration-real-helpers.ts:/app/e2e/integration-real-helpers.ts:ro" \
  -v "${RELEASE_ROOT}/e2e/integration-workspace-entry.spec.ts:/app/e2e/integration-workspace-entry.spec.ts:ro" \
  -v "${RELEASE_ROOT}/e2e/integration-workspace-publish-usable.spec.ts:/app/e2e/integration-workspace-publish-usable.spec.ts:ro" \
  -v "${RELEASE_ROOT}/e2e/integration-preset-external-file-library.spec.ts:/app/e2e/integration-preset-external-file-library.spec.ts:ro" \
  -v "${RELEASE_ROOT}/e2e/integration-release-user-story.spec.ts:/app/e2e/integration-release-user-story.spec.ts:ro" \
  -e BASE_URL="${HOST_LOCAL_WEB_BASE_URL}" \
  -e INTEGRATION_API_BASE="${HOST_LOCAL_API_BASE_URL}" \
  -e EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL="${PUBLIC_API_BASE_URL}" \
  -e EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE="${CLIENT_PUBLIC_POSTGRES_HOST}" \
  -e EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE="${CLIENT_PUBLIC_POSTGRES_PORT}" \
  -e EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="${CLIENT_PUBLIC_MINIO_ENDPOINT}" \
  -e DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE="host.docker.internal" \
  -e DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE="${CLIENT_PUBLIC_POSTGRES_PORT}" \
  -e DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="http://host.docker.internal:${MINIO_API_PORT:-19000}" \
  -e INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE="127.0.0.1" \
  -e INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE="${CLIENT_PUBLIC_POSTGRES_PORT}" \
  -e INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="http://127.0.0.1:${MINIO_API_PORT:-19000}" \
  -e KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
  -e KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
  -e KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
  -e INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES=true \
  -e BACKEND_REAL_API_KEY="${PRESET_ENDPOINT_API_KEY:-}" \
  -e BACKEND_REAL_ANTHROPIC_BASE_URL="${BACKEND_REAL_ANTHROPIC_BASE_URL}" \
  -e BACKEND_REAL_OPENAI_BASE_URL="${BACKEND_REAL_OPENAI_BASE_URL}" \
  -e BACKEND_REAL_MODEL="${PRESET_ENDPOINT_MODEL:-placeholder-model}" \
  -e INTEGRATION_CODEX_RUNNER_DOCKER_IMAGE="${RUNNER_IMAGE}" \
  -e INTEGRATION_INTERNAL_AGENT_IMAGE="${K8S_RUNNER_IMAGE}" \
  -e INTEGRATION_CODEX_RUNNER_EMBEDDED=1 \
  -e INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS_DIR=/etc/codex/skills \
  -e INTEGRATION_RUNNER_LOG_DIR=/app/test-results/runner-logs \
  -e RESET_FIRST=0 \
  "${VERIFY_RUNNER_IMAGE}" \
  npx playwright test \
    --config playwright.config.integration.ts \
    e2e/integration-workspace-entry.spec.ts \
    e2e/integration-workspace-publish-usable.spec.ts \
    e2e/integration-preset-external-file-library.spec.ts \
    e2e/integration-release-user-story.spec.ts \
    --project=chromium \
    --workers=1

state_set release.phase verify_completed
log "verify ok"
