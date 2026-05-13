#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/backend-real-gate-ports.sh"
source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"
WITH_REAL_LANE=0
SKIP_SHARED_PREFLIGHT=0
SKIP_FOCUSED_VISUAL="${WORKSPACE_PROJECT_DEFAULT_GATE_SKIP_FOCUSED_VISUAL:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-backend-real)
      WITH_REAL_LANE=1
      shift
      ;;
    --skip-shared-preflight)
      SKIP_SHARED_PREFLIGHT=1
      shift
      ;;
    --skip-focused-visual)
      SKIP_FOCUSED_VISUAL=1
      shift
      ;;
    *)
      echo "[default-gate] unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

info() { echo "[default-gate] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

if [[ "${SKIP_SHARED_PREFLIGHT}" != "1" ]]; then
  next_generated_root_prepare_for_validation

  run_cmd "npm run contracts:check"
  run_cmd "npm run contracts:check-openapi"
  run_cmd "npm run openapi:check-generated"
  run_cmd "npx next typegen ."
  run_cmd "npx tsc --noEmit"
fi

run_cmd "npm run test:client-public-runtime"
run_cmd "npm run test:unified-deploy:render"
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
run_cmd "npm run test:member-isolation:default"

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
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/use-guide/__tests__/page.test.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/__tests__/page.test.tsx' \
  'src/components/files/__tests__/FilesPage.test.tsx' \
  'src/components/projects/__tests__/CreateProjectDialog.test.tsx'"

run_cmd "node --max-old-space-size=6144 ./node_modules/vitest/vitest.mjs run \
  'packages/api-entry-node/src/project-workspace-governance-routes.test.ts' \
  'packages/api-entry-node/src/workspace-registry.test.ts' \
  'packages/api-entry-node/src/index.test.ts' \
  -t 'lets workspace admins manage project creators and exposes creator permissions in workspace members|forbids plain workspace members from creating projects while allowing project creators|does not expose disabled registered workspaces in runtime workspace list'"

run_cmd "node --max-old-space-size=6144 ./node_modules/vitest/vitest.mjs run \
  'packages/api-entry-node/src/task-route-handler.test.ts'"

info "running workspace/project chromium mock lane"
(
  cd "${ROOT_DIR}"
  MOCK_LANE_WARM_URLS=$'/zh-CN/login\n/en-US/login/workspace\n/en-US/workspaces/overview\n/en-US/workspaces/ws_default\n/en-US/workspaces/ws_default/settings\n/en-US/workspaces/ws_default/projects/proj_001/overview' \
  bash scripts/run-mock-lane-playwright.sh \
    e2e/system-workspace-default.spec.ts \
    e2e/projects-join-governance.spec.ts \
    e2e/workspace-settings.spec.ts \
    --project=chromium \
    --workers=1
)

if [[ "${SKIP_FOCUSED_VISUAL}" == "1" ]]; then
  info "skipping workspace/project focused visual mock lane; full visual evidence is owned by lane:visual"
else
  info "running workspace/project visual mock lane"
  (
    cd "${ROOT_DIR}"
    MOCK_LANE_WARM_URLS=$'/zh-CN/login\n/en-US/login/workspace\n/en-US/workspaces/overview\n/en-US/workspaces/ws_default\n/en-US/workspaces/ws_default/login\n/en-US/workspaces/ws_default/projects\n/en-US/workspaces/ws_test/projects\n/en-US/workspaces/ws_default/settings\n/en-US/workspaces/ws_default/projects/proj_001/overview' \
    bash scripts/run-mock-lane-playwright.sh \
      e2e/visual.spec.ts \
      --project=visual \
      --workers=1 \
      --grep 'workspace selection|workspace login|workspace home|workspace home - project creator|projects list|projects list public discovery|project join request dialog|project join now dialog|notification center join request outcome|projects empty state|workspace settings|workspace settings create project dialog|overview'
  )
fi

if [[ "${WITH_REAL_LANE}" == "1" ]]; then
  real_api_port="${INTEGRATION_API_PORT:-20040}"
  real_web_port="${INTEGRATION_WEB_PORT:-3041}"
  real_spec="e2e/integration-minimal.spec.ts"
  cleanup_gate_ports "${real_api_port}" "${real_web_port}" "${real_spec}"
  info "backend-real enabled"
  info "running workspace/project backend-real lane"
  (
    cd "${ROOT_DIR}"
    INTEGRATION_API_PORT="${real_api_port}" \
    INTEGRATION_WEB_PORT="${real_web_port}" \
    KEYCLOAK_BASE_URL="${KEYCLOAK_BASE_URL:-http://localhost:18080}" \
    KEYCLOAK_REALM="${KEYCLOAK_REALM:-mbos}" \
    KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:18080/realms}" \
    KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-agentsmith}" \
    bash scripts/run-integration-e2e-full.sh "${real_spec}"
  )
fi

info "workspace / project default gate passed"
