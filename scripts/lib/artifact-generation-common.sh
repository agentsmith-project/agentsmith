#!/usr/bin/env bash
set -euo pipefail

artifact_log() {
  local label="$1"
  shift
  printf '[%s] %s\n' "${label}" "$*"
}

artifact_prepare_dir() {
  local path="$1"
  rm -rf "${path}"
  mkdir -p "${path}"
}

artifact_sync_dir() {
  local src="$1"
  local dst="$2"
  artifact_prepare_dir "${dst}"
  cp -R "${src}/." "${dst}/"
}
