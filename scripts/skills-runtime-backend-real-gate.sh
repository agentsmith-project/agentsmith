#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/lib/backend-real-env.sh"

info() { echo "[skills-runtime-backend-real-gate] $*"; }
die() { echo "[skills-runtime-backend-real-gate] $*" >&2; exit 1; }

load_backend_real_env
export_backend_real_endpoint_env

if [[ -z "${BACKEND_REAL_API_KEY_VALUE:-}" ]]; then
  die "missing PRESET_ENDPOINT_API_KEY in .env.backend-real"
fi

run_grep() {
  local spec="$1"
  local label="$2"
  info "running ${spec} --grep ${label}"
  (cd "${ROOT_DIR}" && bash scripts/run-integration-e2e-full.sh "${spec}" --grep "${label}")
}

run_grep e2e/integration-agents-codex-runner.spec.ts "reads member context through mbos-context"
run_grep e2e/integration-agents-codex-runner.spec.ts "writes member context through mbos-context and persists it"
run_grep e2e/integration-agents-codex-runner.spec.ts "rejects task scope in chat codex-runner sessions"
run_grep e2e/integration-agents-codex-runner.spec.ts "rejects shared workspace context writes in chat codex-runner sessions"

run_grep e2e/integration-notebook-codex-runner.spec.ts "reads task context through mbos-context in a real notebook codex runner task"
run_grep e2e/integration-notebook-codex-runner.spec.ts "writes task context through mbos-context and persists it for the task owner"
run_grep e2e/integration-notebook-codex-runner.spec.ts "uses jira-ops task context before member context inside a real notebook terminal session"
run_grep e2e/integration-notebook-codex-runner.spec.ts "uses feishu-docs managed credential projection inside a real notebook terminal session"
run_grep e2e/integration-notebook-codex-runner.spec.ts "reads task context through mbos-context inside a real notebook terminal session"
run_grep e2e/integration-notebook-codex-runner.spec.ts "rejects shared workspace context writes inside a real notebook terminal session"

run_grep e2e/integration-context-store-isolation.spec.ts "member context stays private between workspace members"
run_grep e2e/integration-context-store-isolation.spec.ts "task context stays private to the task owner within the same workspace"

info "skill runtime backend-real gate passed"
