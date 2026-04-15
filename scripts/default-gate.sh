#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"

info() { echo "[default-gate] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

next_generated_root_prepare_for_validation

run_cmd "npm run contracts:check"
run_cmd "npm run contracts:check-openapi"
run_cmd "npm run openapi:check-generated"
run_cmd "npx next typegen ."
run_cmd "npx tsc --noEmit"
run_cmd "bash scripts/workspace-project-default-gate.sh --skip-shared-preflight"
run_cmd "bash scripts/governance-default-gate.sh --skip-shared-preflight"

info "default engineering gate passed"
