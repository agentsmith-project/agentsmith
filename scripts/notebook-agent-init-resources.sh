#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

API_BASE="${API_BASE:-http://localhost:20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}"

PROJECT_NAME="${PROJECT_NAME:-Codex Agent Regression}"
AGENT_NAME="${AGENT_NAME:-codex-ext-$(date +%s)}"
ENDPOINT_NAME="${ENDPOINT_NAME:-glm47-coding-$(date +%s)}"
CREDENTIAL_NAME="${CREDENTIAL_NAME:-glm-key-$(date +%s)}"

GLM_BASE_URL="${GLM_BASE_URL:-https://open.bigmodel.cn/api/coding/paas/v4}"
GLM_MODEL="${GLM_MODEL:-glm-5}"
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

TOKEN="$(cat "${TOKEN_FILE}")"
BASE="${API_BASE}/api/v1/workspaces/${WORKSPACE_ID}"

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
echo "${PROJECT_ID}" > /tmp/agentsmith_project_id.txt
echo "[init] project_id=${PROJECT_ID}"

PROJECT_BASE="${BASE}/projects/${PROJECT_ID}"

echo "[init] creating credential..."
cred_resp="$(api_curl -X POST "${PROJECT_BASE}/credentials" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({name:process.argv[1], type:"api_key", value:process.argv[2]}))' \
      "${CREDENTIAL_NAME}" "${GLM_API_KEY}")")"
CRED_ID="$(printf '%s' "${cred_resp}" | json_get id)"
echo "${CRED_ID}" > /tmp/agentsmith_cred_id.txt
echo "[init] credential_id=${CRED_ID}"

echo "[init] creating endpoint..."
endpoint_resp="$(api_curl -X POST "${PROJECT_BASE}/endpoints" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({name:process.argv[1], protocol:"openai_compatible", base_url:process.argv[2], openai_model:process.argv[3], credential_ref:process.argv[4]}))' \
      "${ENDPOINT_NAME}" "${GLM_BASE_URL}" "${GLM_MODEL}" "${CRED_ID}")")"
ENDPOINT_ID="$(printf '%s' "${endpoint_resp}" | json_get id)"
echo "${ENDPOINT_ID}" > /tmp/agentsmith_endpoint_id.txt
echo "[init] endpoint_id=${ENDPOINT_ID}"

echo "[init] creating external notebook agent..."
agent_resp="$(api_curl -X POST "${PROJECT_BASE}/agents" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({name:process.argv[1], mode:"external", interaction_mode:"notebook", runtime_preferences:{notebook:{endpoint_id:process.argv[2], wire_api:process.argv[3], model:process.argv[4]}}, capabilities:{streaming_completion:true,multimodal_completion:false}}))' \
      "${AGENT_NAME}" "${ENDPOINT_ID}" "${WIRE_API}" "${GLM_MODEL}")")"
AGENT_ID="$(printf '%s' "${agent_resp}" | json_get id)"
echo "${AGENT_ID}" > /tmp/agentsmith_agent_id.txt
echo "[init] agent_id=${AGENT_ID}"

echo "[init] creating agent key..."
agent_key_resp="$(api_curl -X POST "${PROJECT_BASE}/agents/${AGENT_ID}/keys" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{}')"
AGENT_KEY="$(printf '%s' "${agent_key_resp}" | json_get key)"
echo "${AGENT_KEY}" > /tmp/agentsmith_agent_key.txt
echo "[init] agent key written to /tmp/agentsmith_agent_key.txt"

echo "[init] fetching connection info..."
conn_resp="$(api_curl "${PROJECT_BASE}/agents/${AGENT_ID}/connection-info" \
  -H "Authorization: Bearer ${TOKEN}")"
WS_URL="$(printf '%s' "${conn_resp}" | json_get ws_url)"
echo "${WS_URL}" > /tmp/agentsmith_ws_url.txt
echo "[init] ws_url=${WS_URL}"

cat > /tmp/agentsmith_init_summary.txt <<EOF
API_BASE=${API_BASE}
WORKSPACE_ID=${WORKSPACE_ID}
PROJECT_ID=${PROJECT_ID}
CREDENTIAL_ID=${CRED_ID}
ENDPOINT_ID=${ENDPOINT_ID}
AGENT_ID=${AGENT_ID}
WS_URL=${WS_URL}
GLM_BASE_URL=${GLM_BASE_URL}
GLM_MODEL=${GLM_MODEL}
WIRE_API=${WIRE_API}
EOF

echo
echo "[init] done. Files written:"
echo "  /tmp/agentsmith_project_id.txt"
echo "  /tmp/agentsmith_cred_id.txt"
echo "  /tmp/agentsmith_endpoint_id.txt"
echo "  /tmp/agentsmith_agent_id.txt"
echo "  /tmp/agentsmith_agent_key.txt"
echo "  /tmp/agentsmith_ws_url.txt"
echo "  /tmp/agentsmith_init_summary.txt"
