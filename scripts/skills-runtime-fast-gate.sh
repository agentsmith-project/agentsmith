#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

info() { echo "[skills-runtime-fast-gate] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

run_cmd "npx tsc --noEmit"

run_cmd "npx tsx scripts/contracts/check-runner-naming.ts"

run_cmd "npm run test:run -- \
  packages/notebook-codex-runner/src/builtin-skills.test.ts \
  packages/notebook-codex-runner/src/package-metadata.test.ts \
  packages/notebook-codex-runner/src/terminal-runtime.test.ts \
  packages/notebook-codex-runner/src/notebook-assets.test.ts \
  packages/chat-llm-runner/src/index.test.ts \
  packages/chat-llm-runner/src/package-metadata.test.ts \
  packages/agent-runner/src/runner-spec.test.ts \
  packages/agent-runner/src/runtime-env.test.ts \
  packages/api-entry-node/src/context-store.test.ts \
  packages/api-entry-node/src/context-route-handler.test.ts \
  packages/api-entry-node/src/__integration__/context-store.integration.test.ts \
  packages/api-entry-node/src/__integration__/notebook-tasks.integration.test.ts"

run_cmd "python3 -m unittest \
  packages/notebook-codex-runner/builtin-skills/mbos-context/scripts/context_cli_test.py \
  packages/notebook-codex-runner/builtin-skills/jira-ops/scripts/jira_ops_test.py \
  packages/notebook-codex-runner/builtin-skills/feishu-docs/scripts/feishu_mcp_test.py"

info "skill runtime fast gate passed"
