#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
source "${ROOT_DIR}/scripts/lib/runtime-verification.sh"
ensure_backend_real_state

API_PORT="${API_PORT:-${INTEGRATION_API_PORT:-20000}}"
WEB_PORT="${WEB_PORT:-${INTEGRATION_WEB_PORT:-3001}}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
clear_runtime_stack_env
resolve_loopback_runtime_stack "${API_PORT}" "${WEB_PORT}" "${KEYCLOAK_PORT}" "${KEYCLOAK_REALM}" "${KEYCLOAK_CLIENT_ID}"
API_BASE="${API_BASE:-${RUNTIME_HOST_API_BASE_URL}}"
WORKSPACE_ID="${WORKSPACE_ID:-$(state_get workspace.id ws_default)}"
TOKEN_FILE="${TOKEN_FILE:-$(backend_real_token_file)}"
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}"
MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"

PROJECT_NAME="${PROJECT_NAME:-Codex Agent Regression}"
AGENT_RUNNER_NAME="${AGENT_RUNNER_NAME:-codex-agent-task-runner-$(date +%s)}"
ENDPOINT_NAME="${ENDPOINT_NAME:-demo-endpoint-$(date +%s)}"
CREDENTIAL_NAME="${CREDENTIAL_NAME:-demo-key-$(date +%s)}"
AGENT_RUNNER_SEED_MODE="${AGENT_RUNNER_SEED_MODE:-developer_runner}"

PRESET_ENDPOINT_MODEL="${PRESET_ENDPOINT_MODEL:-}"
PRESET_ENDPOINT_API_KEY="${PRESET_ENDPOINT_API_KEY:-}"
PRESET_ANTHROPIC_ENDPOINT_BASE_URL="${PRESET_ANTHROPIC_ENDPOINT_BASE_URL:-}"
PRESET_ANTHROPIC_ENDPOINT_PROTOCOL="${PRESET_ANTHROPIC_ENDPOINT_PROTOCOL:-}"

PROJECT_VISIBILITY="${PROJECT_VISIBILITY:-private}"
PROJECT_JOIN_POLICY="${PROJECT_JOIN_POLICY:-approval_required}"
MODEL_MAX_CONTEXT_TOKENS="${MODEL_MAX_CONTEXT_TOKENS:-204800}"
MODEL_MAX_OUTPUT_TOKENS="${MODEL_MAX_OUTPUT_TOKENS:-128000}"

if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[init] token file not found: ${TOKEN_FILE}" >&2
  echo "[init] run: make agent-runner-refresh-token" >&2
  exit 1
fi
if [[ -z "${PRESET_ENDPOINT_API_KEY}" || -z "${PRESET_ANTHROPIC_ENDPOINT_BASE_URL}" || -z "${PRESET_ENDPOINT_MODEL}" || -z "${PRESET_ANTHROPIC_ENDPOINT_PROTOCOL}" ]]; then
  echo "[init] missing required PRESET_ENDPOINT_* env vars" >&2
  echo "[init] required: PRESET_ENDPOINT_API_KEY PRESET_ANTHROPIC_ENDPOINT_BASE_URL PRESET_ENDPOINT_MODEL PRESET_ANTHROPIC_ENDPOINT_PROTOCOL" >&2
  exit 1
fi

(
  cd "${ROOT_DIR}" && \
  MONGO_URL="${MONGO_URL}" \
  MONGO_DB_NAME="${MONGO_DB_NAME}" \
  KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL}" \
  KEYCLOAK_REALM="${KEYCLOAK_REALM}" \
  KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID}" \
  npx tsx scripts/ensure-default-workspace.ts >/dev/null
)

TOKEN="$(cat "${TOKEN_FILE}")"
BASE="${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}"
state_set_string workspace.id "${WORKSPACE_ID}"

userinfo_status="$(curl -sS -o "$(backend_real_tmp_file userinfo-check.json)" -w '%{http_code}' \
  "${KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/userinfo" \
  -H "Authorization: Bearer ${TOKEN}" || true)"
if [[ "${userinfo_status}" != "200" ]]; then
  echo "[init] token invalid or expired (userinfo status=${userinfo_status})." >&2
  echo "[init] run: make agent-runner-refresh-token" >&2
  exit 1
fi

json_get() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); let v=j; for(const p of process.argv[1].split(".")){ if(!p) continue; v=v?.[p]; } if(v==null){ process.exit(2);} process.stdout.write(String(v)); })' "$1"
}

json_get_optional() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); let v=j; for(const p of process.argv[1].split(".")){ if(!p) continue; v=v?.[p]; } if(v==null){ process.exit(0);} process.stdout.write(String(v)); })' "$1"
}

secret_fingerprint() {
  local value="${1:-}"
  local digest
  if [[ -z "${value}" ]]; then
    printf '\n'
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    digest="$(printf '%s' "${value}" | sha256sum | awk '{print $1}')"
  else
    digest="$(printf '%s' "${value}" | shasum -a 256 | awk '{print $1}')"
  fi
  printf 'sha256:%s\n' "${digest}"
}

api_curl() {
  curl -sS "$@"
}

echo "[init] creating project..."
project_resp="$(api_curl -X POST "${BASE}/projects" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({name:process.argv[1], visibility:process.argv[2], join_policy:process.argv[3]}))' \
      "${PROJECT_NAME}" "${PROJECT_VISIBILITY}" "${PROJECT_JOIN_POLICY}")")"
if ! printf '%s' "${project_resp}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);process.exit(j.id?0:1)}catch{process.exit(2)}})'; then
  echo "[init] create project failed: ${project_resp}" >&2
  exit 2
fi
PROJECT_ID="$(printf '%s' "${project_resp}" | json_get id)"
state_set_string project.id "${PROJECT_ID}"
state_set_string project.name "${PROJECT_NAME}"
echo "[init] project_id=${PROJECT_ID}"

PROJECT_BASE="${BASE}/projects/${PROJECT_ID}"

echo "[init] creating credential..."
cred_resp="$(api_curl -X POST "${PROJECT_BASE}/credentials" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
      -d "$(node -e 'console.log(JSON.stringify({name:process.argv[1], type:"api_key", value:process.argv[2]}))' \
      "${CREDENTIAL_NAME}" "${PRESET_ENDPOINT_API_KEY}")")"
CRED_ID="$(printf '%s' "${cred_resp}" | json_get id)"
state_set_string credential.id "${CRED_ID}"
state_set_string credential.name "${CREDENTIAL_NAME}"
echo "[init] credential_id=${CRED_ID}"

echo "[init] creating endpoint..."
endpoint_resp="$(api_curl -X POST "${PROJECT_BASE}/endpoints" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({name:process.argv[1], type:"custom", upstream_protocol:process.argv[2], base_url:process.argv[3], model:process.argv[4], credential_ref:process.argv[5], model_profile:{max_context_tokens:Number(process.argv[6]), max_output_tokens:Number(process.argv[7]), supports_file:false, supports_tool_call:true, supports_reasoning:false, price_input_per_1m:0, price_output_per_1m:0, cache_read_discount_ratio:0, cache_write_discount_ratio:0}}))' \
      "${ENDPOINT_NAME}" "${PRESET_ANTHROPIC_ENDPOINT_PROTOCOL}" "${PRESET_ANTHROPIC_ENDPOINT_BASE_URL}" "${PRESET_ENDPOINT_MODEL}" "${CRED_ID}" "${MODEL_MAX_CONTEXT_TOKENS}" "${MODEL_MAX_OUTPUT_TOKENS}")")"
ENDPOINT_ID="$(printf '%s' "${endpoint_resp}" | json_get id)"
state_set_string endpoint.id "${ENDPOINT_ID}"
state_set_string endpoint.name "${ENDPOINT_NAME}"
state_set_string endpoint.upstream_protocol "${PRESET_ANTHROPIC_ENDPOINT_PROTOCOL}"
state_set_string endpoint.base_url "${PRESET_ANTHROPIC_ENDPOINT_BASE_URL}"
state_set_string endpoint.model "${PRESET_ENDPOINT_MODEL}"
echo "[init] endpoint_id=${ENDPOINT_ID}"

case "${AGENT_RUNNER_SEED_MODE}" in
  developer_runner|developer|external)
    echo "[init] creating developer agent-task runner..."
    seed_resp="$(
      WORKSPACE_ID="${WORKSPACE_ID}" \
      PROJECT_ID="${PROJECT_ID}" \
      ENDPOINT_ID="${ENDPOINT_ID}" \
      AGENT_RUNNER_NAME="${AGENT_RUNNER_NAME}" \
      API_BASE="${API_BASE}" \
      PUBLIC_API_BASE_URL="${PUBLIC_API_BASE_URL:-${API_BASE}}" \
      MONGO_URL="${MONGO_URL}" \
      MONGO_DB_NAME="${MONGO_DB_NAME}" \
      npx tsx scripts/agent-runner-seed-developer-runner.ts
    )"
    AGENT_RUNNER_PROVIDER="developer"
    AGENT_RUNNER_MANAGED="false"
    ;;
  managed_agent_task|managed|internal)
    echo "[init] creating managed agent-task runner..."
    seed_resp="$(
      WORKSPACE_ID="${WORKSPACE_ID}" \
      PROJECT_ID="${PROJECT_ID}" \
      ENDPOINT_ID="${ENDPOINT_ID}" \
      AGENT_RUNNER_NAME="${AGENT_RUNNER_NAME}" \
      API_BASE="${API_BASE}" \
      AGENT_EXECUTION_WS_BASE_URL="${AGENT_EXECUTION_WS_BASE_URL:-${API_BASE/http:/ws:}}" \
      MONGO_URL="${MONGO_URL}" \
      MONGO_DB_NAME="${MONGO_DB_NAME}" \
      npx tsx scripts/agent-runner-seed-managed-runner.ts
    )"
    AGENT_RUNNER_PROVIDER="managed"
    AGENT_RUNNER_MANAGED="true"
    ;;
  *)
    echo "[init] unsupported AGENT_RUNNER_SEED_MODE=${AGENT_RUNNER_SEED_MODE}" >&2
    exit 1
    ;;
esac
AGENT_RUNNER_ID="$(printf '%s' "${seed_resp}" | json_get agent_runner_id)"
AGENT_RUNNER_DEFAULT_ENDPOINT_ID="$(printf '%s' "${seed_resp}" | json_get_optional default_endpoint_id)"
AGENT_TASK_MODEL_SETTING_ENDPOINT_ID="$(printf '%s' "${seed_resp}" | json_get agent_task_model_setting.endpoint_id)"
AGENT_TASK_MODEL_SETTING_DEFAULT_MODEL="$(printf '%s' "${seed_resp}" | json_get agent_task_model_setting.default_model_id)"
AGENT_TASK_MODEL_SETTING_REVISION="$(printf '%s' "${seed_resp}" | json_get agent_task_model_setting.setting_revision)"
WS_URL="$(printf '%s' "${seed_resp}" | json_get ws_url)"
AGENT_RUNNER_KEY="$(printf '%s' "${seed_resp}" | json_get_optional agent_key)"
AGENT_RUNNER_KEY_PRESENT="false"
AGENT_RUNNER_KEY_FINGERPRINT=""
if [[ -n "${AGENT_RUNNER_KEY}" ]]; then
  AGENT_RUNNER_KEY_PRESENT="true"
  AGENT_RUNNER_KEY_FINGERPRINT="$(secret_fingerprint "${AGENT_RUNNER_KEY}")"
fi
state_set_string agent_runner.id "${AGENT_RUNNER_ID}"
state_set_string agent_runner.name "${AGENT_RUNNER_NAME}"
state_set_string agent_runner.runner_provider "${AGENT_RUNNER_PROVIDER}"
state_set_string agent_runner.managed "${AGENT_RUNNER_MANAGED}"
state_set_string agent_runner.default_endpoint_id "${AGENT_RUNNER_DEFAULT_ENDPOINT_ID}"
state_set_string agent_runner.ws_url "${WS_URL}"
state_set_string agent_task_model_setting.endpoint_id "${AGENT_TASK_MODEL_SETTING_ENDPOINT_ID}"
state_set_string agent_task_model_setting.default_model "${AGENT_TASK_MODEL_SETTING_DEFAULT_MODEL}"
state_set_string agent_task_model_setting.revision "${AGENT_TASK_MODEL_SETTING_REVISION}"
echo "[init] agent_runner_id=${AGENT_RUNNER_ID}"
echo "[init] agent_task_model_setting_endpoint_id=${AGENT_TASK_MODEL_SETTING_ENDPOINT_ID}"
echo "[init] ${AGENT_RUNNER_PROVIDER} runner state written to $(backend_real_state_file)"
echo "[init] ws_url=${WS_URL}"

state_write_summary

cat >> "$(backend_real_summary_file)" <<EOF
API_BASE=${API_BASE}
WORKSPACE_ID=${WORKSPACE_ID}
PROJECT_ID=${PROJECT_ID}
CREDENTIAL_ID=${CRED_ID}
ENDPOINT_ID=${ENDPOINT_ID}
AGENT_RUNNER_ID=${AGENT_RUNNER_ID}
AGENT_RUNNER_PROVIDER=${AGENT_RUNNER_PROVIDER}
AGENT_RUNNER_DEFAULT_ENDPOINT_ID=${AGENT_RUNNER_DEFAULT_ENDPOINT_ID}
AGENT_RUNNER_KEY_PRESENT=${AGENT_RUNNER_KEY_PRESENT}
AGENT_RUNNER_KEY_FINGERPRINT=${AGENT_RUNNER_KEY_FINGERPRINT}
AGENT_TASK_MODEL_SETTING_ENDPOINT_ID=${AGENT_TASK_MODEL_SETTING_ENDPOINT_ID}
AGENT_TASK_MODEL_SETTING_DEFAULT_MODEL=${AGENT_TASK_MODEL_SETTING_DEFAULT_MODEL}
AGENT_TASK_MODEL_SETTING_REVISION=${AGENT_TASK_MODEL_SETTING_REVISION}
WS_URL=${WS_URL}
PRESET_ANTHROPIC_ENDPOINT_BASE_URL=${PRESET_ANTHROPIC_ENDPOINT_BASE_URL}
PRESET_ENDPOINT_MODEL=${PRESET_ENDPOINT_MODEL}
PRESET_ANTHROPIC_ENDPOINT_PROTOCOL=${PRESET_ANTHROPIC_ENDPOINT_PROTOCOL}
MODEL_MAX_CONTEXT_TOKENS=${MODEL_MAX_CONTEXT_TOKENS}
MODEL_MAX_OUTPUT_TOKENS=${MODEL_MAX_OUTPUT_TOKENS}
EOF
unset AGENT_RUNNER_KEY

echo
echo "[init] done. Files written:"
echo "  $(backend_real_state_file)"
echo "  $(backend_real_summary_file)"
