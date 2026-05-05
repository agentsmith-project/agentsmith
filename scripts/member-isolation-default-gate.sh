#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

info() { echo "[member-isolation-default-gate] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

run_cmd "npm run test:run -- \
  packages/api-entry-node/src/__integration__/project-file-libraries.integration.test.ts \
  packages/api-entry-node/src/__integration__/agent-permissions.integration.test.ts \
  packages/api-entry-node/src/audit-usage-route-handler.test.ts \
  packages/api-entry-node/src/audit-usage-store.test.ts \
  packages/api-entry-node/src/project-file-library-routes.test.ts \
  packages/api-entry-node/src/project-authz-engine.test.ts \
  src/lib/hooks/__tests__/use-permissions.test.tsx \
  src/lib/api/__tests__/audit-usage-api.test.ts \
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-runners/__tests__/page.test.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/__tests__/page.test.tsx' \
  packages/api-entry-node/src/project-member-governance-routes.test.ts \
  src/components/members/__tests__/PeopleTab.test.tsx \
  packages/api-entry-node/src/__integration__/project-routes.integration.test.ts"

info "member isolation default gate passed"
