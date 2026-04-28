#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

ensure_dirs
load_site_env
render_admin_handoff

state_set release.phase admin_handoff_prepared
state_set admin.ready 0
log "admin handoff prepared at ${ADMIN_HANDOFF_DIR}"
log "wait for the cluster administrator to complete CHECKLIST.md and set ADMIN_READY=1 in ${SHARED_ADMIN_READY_ENV}"
