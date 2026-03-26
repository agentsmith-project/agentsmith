#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${ROOT_DIR}/scripts/cluster-deploy/lib.sh"

KEEP_RELEASES="${KEEP_RELEASES:-2}"
KEEP_UPLOADS="${KEEP_UPLOADS:-2}"
KEEP_REPORTS="${KEEP_REPORTS:-10}"

prune_directory_keep_latest() {
  local dir="$1"
  local keep="$2"
  [[ -d "${dir}" ]] || return 0
  mapfile -t entries < <(find "${dir}" -mindepth 1 -maxdepth 1 -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
  local index=0
  local current_target=""
  [[ -L "${CURRENT_LINK}" ]] && current_target="$(readlink -f "${CURRENT_LINK}")"
  for entry in "${entries[@]}"; do
    index=$((index + 1))
    [[ -n "${current_target}" && "$(readlink -f "${entry}" 2>/dev/null || true)" == "${current_target}" ]] && continue
    if (( index > keep )); then
      rm -rf "${entry}"
    fi
  done
}

prune_directory_keep_latest "${CLUSTER_DEPLOY_ROOT}/releases" "${KEEP_RELEASES}"
prune_directory_keep_latest "${CLUSTER_DEPLOY_ROOT}/uploads" "${KEEP_UPLOADS}"
prune_directory_keep_latest "${REPORT_DIR}" "${KEEP_REPORTS}"
log "prune-history ok"

