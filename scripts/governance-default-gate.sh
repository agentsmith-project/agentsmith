#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"
SKIP_SHARED_PREFLIGHT=0
SKIP_FOCUSED_VISUAL="${GOVERNANCE_DEFAULT_GATE_SKIP_FOCUSED_VISUAL:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-shared-preflight)
      SKIP_SHARED_PREFLIGHT=1
      shift
      ;;
    --skip-focused-visual)
      SKIP_FOCUSED_VISUAL=1
      shift
      ;;
    *)
      echo "[governance-gate] unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

info() { echo "[governance-gate] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

if [[ "${SKIP_SHARED_PREFLIGHT}" != "1" ]]; then
  next_generated_root_prepare_for_validation

  run_cmd "npm run contracts:check"
  run_cmd "npm run contracts:check-openapi"
  run_cmd "npm run openapi:check-generated"
  run_cmd "npx tsc --noEmit"
fi

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

run_cmd "npm run test:run -- \
  'src/components/members/__tests__/JoinRequestsTab.test.tsx' \
  'src/lib/__tests__/governance-explainability-presenter.test.ts' \
  'src/lib/api/__tests__/governance-explainability-api.test.ts' \
  'src/lib/hooks/__tests__/use-governance-explainability.test.tsx' \
  'src/components/members/__tests__/PeopleTab.test.tsx' \
  'src/components/members/__tests__/MemberDetailDrawer.test.tsx' \
  'src/components/members/__tests__/MembersPage.test.tsx' \
  'src/components/audit-usage/__tests__/AuditDetailDrawer.test.tsx' \
  'src/components/alerts/__tests__/AlertNotificationsPanel.test.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/__tests__/page.test.tsx' \
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/settings/__tests__/page.test.tsx'"

run_cmd "node --max-old-space-size=6144 ./node_modules/vitest/vitest.mjs run \
  'packages/api-entry-node/src/index.test.ts' \
  -t 'denies suspended memberships in route authz and authorize endpoint'"

run_cmd "bash scripts/run-mock-lane-playwright.sh \
  e2e/governance-default.spec.ts \
  --project=chromium \
  --workers=1"

if [[ "${SKIP_FOCUSED_VISUAL}" == "1" ]]; then
  info "skipping governance focused visual mock lane; full visual evidence is owned by lane:visual"
else
  run_cmd "bash scripts/run-mock-lane-playwright.sh \
    e2e/visual.spec.ts \
    --project=visual \
    --workers=1 \
    --grep 'governance_pages / members|members-effective-access-drawer|governance_pages / resource-policy|drawer-audit-detail|alerts-notifications-tab'"
fi

info "governance default gate passed"
