#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "demo-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
source "${ROOT_DIR}/scripts/lib/common.sh"
source "${ROOT_DIR}/scripts/lib/preset-common.sh"

load_agentsmith_presets "${ROOT_DIR}"
load_release_env
apply_preset_endpoint_defaults
DEMO_DEPLOY_MODE="$(demo_deploy_mode)"

BACKEND_REAL_ANTHROPIC_BASE_URL="${PRESET_ANTHROPIC_ENDPOINT_BASE_URL:-https://anthropic-compatible.provider.example/v1}"
BACKEND_REAL_OPENAI_BASE_URL="${PRESET_OPENAI_ENDPOINT_BASE_URL:-https://openai-compatible.provider.example/v1}"

PUBLIC_WEB_BASE_URL="${PUBLIC_WEB_BASE_URL:-http://localhost:3001}"
PUBLIC_API_BASE_URL="${PUBLIC_API_BASE_URL:-http://localhost:20000}"
PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-http://localhost:18080}"
HOST_LOCAL_WEB_BASE_URL="${HOST_LOCAL_WEB_BASE_URL:-http://127.0.0.1:${WEB_PORT:-3001}}"
HOST_LOCAL_API_BASE_URL="${HOST_LOCAL_API_BASE_URL:-http://127.0.0.1:${API_PORT:-20000}}"
HOST_LOCAL_KEYCLOAK_BASE_URL="${HOST_LOCAL_KEYCLOAK_BASE_URL:-http://127.0.0.1:${KEYCLOAK_PORT:-18080}}"
EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE="${EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE:-${CLIENT_PUBLIC_POSTGRES_HOST:-}}"
EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE_VALUE="${EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE:-${CLIENT_PUBLIC_POSTGRES_PORT:-}}"
EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE="${EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE:-${CLIENT_PUBLIC_MINIO_ENDPOINT:-}}"
DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE="${DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE:-host.docker.internal}"
DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE_VALUE="${DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE:-${CLIENT_PUBLIC_POSTGRES_PORT:-}}"
DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE="${DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE:-http://host.docker.internal:${MINIO_API_PORT:-19000}}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
INTEGRATION_DEV_ADMIN_USERNAME="${INTEGRATION_DEV_ADMIN_USERNAME:-dev-admin}"
INTEGRATION_DEV_ADMIN_PASSWORD="${INTEGRATION_DEV_ADMIN_PASSWORD:-dev-admin-123}"
RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
VERIFY_RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_verify_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
DEMO_COMPOSE_PROJECT_NAME="${DEMO_COMPOSE_PROJECT_NAME:-agentsmith-demo}"
EXTERNAL_RUNNER_CONTAINER_NAME="${EXTERNAL_RUNNER_CONTAINER_NAME:-${DEMO_COMPOSE_PROJECT_NAME}-external-runner-1}"

cleanup_verify_artifacts() {
  mkdir -p "${REPORT_DIR}/verify-artifacts"
  docker run --rm \
    --user 0:0 \
    --entrypoint /bin/sh \
    -v "${REPORT_DIR}/verify-artifacts:/artifacts" \
    minio/mc:latest \
    -lc "chown -R $(id -u):$(id -g) /artifacts || true"
}

trap cleanup_verify_artifacts EXIT

[[ -n "${VERIFY_RUNNER_IMAGE}" ]] || die "verify runner image missing from VERSION"

wait_http "${HOST_LOCAL_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" 240
wait_tcp "127.0.0.1" "${API_PORT:-20000}" 240
wait_http "${HOST_LOCAL_WEB_BASE_URL}/api/public/workspaces" 240
if demo_mode_is_full; then
  wait_http "http://localhost:${SANDBOX_HOST_PORT:-29080}/readyz" 240
  kubectl get csidriver csi.juicefs.com >/dev/null
  kubectl get deploy sandbox-manager -n agentsmith-sandbox >/dev/null
  kubectl get cronjob sandbox-manager-cleaner -n agentsmith-sandbox >/dev/null
fi
docker inspect -f '{{.State.Running}}' "${EXTERNAL_RUNNER_CONTAINER_NAME}" 2>/dev/null | grep -q true || die "preset verify failed: external-runner not running"
docker logs "${EXTERNAL_RUNNER_CONTAINER_NAME}" 2>&1 | grep -q '\[agent-codex-runner\] connected' || die "preset verify failed: external-runner not connected"
docker_compose ps --status running universal-proxy | grep -q universal-proxy || die "preset verify failed: universal-proxy not running"

token_json="$(
  curl -fsS "${HOST_LOCAL_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
    -H 'content-type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=password' \
    --data-urlencode "client_id=${KEYCLOAK_CLIENT_ID}" \
    --data-urlencode "username=${INTEGRATION_DEV_ADMIN_USERNAME}" \
    --data-urlencode "password=${INTEGRATION_DEV_ADMIN_PASSWORD}" \
    --data-urlencode 'scope=openid profile email'
)"
ACCESS_TOKEN="$(printf '%s' "${token_json}" | json_extract access_token)"
[[ -n "${ACCESS_TOKEN}" ]] || die "failed to obtain dev-admin token during verify"

curl -fsS "${HOST_LOCAL_API_BASE_URL}/api/v1/me/profile" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" >/dev/null \
  || die "public auth chain failed: authenticated /api/v1/me/profile unavailable"

PROJECTS_JSON="$(
  curl -fsS "${HOST_LOCAL_API_BASE_URL}/api/v1/workspaces/ws_default/projects?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
PRESET_PROJECT_NAME_VALUE="${PRESET_PROJECT_NAME:-Demo Project}"
PRESET_PROJECT_ID="$(printf '%s' "${PROJECTS_JSON}" | json_find_named_id "${PRESET_PROJECT_NAME_VALUE}")"
[[ -n "${PRESET_PROJECT_ID}" ]] || die "preset verify failed: preset project missing in ws_default"

EXPECTED_MODEL="${PRESET_ENDPOINT_MODEL:-placeholder-model}"
EXPECTED_ANTHROPIC_ENDPOINT_NAME="${PRESET_ANTHROPIC_ENDPOINT_NAME:-preset-anthropic-endpoint}"
EXPECTED_OPENAI_ENDPOINT_NAME="${PRESET_OPENAI_ENDPOINT_NAME:-preset-openai-endpoint}"
ENDPOINT_COUNT="$(
  curl -fsS "${HOST_LOCAL_API_BASE_URL}/api/v1/workspaces/ws_default/projects/${PRESET_PROJECT_ID}/endpoints?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    | json_count_items_by_field model "${EXPECTED_MODEL}"
)"
[[ "${ENDPOINT_COUNT}" -ge 2 ]] || die "preset verify failed: expected two ${EXPECTED_MODEL} endpoints"
ENDPOINT_JSON="$(
  curl -fsS "${HOST_LOCAL_API_BASE_URL}/api/v1/workspaces/ws_default/projects/${PRESET_PROJECT_ID}/endpoints?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
printf '%s' "${ENDPOINT_JSON}" | grep -q "\"name\":\"${EXPECTED_ANTHROPIC_ENDPOINT_NAME}\"" || die "preset verify failed: anthropic endpoint missing"
printf '%s' "${ENDPOINT_JSON}" | grep -q "\"name\":\"${EXPECTED_OPENAI_ENDPOINT_NAME}\"" || die "preset verify failed: openai endpoint missing"

AGENTS_JSON="$(
  curl -fsS "${HOST_LOCAL_API_BASE_URL}/api/v1/workspaces/ws_default/projects/${PRESET_PROJECT_ID}/agents?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
EXTERNAL_AGENT_COUNT="$(printf '%s' "${AGENTS_JSON}" | json_count_items_by_field mode external)"
[[ "${EXTERNAL_AGENT_COUNT}" -ge 1 ]] || die "preset verify failed: external agent missing"
if demo_mode_is_full; then
  INTERNAL_AGENT_COUNT="$(printf '%s' "${AGENTS_JSON}" | json_count_items_by_field mode internal)"
  [[ "${INTERNAL_AGENT_COUNT}" -ge 1 ]] || die "preset verify failed: internal agent missing"
else
  INTERNAL_AGENT_COUNT="0"
fi

state_set verify.preset_workspace_id ws_default
state_set verify.preset_project_id "${PRESET_PROJECT_ID}"
state_set verify.preset_endpoint_count "${ENDPOINT_COUNT}"
state_set verify.preset_external_agent_count "${EXTERNAL_AGENT_COUNT}"
state_set verify.preset_internal_agent_count "${INTERNAL_AGENT_COUNT}"
state_set verify.preset_external_runner connected
state_set verify.mode "${DEMO_DEPLOY_MODE}"

bash "${RELEASE_SCRIPT_DIR}/check-preset-external-file-library.sh"

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
  -v "${RELEASE_ROOT}/e2e/integration-release-user-story.spec.ts:/app/e2e/integration-release-user-story.spec.ts:ro" \
  -e BASE_URL="${HOST_LOCAL_WEB_BASE_URL}" \
  -e INTEGRATION_API_BASE="${HOST_LOCAL_API_BASE_URL}" \
  -e EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL="${EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL}" \
  -e EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE="${EXTERNAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE}" \
  -e EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE="${EXTERNAL_AGENT_JUICEFS_META_PORT_OVERRIDE_VALUE}" \
  -e EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="${EXTERNAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE}" \
  -e DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE="${DOCKER_MANUAL_AGENT_JUICEFS_META_HOST_OVERRIDE_VALUE}" \
  -e DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE="${DOCKER_MANUAL_AGENT_JUICEFS_META_PORT_OVERRIDE_VALUE}" \
  -e DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="${DOCKER_MANUAL_AGENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE_VALUE}" \
  -e INTEGRATION_CLIENT_JUICEFS_META_HOST_OVERRIDE="127.0.0.1" \
  -e INTEGRATION_CLIENT_JUICEFS_META_PORT_OVERRIDE="${CLIENT_PUBLIC_POSTGRES_PORT:-15432}" \
  -e INTEGRATION_CLIENT_JUICEFS_STORAGE_ENDPOINT_OVERRIDE="http://127.0.0.1:${MINIO_API_PORT:-19000}" \
  -e KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
  -e KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
  -e KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
  -e INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES=true \
  -e BACKEND_REAL_API_KEY="${PRESET_ENDPOINT_API_KEY:-}" \
  -e BACKEND_REAL_ANTHROPIC_BASE_URL="${BACKEND_REAL_ANTHROPIC_BASE_URL}" \
  -e BACKEND_REAL_OPENAI_BASE_URL="${BACKEND_REAL_OPENAI_BASE_URL}" \
  -e BACKEND_REAL_MODEL="${PRESET_ENDPOINT_MODEL:-placeholder-model}" \
  -e INTEGRATION_DEMO_DEPLOY_MODE="${DEMO_DEPLOY_MODE}" \
  -e INTEGRATION_CODEX_RUNNER_DOCKER_IMAGE="${RUNNER_IMAGE}" \
  -e INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
  -e INTEGRATION_CODEX_RUNNER_EMBEDDED=1 \
  -e INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS_DIR=/etc/codex/skills \
  -e INTEGRATION_CODEX_RUNNER_MOUNT_READY_TIMEOUT_MS="${MBOS_AGENT_JUICEFS_MOUNT_READY_TIMEOUT_MS:-120000}" \
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
