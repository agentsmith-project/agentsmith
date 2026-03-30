#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "demo-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
source "${ROOT_DIR}/scripts/lib/common.sh"
source "${ROOT_DIR}/scripts/lib/release-stage-common.sh"

KEEP_RELEASES="${KEEP_RELEASES:-2}"
KEEP_UPLOADS="${KEEP_UPLOADS:-2}"
KEEP_REPORTS="${KEEP_REPORTS:-10}"

ensure_dirs

current_target=""
if [[ -L "${CURRENT_LINK}" ]]; then
  current_target="$(readlink -f "${CURRENT_LINK}")"
fi

prune_directory_keep_latest "${DEMO_DEPLOY_ROOT}/releases" "${KEEP_RELEASES}" "${current_target}"
prune_directory_keep_latest "${DEMO_DEPLOY_ROOT}/uploads" "${KEEP_UPLOADS}"
prune_directory_keep_latest "${REPORT_DIR}" "${KEEP_REPORTS}"

find "${STATE_DIR}" -mindepth 1 -maxdepth 1 -type f -delete 2>/dev/null || true
find "${LOG_DIR}" -mindepth 1 -maxdepth 1 -type f -delete 2>/dev/null || true

log "prune-history ok"
