#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/real-lane-state.sh"
ensure_real_lane_state

API_BASE="${API_BASE:-http://localhost:20000}"
WORKSPACE_ID="${WORKSPACE_ID:-$(state_get workspace.id ws_default)}"
TOKEN_FILE="${TOKEN_FILE:-$(real_lane_token_file)}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}"
MONGO_URL="${MONGO_URL:-mongodb://mbos:mbos_dev_password@localhost:17017/admin}"
MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"

PROJECT_NAME="${PROJECT_NAME:-Codex Agent Regression}"
AGENT_NAME="${AGENT_NAME:-codex-ext-$(date +%s)}"
ENDPOINT_NAME="${ENDPOINT_NAME:-glm5-anthropic-$(date +%s)}"
CREDENTIAL_NAME="${CREDENTIAL_NAME:-glm-key-$(date +%s)}"

GLM_BASE_URL="${GLM_BASE_URL:-https://open.bigmodel.cn/api/anthropic}"
GLM_MODEL="${GLM_MODEL:-GLM-5}"
ENDPOINT_PROTOCOL="${ENDPOINT_PROTOCOL:-anthropic_compatible}"
GLM_API_KEY="${GLM_API_KEY:-}"

WIRE_API="${WIRE_API:-responses}"
PROJECT_VISIBILITY="${PROJECT_VISIBILITY:-private}"
PROJECT_JOIN_POLICY="${PROJECT_JOIN_POLICY:-approval_required}"

if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[init] token file not found: ${TOKEN_FILE}" >&2
  echo "[init] run: make notebook-agent-refresh-token" >&2
  exit 1
fi
if [[ -z "${GLM_API_KEY}" ]]; then
  echo "[init] missing GLM_API_KEY env var" >&2
  echo "[init] example: GLM_API_KEY='***' make notebook-agent-init-resources" >&2
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

userinfo_status="$(curl -sS -o /tmp/agentsmith_userinfo_check.json -w '%{http_code}' \
  "${KEYCLOAK_BASE_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/userinfo" \
  -H "Authorization: Bearer ${TOKEN}" || true)"
if [[ "${userinfo_status}" != "200" ]]; then
  echo "[init] token invalid or expired (userinfo status=${userinfo_status})." >&2
  echo "[init] run: make notebook-agent-refresh-token" >&2
  exit 1
fi

json_get() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); let v=j; for(const p of process.argv[1].split(".")){ if(!p) continue; v=v?.[p]; } if(v==null){ process.exit(2);} process.stdout.write(String(v)); })' "$1"
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
      "${CREDENTIAL_NAME}" "${GLM_API_KEY}")")"
CRED_ID="$(printf '%s' "${cred_resp}" | json_get id)"
state_set_string credential.id "${CRED_ID}"
state_set_string credential.name "${CREDENTIAL_NAME}"
echo "[init] credential_id=${CRED_ID}"

echo "[init] creating endpoint..."
endpoint_resp="$(api_curl -X POST "${PROJECT_BASE}/endpoints" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({name:process.argv[1], protocol:process.argv[2], base_url:process.argv[3], model:process.argv[4], credential_ref:process.argv[5]}))' \
      "${ENDPOINT_NAME}" "${ENDPOINT_PROTOCOL}" "${GLM_BASE_URL}" "${GLM_MODEL}" "${CRED_ID}")")"
ENDPOINT_ID="$(printf '%s' "${endpoint_resp}" | json_get id)"
state_set_string endpoint.id "${ENDPOINT_ID}"
state_set_string endpoint.name "${ENDPOINT_NAME}"
state_set_string endpoint.protocol "${ENDPOINT_PROTOCOL}"
state_set_string endpoint.base_url "${GLM_BASE_URL}"
state_set_string endpoint.model "${GLM_MODEL}"
echo "[init] endpoint_id=${ENDPOINT_ID}"

echo "[init] creating external notebook agent..."
agent_resp="$(api_curl -X POST "${PROJECT_BASE}/agents" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({name:process.argv[1], mode:"external", interaction_mode:"notebook", execution_preferences:{notebook:{endpoint_id:process.argv[2], wire_api:process.argv[3], model:process.argv[4]}}, capabilities:{streaming_completion:true,multimodal_completion:false}}))' \
      "${AGENT_NAME}" "${ENDPOINT_ID}" "${WIRE_API}" "${GLM_MODEL}")")"
AGENT_ID="$(printf '%s' "${agent_resp}" | json_get id)"
state_set_string agent.id "${AGENT_ID}"
state_set_string agent.name "${AGENT_NAME}"
echo "[init] agent_id=${AGENT_ID}"

echo "[init] creating agent key..."
agent_key_resp="$(api_curl -X POST "${PROJECT_BASE}/agents/${AGENT_ID}/keys" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{}')"
AGENT_KEY="$(printf '%s' "${agent_key_resp}" | json_get key)"
state_set_string agent.key "${AGENT_KEY}"
echo "[init] agent key written to $(real_lane_state_file)"

echo "[init] fetching connection info..."
conn_resp="$(api_curl "${PROJECT_BASE}/agents/${AGENT_ID}/connection-info" \
  -H "Authorization: Bearer ${TOKEN}")"
WS_URL="$(printf '%s' "${conn_resp}" | json_get ws_url)"
state_set_string agent.ws_url "${WS_URL}"
echo "[init] ws_url=${WS_URL}"

cat > "$(real_lane_summary_file)" <<EOF
API_BASE=${API_BASE}
WORKSPACE_ID=${WORKSPACE_ID}
PROJECT_ID=${PROJECT_ID}
CREDENTIAL_ID=${CRED_ID}
ENDPOINT_ID=${ENDPOINT_ID}
AGENT_ID=${AGENT_ID}
WS_URL=${WS_URL}
GLM_BASE_URL=${GLM_BASE_URL}
GLM_MODEL=${GLM_MODEL}
ENDPOINT_PROTOCOL=${ENDPOINT_PROTOCOL}
WIRE_API=${WIRE_API}
EOF

state_write_summary

echo
echo "[init] done. Files written:"
echo "  $(real_lane_state_file)"
echo "  $(real_lane_summary_file)"
