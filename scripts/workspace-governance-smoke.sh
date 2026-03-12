#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

BASE_URL="${BASE_URL:-http://localhost:3060}"
WORKSPACE_GOVERNANCE_EVIDENCE_PATH="${WORKSPACE_GOVERNANCE_EVIDENCE_PATH:-}"
WORKSPACE_WEB_LOG="${WORKSPACE_WEB_LOG:-/tmp/agentsmith-workspace-governance-web.log}"
WEB_PID=""
MANAGED_WEB=0

info() { echo "[workspace-governance-smoke] $*"; }

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
  if [[ -f "${WORKSPACE_WEB_LOG}" ]]; then
    echo "--- workspace governance web log tail ---" >&2
    tail -n 120 "${WORKSPACE_WEB_LOG}" >&2 || true
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

  info "starting managed MSW frontend on ${BASE_URL}"
  nohup env \
    -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u no_proxy -u NO_PROXY \
    NEXT_PUBLIC_USE_MSW=true \
    npm run dev:test -- --port "${web_port}" >"${WORKSPACE_WEB_LOG}" 2>&1 &
  WEB_PID=$!
  MANAGED_WEB=1

  wait_for_web 60
}

ensure_web

info "running workspace governance contract suite"
npm run test:run -- \
  src/lib/__tests__/workspace-governance-posture.test.ts \
  src/app/[locale]/workspaces/[workspace]/settings/__tests__/page.test.tsx

info "running workspace governance browser lane"
BASE_URL="${BASE_URL}" npx playwright test --config=playwright.config.workspace-governance.ts --project=chromium e2e/workspace-settings.spec.ts --workers=1

if [[ -n "${WORKSPACE_GOVERNANCE_EVIDENCE_PATH}" ]]; then
  info "writing workspace governance evidence"
  node scripts/write-workspace-governance-evidence.js "${WORKSPACE_GOVERNANCE_EVIDENCE_PATH}"
fi

info "workspace governance smoke passed"
