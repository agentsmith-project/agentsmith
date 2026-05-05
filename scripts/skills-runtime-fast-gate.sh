#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"

info() { echo "[skills-runtime-fast-gate] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

run_typecheck_with_root_preflight() {
  next_generated_root_prepare_source_safe_for_tsc
  run_cmd "npx tsc --noEmit"
}

next_generated_root_with_source_contract_lock skills_runtime_typecheck run_typecheck_with_root_preflight

run_cmd "npx tsx scripts/contracts/check-runner-naming.ts"

run_cmd "npm run test:run -- \
  packages/agent-task-runner/src/builtin-skills.test.ts \
  packages/agent-task-runner/src/package-metadata.test.ts \
  packages/agent-task-runner/src/terminal-runtime.test.ts \
  packages/agent-task-runner/src/task-assets.test.ts \
  packages/agent-runner/src/runner-spec.test.ts \
  packages/agent-runner/src/runtime-env.test.ts \
  packages/api-entry-node/src/context-store.test.ts \
  packages/api-entry-node/src/context-route-handler.test.ts \
  packages/api-entry-node/src/__integration__/context-store.integration.test.ts"

run_cmd "python3 -m unittest \
  packages/agent-task-runner/builtin-skills/mbos-context/scripts/context_cli_test.py \
  packages/agent-task-runner/builtin-skills/jira-ops/scripts/jira_ops_test.py \
  packages/agent-task-runner/builtin-skills/feishu-docs/scripts/feishu_mcp_test.py"

info "skill runtime fast gate passed"
