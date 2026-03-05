#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MAX_ATTEMPTS="${WS_TYPECHECK_MAX_ATTEMPTS:-3}"

log() { echo "[ws-typecheck-safe] $*"; }
err() { echo "[ws-typecheck-safe] ERROR: $*" >&2; }

run_pkg_typecheck() {
  local pkg="$1"
  local attempt=1
  while [[ "${attempt}" -le "${MAX_ATTEMPTS}" ]]; do
    log "typecheck ${pkg} (attempt ${attempt}/${MAX_ATTEMPTS})"
    set +e
    (cd "${ROOT_DIR}" && npm run -w "${pkg}" typecheck --if-present)
    local code=$?
    set -e

    if [[ "${code}" -eq 0 ]]; then
      return 0
    fi

    if [[ "${code}" -eq 139 ]]; then
      log "detected transient SIGSEGV (139) on ${pkg}; retrying"
      attempt=$((attempt + 1))
      continue
    fi

    err "typecheck failed for ${pkg} with exit code ${code}"
    return "${code}"
  done

  err "typecheck failed for ${pkg} after ${MAX_ATTEMPTS} attempts"
  return 139
}

mapfile -t PKGS < <(cd "${ROOT_DIR}" && find packages -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)

for name in "${PKGS[@]}"; do
  run_pkg_typecheck "@mbos/${name}"
done

log "all workspace typechecks passed"
