#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-state.sh"
ensure_backend_real_state
API_BASE="${API_BASE:-http://localhost:20000}"
WORKSPACE_ID="${WORKSPACE_ID:-$(state_get workspace.id ws_default)}"
TOKEN_FILE="${TOKEN_FILE:-$(backend_real_token_file)}"
FLOW="${FLOW:-user_connect}" # admin_verify | user_connect

if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[feishu-real-resume-check] token file missing: ${TOKEN_FILE}" >&2
  exit 1
fi

TOKEN="$(cat "${TOKEN_FILE}")"

workspace_json="$(
  curl -sS -H "Authorization: Bearer ${TOKEN}" \
    "${API_BASE%/}/api/v1/workspaces/${WORKSPACE_ID}/integrations/feishu"
)"

status="$(printf '%s' "${workspace_json}" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s); process.stdout.write(String(j.status || ""));})')"

case "${FLOW}" in
  admin_verify)
    if [[ "${status}" != "enabled" ]]; then
      echo "[feishu-real-resume-check] workspace_feishu_status=${status}" >&2
      echo "[feishu-real-resume-check] expected workspace Feishu to be enabled. Complete verification and click Enable before resuming." >&2
      exit 2
    fi
    state_set_string feishu.admin.status "${status}"
    echo "[feishu-real-resume-check] workspace_feishu_status=${status}"
    ;;
  user_connect)
    connections_json="$(
      curl -sS -H "Authorization: Bearer ${TOKEN}" \
        "${API_BASE%/}/api/v1/me/external-connections"
    )"
    node -e '
      let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
        const items = JSON.parse(s);
        const hit = (Array.isArray(items)?items:[]).find((item)=>item && item.provider==="feishu" && item.workspace_id===process.argv[1] && item.status==="active");
        if (!hit) {
          process.stderr.write(`[feishu-real-resume-check] workspace_feishu_status=${process.argv[2]}\n`);
          process.stderr.write("[feishu-real-resume-check] active user Feishu connection not found for this workspace.\n");
          process.exit(2);
        }
        process.stdout.write("");
        process.stdout.write(`[feishu-real-resume-check] workspace_feishu_status=${process.argv[2]}\n[feishu-real-resume-check] user_feishu_connection=active\n`);
      });
    ' "${WORKSPACE_ID}" "${status}" <<< "${connections_json}"
    state_set_string feishu.admin.status "${status}"
    state_set_string feishu.user.status "active"
    ;;
  *)
    echo "[feishu-real-resume-check] unsupported FLOW=${FLOW}" >&2
    exit 1
    ;;
esac
