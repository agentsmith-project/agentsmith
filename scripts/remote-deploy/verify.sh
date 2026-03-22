#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "remote-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
  source "${ROOT_DIR}/scripts/remote-deploy/lib/common.sh"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
  source "${ROOT_DIR}/scripts/lib/common.sh"
fi

load_release_env

PUBLIC_WEB_BASE_URL="${PUBLIC_WEB_BASE_URL:-http://localhost:3001}"
PUBLIC_API_BASE_URL="${PUBLIC_API_BASE_URL:-http://localhost:20000}"
PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
INTEGRATION_DEV_ADMIN_USERNAME="${INTEGRATION_DEV_ADMIN_USERNAME:-dev-admin}"
INTEGRATION_DEV_ADMIN_PASSWORD="${INTEGRATION_DEV_ADMIN_PASSWORD:-dev-admin-123}"
RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
VERIFY_RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_verify_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")"

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

wait_http "${PUBLIC_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" 240
wait_tcp "127.0.0.1" "${API_PORT:-20000}" 240
wait_http "${PUBLIC_WEB_BASE_URL}/api/public/workspaces" 240
wait_http "http://localhost:${SANDBOX_HOST_PORT:-29080}/readyz" 240

kubectl get csidriver csi.juicefs.com >/dev/null
kubectl get deploy sandbox-manager -n agentsmith-sandbox >/dev/null
docker_compose ps --status running external-runner | grep -q external-runner || die "preset verify failed: external-runner not running"
docker_compose logs external-runner 2>&1 | grep -q '\[agent-codex-runner\] connected' || die "preset verify failed: external-runner not connected"

token_json="$(
  curl -fsS "${PUBLIC_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
    -H 'content-type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=password' \
    --data-urlencode "client_id=${KEYCLOAK_CLIENT_ID}" \
    --data-urlencode "username=${INTEGRATION_DEV_ADMIN_USERNAME}" \
    --data-urlencode "password=${INTEGRATION_DEV_ADMIN_PASSWORD}" \
    --data-urlencode 'scope=openid profile email'
)"
ACCESS_TOKEN="$(printf '%s' "${token_json}" | json_extract access_token)"
[[ -n "${ACCESS_TOKEN}" ]] || die "failed to obtain dev-admin token during verify"

curl -fsS "${PUBLIC_API_BASE_URL}/api/v1/me/profile" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" >/dev/null \
  || die "public auth chain failed: authenticated /api/v1/me/profile unavailable"

PROJECTS_JSON="$(
  curl -fsS "${PUBLIC_API_BASE_URL}/api/v1/workspaces/ws_default/projects?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
DEMO_PROJECT_ID="$(printf '%s' "${PROJECTS_JSON}" | json_find_named_id "Demo Project")"
[[ -n "${DEMO_PROJECT_ID}" ]] || die "preset verify failed: Demo Project missing in ws_default"

ENDPOINT_COUNT="$(
  curl -fsS "${PUBLIC_API_BASE_URL}/api/v1/workspaces/ws_default/projects/${DEMO_PROJECT_ID}/endpoints?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    | json_count_items_by_field model "glm-5-turbo"
)"
[[ "${ENDPOINT_COUNT}" -ge 2 ]] || die "preset verify failed: expected two glm-5-turbo endpoints"

AGENTS_JSON="$(
  curl -fsS "${PUBLIC_API_BASE_URL}/api/v1/workspaces/ws_default/projects/${DEMO_PROJECT_ID}/agents?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
EXTERNAL_AGENT_COUNT="$(printf '%s' "${AGENTS_JSON}" | json_count_items_by_field mode external)"
INTERNAL_AGENT_COUNT="$(printf '%s' "${AGENTS_JSON}" | json_count_items_by_field mode internal)"
[[ "${EXTERNAL_AGENT_COUNT}" -ge 1 ]] || die "preset verify failed: external agent missing"
[[ "${INTERNAL_AGENT_COUNT}" -ge 1 ]] || die "preset verify failed: internal agent missing"

state_set verify.preset_workspace_id ws_default
state_set verify.preset_project_id "${DEMO_PROJECT_ID}"
state_set verify.preset_endpoint_count "${ENDPOINT_COUNT}"
state_set verify.preset_external_agent_count "${EXTERNAL_AGENT_COUNT}"
state_set verify.preset_internal_agent_count "${INTERNAL_AGENT_COUNT}"
state_set verify.preset_external_runner connected

mkdir -p "${REPORT_DIR}/verify-artifacts"
docker run --rm \
  --network host \
  --privileged \
  --device /dev/fuse \
  --security-opt apparmor:unconfined \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${REPORT_DIR}/verify-artifacts:/app/test-results" \
  -e BASE_URL="${PUBLIC_WEB_BASE_URL}" \
  -e INTEGRATION_API_BASE="${PUBLIC_API_BASE_URL}" \
  -e EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL="${EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL}" \
  -e KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL}" \
  -e KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
  -e KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
  -e INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES=true \
  -e GLM_APIKEY="${GLM_APIKEY:-}" \
  -e CLAUDE_URL="${CLAUDE_URL:-https://open.bigmodel.cn/api/anthropic}" \
  -e OPENAI_URL_CODING_PLAN="${OPENAI_URL_CODING_PLAN:-https://open.bigmodel.cn/api/coding/paas/v4}" \
  -e INTEGRATION_GLM_MODEL="${GLM_MODEL:-glm-5-turbo}" \
  -e INTEGRATION_CODEX_RUNNER_DOCKER_IMAGE="${RUNNER_IMAGE}" \
  -e INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
  -e INTEGRATION_CODEX_RUNNER_EMBEDDED=1 \
  -e INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS_DIR=/opt/agent-runner/builtin-skills \
  -e INTEGRATION_RUNNER_LOG_DIR=/app/test-results/runner-logs \
  -e RESET_FIRST=0 \
  "${VERIFY_RUNNER_IMAGE}" \
  npx playwright test \
    --config playwright.config.integration.ts \
    e2e/integration-workspace-entry.spec.ts \
    e2e/integration-workspace-publish-usable.spec.ts \
    e2e/integration-release-user-story.spec.ts \
    --project=chromium \
    --workers=1

state_set release.phase verify_completed
log "verify ok"
