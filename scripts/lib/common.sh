#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DEPLOY_ROOT_DEFAULT="${DEPLOY_ROOT_DEFAULT:-${DEMO_DEPLOY_ROOT_DEFAULT:-${HOME}/agentsmith/deploy}}"
export DEPLOY_LOG_PREFIX="${DEPLOY_LOG_PREFIX:-demo-deploy}"
source "${SCRIPT_DIR}/deploy-common.sh"
export DEMO_DEPLOY_ROOT="${DEPLOY_ROOT}"
