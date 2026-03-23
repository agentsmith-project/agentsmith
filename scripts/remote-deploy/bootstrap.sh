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

API_BASE="${PUBLIC_API_BASE_URL:-${API_BASE:-http://localhost:20000}}"
PUBLIC_KEYCLOAK_BASE_URL="${PUBLIC_KEYCLOAK_BASE_URL:-http://localhost:18080}"
INTERNAL_KEYCLOAK_BASE_URL="${INTERNAL_KEYCLOAK_BASE_URL:-http://keycloak:8080}"
GLM_APIKEY="${GLM_APIKEY:-}"
CLAUDE_URL="${CLAUDE_URL:-https://api.minimaxi.com/anthropic/v1}"
OPENAI_URL_CODING_PLAN="${OPENAI_URL_CODING_PLAN:-https://api.minimaxi.com/v1}"
GLM_MODEL="${GLM_MODEL:-MiniMax-M2.7-highspeed}"
DEMO_ENDPOINT_TIMEOUT_SECONDS="${MBOS_DEMO_ENDPOINT_TIMEOUT_SECONDS:-900}"
INTERNAL_AGENT_IMAGE="${INTERNAL_AGENT_IMAGE:-$(awk -F= '$1=="agentsmith_runner_image"{print $2}' "${RELEASE_ROOT}/VERSION")}"
PUBLIC_WEB_BASE_URL="${PUBLIC_WEB_BASE_URL:-http://localhost:3001}"
DEMO_PROJECT_NAME="${MBOS_DEMO_PROJECT_NAME:-Demo Project}"
DEMO_CREDENTIAL_NAME="${MBOS_DEMO_CREDENTIAL_NAME:-minimax-shared-key}"
DEMO_ANTHROPIC_ENDPOINT_NAME="${MBOS_DEMO_ANTHROPIC_ENDPOINT_NAME:-minimax-anthropic-demo}"
DEMO_OPENAI_ENDPOINT_NAME="${MBOS_DEMO_OPENAI_ENDPOINT_NAME:-minimax-openai-demo}"
DEMO_EXTERNAL_AGENT_NAME="${MBOS_DEMO_EXTERNAL_AGENT_NAME:-demo-external-agent}"
DEMO_INTERNAL_AGENT_NAME="${MBOS_DEMO_INTERNAL_AGENT_NAME:-demo-internal-agent}"

[[ -n "${GLM_APIKEY}" ]] || die "missing GLM_APIKEY"

docker_compose exec -T postgres bash -lc '
  set -euo pipefail
  psql -U "${POSTGRES_USER:-mbos}" -d "${POSTGRES_DB:-mbos}" >/dev/null
' < "${RELEASE_ROOT}/postgres-init/projects.sql"

docker_compose exec -T api bash -lc '
  INTEGRATION_PUBLIC_WEB_BASES="'"${PUBLIC_WEB_BASE_URL}"'" \
  INTERNAL_KEYCLOAK_BASE_URL="'"${INTERNAL_KEYCLOAK_BASE_URL}"'" \
  KEYCLOAK_REALM="mbos" \
  KEYCLOAK_CLIENT_ID="agentsmith" \
  MONGO_URL="mongodb://mbos:mbos_dev_password@mongo:27017/admin" \
  MONGO_DB_NAME="mbos" \
  npx tsx scripts/integration-keycloak-init.ts >/dev/null
'

docker_compose exec -T api bash -lc '
  PUBLIC_KEYCLOAK_BASE_URL="'"${PUBLIC_KEYCLOAK_BASE_URL}"'" \
  KEYCLOAK_REALM="mbos" \
  KEYCLOAK_CLIENT_ID="agentsmith" \
  MONGO_URL="mongodb://mbos:mbos_dev_password@mongo:27017/admin" \
  MONGO_DB_NAME="mbos" \
  npx tsx scripts/ensure-default-workspace.ts >/dev/null
'

token_resp="$(
  curl -sS "${PUBLIC_KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
    -H 'content-type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=password' \
    --data-urlencode "client_id=${KEYCLOAK_CLIENT_ID}" \
    --data-urlencode 'username=dev-admin' \
    --data-urlencode 'password=dev-admin-123' \
    --data-urlencode 'scope=openid profile email'
)"
TOKEN="$(printf '%s' "${token_resp}" | json_extract access_token)"

WORKSPACE_ID="ws_default"
WORKSPACE_BASE="${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}"
project_list_resp="$(
  curl -sS "${WORKSPACE_BASE}/projects?page=1&page_size=100" \
    -H "Authorization: Bearer ${TOKEN}"
)"
PROJECT_ID="$(printf '%s' "${project_list_resp}" | json_find_named_id "${DEMO_PROJECT_NAME}")"
if [[ -z "${PROJECT_ID}" ]]; then
  project_resp="$(
    curl -sS -X POST "${WORKSPACE_BASE}/projects" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[1], visibility:"private", join_policy:"approval_required"}))' "${DEMO_PROJECT_NAME}")"
  )"
  PROJECT_ID="$(printf '%s' "${project_resp}" | json_extract id)"
fi
PROJECT_BASE="${WORKSPACE_BASE}/projects/${PROJECT_ID}"

credential_list_resp="$(
  curl -sS "${PROJECT_BASE}/credentials?page=1&page_size=100" \
    -H "Authorization: Bearer ${TOKEN}"
)"
CREDENTIAL_ID="$(printf '%s' "${credential_list_resp}" | json_find_named_id "${DEMO_CREDENTIAL_NAME}")"
if [[ -z "${CREDENTIAL_ID}" ]]; then
  credential_resp="$(
    curl -sS -X POST "${PROJECT_BASE}/credentials" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[2], type:"api_key", value:process.argv[1]}))' "${GLM_APIKEY}" "${DEMO_CREDENTIAL_NAME}")"
  )"
  CREDENTIAL_ID="$(printf '%s' "${credential_resp}" | json_extract id)"
fi

endpoint_list_resp="$(
  curl -sS "${PROJECT_BASE}/endpoints?page=1&page_size=100" \
    -H "Authorization: Bearer ${TOKEN}"
)"
ANTHROPIC_ENDPOINT_ID="$(printf '%s' "${endpoint_list_resp}" | json_find_named_id "${DEMO_ANTHROPIC_ENDPOINT_NAME}")"
if [[ -z "${ANTHROPIC_ENDPOINT_ID}" ]]; then
  anthropic_endpoint_resp="$(
    curl -sS -X POST "${PROJECT_BASE}/endpoints" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[5], protocol:"anthropic_compatible", base_url:process.argv[1], model:process.argv[2], credential_ref:process.argv[3], limits:{timeout_seconds:Number(process.argv[4])}}))' "${CLAUDE_URL}" "${GLM_MODEL}" "${CREDENTIAL_ID}" "${DEMO_ENDPOINT_TIMEOUT_SECONDS}" "${DEMO_ANTHROPIC_ENDPOINT_NAME}")"
  )"
  ANTHROPIC_ENDPOINT_ID="$(printf '%s' "${anthropic_endpoint_resp}" | json_extract id)"
fi

curl -sS -X PUT "${PROJECT_BASE}/endpoints/${ANTHROPIC_ENDPOINT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({limits:{timeout_seconds:Number(process.argv[1])}}))' "${DEMO_ENDPOINT_TIMEOUT_SECONDS}")" >/dev/null

agent_list_resp="$(
  curl -sS "${PROJECT_BASE}/agents?page=1&page_size=100" \
    -H "Authorization: Bearer ${TOKEN}"
)"
EXTERNAL_AGENT_ID="$(printf '%s' "${agent_list_resp}" | json_find_named_id "${DEMO_EXTERNAL_AGENT_NAME}")"
if [[ -z "${EXTERNAL_AGENT_ID}" ]]; then
  external_agent_resp="$(
    curl -sS -X POST "${PROJECT_BASE}/agents" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[3], mode:"external", interaction_mode:"notebook", execution_preferences:{notebook:{endpoint_id:process.argv[1], wire_api:"responses", model:process.argv[2]}}, config:{runner_runtime:"compose_managed"}, capabilities:{streaming_completion:true,multimodal_completion:false}}))' "${ANTHROPIC_ENDPOINT_ID}" "${GLM_MODEL}" "${DEMO_EXTERNAL_AGENT_NAME}")"
  )"
  EXTERNAL_AGENT_ID="$(printf '%s' "${external_agent_resp}" | json_extract id)"
fi

curl -sS -X PATCH "${PROJECT_BASE}/agents/${EXTERNAL_AGENT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({config:{runner_runtime:"compose_managed"}}))')" >/dev/null

EXTERNAL_AGENT_KEY="${MBOS_AGENT_KEY:-}"
if [[ -z "${EXTERNAL_AGENT_KEY}" ]]; then
  external_agent_key_resp="$(
    curl -sS -X POST "${PROJECT_BASE}/agents/${EXTERNAL_AGENT_ID}/keys" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      -d '{}'
  )"
  EXTERNAL_AGENT_KEY="$(printf '%s' "${external_agent_key_resp}" | json_extract key)"
fi

external_connection_resp="$(
  curl -sS "${PROJECT_BASE}/agents/${EXTERNAL_AGENT_ID}/connection-info" \
    -H "Authorization: Bearer ${TOKEN}"
)"
EXTERNAL_AGENT_WS_URL="$(printf '%s' "${external_connection_resp}" | json_extract ws_url)"

OPENAI_ENDPOINT_ID="$(printf '%s' "${endpoint_list_resp}" | json_find_named_id "${DEMO_OPENAI_ENDPOINT_NAME}")"
if [[ -z "${OPENAI_ENDPOINT_ID}" ]]; then
  openai_endpoint_resp="$(
    curl -sS -X POST "${PROJECT_BASE}/endpoints" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[5], protocol:"openai_compatible", base_url:process.argv[1], model:process.argv[2], credential_ref:process.argv[3], limits:{timeout_seconds:Number(process.argv[4])}}))' "${OPENAI_URL_CODING_PLAN}" "${GLM_MODEL}" "${CREDENTIAL_ID}" "${DEMO_ENDPOINT_TIMEOUT_SECONDS}" "${DEMO_OPENAI_ENDPOINT_NAME}")"
  )"
  OPENAI_ENDPOINT_ID="$(printf '%s' "${openai_endpoint_resp}" | json_extract id)"
fi

curl -sS -X PUT "${PROJECT_BASE}/endpoints/${OPENAI_ENDPOINT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({limits:{timeout_seconds:Number(process.argv[1])}}))' "${DEMO_ENDPOINT_TIMEOUT_SECONDS}")" >/dev/null

INTERNAL_AGENT_ID="$(printf '%s' "${agent_list_resp}" | json_find_named_id "${DEMO_INTERNAL_AGENT_NAME}")"
if [[ -z "${INTERNAL_AGENT_ID}" ]]; then
  internal_agent_resp="$(
    curl -sS -X POST "${PROJECT_BASE}/agents" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "$(docker_compose exec -T api node -e 'console.log(JSON.stringify({name:process.argv[4], mode:"internal", interaction_mode:"notebook", execution_preferences:{notebook:{endpoint_id:process.argv[1], wire_api:"responses", model:process.argv[2]}}, config:{image:process.argv[3], endpoint_id:process.argv[1], cpu_request:"500m", cpu_limit:"2", memory_request:"512Mi", memory_limit:"4Gi", idle_timeout_sec:180, max_lifetime_sec:3600}, capabilities:{streaming_completion:true}}))' "${OPENAI_ENDPOINT_ID}" "${GLM_MODEL}" "${INTERNAL_AGENT_IMAGE}" "${DEMO_INTERNAL_AGENT_NAME}")"
  )"
  INTERNAL_AGENT_ID="$(printf '%s' "${internal_agent_resp}" | json_extract id)"
fi

cat > "${RELEASE_ROOT}/env/runner-runtime.env" <<EOF
# Generated by bootstrap.sh after preset external agent provisioning.
# Operators must not edit this file manually.
MBOS_AGENT_WS_URL=${EXTERNAL_AGENT_WS_URL}
MBOS_AGENT_KEY=${EXTERNAL_AGENT_KEY}
EOF

docker_compose up -d external-runner >/dev/null
started="$(date +%s)"
until docker_compose logs external-runner 2>&1 | grep -q '\[agent-codex-runner\] connected'; do
  if (( "$(date +%s)" - started > 120 )); then
    die "external-runner failed to connect during bootstrap"
  fi
  sleep 2
done

bash "${RELEASE_SCRIPT_DIR}/check-preset-external-file-library.sh"

state_set release.phase bootstrap_completed
state_set workspace.id "${WORKSPACE_ID}"
state_set project.id "${PROJECT_ID}"
state_set credential.id "${CREDENTIAL_ID}"
state_set endpoint.primary_id "${ANTHROPIC_ENDPOINT_ID}"
state_set endpoint.secondary_id "${OPENAI_ENDPOINT_ID}"
state_set agent.external_id "${EXTERNAL_AGENT_ID}"
state_set agent.internal_id "${INTERNAL_AGENT_ID}"
state_set agent.external_runner_connected true
state_set agent.external_runner_ws_url "${EXTERNAL_AGENT_WS_URL}"

log "bootstrap ok"
