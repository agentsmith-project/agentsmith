#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

info() { echo "[governance-gate] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

run_cmd "npm run contracts:check"
run_cmd "npm run contracts:check-openapi"
run_cmd "npm run openapi:check-generated"
run_cmd "npx eslint \
  'src/components/members/MemberDetailDrawer.tsx' \
  'src/components/members/PeopleTab.tsx' \
  'src/components/members/MembersPage.tsx' \
  'src/components/audit-usage/AuditDetailDrawer.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/page.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/_components/ResourcePolicyEditor.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/_components/ResourcePolicyExplainabilityPanel.tsx' \
  'src/lib/governance-explainability-presenter.ts' \
  'src/lib/hooks/use-governance-explainability.ts'"
run_cmd "npx tsc --noEmit"

run_cmd "npm run test:run -- \
  'src/lib/__tests__/governance-explainability-presenter.test.ts' \
  'src/lib/api/__tests__/governance-explainability-api.test.ts' \
  'src/lib/hooks/__tests__/use-governance-explainability.test.tsx' \
  'src/components/members/__tests__/PeopleTab.test.tsx' \
  'src/components/members/__tests__/MemberDetailDrawer.test.tsx' \
  'src/components/audit-usage/__tests__/AuditDetailDrawer.test.tsx' \
  'src/components/alerts/__tests__/AlertNotificationsPanel.test.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/__tests__/page.test.tsx'"

run_cmd "node --max-old-space-size=6144 ./node_modules/vitest/vitest.mjs run \
  'packages/api-entry-node/src/index.test.ts' \
  -t 'denies suspended memberships in route authz and authorize endpoint'"

run_cmd "bash scripts/run-mock-lane-playwright.sh \
  e2e/governance-mainline.spec.ts \
  --project=chromium \
  --workers=1"

run_cmd "bash scripts/run-mock-lane-playwright.sh \
  e2e/visual.spec.ts \
  --project=visual \
  --workers=1 \
  --grep 'members$|members - effective access drawer|resource policy|audit detail drawer|alerts - notifications tab'"

info "governance mainline gate passed"
