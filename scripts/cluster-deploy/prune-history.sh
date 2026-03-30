#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"
source "${ROOT_DIR}/scripts/lib/release-stage-common.sh"

KEEP_RELEASES="${KEEP_RELEASES:-2}"
KEEP_UPLOADS="${KEEP_UPLOADS:-2}"
KEEP_REPORTS="${KEEP_REPORTS:-10}"

current_target=""
[[ -L "${CURRENT_LINK}" ]] && current_target="$(readlink -f "${CURRENT_LINK}")"

prune_directory_keep_latest "${CLUSTER_DEPLOY_ROOT}/releases" "${KEEP_RELEASES}" "${current_target}"
prune_directory_keep_latest "${CLUSTER_DEPLOY_ROOT}/uploads" "${KEEP_UPLOADS}"
prune_directory_keep_latest "${REPORT_DIR}" "${KEEP_REPORTS}"
log "prune-history ok"
