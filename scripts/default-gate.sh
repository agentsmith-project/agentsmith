#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
unset no_proxy NO_PROXY

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/next-generated-root-state.sh"
DEFAULT_GATE_PROFILE="${DEFAULT_GATE_PROFILE:-standalone}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --campaign-after-gate-fast)
      DEFAULT_GATE_PROFILE="campaign_after_gate_fast"
      shift
      ;;
    *)
      echo "[default-gate] unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

info() { echo "[default-gate] $*"; }

run_cmd() {
  info "$*"
  (cd "${ROOT_DIR}" && eval "$*")
}

run_default_gate_typegen() {
  run_cmd "npx next typegen ."
}

run_default_gate_typecheck() {
  run_cmd "npx tsc --noEmit"
}

run_default_gate_build() {
  run_cmd "npm run build"
}

case "${DEFAULT_GATE_PROFILE}" in
  standalone|fast|campaign_after_gate_fast)
    ;;
  *)
    echo "[default-gate] unknown DEFAULT_GATE_PROFILE: ${DEFAULT_GATE_PROFILE}" >&2
    exit 1
    ;;
esac

next_generated_root_with_source_contract_lock default_gate_shared_preflight \
  next_generated_root_prepare_for_validation

if [[ "${DEFAULT_GATE_PROFILE}" != "campaign_after_gate_fast" ]]; then
  run_cmd "npm run contracts:check"
fi
run_cmd "npm run contracts:check-openapi"
run_cmd "npm run openapi:check-generated"
run_cmd "npm run lint"
next_generated_root_run_locked_type_state_gate_sequence \
  default_gate_type_state \
  run_default_gate_typegen \
  run_default_gate_typecheck \
  run_default_gate_build

if [[ "${DEFAULT_GATE_PROFILE}" == "fast" ]]; then
  run_cmd "npm run test:e2e:lane:mock:smoke"
  info "fast engineering gate passed"
  exit 0
fi

run_cmd "bash scripts/workspace-project-default-gate.sh --skip-shared-preflight"
run_cmd "bash scripts/governance-default-gate.sh --skip-shared-preflight"

info "default engineering gate passed"
