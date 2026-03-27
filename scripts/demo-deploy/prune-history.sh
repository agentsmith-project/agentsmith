#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(basename "${SCRIPT_DIR}")" == "demo-deploy" ]]; then
  ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
else
  ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi
source "${ROOT_DIR}/scripts/lib/common.sh"

KEEP_RELEASES="${KEEP_RELEASES:-2}"
KEEP_UPLOADS="${KEEP_UPLOADS:-2}"
KEEP_REPORTS="${KEEP_REPORTS:-10}"

ensure_dirs

current_target=""
if [[ -L "${CURRENT_LINK}" ]]; then
  current_target="$(readlink -f "${CURRENT_LINK}")"
fi

prune_directory_keep_latest() {
  local dir="$1"
  local keep_count="$2"
  local protect_path="${3:-}"
  [[ -d "${dir}" ]] || return 0

  mapfile -t entries < <(find "${dir}" -mindepth 1 -maxdepth 1 -printf '%T@ %p\n' | sort -nr | awk '{ $1=""; sub(/^ /, ""); print }')
  local index=0
  local entry real_entry
  for entry in "${entries[@]}"; do
    [[ -n "${entry}" ]] || continue
    real_entry="$(readlink -f "${entry}" 2>/dev/null || printf '%s' "${entry}")"
    if [[ -n "${protect_path}" && "${real_entry}" == "${protect_path}" ]]; then
      continue
    fi
    index=$((index + 1))
    if (( index <= keep_count )); then
      continue
    fi
    rm -rf "${entry}"
    log "pruned $(basename "${entry}")"
  done
}

prune_directory_keep_latest "${DEMO_DEPLOY_ROOT}/releases" "${KEEP_RELEASES}" "${current_target}"
prune_directory_keep_latest "${DEMO_DEPLOY_ROOT}/uploads" "${KEEP_UPLOADS}"
prune_directory_keep_latest "${REPORT_DIR}" "${KEEP_REPORTS}"

find "${STATE_DIR}" -mindepth 1 -maxdepth 1 -type f -delete 2>/dev/null || true
find "${LOG_DIR}" -mindepth 1 -maxdepth 1 -type f -delete 2>/dev/null || true

log "prune-history ok"
