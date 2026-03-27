#!/usr/bin/env bash
set -euo pipefail

ensure_juicefs_vendor_dir() {
  local source_root="$1"
  local juicefs_version="${2:-1.3.0}"
  local download_base_url="${3:-https://github.com/juicedata/juicefs/releases/download/v${juicefs_version}}"
  local vendor_dir="${source_root}/infra/vendor/juicefs"
  local arch archive

  mkdir -p "${vendor_dir}"
  for arch in amd64 arm64; do
    archive="juicefs-${juicefs_version}-linux-${arch}.tar.gz"
    if [[ ! -f "${vendor_dir}/${archive}" ]]; then
      curl --fail --show-error --location --retry 5 --retry-delay 2 --retry-all-errors \
        "${download_base_url}/${archive}" \
        -o "${vendor_dir}/${archive}"
    fi
  done

  printf '%s\n' "${vendor_dir}"
}
