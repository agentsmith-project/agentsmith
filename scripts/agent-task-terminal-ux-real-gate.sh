#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/local-manual/common.sh"

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

cleanup_on_exit() {
  local exit_code="${1:-0}"
  if [[ "${exit_code}" != "0" ]]; then
    bash "${ROOT_DIR}/scripts/local-manual/down.sh" >/dev/null 2>&1 || true
  fi
}
trap 'cleanup_on_exit $?' EXIT INT TERM

export BASE_URL="${BASE_URL:-http://localhost:3101}"
export INTEGRATION_API_BASE="${INTEGRATION_API_BASE:-http://localhost:21000}"
export INTEGRATION_LOCALE="${INTEGRATION_LOCALE:-en-US}"
export INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES="${INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES:-true}"

bash "${ROOT_DIR}/scripts/agent-task-terminal-matrix-real-gate.sh"

cd "${ROOT_DIR}"
npx playwright test --config playwright.config.integration.ts e2e/integration-agent-task-terminal-ux.spec.ts --project=chromium --workers=1
