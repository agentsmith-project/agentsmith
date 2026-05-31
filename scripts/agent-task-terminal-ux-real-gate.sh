#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
bash "${ROOT_DIR}/scripts/local-manual/require-monorepo-runner-diagnostic-opt-in.sh" "scripts/agent-task-terminal-ux-real-gate.sh"

source "${ROOT_DIR}/scripts/local-manual/common.sh"

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

cleanup_on_exit() {
  local exit_code="${1:-0}"
  if [[ "${exit_code}" != "0" ]]; then
    bash "${ROOT_DIR}/scripts/local-manual/down.sh" >/dev/null 2>&1 || true
  fi
}
trap 'cleanup_on_exit $?' EXIT INT TERM

export INTEGRATION_LOCALE="${INTEGRATION_LOCALE:-en-US}"
export INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES="${INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES:-true}"

AGENT_TASK_TERMINAL_MATRIX_FINAL_MODE=managed_agent_task bash "${ROOT_DIR}/scripts/agent-task-terminal-matrix-real-gate.sh"

init_local_manual_env

if [[ -z "${MONGO_URL:-}" ]]; then
  echo "[agent-task-terminal-ux] backend_real_mongo_url_missing: MONGO_URL is required after local-manual env initialization" >&2
  exit 1
fi

export MONGO_URL
export MONGO_DB_NAME="${MONGO_DB_NAME:-mbos}"
export BASE_URL="${BASE_URL:-http://localhost:${PORT_WEB}}"
export INTEGRATION_API_BASE="${INTEGRATION_API_BASE:-http://localhost:${PORT_API}}"

cd "${ROOT_DIR}"
npx playwright test --config playwright.config.integration.ts e2e/integration-agent-task-terminal-ux.spec.ts --project=chromium --workers=1
