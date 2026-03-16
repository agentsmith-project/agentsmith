#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WITH_REAL_LANE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-real-lane)
      WITH_REAL_LANE=1
      shift
      ;;
    *)
      echo "[mainline-gate] unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

info() { echo "[mainline-gate] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

run_cmd "npm run contracts:check"
run_cmd "npm run contracts:check-openapi"
run_cmd "npm run openapi:check-generated"
run_cmd "npx eslint \
  'src/app/[locale]/join/page.tsx' \
  'src/app/[locale]/workspaces/[workspace]/page.tsx' \
  'src/app/[locale]/workspaces/[workspace]/login/page.tsx' \
  'src/app/[locale]/workspaces/[workspace]/settings/page.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/page.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/page.tsx' \
  'src/components/projects/CreateProjectDialog.tsx' \
  'src/components/system/SystemWorkspacesPage.tsx' \
  'src/lib/system-admin/**/*.ts' \
  'packages/api-entry-node/src/project-workspace-governance-routes.ts' \
  'packages/api-entry-node/src/workspace-registry.ts'"
run_cmd "npx tsc --noEmit"

run_cmd "npm run test:run -- \
  'src/lib/system-admin/__tests__/workspace-registry.test.ts' \
  'src/lib/system-admin/__tests__/workspace-registry-publish.test.ts' \
  'src/lib/system-admin/__tests__/workspace-provisioning.test.ts' \
  'src/components/system/__tests__/SystemWorkspacesPage.test.tsx' \
  'src/app/[locale]/join/__tests__/page.test.tsx' \
  'src/app/[locale]/workspaces/[workspace]/__tests__/page.test.tsx' \
  'src/app/[locale]/workspaces/[workspace]/login/__tests__/page.test.tsx' \
  'src/app/[locale]/workspaces/[workspace]/settings/__tests__/page.test.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/__tests__/page.test.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/__tests__/page.test.tsx' \
  'src/components/projects/__tests__/CreateProjectDialog.test.tsx'"

run_cmd "node --max-old-space-size=6144 ./node_modules/vitest/vitest.mjs run \
  'packages/api-entry-node/src/project-workspace-governance-routes.test.ts' \
  'packages/api-entry-node/src/workspace-registry.test.ts' \
  'packages/api-entry-node/src/index.test.ts' \
  -t 'lets workspace admins manage project creators and exposes creator permissions in workspace members|forbids plain workspace members from creating projects while allowing project creators|does not expose disabled registered workspaces in runtime workspace list'"

run_cmd "MOCK_LANE_WARM_URLS=\$'/zh-CN/login\n/en-US/login/workspace\n/en-US/workspaces/overview\n/en-US/workspaces/ws_default\n/en-US/workspaces/ws_default/settings\n/en-US/workspaces/ws_default/projects/proj_001/overview' \
bash scripts/run-mock-lane-playwright.sh \
  e2e/system-workspace-mainline.spec.ts \
  e2e/workspace-settings.spec.ts \
  --project=chromium \
  --workers=1"

run_cmd "MOCK_LANE_WARM_URLS=\$'/zh-CN/login\n/en-US/login/workspace\n/en-US/workspaces/overview\n/en-US/workspaces/ws_default\n/en-US/workspaces/ws_default/login\n/en-US/workspaces/ws_default/projects\n/en-US/workspaces/ws_test/projects\n/en-US/workspaces/ws_default/settings\n/en-US/workspaces/ws_default/projects/proj_001/overview' \
bash scripts/run-mock-lane-playwright.sh \
  e2e/visual.spec.ts \
  --project=visual \
  --workers=1 \
  --grep 'workspace selection|workspace login|workspace home|workspace home - project creator|projects list|projects empty state|workspace settings|workspace settings create project dialog|overview'"

if [[ "${WITH_REAL_LANE}" == "1" ]]; then
  info "real lane enabled"
  run_cmd "INTEGRATION_API_PORT=\${INTEGRATION_API_PORT:-20040} \
INTEGRATION_WEB_PORT=\${INTEGRATION_WEB_PORT:-3041} \
KEYCLOAK_BASE_URL=\${KEYCLOAK_BASE_URL:-http://localhost:18080} \
KEYCLOAK_REALM=\${KEYCLOAK_REALM:-mbos} \
KEYCLOAK_URL=\${KEYCLOAK_URL:-http://localhost:18080/realms} \
KEYCLOAK_CLIENT_ID=\${KEYCLOAK_CLIENT_ID:-agentsmith} \
bash scripts/run-integration-e2e-full.sh e2e/integration-minimal.spec.ts"
fi

info "workspace / project mainline gate passed"
