#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

bash "${ROOT_DIR}/scripts/cluster-deploy/deploy-sandbox.sh"

source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
state_set release.phase upgrade_sandbox_completed
log "upgrade-sandbox ok"
