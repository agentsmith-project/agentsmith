#!/usr/bin/env bash
set -euo pipefail

release_check_init_tmp_root() {
  TMP_ROOT="$(mktemp -d)"
  trap 'rm -rf "${TMP_ROOT}"' EXIT
  export TMP_ROOT
}

release_check_require_files() {
  local error_prefix="$1"
  shift
  local required_file
  for required_file in "$@"; do
    [[ -f "${required_file}" ]] || {
      echo "${error_prefix}:${required_file}" >&2
      exit 1
    }
  done
}

release_check_require_exact_line() {
  local file_path="$1"
  local expected_line="$2"
  local error_key="$3"
  grep -Fxq "${expected_line}" "${file_path}" || {
    echo "${error_key}" >&2
    exit 1
  }
}

release_check_require_pattern() {
  local file_path="$1"
  local pattern="$2"
  local error_key="$3"
  grep -E "${pattern}" "${file_path}" >/dev/null || {
    echo "${error_key}" >&2
    exit 1
  }
}

release_check_forbid_pattern() {
  local file_path="$1"
  local pattern="$2"
  local error_key="$3"
  if grep -E "${pattern}" "${file_path}" >/dev/null; then
    echo "${error_key}" >&2
    exit 1
  fi
}
