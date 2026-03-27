#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
export DEPLOY_ROOT_DEFAULT="${DEPLOY_ROOT_DEFAULT:-${REMOTE_DEPLOY_ROOT_DEFAULT:-${HOME}/agentsmith/deploy}}"
export DEPLOY_LOG_PREFIX="${DEPLOY_LOG_PREFIX:-remote-deploy}"
source "${ROOT_DIR}/scripts/lib/deploy-common.sh"
export REMOTE_DEPLOY_ROOT="${DEPLOY_ROOT}"
