#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_BASE="${API_BASE:-http://localhost:20000}"
WORKSPACE_ID="${WORKSPACE_ID:-ws_default}"
TOKEN_FILE="${TOKEN_FILE:-/tmp/agentsmith_user_token.txt}"
FLOW="${FLOW:-user_connect}" # admin_verify | user_connect
POST_REDIRECT_PATH="${POST_REDIRECT_PATH:-}"

info() { echo "[feishu-real-manual-step] $*"; }

if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[feishu-real-manual-step] token file missing: ${TOKEN_FILE}" >&2
  echo "[feishu-real-manual-step] run: make notebook-agent-refresh-token" >&2
  exit 1
fi

TOKEN="$(cat "${TOKEN_FILE}")"

case "${FLOW}" in
  admin_verify)
    endpoint="${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/integrations/feishu/verify/start"
    default_redirect="/workspaces/${WORKSPACE_ID}/settings/feishu?step=verify"
    ;;
  user_connect)
    endpoint="${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/me/feishu/auth/start"
    default_redirect="/workspaces/${WORKSPACE_ID}/connections?provider=feishu"
    ;;
  *)
    echo "[feishu-real-manual-step] unsupported FLOW=${FLOW}" >&2
    exit 1
    ;;
esac

payload="$(node -e 'console.log(JSON.stringify({post_redirect_path: process.argv[1]}))' "${POST_REDIRECT_PATH:-${default_redirect}}")"
response="$(
  curl -sS -X POST "${endpoint}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H 'Content-Type: application/json' \
    -d "${payload}"
)"

auth_url="$(printf '%s' "${response}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); const url = typeof j.auth_url === "string" ? j.auth_url : (typeof j.authorization_url === "string" ? j.authorization_url : ""); if(!url){process.exit(2)} process.stdout.write(url);})' || true)"
if [[ -z "${auth_url}" ]]; then
  echo "[feishu-real-manual-step] failed to generate auth url: ${response}" >&2
  exit 1
fi

info "flow=${FLOW}"
info "open this URL in your browser and complete the Feishu confirmation:"
echo "${auth_url}"
