#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"

info() { echo "[chat-runtime-fast-gate] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

run_typecheck_with_root_preflight() {
  next_generated_root_prepare_source_safe_for_tsc
  run_cmd "npx tsc --noEmit"
}

next_generated_root_with_source_contract_lock chat_runtime_typecheck run_typecheck_with_root_preflight

run_cmd "npm run test:run -- \
  scripts/lib/next-generated-root-state.test.ts \
  scripts/run-next-dev-safe.test.ts \
  packages/agent-runner/src/runner-spec.test.ts \
  packages/agent-runner/src/runtime-env.test.ts \
  packages/api-entry-node/src/chat-execution-messages.test.ts \
  packages/chat-llm-runner/src/message-selection.test.ts \
  packages/chat-llm-runner/src/session-workdir.test.ts \
  packages/chat-llm-runner/src/index.test.ts \
  packages/api-entry-node/src/agent-execution-service.test.ts \
  packages/api-entry-node/src/context-route-handler.test.ts \
  packages/api-entry-node/src/index.test.ts \
  packages/api-entry-node/src/__integration__/chat-isolation.integration.test.ts \
  src/lib/chat/__tests__/use-chat-streaming.test.tsx"

info "chat runtime fast gate passed"
