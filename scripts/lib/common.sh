#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DEPLOY_ROOT_DEFAULT="${DEPLOY_ROOT_DEFAULT:-${DEMO_DEPLOY_ROOT_DEFAULT:-${HOME}/agentsmith/deploy}}"
export DEPLOY_LOG_PREFIX="${DEPLOY_LOG_PREFIX:-demo-deploy}"
source "${SCRIPT_DIR}/deploy-common.sh"
export DEMO_DEPLOY_ROOT="${DEPLOY_ROOT}"

demo_deploy_mode() {
  local mode="${DEMO_DEPLOY_MODE:-full}"
  case "${mode}" in
    full|simple)
      printf '%s\n' "${mode}"
      ;;
    *)
      die "invalid DEMO_DEPLOY_MODE: ${mode} (expected full or simple)"
      ;;
  esac
}

demo_mode_is_full() {
  [[ "$(demo_deploy_mode)" == "full" ]]
}

demo_mode_is_simple() {
  [[ "$(demo_deploy_mode)" == "simple" ]]
}
