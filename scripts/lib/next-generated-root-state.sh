#!/usr/bin/env bash

next_generated_root_repo_dir() {
  printf '%s\n' "${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
}

next_generated_root_state_dir() {
  local state_dir="${1:-${NEXT_GENERATED_ROOT_STATE_DIR:-}}"
  if [[ -n "${state_dir}" ]]; then
    printf '%s\n' "${state_dir}"
    return 0
  fi

  local repo_dir temp_dir temp_root
  repo_dir="$(next_generated_root_repo_dir)"
  temp_root="${repo_dir}/artifacts/runtime"
  mkdir -p "${temp_root}"
  temp_dir="$(mktemp -d "${temp_root}/next-root-state.XXXXXX")"
  printf '%s\n' "${temp_dir}"
}

next_generated_root_canonical_next_env() {
  cat <<'EOF'
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
EOF
}

next_generated_root_snapshot() {
  local state_dir="$1"
  local repo_dir snapshot_dir
  repo_dir="$(next_generated_root_repo_dir)"
  snapshot_dir="${state_dir}/root-files"
  mkdir -p "${snapshot_dir}"

  cp "${repo_dir}/tsconfig.json" "${snapshot_dir}/tsconfig.json"
  if [[ -f "${repo_dir}/next-env.d.ts" ]]; then
    cp "${repo_dir}/next-env.d.ts" "${snapshot_dir}/next-env.d.ts"
    rm -f "${snapshot_dir}/next-env.absent"
  else
    rm -f "${snapshot_dir}/next-env.d.ts"
    : > "${snapshot_dir}/next-env.absent"
  fi
}

next_generated_root_restore() {
  local state_dir="$1"
  local repo_dir snapshot_dir
  repo_dir="$(next_generated_root_repo_dir)"
  snapshot_dir="${state_dir}/root-files"
  [[ -d "${snapshot_dir}" ]] || return 0

  if [[ -f "${snapshot_dir}/tsconfig.json" ]]; then
    cp "${snapshot_dir}/tsconfig.json" "${repo_dir}/tsconfig.json"
  fi

  if [[ -f "${snapshot_dir}/next-env.d.ts" ]]; then
    cp "${snapshot_dir}/next-env.d.ts" "${repo_dir}/next-env.d.ts"
  else
    next_generated_root_canonical_next_env > "${repo_dir}/next-env.d.ts"
  fi
}
