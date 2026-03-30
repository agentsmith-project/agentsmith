#!/usr/bin/env bash
set -euo pipefail

release_substrate_services() {
  printf '%s\n' postgres mongo redis minio minio-init keycloak universal-proxy
}

release_substrate_up() {
  docker_compose up -d $(release_substrate_services)
}

cleanup_report_dir_artifacts() {
  local report_dir="$1"
  [[ -d "${report_dir}" ]] || return 0
  docker run --rm \
    --user 0:0 \
    --entrypoint /bin/sh \
    -v "${report_dir}:/artifacts" \
    minio/mc:latest \
    -lc "rm -rf /artifacts/* /artifacts/.[!.]* /artifacts/..?* 2>/dev/null || true; chown -R $(id -u):$(id -g) /artifacts || true"
}
