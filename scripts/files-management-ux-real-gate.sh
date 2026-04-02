#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

export BASE_URL="${BASE_URL:-http://localhost:3101}"
export INTEGRATION_API_BASE="${INTEGRATION_API_BASE:-http://localhost:21000}"
export INTEGRATION_LOCALE="${INTEGRATION_LOCALE:-en-US}"
export INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES="${INTEGRATION_PRESEEDED_SYSTEM_WORKSPACES:-true}"

cd "${ROOT_DIR}"
npx playwright test --config playwright.config.integration.ts e2e/integration-files-management-ux.spec.ts --project=chromium --workers=1
