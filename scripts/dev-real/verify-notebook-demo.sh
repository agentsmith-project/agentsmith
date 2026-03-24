#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init_dev_real_env

if [[ ! -f "${API_READY_FILE}" || ! -f "${WEB_READY_FILE}" || ! -f "${PROXY_READY_FILE}" ]]; then
  err "dev-real platform is not ready; run make dev-real-up first"
  exit 1
fi

if [[ ! -s "$(real_lane_token_file)" ]]; then
  err "missing dev token; run make dev-real-seed-notebook again"
  exit 1
fi

TOKEN="$(cat "$(real_lane_token_file)")"
CODE="$(curl -sS -o /dev/null -w '%{http_code}' "http://localhost:${PORT_API}/api/v1/me/profile" -H "Authorization: Bearer ${TOKEN}" || true)"
if [[ "${CODE}" != "200" ]]; then
  err "dev token validation failed against API (status=${CODE})"
  exit 1
fi

PROJECT_ID="$(state_get project.id)"
ENDPOINT_ID="$(state_get endpoint.id)"
AGENT_ID="$(state_get agent.id)"
WS_URL="$(state_get agent.ws_url)"

if [[ -z "${PROJECT_ID}" || -z "${ENDPOINT_ID}" || -z "${AGENT_ID}" || -z "${WS_URL}" ]]; then
  err "notebook demo state is incomplete; run make dev-real-seed-notebook again"
  exit 1
fi

if [[ ! -f "${RUNNER_READY_FILE}" ]]; then
  err "runner is not connected; run make dev-real-seed-notebook again"
  exit 1
fi

info "notebook demo verify passed"
