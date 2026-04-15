#!/usr/bin/env bash

runtime_lines_root_relative() {
  printf '%s\n' "${RUNTIME_LINES_ROOT_RELATIVE:-artifacts/runtime/lines}"
}

runtime_lines_root() {
  local root_dir="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
  if [[ -n "${RUNTIME_LINES_ROOT:-}" ]]; then
    printf '%s\n' "${RUNTIME_LINES_ROOT}"
  else
    printf '%s/%s\n' "${root_dir}" "$(runtime_lines_root_relative)"
  fi
}

runtime_line_root_relative() {
  local line_id="$1"
  printf '%s/%s\n' "$(runtime_lines_root_relative)" "${line_id}"
}

runtime_line_current_relative() {
  local line_id="$1"
  printf '%s/current\n' "$(runtime_line_root_relative "${line_id}")"
}

runtime_line_root() {
  local line_id="$1"
  printf '%s/%s\n' "$(runtime_lines_root)" "${line_id}"
}

runtime_line_current_root() {
  local line_id="$1"
  printf '%s/current\n' "$(runtime_line_root "${line_id}")"
}

runtime_line_current_path() {
  local line_id="$1"
  local suffix="$2"
  printf '%s/%s\n' "$(runtime_line_current_root "${line_id}")" "${suffix}"
}

runtime_line_current_relative_path() {
  local line_id="$1"
  local suffix="$2"
  printf '%s/%s\n' "$(runtime_line_current_relative "${line_id}")" "${suffix}"
}

ensure_runtime_line_current_root() {
  local line_id="$1"
  local current_root
  current_root="$(runtime_line_current_root "${line_id}")"
  mkdir -p "${current_root}"
  printf '%s\n' "${current_root}"
}

local_manual_runtime_root() {
  runtime_line_current_root "local-manual"
}

local_manual_runtime_path() {
  local suffix="$1"
  runtime_line_current_path "local-manual" "${suffix}"
}

local_manual_next_dist_dir() {
  if [[ -n "${RUNTIME_LINES_ROOT:-}" ]]; then
    runtime_line_current_path "local-manual" "next-dist"
  else
    runtime_line_current_relative_path "local-manual" "next-dist"
  fi
}
