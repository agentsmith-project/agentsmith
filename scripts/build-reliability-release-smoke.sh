#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

BASE_URL="${BASE_URL:-http://localhost:3001}"
CHAT_API_PORT="${BUILD_CHAT_API_PORT:-20011}"
NOTEBOOK_API_PORT="${BUILD_NOTEBOOK_API_PORT:-20012}"
BUILD_RELIABILITY_EVIDENCE_PATH="${BUILD_RELIABILITY_EVIDENCE_PATH:-}"
BUILD_WEB_API_BASE="${BUILD_WEB_API_BASE:-http://localhost:20000/api/v1}"
BUILD_WEB_LOG="${BUILD_WEB_LOG:-/tmp/agentsmith-build-reliability-web.log}"
WEB_PID=""
MANAGED_WEB=0

info() { echo "[build-reliability-smoke] $*"; }

cleanup() {
  if [[ "${MANAGED_WEB}" -eq 1 && -n "${WEB_PID}" ]]; then
    kill "${WEB_PID}" >/dev/null 2>&1 || true
    wait "${WEB_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_web() {
  local attempts="${1:-60}"
  local quiet="${2:-0}"
  local code=""
  for _ in $(seq 1 "${attempts}"); do
    code="$(node -e "fetch(process.argv[1]).then((res)=>process.stdout.write(String(res.status))).catch(()=>process.stdout.write('000'))" "${BASE_URL}/en-US/login" 2>/dev/null || true)"
    if [[ "${code}" == "200" || "${code}" == "307" || "${code}" == "308" ]]; then
      return 0
    fi
    sleep 1
  done

  if [[ "${quiet}" == "1" ]]; then
    return 1
  fi

  echo "Web did not become ready at ${BASE_URL} (last status: ${code:-n/a})." >&2
  if [[ -f "${BUILD_WEB_LOG}" ]]; then
    echo "--- build reliability web log tail ---" >&2
    tail -n 120 "${BUILD_WEB_LOG}" >&2 || true
  fi
  return 1
}

ensure_web() {
  if wait_for_web 5 1; then
    info "using existing frontend at ${BASE_URL}"
    return 0
  fi

  local web_port
  web_port="$(node -e "const u=new URL(process.argv[1]); process.stdout.write(String(u.port || (u.protocol === 'https:' ? 443 : 80)));" "${BASE_URL}")"

  info "starting managed real-backend frontend on ${BASE_URL}"
  nohup env \
    -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
    NEXT_PUBLIC_USE_MSW=false \
    NEXT_PUBLIC_API_BASE="${BUILD_WEB_API_BASE}" \
    NEXT_PUBLIC_KEYCLOAK_URL="${NEXT_PUBLIC_KEYCLOAK_URL:-http://localhost:18080/realms}" \
    NEXT_PUBLIC_KEYCLOAK_REALM="${NEXT_PUBLIC_KEYCLOAK_REALM:-mbos}" \
    NEXT_PUBLIC_KEYCLOAK_CLIENT_ID="${NEXT_PUBLIC_KEYCLOAK_CLIENT_ID:-agentsmith}" \
    npm run dev:test -- --port "${web_port}" >"${BUILD_WEB_LOG}" 2>&1 &
  WEB_PID=$!
  MANAGED_WEB=1

  wait_for_web 60
}

ensure_web

info "running build reliability contract suite"
npm run test:run -- \
  src/lib/hooks/__tests__/use-task-sse.test.ts \
  src/components/notebook/__tests__/MessageItem.test.tsx \
  src/lib/__tests__/build-failure-explainability.test.ts \
  src/components/chat/__tests__/ChatMainPane.test.tsx \
  src/components/notebook/__tests__/ConversationPanel.test.tsx

info "running chat recovery integration lane"
INTEGRATION_API_PORT="${CHAT_API_PORT}" \
BASE_URL="${BASE_URL}" \
npm run test:e2e:integration:chat:with-api -- \
  --grep "chat can recover by switching endpoint after upstream failure|refresh recovers stream id and stop uses stream-level route"

info "running notebook external runtime integration lane"
INTEGRATION_API_PORT="${NOTEBOOK_API_PORT}" \
BASE_URL="${BASE_URL}" \
npm run test:e2e:integration:notebook-external:with-api

if [[ -n "${BUILD_RELIABILITY_EVIDENCE_PATH}" ]]; then
  info "writing build reliability evidence"
  node scripts/write-build-reliability-release-evidence.js "${BUILD_RELIABILITY_EVIDENCE_PATH}"
fi

info "build reliability release smoke passed"
