#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

BASE_URL="${BASE_URL:-http://localhost:3061}"
ORGANIZATION_GOVERNANCE_EVIDENCE_PATH="${ORGANIZATION_GOVERNANCE_EVIDENCE_PATH:-}"
WORKSPACE_OVERVIEW_WEB_LOG="${WORKSPACE_OVERVIEW_WEB_LOG:-/tmp/agentsmith-workspace-overview-web.log}"
WEB_PID=""
MANAGED_WEB=0

info() { echo "[workspace-overview-smoke] $*"; }

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
  if [[ -f "${WORKSPACE_OVERVIEW_WEB_LOG}" ]]; then
    echo "--- workspace overview web log tail ---" >&2
    tail -n 120 "${WORKSPACE_OVERVIEW_WEB_LOG}" >&2 || true
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
    NEXT_GENERATED_ROOT_MANAGED=1 \
    NEXT_PUBLIC_USE_MSW=true \
    npm run dev:test -- --port "${web_port}" >"${WORKSPACE_OVERVIEW_WEB_LOG}" 2>&1 &
  WEB_PID=$!
  MANAGED_WEB=1

  wait_for_web 60
}

ensure_web

info "running workspace overview contract suite"
npm run test:run -- \
  src/app/[locale]/login/workspace/__tests__/page.test.tsx \
  src/app/[locale]/workspaces/overview/__tests__/page.test.tsx

info "running workspace overview browser lane"
BASE_URL="${BASE_URL}" npx playwright test --project=chromium e2e/workspace-overview.spec.ts --workers=1

if [[ -n "${ORGANIZATION_GOVERNANCE_EVIDENCE_PATH}" ]]; then
  info "writing workspace overview evidence"
  node scripts/write-organization-governance-evidence.js "${ORGANIZATION_GOVERNANCE_EVIDENCE_PATH}"
fi

info "workspace overview smoke passed"
