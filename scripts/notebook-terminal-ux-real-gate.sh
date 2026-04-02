#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/local-manual/common.sh"

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

export BASE_URL="${BASE_URL:-http://localhost:3101}"
export INTEGRATION_API_BASE="${INTEGRATION_API_BASE:-http://localhost:21000}"
export INTEGRATION_LOCALE="${INTEGRATION_LOCALE:-en-US}"
export INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES="${INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES:-true}"
export INTEGRATION_NOTEBOOK_TERMINAL_WORKSPACE_ID="${INTEGRATION_NOTEBOOK_TERMINAL_WORKSPACE_ID:-ws_default}"
export INTEGRATION_NOTEBOOK_TERMINAL_PROJECT_ID="${INTEGRATION_NOTEBOOK_TERMINAL_PROJECT_ID:-$(state_get project.id)}"
export INTEGRATION_NOTEBOOK_TERMINAL_AGENT_ID="${INTEGRATION_NOTEBOOK_TERMINAL_AGENT_ID:-$(state_get agent.id)}"
TOKEN_FILE="${TOKEN_FILE:-${ROOT_DIR}/artifacts/backend-real/current/token.txt}"

if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "[notebook-terminal-ux-gate] missing token file: ${TOKEN_FILE}" >&2
  exit 1
fi

TERMINAL_SMOKE_OUTPUT=""
for attempt in 1 2 3; do
  if TERMINAL_SMOKE_OUTPUT="$(bash "${ROOT_DIR}/scripts/notebook-terminal-internal-real-smoke.sh" 2>&1)"; then
    break
  fi
  if [[ "${attempt}" == "3" ]]; then
    echo "${TERMINAL_SMOKE_OUTPUT}" >&2
    exit 1
  fi
  bash "${ROOT_DIR}/scripts/local-manual/up.sh" >/dev/null 2>&1 || true
  bash "${ROOT_DIR}/scripts/local-manual/internal-up.sh" >/dev/null 2>&1 || true
  bash "${ROOT_DIR}/scripts/local-manual/seed-notebook-demo.sh" >/dev/null 2>&1 || true
  sleep $((attempt * 2))
done

export INTEGRATION_NOTEBOOK_TERMINAL_TASK_ID="$(printf '%s\n' "${TERMINAL_SMOKE_OUTPUT}" | sed -n 's/.* task=\([^ ]*\)$/\1/p' | tail -n 1)"
if [[ -z "${INTEGRATION_NOTEBOOK_TERMINAL_TASK_ID}" ]]; then
  echo "[notebook-terminal-ux-gate] failed to resolve smoke task id" >&2
  echo "${TERMINAL_SMOKE_OUTPUT}" >&2
  exit 1
fi

cd "${ROOT_DIR}"
npx playwright test --config playwright.config.integration.ts e2e/integration-notebook-terminal-ux.spec.ts --project=chromium --workers=1
