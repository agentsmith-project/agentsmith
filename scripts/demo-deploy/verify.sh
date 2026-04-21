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
source "${ROOT_DIR}/scripts/lib/release-story-verify-source-set.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"

load_agentsmith_presets "${ROOT_DIR}"
load_release_env
apply_non_environment_preset_defaults
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
CHAT_RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_chat_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
VERIFY_RUNNER_IMAGE="$(awk -F= '$1=="agentsmith_verify_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")"
DEMO_COMPOSE_PROJECT_NAME="${DEMO_COMPOSE_PROJECT_NAME:-agentsmith-demo}"
EXTERNAL_RUNNER_CONTAINER_NAME="${EXTERNAL_RUNNER_CONTAINER_NAME:-${DEMO_COMPOSE_PROJECT_NAME}-external-runner-1}"
VERIFY_EVIDENCE_DIR="${REPORT_DIR}/verify-artifacts/evidence"
mkdir -p "${VERIFY_EVIDENCE_DIR}"
export RUNTIME_LINE_ID="${RELEASE_ID}"
export RUNTIME_RUNNER_MODES="${RUNTIME_RUNNER_MODES:-external_host,$([[ "${DEMO_DEPLOY_MODE}" == "full" ]] && printf 'internal_k8s' || printf 'external_host')}"
resolve_public_runtime_stack \
  "${PUBLIC_WEB_BASE_URL}" \
  "${PUBLIC_API_BASE_URL}" \
  "${PUBLIC_KEYCLOAK_BASE_URL}" \
  "${HOST_LOCAL_WEB_BASE_URL}" \
  "${HOST_LOCAL_API_BASE_URL}" \
  "${HOST_LOCAL_KEYCLOAK_BASE_URL}" \
  "${KEYCLOAK_REALM}" \
  "${KEYCLOAK_CLIENT_ID}"
gate_evidence_init "${VERIFY_EVIDENCE_DIR}" "demo_deploy_verify"
gate_write_runtime_descriptor "${VERIFY_EVIDENCE_DIR}" "demo_deploy_verify"
gate_write_resolved_env "${VERIFY_EVIDENCE_DIR}"

record_service() {
  local service_name="$1"
  local status="$2"
  local detail="${3:-}"
  gate_record_service_status "${VERIFY_EVIDENCE_DIR}" "${service_name}" "${status}" "${detail}"
}

record_task_summary() {
  local summary_json="$1"
  gate_record_task_summary "${VERIFY_EVIDENCE_DIR}" "${summary_json}"
}

resolve_verify_source_file() {
  local relative_path="$1"
  gate_resolve_verify_source_file \
    "${VERIFY_EVIDENCE_DIR}" \
    "demo-deploy" \
    "${RELEASE_ROOT}" \
    "${ROOT_DIR}" \
    "${relative_path}"
}

RELEASE_STORY_VERIFY_MOUNTS=()

prepare_release_story_verify_mounts() {
  RELEASE_STORY_VERIFY_MOUNTS=()
  local relative_path
  local source_path

  while IFS= read -r relative_path; do
    [[ -n "${relative_path}" ]] || continue
    source_path="$(resolve_verify_source_file "${relative_path}")" || return 1
    RELEASE_STORY_VERIFY_MOUNTS+=(-v "${source_path}:/app/${relative_path}:ro")
  done < <(release_story_verify_source_set "${RELEASE_ROOT}")
}




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
if demo_mode_is_full; then
  [[ -n "${CHAT_RUNNER_IMAGE}" ]] || die "chat runner image missing from VERSION"
fi

gate_wait_for_http "${VERIFY_EVIDENCE_DIR}" "${HOST_LOCAL_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" 240 infra_dependency_unready infra_preflight_keycloak
record_service keycloak ready "${HOST_LOCAL_KEYCLOAK_BASE_URL}"
gate_wait_for_tcp "${VERIFY_EVIDENCE_DIR}" "127.0.0.1" "${API_PORT:-20000}" 240 infra_dependency_unready infra_preflight_api_port
record_service api_port ready "127.0.0.1:${API_PORT:-20000}"
gate_wait_for_http "${VERIFY_EVIDENCE_DIR}" "${HOST_LOCAL_WEB_BASE_URL}/api/public/workspaces" 240 infra_dependency_unready infra_preflight_web
record_service web ready "${HOST_LOCAL_WEB_BASE_URL}"
gate_record_preflight_check "${VERIFY_EVIDENCE_DIR}" "host_local_stack" "passed" "web/api/keycloak ready"
if demo_mode_is_full; then
  gate_wait_for_http "${VERIFY_EVIDENCE_DIR}" "http://localhost:${SANDBOX_HOST_PORT:-29180}/readyz" 240 sandbox_startup_failed infra_preflight_sandbox
  record_service sandbox_manager ready "http://localhost:${SANDBOX_HOST_PORT:-29180}/readyz"
  gate_require_command "${VERIFY_EVIDENCE_DIR}" "kubectl get csidriver csi.juicefs.com >/dev/null" sandbox_startup_failed infra_preflight_csi "csi.juicefs.com missing"
  gate_require_command "${VERIFY_EVIDENCE_DIR}" "kubectl get deploy sandbox-manager -n agentsmith-sandbox >/dev/null" sandbox_startup_failed infra_preflight_sandbox "sandbox-manager deploy missing"
  gate_require_command "${VERIFY_EVIDENCE_DIR}" "kubectl get cronjob sandbox-manager-cleaner -n agentsmith-sandbox >/dev/null" sandbox_startup_failed infra_preflight_sandbox "sandbox-manager-cleaner missing"
  gate_record_preflight_check "${VERIFY_EVIDENCE_DIR}" "internal_control_plane" "passed" "sandbox manager and csi ready"
fi
gate_require_command "${VERIFY_EVIDENCE_DIR}" "docker inspect -f '{{.State.Running}}' '${EXTERNAL_RUNNER_CONTAINER_NAME}' 2>/dev/null | grep -q true" runner_launch_failed infra_preflight_external_runner "external-runner not running"
if ! gate_wait_for_external_runner_connection "${VERIFY_EVIDENCE_DIR}" "${EXTERNAL_RUNNER_CONTAINER_NAME}" 60; then
  exit 1
fi
PROXY_ADMIN_STATE_BASE_URL="${MBOS_UNIVERSAL_PROXY_BASE_URL:-http://universal-proxy:8080}"
if ! gate_wait_for_universal_proxy_admin_state \
  "${VERIFY_EVIDENCE_DIR}" \
  "${PROXY_ADMIN_STATE_BASE_URL}" \
  "${MBOS_UNIVERSAL_PROXY_ADMIN_TOKEN:-}" \
  60 \
  infra_dependency_unready \
  infra_preflight_proxy; then
  exit 1
fi
record_service external_runner ready "${EXTERNAL_RUNNER_CONTAINER_NAME}"
record_service universal_proxy ready "${PROXY_ADMIN_STATE_BASE_URL%/}/admin/state"
gate_record_preflight_check "${VERIFY_EVIDENCE_DIR}" "external_runner" "passed" "${EXTERNAL_RUNNER_CONTAINER_NAME}"
gate_record_preflight_check "${VERIFY_EVIDENCE_DIR}" "universal_proxy" "passed" "${PROXY_ADMIN_STATE_BASE_URL%/}/admin/state"

ACCESS_TOKEN="$(gate_run_auth_preflight   "${VERIFY_EVIDENCE_DIR}"   "${HOST_LOCAL_KEYCLOAK_BASE_URL}"   "${KEYCLOAK_REALM}"   "${KEYCLOAK_CLIENT_ID}"   "${INTEGRATION_DEV_ADMIN_USERNAME}"   "${INTEGRATION_DEV_ADMIN_PASSWORD}"   "${HOST_LOCAL_API_BASE_URL}/api/v1/me/profile"   "failed to obtain dev-admin token during verify"   "verify token missing access_token"   "authenticated /api/v1/me/profile unavailable")" || exit 1
record_service auth ready "dev-admin token bootstrap"

PROJECTS_JSON="$(
  curl -fsS "${HOST_LOCAL_API_BASE_URL}/api/v1/workspaces/ws_default/projects?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
PRESET_PROJECT_NAME_VALUE="${PRESET_PROJECT_NAME:-Demo Project}"
PRESET_PROJECT_ID="$(printf '%s' "${PROJECTS_JSON}" | json_find_named_id "${PRESET_PROJECT_NAME_VALUE}")"
if [[ -z "${PRESET_PROJECT_ID}" ]]; then
  gate_record_failure "${VERIFY_EVIDENCE_DIR}" "scenario_assertion_failed" "scenario_gate_preset_project" "preset project missing in ws_default"
  exit 1
fi

EXPECTED_MODEL="${PRESET_ENDPOINT_MODEL:-placeholder-model}"
EXPECTED_ANTHROPIC_ENDPOINT_NAME="${PRESET_ANTHROPIC_ENDPOINT_NAME:-preset-anthropic-endpoint}"
EXPECTED_OPENAI_ENDPOINT_NAME="${PRESET_OPENAI_ENDPOINT_NAME:-preset-openai-endpoint}"
ENDPOINT_COUNT="$(
  curl -fsS "${HOST_LOCAL_API_BASE_URL}/api/v1/workspaces/ws_default/projects/${PRESET_PROJECT_ID}/endpoints?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    | json_count_items_by_field model "${EXPECTED_MODEL}"
)"
if [[ "${ENDPOINT_COUNT}" -lt 2 ]]; then
  gate_record_failure "${VERIFY_EVIDENCE_DIR}" "scenario_assertion_failed" "scenario_gate_endpoints" "expected two ${EXPECTED_MODEL} endpoints"
  exit 1
fi
ENDPOINT_JSON="$(
  curl -fsS "${HOST_LOCAL_API_BASE_URL}/api/v1/workspaces/ws_default/projects/${PRESET_PROJECT_ID}/endpoints?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
EXPECTED_ANTHROPIC_ENDPOINT_ID="$(printf '%s' "${ENDPOINT_JSON}" | json_find_named_id "${EXPECTED_ANTHROPIC_ENDPOINT_NAME}")"
if [[ -z "${EXPECTED_ANTHROPIC_ENDPOINT_ID}" ]]; then
  gate_record_failure "${VERIFY_EVIDENCE_DIR}" "scenario_assertion_failed" "scenario_gate_endpoints" "anthropic endpoint missing"
  exit 1
fi
EXPECTED_OPENAI_ENDPOINT_ID="$(printf '%s' "${ENDPOINT_JSON}" | json_find_named_id "${EXPECTED_OPENAI_ENDPOINT_NAME}")"
if [[ -z "${EXPECTED_OPENAI_ENDPOINT_ID}" ]]; then
  gate_record_failure "${VERIFY_EVIDENCE_DIR}" "scenario_assertion_failed" "scenario_gate_endpoints" "openai endpoint missing"
  exit 1
fi

AGENTS_JSON="$(
  curl -fsS "${HOST_LOCAL_API_BASE_URL}/api/v1/workspaces/ws_default/projects/${PRESET_PROJECT_ID}/agents?page=1&page_size=100" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}"
)"
EXTERNAL_AGENT_COUNT="$(printf '%s' "${AGENTS_JSON}" | json_count_items_by_field mode external)"
if [[ "${EXTERNAL_AGENT_COUNT}" -lt 1 ]]; then
  gate_record_failure "${VERIFY_EVIDENCE_DIR}" "scenario_assertion_failed" "scenario_gate_agents" "external agent missing"
  exit 1
fi
if demo_mode_is_full; then
  INTERNAL_AGENT_COUNT="$(printf '%s' "${AGENTS_JSON}" | json_count_items_by_field mode internal)"
  if [[ "${INTERNAL_AGENT_COUNT}" -lt 1 ]]; then
    gate_record_failure "${VERIFY_EVIDENCE_DIR}" "scenario_assertion_failed" "scenario_gate_agents" "internal agent missing"
    exit 1
  fi
else
  INTERNAL_AGENT_COUNT="0"
fi
record_task_summary "{\"workspace_id\":\"ws_default\",\"project_id\":\"${PRESET_PROJECT_ID}\",\"line_kind\":\"demo_deploy_verify\",\"external_agent_count\":\"${EXTERNAL_AGENT_COUNT}\",\"internal_agent_count\":\"${INTERNAL_AGENT_COUNT}\"}"

state_set verify.preset_workspace_id ws_default
state_set verify.preset_project_id "${PRESET_PROJECT_ID}"
state_set verify.preset_endpoint_count "${ENDPOINT_COUNT}"
state_set verify.preset_external_agent_count "${EXTERNAL_AGENT_COUNT}"
state_set verify.preset_internal_agent_count "${INTERNAL_AGENT_COUNT}"
state_set verify.preset_external_runner connected
state_set verify.mode "${DEMO_DEPLOY_MODE}"

WORKSPACE_ACCESS_EVIDENCE_FILE="${VERIFY_EVIDENCE_DIR}/workspace-access-external.json" \
bash "${RELEASE_SCRIPT_DIR}/check-preset-external-file-library.sh" || {
  gate_record_failure "${VERIFY_EVIDENCE_DIR}" "workspace_contract_failed" "scenario_gate_workspace_access" "preset external file-library verification failed"
  exit 1
}
if [[ -f "${VERIFY_EVIDENCE_DIR}/workspace-access-external.json" ]]; then
  gate_record_workspace_access "${VERIFY_EVIDENCE_DIR}" "external" "${VERIFY_EVIDENCE_DIR}/workspace-access-external.json"
fi

API_BASE="${HOST_LOCAL_API_BASE_URL}" \
KEYCLOAK_BASE_URL="${HOST_LOCAL_KEYCLOAK_BASE_URL}" \
PUBLIC_WEB_BASE_URL="${PUBLIC_WEB_BASE_URL}" \
CLIENT_PUBLIC_POSTGRES_HOST="${CLIENT_PUBLIC_POSTGRES_HOST:-}" \
CLIENT_PUBLIC_POSTGRES_PORT="${CLIENT_PUBLIC_POSTGRES_PORT:-}" \
CLIENT_PUBLIC_MINIO_ENDPOINT="${CLIENT_PUBLIC_MINIO_ENDPOINT:-}" \
HOST_LOCAL_POSTGRES_HOST="${HOST_LOCAL_POSTGRES_HOST:-localhost}" \
HOST_LOCAL_MINIO_ENDPOINT="${HOST_LOCAL_MINIO_ENDPOINT:-http://localhost:${MINIO_API_PORT:-19000}}" \
EXTERNAL_DEPS_POSTGRES_IP="${EXTERNAL_DEPS_POSTGRES_IP:-}" \
EXTERNAL_DEPS_MINIO_IP="${EXTERNAL_DEPS_MINIO_IP:-}" \
PROJECT_ID="${PRESET_PROJECT_ID}" \
FILE_LIBRARY_VERIFY_ENFORCE_DEPLOY_CLIENT_TRUTH=1 \
bash "${ROOT_DIR}/scripts/file-library-real-smoke.sh" || {
  gate_record_failure "${VERIFY_EVIDENCE_DIR}" "workspace_contract_failed" "scenario_gate_file_library" "file-library-real-smoke failed"
  exit 1
}

mkdir -p "${REPORT_DIR}/verify-artifacts"
VERIFY_INTEGRATION_REAL_HELPERS="$(resolve_verify_source_file "e2e/integration-real-helpers.ts")"
VERIFY_INTEGRATION_FILES_SPEC="$(resolve_verify_source_file "e2e/integration-files.spec.ts")"
VERIFY_NOTEBOOK_EXECUTION_OUTCOME="$(resolve_verify_source_file "e2e/notebook-execution-outcome.ts")"
VERIFY_INTEGRATION_WORKSPACE_ACCESS="$(resolve_verify_source_file "e2e/integration-workspace-access.ts")"
VERIFY_INTEGRATION_WORKSPACE_ENTRY_SPEC="$(resolve_verify_source_file "e2e/integration-workspace-entry.spec.ts")"
VERIFY_INTEGRATION_WORKSPACE_PUBLISH_SPEC="$(resolve_verify_source_file "e2e/integration-workspace-publish-usable.spec.ts")"
VERIFY_INTEGRATION_PRESET_FILELIB_SPEC="$(resolve_verify_source_file "e2e/integration-preset-external-file-library.spec.ts")"
VERIFY_INTEGRATION_INTERNAL_CHAT_RUNNER_SPEC="$(resolve_verify_source_file "e2e/integration-internal-chat-runner.spec.ts")"
VERIFY_BUNDLED_KUBECTL="${RELEASE_ROOT}/tools/kubectl"
[[ -x "${VERIFY_BUNDLED_KUBECTL}" ]] || die "bundled kubectl missing from release tools"
VERIFY_KUBECONFIG_SOURCE="${KUBECONFIG:-}"
[[ -f "${VERIFY_KUBECONFIG_SOURCE}" ]] || die "verify kubeconfig missing"
prepare_release_story_verify_mounts || exit 1
VERIFY_PLAYWRIGHT_SPECS=(
  e2e/integration-files.spec.ts
  e2e/integration-workspace-entry.spec.ts
  e2e/integration-workspace-publish-usable.spec.ts
  e2e/integration-preset-external-file-library.spec.ts
  e2e/integration-release-user-story.spec.ts
)
if demo_mode_is_full; then
  VERIFY_PLAYWRIGHT_SPECS+=(e2e/integration-internal-chat-runner.spec.ts)
fi
docker run --rm \
  --network host \
  --ipc host \
  --privileged \
  --device /dev/fuse \
  --security-opt apparmor:unconfined \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${REPORT_DIR}/verify-artifacts:/app/test-results" \
  -v "${VERIFY_BUNDLED_KUBECTL}:/usr/local/bin/kubectl:ro" \
  -v "${VERIFY_KUBECONFIG_SOURCE}:/tmp/verify-kubeconfig:ro" \
  -v "${VERIFY_INTEGRATION_REAL_HELPERS}:/app/e2e/integration-real-helpers.ts:ro" \
  -v "${VERIFY_INTEGRATION_FILES_SPEC}:/app/e2e/integration-files.spec.ts:ro" \
  -v "${VERIFY_NOTEBOOK_EXECUTION_OUTCOME}:/app/e2e/notebook-execution-outcome.ts:ro" \
  -v "${VERIFY_INTEGRATION_WORKSPACE_ACCESS}:/app/e2e/integration-workspace-access.ts:ro" \
  -v "${VERIFY_INTEGRATION_WORKSPACE_ENTRY_SPEC}:/app/e2e/integration-workspace-entry.spec.ts:ro" \
  -v "${VERIFY_INTEGRATION_WORKSPACE_PUBLISH_SPEC}:/app/e2e/integration-workspace-publish-usable.spec.ts:ro" \
  -v "${VERIFY_INTEGRATION_PRESET_FILELIB_SPEC}:/app/e2e/integration-preset-external-file-library.spec.ts:ro" \
  -v "${VERIFY_INTEGRATION_INTERNAL_CHAT_RUNNER_SPEC}:/app/e2e/integration-internal-chat-runner.spec.ts:ro" \
  "${RELEASE_STORY_VERIFY_MOUNTS[@]}" \
  -e BASE_URL="${HOST_LOCAL_WEB_BASE_URL}" \
  -e INTEGRATION_API_BASE="${HOST_LOCAL_API_BASE_URL}" \
  -e KUBECONFIG=/tmp/verify-kubeconfig \
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
  -e SANDBOX_MANAGER_URL="${SANDBOX_MANAGER_URL:-}" \
  -e SANDBOX_SERVICE_KEY="${SANDBOX_SERVICE_KEY:-}" \
  -e INTERNAL_AGENT_K8S_NAMESPACE="${INTERNAL_AGENT_K8S_NAMESPACE:-}" \
  -e INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES=true \
  -e BACKEND_REAL_API_KEY="${PRESET_ENDPOINT_API_KEY:-}" \
  -e BACKEND_REAL_ANTHROPIC_BASE_URL="${BACKEND_REAL_ANTHROPIC_BASE_URL}" \
  -e BACKEND_REAL_OPENAI_BASE_URL="${BACKEND_REAL_OPENAI_BASE_URL}" \
  -e BACKEND_REAL_MODEL="${PRESET_ENDPOINT_MODEL:-placeholder-model}" \
  -e INTEGRATION_DEMO_DEPLOY_MODE="${DEMO_DEPLOY_MODE}" \
  -e INTEGRATION_CODEX_RUNNER_DOCKER_IMAGE="${RUNNER_IMAGE}" \
  -e INTEGRATION_INTERNAL_AGENT_IMAGE="${RUNNER_IMAGE}" \
  -e INTEGRATION_INTERNAL_CHAT_AGENT_IMAGE="${CHAT_RUNNER_IMAGE}" \
  -e INTEGRATION_CHAT_RUNNER_BASE_DOCKER_IMAGE="${CHAT_RUNNER_IMAGE}" \
  -e INTEGRATION_CHAT_RUNNER_REBUILD_BASE_IMAGE=0 \
  -e INTEGRATION_CHAT_RUNNER_REBUILD_IMAGE=0 \
  -e INTEGRATION_CODEX_RUNNER_EMBEDDED=1 \
  -e INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS="${INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS:-feishu-docs,jira-ops}" \
  -e INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS_REQUIRED="${INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS_REQUIRED:-1}" \
  -e INTEGRATION_CODEX_RUNNER_MOUNT_READY_TIMEOUT_MS="${MBOS_AGENT_JUICEFS_MOUNT_READY_TIMEOUT_MS:-120000}" \
  -e INTEGRATION_RUNNER_LOG_DIR=/app/test-results/runner-logs \
  -e RESET_FIRST=0 \
  "${VERIFY_RUNNER_IMAGE}" \
  npx playwright test \
    --config playwright.config.integration.ts \
    "${VERIFY_PLAYWRIGHT_SPECS[@]}" \
    --project=chromium \
    --workers=1 || {
      gate_record_failure "${VERIFY_EVIDENCE_DIR}" "scenario_assertion_failed" "scenario_gate_playwright" "deploy verify playwright failed"
      exit 1
    }

gate_write_mount_tree "${VERIFY_EVIDENCE_DIR}" "${REPORT_DIR}/verify-artifacts"

state_set release.phase verify_completed
log "verify ok"
gate_record_success "${VERIFY_EVIDENCE_DIR}" "demo_verify"
