#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESTORE_CONTINUATION_SPEC="e2e/integration-files-user-stories.spec.ts"
RESTORE_CONTINUATION_GREP="same task can continue after Files restore"

if [[ "${1:-}" == "--list" ]]; then
  shift
  (cd "${ROOT_DIR}" && npx playwright test --list --config playwright.config.integration.ts \
    "${RESTORE_CONTINUATION_SPEC}" \
    --project=chromium \
    --grep "${RESTORE_CONTINUATION_GREP}" \
    "$@")
  exit 0
fi

(cd "${ROOT_DIR}" && bash scripts/run-internal-agent-task-real-gate.sh --files-restore-continue -- "$@")
